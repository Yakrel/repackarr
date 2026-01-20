import httpx
import logging
import asyncio
from datetime import datetime
from sqlmodel import Session, select
from app.config import get_settings
from app.database import engine
from app.models import Game, Release
from app.utils import extract_version, compare_versions, format_size

logger = logging.getLogger("repackarr")
settings = get_settings()


class ProwlarrService:
    """
    Service for interacting with Prowlarr API to search for game updates.
    Uses semaphore to limit concurrent requests.
    """
    
    def __init__(self):
        self.base_url = settings.PROWLARR_URL
        self.headers = {"X-Api-Key": settings.PROWLARR_API_KEY}
        self.sem = asyncio.Semaphore(3)  # Max 3 concurrent requests
        self.client = httpx.AsyncClient(timeout=60.0, verify=False)

    async def search_for_game(self, game_id: int) -> dict:
        """
        Search Prowlarr for updates for a specific game.
        
        Args:
            game_id: Database ID of the game to search for
            
        Returns:
            Dictionary with scan statistics
        """
        stats = {
            "game_id": game_id,
            "total_found": 0,
            "added": 0,
            "error": None
        }

        async with self.sem:
            with Session(engine) as session:
                game = session.get(Game, game_id)
                if not game:
                    stats["error"] = "Game not found"
                    return stats

                try:
                    params = {
                        "query": game.search_query,
                        "type": "search",
                        "limit": 100,
                    }
                    
                    resp = await self.client.get(
                        f"{self.base_url}/api/v1/search",
                        params=params,
                        headers=self.headers
                    )
                    resp.raise_for_status()
                    results = resp.json()
                except httpx.HTTPStatusError as e:
                    logger.error(f"Prowlarr API error for {game.title}: {e.response.status_code}")
                    stats["error"] = f"HTTP {e.response.status_code}"
                    return stats
                except httpx.RequestError as e:
                    logger.error(f"Prowlarr connection error for {game.title}: {e}")
                    stats["error"] = "Connection Error"
                    return stats
                except Exception as e:
                    logger.error(f"Prowlarr search failed for {game.title}: {e}")
                    stats["error"] = str(e)
                    return stats

                stats["total_found"] = len(results)
                new_releases_count = 0
                
                for item in results:
                    release = self._process_search_result(item, game, session)
                    if release:
                        session.add(release)
                        new_releases_count += 1
                
                stats["added"] = new_releases_count
                
                if new_releases_count > 0:
                    logger.info(f"Found {new_releases_count} new release(s) for {game.title}")
                
                # Update scan timestamp (use naive datetime for consistency)
                game.last_scanned_at = datetime.utcnow()
                session.add(game)
                session.commit()
                
        return stats

    def _process_search_result(self, item: dict, game: Game, session: Session) -> Release | None:
        """
        Process a single search result and return a Release if it's a valid upgrade.
        
        Args:
            item: Search result from Prowlarr API
            game: Game being searched for
            session: Database session
            
        Returns:
            Release object if valid, None otherwise
        """
        title = item.get('title', '')
        indexer = item.get('indexer', 'Unknown')
        info_url = item.get('infoUrl', '')
        size = item.get('size', 0)
        
        title_lower = title.lower()
        
        # 1. Strict Title Check: Ensure all words from game title are present
        game_words = [w.strip().lower() for w in game.title.split() if len(w.strip()) > 2]
        if not all(w in title_lower for w in game_words):
            return None

        # 2. Platform Filter: Exclude console/mobile releases
        excluded_platforms = ["ps5", "ps4", "ps3", "xbox", "switch", "macos", "android", "mac", "ios"]
        if any(p in title_lower for p in excluded_platforms):
            return None

        # 3. Keyword Filter: Exclude unwanted content types
        if any(k in title_lower for k in settings.ignored_keywords_list):
            return None
            
        # 4. Extract Remote Version
        remote_version = extract_version(title)
        is_upgrade = False
        reason = "date"
        
        # 5. Parse Upload Date
        upload_date = self._parse_date(item)
        
        # 6. Determine if this is an upgrade
        if game.current_version and remote_version:
            comparison = compare_versions(game.current_version, remote_version)
            if comparison == 1:
                is_upgrade = True
                reason = f"version (v{remote_version} > v{game.current_version})"
            elif comparison in (-1, 0):
                # Same or older version, skip
                return None
            else:
                # Comparison failed, fallback to date
                if upload_date and upload_date > game.current_version_date.replace(tzinfo=None):
                    is_upgrade = True
        else:
            # Fallback to date if version is missing
            if upload_date and upload_date > game.current_version_date.replace(tzinfo=None):
                is_upgrade = True

        if not is_upgrade:
            return None

        # 7. Check for Duplicates
        existing = session.exec(
            select(Release).where(
                Release.raw_title == title,
                Release.game_id == game.id
            )
        ).first()
        
        if existing:
            return None

        # 8. Create and return release
        logger.info(f"New release for {game.title}: {title} [{reason}]")
        
        return Release(
            game_id=game.id,
            raw_title=title,
            parsed_version=remote_version,
            upload_date=upload_date or datetime.utcnow(),
            indexer=indexer,
            magnet_url=item.get('magnetUrl') or item.get('downloadUrl'),
            info_url=info_url,
            size=format_size(size) if size else "?",
        )
    
    def _parse_date(self, item: dict) -> datetime | None:
        """
        Parse date from Prowlarr search result.
        
        Args:
            item: Search result dict
            
        Returns:
            Parsed datetime or None
        """
        added_str = item.get('publishDate') or item.get('added')
        if not added_str:
            return None
            
        try:
            upload_date = datetime.fromisoformat(added_str.replace("Z", "+00:00"))
            # Convert to naive datetime for consistency
            if upload_date.tzinfo:
                upload_date = upload_date.astimezone(None).replace(tzinfo=None)
            
            # Prevent future dates (some trackers fake dates)
            now = datetime.utcnow()
            if upload_date > now:
                logger.warning(f"Future date detected: {upload_date}. Capping to now.")
                upload_date = now
                
            return upload_date
        except (ValueError, TypeError):
            return None

    async def close(self) -> None:
        """Close the HTTP client."""
        await self.client.aclose()