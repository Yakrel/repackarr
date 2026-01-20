import httpx
import logging
import asyncio
from datetime import datetime, timezone
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
            "skipped": [],
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
                    release, skipped_info = self._process_search_result(item, game, session)
                    if release:
                        session.add(release)
                        new_releases_count += 1
                    elif skipped_info:
                        stats["skipped"].append(skipped_info)
                
                stats["added"] = new_releases_count
                
                if new_releases_count > 0:
                    logger.info(f"Found {new_releases_count} new release(s) for {game.title}")
                
                # Update scan timestamp (use naive datetime for consistency)
                game.last_scanned_at = datetime.utcnow()
                session.add(game)
                session.commit()
                
        return stats

    def _process_search_result(self, item: dict, game: Game, session: Session) -> tuple[Release | None, dict | None]:
        """
        Process a single search result and return a Release if it's a valid upgrade.
        
        Args:
            item: Search result from Prowlarr API
            game: Game being searched for
            session: Database session
            
        Returns:
            Tuple (Release | None, SkippedInfo | None)
        """
        title = item.get('title', '')
        indexer = item.get('indexer', 'Unknown')
        info_url = item.get('infoUrl', '')
        size = item.get('size', 0)
        
        title_lower = title.lower()
        upload_date = self._parse_date(item)
        
        # Check if this release is newer than current installed version
        # If it is newer, we want to log why we skip it if we do skip it.
        is_newer_date = False
        if upload_date:
            # Simple date check against current version date
            if upload_date > game.current_version_date.replace(tzinfo=None):
                is_newer_date = True
        
        # Helper to create skip info
        def make_skip(reason_text: str):
            # Only return skip info if it was newer by date, as requested
            if is_newer_date:
                return None, {
                    "title": title,
                    "date": upload_date.strftime('%Y-%m-%d') if upload_date else "N/A",
                    "reason": reason_text,
                    "indexer": indexer,
                    "magnet_url": item.get('magnetUrl') or item.get('downloadUrl'),
                    "info_url": info_url,
                    "size": format_size(size) if size else "?"
                }
            return None, None

        # 1. Strict Title Check: Ensure all words from game title are present
        game_words = [w.strip().lower() for w in game.title.split() if len(w.strip()) > 2]
        if not all(w in title_lower for w in game_words):
            # If title doesn't match well, it might be irrelevant noise.
            # But if it's "newer", user might want to know.
            # However, weak title matches are usually just wrong games.
            # We'll log it if it's newer, but maybe mark as "Title Mismatch"
            return make_skip("Title mismatch")

        # 2. Platform Filter: Exclude console/mobile releases
        excluded_platforms = ["ps5", "ps4", "ps3", "xbox", "switch", "macos", "android", "mac", "ios"]
        if any(p in title_lower for p in excluded_platforms):
            return make_skip("Platform excluded")

        # 3. Keyword Filter: Exclude unwanted content types
        if any(k in title_lower for k in settings.ignored_keywords_list):
            return make_skip("Ignored keyword match")
            
        # 4. Extract Remote Version
        remote_version = extract_version(title)
        is_upgrade = False
        reason = "date"
        
        # 5. Determine if this is an upgrade
        if game.current_version and remote_version:
            comparison = compare_versions(game.current_version, remote_version)
            if comparison == 1:
                is_upgrade = True
                reason = f"version (v{remote_version} > v{game.current_version})"
            elif comparison in (-1, 0):
                # Same or older version, skip
                return make_skip(f"Version not newer (v{remote_version} <= v{game.current_version})")
            else:
                # Comparison failed, fallback to date
                if is_newer_date:
                    is_upgrade = True
                else:
                    return make_skip("Date not newer")
        else:
            # Fallback to date if version is missing
            if is_newer_date:
                is_upgrade = True
            else:
                 return make_skip("Date not newer")

        if not is_upgrade:
            # Should be covered above, but just in case
            return make_skip("Not an upgrade")

        # 6. Check for Duplicates
        existing = session.exec(
            select(Release).where(
                Release.raw_title == title,
                Release.game_id == game.id
            )
        ).first()
        
        if existing:
            return make_skip("Already exists in database")

        # 7. Create and return release
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
        ), None
    
    def _parse_date(self, item: dict) -> datetime | None:
        """
        Parse date from Prowlarr search result.
        
        Args:
            item: Search result dict
            
        Returns:
            Parsed datetime (UTC Naive) or None
        """
        added_str = item.get('publishDate') or item.get('added')
        if not added_str:
            return None
            
        try:
            # Parse ISO format
            upload_date = datetime.fromisoformat(added_str.replace("Z", "+00:00"))
            
            # Convert to UTC explicitly, then remove tzinfo to make it naive (for DB)
            upload_date = upload_date.astimezone(timezone.utc).replace(tzinfo=None)
            
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