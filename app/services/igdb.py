import httpx
import logging
from datetime import datetime, timedelta
from app.config import get_settings
from app.database import engine
from sqlmodel import Session, select
from app.models import Game

logger = logging.getLogger("repackarr")
settings = get_settings()

class IGDBService:
    _access_token = None
    _token_expiry = datetime.min

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=10.0)
        self.auth_url = "https://id.twitch.tv/oauth2/token"
        self.api_url = "https://api.igdb.com/v4"

    async def _get_token(self):
        """Get or refresh OAuth token"""
        if not settings.IGDB_CLIENT_ID or not settings.IGDB_CLIENT_SECRET:
            logger.warning("IGDB Credentials missing in settings.")
            return None

        if self._access_token and datetime.now() < self._token_expiry:
            return self._access_token

        try:
            logger.info(f"Fetching new IGDB token for Client ID: {settings.IGDB_CLIENT_ID[:5]}...")
            resp = await self.client.post(self.auth_url, params={
                "client_id": settings.IGDB_CLIENT_ID,
                "client_secret": settings.IGDB_CLIENT_SECRET,
                "grant_type": "client_credentials"
            })
            resp.raise_for_status()
            data = resp.json()
            IGDBService._access_token = data["access_token"]
            IGDBService._token_expiry = datetime.now() + timedelta(seconds=data["expires_in"] - 300)
            logger.info("IGDB token acquired successfully.")
            return self._access_token
        except Exception as e:
            logger.error(f"Failed to get IGDB token: {e}")
            return None

    async def get_game_cover(self, game_name: str) -> str | None:
        """Search game and return cover URL (1080p if available)"""
        try:
            token = await self._get_token()
            if not token:
                return None

            headers = {
                "Client-ID": settings.IGDB_CLIENT_ID,
                "Authorization": f"Bearer {token}",
                "Accept": "application/json"
            }

            query = f'fields name, cover.image_id; search "{game_name}"; limit 1;'
            logger.info(f"Searching IGDB for: {game_name}")
            
            resp = await self.client.post(
                f"{self.api_url}/games", 
                content=query, 
                headers=headers
            )
            resp.raise_for_status()
            results = resp.json()
            
            if not results:
                logger.info(f"No results found on IGDB for: {game_name}")
                return None
            
            game_data = results[0]
            if "cover" in game_data and "image_id" in game_data["cover"]:
                img_id = game_data["cover"]["image_id"]
                url = f"https://images.igdb.com/igdb/image/upload/t_cover_big/{img_id}.jpg"
                logger.info(f"Found IGDB cover for {game_name}: {url}")
                return url
            
            return None
            
        except Exception as e:
            logger.error(f"IGDB search error for {game_name}: {e}")
            return None

    async def close(self):
        await self.client.aclose()
