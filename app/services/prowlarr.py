import httpx
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select
from app.config import get_settings
from app.database import engine
from app.models import Game, Release, IgnoredRelease
from app.utils import extract_version, compare_versions, format_size

logger = logging.getLogger("repackarr")
settings = get_settings()


# Module-level cache for indexer IDs to persist across service instances
_cached_indexer_ids: list[int] = []
_indexer_cache_time: datetime | None = None
_cache_duration = timedelta(hours=1)


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

    async def _fetch_allowed_indexer_ids(self) -> list[int]:
        """
        Fetch indexer IDs from Prowlarr API that match allowed indexer names.
        Uses case-insensitive substring matching.
        
        Returns:
            List of indexer IDs to search, empty list if none match
        """
        global _cached_indexer_ids
        
        if not settings.allowed_indexers_list:
            # No filter configured, allow all indexers
            return []
        
        try:
            resp = await self.client.get(
                f"{self.base_url}/api/v1/indexer",
                headers=self.headers,
                timeout=30.0
            )
            resp.raise_for_status()
            indexers = resp.json()
            
            matched_ids = []
            allowed_lower = [name.lower() for name in settings.allowed_indexers_list]
            
            for indexer in indexers:
                indexer_name = indexer.get('name', '').lower()
                indexer_id = indexer.get('id')
                
                # Check if any allowed indexer name is a substring of this indexer's name
                if any(allowed in indexer_name for allowed in allowed_lower):
                    if indexer_id is not None:
                        matched_ids.append(indexer_id)
                        logger.info(f"✓ Matched allowed indexer: {indexer.get('name')} (ID: {indexer_id})")
            
            if not matched_ids and settings.allowed_indexers_list:
                logger.warning(
                    f"No Prowlarr indexers matched allowed list: {settings.ALLOWED_INDEXERS}. "
                    "Searches will return no results until indexers are configured correctly."
                )
            
            return matched_ids
            
        except Exception as e:
            logger.error(f"Failed to fetch indexer list from Prowlarr: {e}")
            # Return cached IDs if available, otherwise empty list
            return _cached_indexer_ids if _cached_indexer_ids else []

    async def _get_indexer_ids(self) -> list[int]:
        """
        Get cached indexer IDs or fetch fresh ones if cache is stale.
        
        Returns:
            List of indexer IDs to use in search requests
        """
        global _cached_indexer_ids, _indexer_cache_time
        
        now = datetime.utcnow()
        
        # Check if cache is valid
        if (
            _cached_indexer_ids and 
            _indexer_cache_time and 
            (now - _indexer_cache_time) < _cache_duration
        ):
            return _cached_indexer_ids
        
        # Fetch fresh indexer IDs
        indexer_ids = await self._fetch_allowed_indexer_ids()
        _cached_indexer_ids = indexer_ids
        _indexer_cache_time = now
        
        return indexer_ids

    async def refresh_indexer_cache(self):
        """
        Force refresh of the indexer ID cache.
        Call this when settings change.
        """
        global _indexer_cache_time
        
        logger.info("Refreshing Prowlarr indexer cache...")
        _indexer_cache_time = None  # Invalidate cache
        await self._get_indexer_ids()

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
                    # Get allowed indexer IDs to limit search scope
                    indexer_ids = await self._get_indexer_ids()
                    
                    # Safety check: if allowed indexers are configured but none matched,
                    # don't search at all to avoid querying all indexers
                    if settings.allowed_indexers_list and not indexer_ids:
                        stats["error"] = "No matching indexers found in Prowlarr"
                        logger.warning(f"Skipping search for {game.title}: No indexers matched allowed list")
                        return stats
                    
                    params = {
                        "query": game.search_query,
                        "type": "search",
                        "limit": 100,
                    }
                    
                    # Add indexer filtering if we have specific indexers to search
                    # Prowlarr API requires repeated query params: indexerIds=24&indexerIds=25
                    if indexer_ids:
                        # httpx automatically handles list values as repeated params
                        params["indexerIds"] = indexer_ids
                        logger.debug(f"Searching indexers: {indexer_ids} for {game.title}")
                    
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
                    error_msg = str(e) or type(e).__name__
                    stats["error"] = f"Connection error: {error_msg[:80]}"
                    return stats
                except Exception as e:
                    logger.error(f"Prowlarr search failed for {game.title}: {e}")
                    error_msg = str(e) if str(e) else type(e).__name__
                    stats["error"] = f"Error: {error_msg[:80]}"
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
        
        # Helper to create skip info - now logs ALL skips with categories
        def make_skip(reason_text: str, skip_category: str = "other", extra_data: dict = None):
            skip_info = {
                "game_id": game.id,
                "game_title": game.title,
                "title": title,
                "date": upload_date.strftime('%Y-%m-%d') if upload_date else "N/A",
                "reason": reason_text,
                "category": skip_category,  # For grouping: "older", "platform", "keyword", etc.
                "indexer": indexer,
                "is_newer_date": is_newer_date,
                "magnet_url": item.get('magnetUrl') or item.get('downloadUrl'),
                "info_url": info_url,
                "size": format_size(size) if size else "?"
            }
            if extra_data:
                skip_info.update(extra_data)
            return None, skip_info

        # 0. Check if user has ignored this release
        ignored = session.exec(
            select(IgnoredRelease).where(
                IgnoredRelease.game_id == game.id,
                IgnoredRelease.release_title == title
            )
        ).first()
        
        if ignored:
            return make_skip(
                "User ignored",
                "ignored",
                {"ignored_at": ignored.ignored_at.strftime('%Y-%m-%d %H:%M')}
            )

        # 1. Title Match: Ensure search query words are present in result
        # Use search_query (cleaned) instead of title (may contain tags)
        query_words = [w.strip().lower() for w in game.search_query.split() if len(w.strip()) > 2]
        if not all(w in title_lower for w in query_words):
            return make_skip("Title mismatch", "title")

        # 2. Platform Filter: Exclude console/mobile releases
        excluded_platforms = ["ps5", "ps4", "ps3", "xbox", "switch", "macos", "android", "mac", "ios"]
        if any(p in title_lower for p in excluded_platforms):
            return make_skip("Platform excluded", "platform")

        # 3. Keyword Filter: Exclude unwanted content types
        if any(k in title_lower for k in settings.ignored_keywords_list):
            return make_skip("Ignored keyword match", "keyword")
            
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
                return make_skip(f"Version not newer (v{remote_version} <= v{game.current_version})", "older")
            else:
                # Comparison failed, fallback to date
                if is_newer_date:
                    is_upgrade = True
                else:
                    return make_skip("Date not newer", "older")
        else:
            # Fallback to date if version is missing
            if is_newer_date:
                is_upgrade = True
            else:
                 return make_skip("Date not newer", "older")

        if not is_upgrade:
            # Should be covered above, but just in case
            return make_skip("Not an upgrade", "older")

        # 6. Check for Duplicates
        existing = session.exec(
            select(Release).where(
                Release.raw_title == title,
                Release.game_id == game.id
            )
        ).first()
        
        if existing:
            return make_skip("Already exists in database", "duplicate")

        # 7. Create and return release
        logger.info(f"New release for {game.title}: {title} [{reason}]")
        
        return Release(
            game_id=game.id,
            raw_title=title,
            parsed_version=remote_version,
            upload_date=upload_date or datetime(1970, 1, 1),
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
        # 1. Try standard date fields
        added_str = item.get('publishDate') or item.get('added')
        if added_str:
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
                pass
        
        # 2. Try 'age' (days) or 'ageMinutes'
        try:
            now = datetime.utcnow()
            
            # ageMinutes is more precise if available
            age_minutes = item.get('ageMinutes')
            if age_minutes is not None:
                age_minutes_float = float(age_minutes)
                if age_minutes_float < 0:
                    logger.warning(f"Negative ageMinutes detected ({age_minutes}). Ignoring bad data.")
                    return None
                return now - timedelta(minutes=age_minutes_float)
                
            # age in days (Prowlarr usually returns this as int or string)
            age_days = item.get('age')
            if age_days is not None:
                age_days_float = float(age_days)
                if age_days_float < 0:
                    logger.warning(f"Negative age days detected ({age_days}). Ignoring bad data.")
                    return None
                return now - timedelta(days=age_days_float)
                
        except (ValueError, TypeError):
            pass

        return None

    async def close(self) -> None:
        """Close the HTTP client."""
        await self.client.aclose()