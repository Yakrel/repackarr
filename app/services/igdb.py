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
            return None

        if self._access_token and datetime.now() < self._token_expiry:
            return self._access_token

        try:
            resp = await self.client.post(self.auth_url, params={
                "client_id": settings.IGDB_CLIENT_ID,
                "client_secret": settings.IGDB_CLIENT_SECRET,
                "grant_type": "client_credentials"
            })
            resp.raise_for_status()
            data = resp.json()
            IGDBService._access_token = data["access_token"]
            # Set expiry a bit earlier than actual to be safe
            IGDBService._token_expiry = datetime.now() + timedelta(seconds=data["expires_in"] - 300)
            return self._access_token
        except Exception as e:
            logger.error(f"Failed to get IGDB token: {e}")
            return None

    async def get_game_cover(self, game_name: str) -> str | None:
        """Search game and return cover URL (1080p if available)"""
        token = await self._get_token()
        if not token:
            return None

        headers = {
            "Client-ID": settings.IGDB_CLIENT_ID,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json"
        }

        # Search for the game
        # We ask for cover.image_id
        query = f'fields name, cover.image_id; search "{game_name}"; limit 1;'
        
        try:
            resp = await self.client.post(
                f"{self.api_url}/games", 
                content=query, 
                headers=headers
            )
            resp.raise_for_status()
            results = resp.json()
            
            if not results:
                return None
            
            game_data = results[0]
            if "cover" in game_data and "image_id" in game_data["cover"]:
                # IGDB image sizes: cover_big, 720p, 1080p
                # format: //images.igdb.com/igdb/image/upload/t_{size}/{hash}.jpg
                img_id = game_data["cover"]["image_id"]
                return f"https://images.igdb.com/igdb/image/upload/t_cover_big/{img_id}.jpg"
            
            return None
            
        except Exception as e:
            logger.error(f"IGDB search error for {game_name}: {e}")
            return None

    async def close(self):
        await self.client.aclose()
