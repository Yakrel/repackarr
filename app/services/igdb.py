import httpx
import logging
from datetime import datetime, timedelta
from app.config import get_settings

logger = logging.getLogger("repackarr")
settings = get_settings()


class IGDBService:
    """
    Service for fetching game metadata from IGDB (Internet Game Database).
    Handles OAuth2 token management and cover image retrieval.
    """
    
    # Class-level token cache
    _access_token: str | None = None
    _token_expiry: datetime = datetime.min

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=10.0, verify=False)
        self.auth_url = "https://id.twitch.tv/oauth2/token"
        self.api_url = "https://api.igdb.com/v4"

    async def _get_token(self) -> str | None:
        """
        Get or refresh OAuth token for IGDB API.
        
        Returns:
            Access token string or None if authentication fails
        """
        if not settings.is_igdb_enabled:
            logger.debug("IGDB credentials not configured")
            return None

        # Return cached token if still valid
        if self._access_token and datetime.now() < self._token_expiry:
            return self._access_token

        try:
            logger.info("Refreshing IGDB access token...")
            resp = await self.client.post(self.auth_url, params={
                "client_id": settings.IGDB_CLIENT_ID,
                "client_secret": settings.IGDB_CLIENT_SECRET,
                "grant_type": "client_credentials"
            })
            resp.raise_for_status()
            data = resp.json()
            
            # Update class-level cache
            IGDBService._access_token = data["access_token"]
            IGDBService._token_expiry = datetime.now() + timedelta(
                seconds=data["expires_in"] - 300  # 5 min buffer
            )
            
            logger.info("IGDB token acquired successfully")
            return self._access_token
            
        except httpx.HTTPStatusError as e:
            logger.error(f"IGDB auth failed: {e.response.status_code}")
            return None
        except httpx.RequestError as e:
            logger.error(f"IGDB auth connection error: {e}")
            return None
        except Exception as e:
            logger.error(f"Failed to get IGDB token: {e}")
            return None

    async def get_game_metadata(self, game_name: str) -> dict[str, any] | None:
        """
        Search for a game and return metadata including cover and Steam App ID.
        
        Args:
            game_name: Name of the game to search for
            
        Returns:
            Dict with 'cover_url' and 'steam_app_id' or None if not found
        """
        if not game_name:
            return None
            
        try:
            token = await self._get_token()
            if not token:
                return None

            headers = {
                "Client-ID": settings.IGDB_CLIENT_ID,
                "Authorization": f"Bearer {token}",
                "Accept": "application/json"
            }

            # Search for game with cover and external game IDs (Steam)
            # Note: external_games needs to be expanded with *
            query = f'fields name, cover.image_id, category, external_games.*; search "{game_name}"; limit 5;'
            
            resp = await self.client.post(
                f"{self.api_url}/games", 
                content=query, 
                headers=headers
            )
            resp.raise_for_status()
            results = resp.json()
            
            if not results:
                logger.debug(f"No IGDB results for: {game_name}")
                return None
            
            # Find best match
            best_match = None
            game_name_clean = game_name.lower().strip()
            
            for game in results:
                # 1. Exact match preference
                if game.get("name", "").lower().strip() == game_name_clean:
                    best_match = game
                    break
                
                # 2. Starts with match (fallback)
                if not best_match and game.get("name", "").lower().strip().startswith(game_name_clean):
                    best_match = game
            
            # Fallback to first result if no better match found
            target_game = best_match or results[0]
            
            result = {}
            
            # Extract cover URL
            cover_info = target_game.get("cover")
            if cover_info and "image_id" in cover_info:
                img_id = cover_info["image_id"]
                # Use t_cover_big for 264x374 resolution
                result["cover_url"] = f"https://images.igdb.com/igdb/image/upload/t_cover_big/{img_id}.jpg"
            
            # Extract Steam App ID (external_game_source 1 = Steam)
            external_games = target_game.get("external_games", [])
            for ext in external_games:
                if ext.get("external_game_source") == 1:  # Steam
                    try:
                        result["steam_app_id"] = int(ext.get("uid"))
                        break
                    except (ValueError, TypeError):
                        pass
            
            if result:
                logger.info(f"Found metadata for {game_name} -> {target_game.get('name')}: {result}")
                return result
            
            return None
            
        except httpx.HTTPStatusError as e:
            logger.debug(f"IGDB API error for {game_name}: {e.response.status_code}")
            return None
        except httpx.RequestError as e:
            logger.debug(f"IGDB connection error for {game_name}: {e}")
            return None
        except Exception as e:
            logger.error(f"IGDB search error for {game_name}: {e}")
            return None

    async def get_game_cover(self, game_name: str) -> str | None:
        """
        Legacy method for backward compatibility.
        Search for a game and return its cover image URL.
        
        Args:
            game_name: Name of the game to search for
            
        Returns:
            Cover image URL or None if not found
        """
        metadata = await self.get_game_metadata(game_name)
        return metadata.get("cover_url") if metadata else None

    async def close(self) -> None:
        """Close the HTTP client."""
        await self.client.aclose()
