import httpx
import logging
from datetime import datetime
from guessit import guessit
from sqlmodel import Session, select
from app.config import get_settings
from app.models import Game, GameStatus
from app.services.igdb import IGDBService
from app.utils import extract_version

logger = logging.getLogger("repackarr")
settings = get_settings()

class QBitService:
    def __init__(self):
        self.base_url = settings.QBIT_HOST.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30.0, verify=False)
        self.cookies = {}
        self.igdb = IGDBService()

    async def login(self):
        try:
            resp = await self.client.post(
                f"{self.base_url}/api/v2/auth/login",
                data={"username": settings.QBIT_USERNAME, "password": settings.QBIT_PASSWORD}
            )
            if resp.status_code == 200 and "SID" in resp.cookies:
                self.cookies = resp.cookies
                return True
            logger.error(f"qBit login failed: {resp.text}")
            return False
        except Exception as e:
            logger.error(f"qBit connection error: {e}")
            return False

    async def sync_games(self, session: Session):
        if not self.cookies:
            if not await self.login():
                return

        try:
            resp = await self.client.get(
                f"{self.base_url}/api/v2/torrents/info",
                params={"category": settings.QBIT_CATEGORY},
                cookies=self.cookies
            )
            resp.raise_for_status()
            torrents = resp.json()
        except Exception as e:
            logger.error(f"Failed to fetch torrents: {e}")
            return

        for torrent in torrents:
            ts = torrent.get('completion_on', 0)
            if ts <= 0:
                ts = torrent.get('added_on', 0)
            
            torrent_date = datetime.fromtimestamp(ts)
            
            raw_name = torrent.get('name', '')
            parsed = guessit(raw_name)
            title = parsed.get('title')
            
            # Extract version using our new utility
            detected_version = extract_version(raw_name)
            
            if not title:
                logger.warning(f"Could not parse title from: {raw_name}")
                continue

            statement = select(Game).where(Game.title == title)
            game = session.exec(statement).first()

            if not game:
                logger.info(f"New game detected: {title} (v{detected_version})")
                
                # Fetch Cover Art
                cover_url = await self.igdb.get_game_cover(title)
                
                new_game = Game(
                    title=title,
                    search_query=title,
                    current_version_date=torrent_date,
                    current_version=detected_version,
                    status=GameStatus.MONITORED,
                    cover_url=cover_url
                )
                session.add(new_game)
            else:
                # Update logic: If date is newer OR version changed
                # Note: We trust the torrent date as the ultimate source of "what is currently installed"
                if torrent_date > game.current_version_date:
                    logger.info(f"Updating local info for {title}: v{game.current_version} -> v{detected_version}")
                    game.current_version_date = torrent_date
                    if detected_version:
                        game.current_version = detected_version
                    session.add(game)
                
                # Retry cover if missing
                if not game.cover_url:
                     game.cover_url = await self.igdb.get_game_cover(title)
                     session.add(game)
        
        session.commit()
    
    async def close(self):
        await self.client.aclose()
        await self.igdb.close()