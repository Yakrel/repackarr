import httpx
import logging
from datetime import datetime, timezone
from guessit import guessit
from sqlmodel import Session, select
from app.config import get_settings
from app.models import Game, GameStatus
from app.services.igdb import IGDBService
from app.utils import extract_version

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
            
        torrent_date = datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None)
        
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
        
        # Extract version
        detected_version = extract_version(raw_name)
        
        # Check if game already exists
        existing_game = session.exec(
            select(Game).where(Game.title == title)
        ).first()

        if not existing_game:
            return await self._add_new_game(
                title, detected_version, torrent_date, session
            )
        else:
            return await self._update_existing_game(
                existing_game, detected_version, torrent_date, session
            )

    async def _add_new_game(
        self,
        title: str,
        version: str | None,
        torrent_date: datetime,
        session: Session
    ) -> bool:
        """Add a new game to the database."""
        logger.info(f"New game detected: {title} (v{version or 'unknown'})")
        
        # Try to fetch cover from IGDB
        cover_url = None
        if settings.is_igdb_enabled:
            try:
                cover_url = await self.igdb.get_game_cover(title)
            except Exception as e:
                logger.debug(f"Failed to fetch cover for {title}: {e}")
        
        new_game = Game(
            title=title,
            search_query=title,
            current_version_date=torrent_date,
            current_version=version,
            status=GameStatus.MONITORED,
            cover_url=cover_url
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
        
        # Retry cover fetch if missing
        if not game.cover_url and settings.is_igdb_enabled:
            try:
                cover_url = await self.igdb.get_game_cover(game.title)
                if cover_url:
                    game.cover_url = cover_url
                    session.add(game)
                    updated = True
            except Exception:
                pass
                
        return updated
    
    async def close(self) -> None:
        """Close HTTP clients."""
        await self.client.aclose()
        await self.igdb.close()