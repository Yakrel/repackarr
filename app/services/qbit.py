import httpx
import logging
import re
from datetime import datetime
from guessit import guessit
from sqlmodel import Session, select
from app.config import get_settings
from app.models import Game, GameStatus
from app.services.igdb import IGDBService
from app.utils import extract_version, sanitize_search_query

logger = logging.getLogger("repackarr")
settings = get_settings()


class QBitService:
    """
    Service for interacting with qBittorrent WebUI API.
    Syncs completed torrents from a configured category into the game library.
    """
    
    def __init__(self):
        self.base_url = settings.QBIT_HOST
        self.client = httpx.AsyncClient(timeout=30.0, verify=False)
        self.cookies: dict = {}
        self.igdb = IGDBService()

    async def login(self) -> bool:
        """
        Authenticate with qBittorrent WebUI.
        
        Returns:
            True if login successful, False otherwise
        """
        try:
            resp = await self.client.post(
                f"{self.base_url}/api/v2/auth/login",
                data={
                    "username": settings.QBIT_USERNAME,
                    "password": settings.QBIT_PASSWORD
                }
            )
            if resp.status_code == 200 and "SID" in resp.cookies:
                self.cookies = dict(resp.cookies)
                logger.info("Successfully authenticated with qBittorrent")
                return True
                
            logger.error(f"qBittorrent login failed: {resp.text}")
            return False
        except httpx.RequestError as e:
            logger.error(f"qBittorrent connection error: {e}")
            return False
        except Exception as e:
            logger.error(f"qBittorrent login error: {e}")
            return False

    async def sync_games(self, session: Session) -> int:
        """
        Sync games from qBittorrent to the database.
        
        Args:
            session: Database session
            
        Returns:
            Number of games synced/updated
        """
        if not self.cookies:
            if not await self.login():
                return 0

        try:
            resp = await self.client.get(
                f"{self.base_url}/api/v2/torrents/info",
                params={"category": settings.QBIT_CATEGORY},
                cookies=self.cookies
            )
            resp.raise_for_status()
            torrents = resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"qBittorrent API error: {e.response.status_code}")
            return 0
        except httpx.RequestError as e:
            logger.error(f"Failed to fetch torrents: {e}")
            return 0
        except Exception as e:
            logger.error(f"Failed to fetch torrents: {e}")
            return 0

        synced_count = 0
        
        for torrent in torrents:
            try:
                if await self._process_torrent(torrent, session):
                    synced_count += 1
            except Exception as e:
                logger.error(f"Error processing torrent {torrent.get('name')}: {e}")
        
        session.commit()
        logger.info(f"Synced {synced_count} game(s) from qBittorrent")
        return synced_count

    async def _process_torrent(self, torrent: dict, session: Session) -> bool:
        """
        Process a single torrent and sync it to the database.
        
        Args:
            torrent: Torrent info from qBittorrent API
            session: Database session
            
        Returns:
            True if game was added/updated, False otherwise
        """
        # Get completion date, fallback to added date
        ts = torrent.get('completion_on', 0)
        if ts <= 0:
            ts = torrent.get('added_on', 0)
        
        if ts <= 0:
            return False
        
        # Use UTC datetime for consistency with Prowlarr/Database
        torrent_date = datetime.utcfromtimestamp(ts)
        
        raw_name = torrent.get('name', '')
        if not raw_name:
            return False
            
        logger.debug(f"Processing torrent: {raw_name}")
        
        # Parse title using guessit
        parsed = guessit(raw_name)
        title = parsed.get('title')
        
        if not title:
            logger.warning(f"Could not parse title from: {raw_name}")
            return False
        
        # Clean up the title - remove release group patterns
        # Remove known release groups (after -, ., or _)
        title = re.sub(r'[-._](?:CODEX|SKIDROW|RELOADED|CPY|FLT|PLAZA|RAZOR1911|HOODLUM|DOGE|RUNE|TiNYiSO|DARKSiDERS|ANOMALY|PROPHET|GOLDBERG|STEAMPUNKS|EMPRESS|DODI|FITGIRL|NECROS|ElAmigos|KaOs|GOG|TENOKE|P2P|insaneramzes)(?:[-._].*)?$', '', title, flags=re.IGNORECASE)
        # Remove trailing UPPERCASE-only words after - or . (safer - preserves "II", "DLC", "VR", lowercase groups)
        # This hybrid approach only removes all-caps release groups while keeping mixed/lower case words
        title = re.sub(r'[-._]([A-Z]{2,15})$', '', title)
        title = title.strip()
        
        if not title:
            logger.warning(f"Title became empty after cleanup from: {raw_name}")
            return False
        
        # Extract version
        detected_version = extract_version(raw_name)
        
        # Generate clean search query (removes versions, tags, special chars)
        search_query = sanitize_search_query(title)
        if not search_query:
            search_query = title  # Fallback to title if sanitization fails
        
        # Check if game already exists
        existing_game = session.exec(
            select(Game).where(Game.title == title)
        ).first()

        if not existing_game:
            return await self._add_new_game(
                title, search_query, detected_version, torrent_date, session
            )
        else:
            return await self._update_existing_game(
                existing_game, detected_version, torrent_date, session
            )

    async def _add_new_game(
        self,
        title: str,
        search_query: str,
        version: str | None,
        torrent_date: datetime,
        session: Session
    ) -> bool:
        """Add a new game to the database."""
        logger.info(f"New game detected: {title} (v{version or 'unknown'})")
        logger.debug(f"Search query: {search_query}")
        
        # Try to fetch metadata from IGDB
        cover_url = None
        steam_app_id = None
        if settings.is_igdb_enabled:
            try:
                metadata = await self.igdb.get_game_metadata(title)
                if metadata:
                    cover_url = metadata.get("cover_url")
                    steam_app_id = metadata.get("steam_app_id")
            except Exception as e:
                logger.debug(f"Failed to fetch metadata for {title}: {e}")
        
        new_game = Game(
            title=title,
            search_query=search_query,
            current_version_date=torrent_date,
            current_version=version,
            status=GameStatus.MONITORED,
            cover_url=cover_url,
            steam_app_id=steam_app_id
        )
        session.add(new_game)
        logger.info(f"Added {title} to library")
        return True

    async def _update_existing_game(
        self,
        game: Game,
        version: str | None,
        torrent_date: datetime,
        session: Session
    ) -> bool:
        """Update an existing game if newer version found."""
        updated = False
        
        # Update if torrent is newer
        if torrent_date > game.current_version_date.replace(tzinfo=None):
            logger.info(
                f"Updating {game.title}: "
                f"v{game.current_version or '?'} -> v{version or '?'}"
            )
            game.current_version_date = torrent_date
            if version:
                game.current_version = version
            session.add(game)
            updated = True
        
        # Retry metadata fetch if missing
        if (not game.cover_url or not game.steam_app_id) and settings.is_igdb_enabled:
            try:
                metadata = await self.igdb.get_game_metadata(game.title)
                if metadata:
                    if not game.cover_url and metadata.get("cover_url"):
                        game.cover_url = metadata["cover_url"]
                        updated = True
                    if not game.steam_app_id and metadata.get("steam_app_id"):
                        game.steam_app_id = metadata["steam_app_id"]
                        updated = True
                    if updated:
                        session.add(game)
            except Exception:
                pass
                
        return updated

    async def add_torrent(self, magnet_url: str, category: str = None) -> bool:
        """
        Add a torrent to qBittorrent via magnet link.
        
        Args:
            magnet_url: The magnet link
            category: Category to assign (defaults to settings.QBIT_CATEGORY)
            
        Returns:
            True if successful
        """
        if not self.cookies:
            if not await self.login():
                return False
                
        try:
            category = category or settings.QBIT_CATEGORY
            
            resp = await self.client.post(
                f"{self.base_url}/api/v2/torrents/add",
                data={
                    "urls": magnet_url,
                    "category": category,
                },
                cookies=self.cookies
            )
            
            if resp.status_code == 200:
                # "Ok." or similar text is returned on success, but 200 is main indicator
                logger.info("Sent magnet to qBittorrent")
                return True
            else:
                logger.error(f"Failed to add torrent: {resp.status_code} - {resp.text}")
                return False
                
        except Exception as e:
            logger.error(f"Exception adding torrent: {e}")
            return False
    
    async def close(self) -> None:
        """Close HTTP clients."""
        await self.client.aclose()
        await self.igdb.close()