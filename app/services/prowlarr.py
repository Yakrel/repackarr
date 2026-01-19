import httpx
import logging
import asyncio
from datetime import datetime
from sqlmodel import Session, select
from app.config import get_settings
from app.database import engine
from app.models import Game, Release
from app.utils import extract_version, compare_versions

logger = logging.getLogger("repackarr")
settings = get_settings()

class ProwlarrService:
    def __init__(self):
        self.base_url = settings.PROWLARR_URL.rstrip('/')
        self.headers = {"X-Api-Key": settings.PROWLARR_API_KEY}
        self.sem = asyncio.Semaphore(3) 
        self.client = httpx.AsyncClient(timeout=60.0, verify=False)

    async def search_for_game(self, game_id: int):
        async with self.sem:
            with Session(engine) as session:
                game = session.get(Game, game_id)
                if not game:
                    return

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
                except Exception as e:
                    logger.error(f"Prowlarr search failed for {game.title}: {e}")
                    return

                new_releases_count = 0
                
                for item in results:
                    title = item.get('title', '')
                    indexer = item.get('indexer', 'Unknown')
                    info_url = item.get('infoUrl', '')
                    size = item.get('size', 0)
                    
                    title_lower = title.lower()
                    
                    # Strict Title Check: Ensure all words from game title are in the release title
                    game_words = [w.strip().lower() for w in game.title.split() if len(w.strip()) > 2]
                    if not all(w in title_lower for w in game_words):
                        continue

                    # Platform Filter
                    if any(p in title_lower for p in ["ps5", "ps4", "xbox", "switch", "macos", "android", "mac"]):
                        continue

                    # Keyword Filter
                    if any(k in title_lower for k in settings.ignored_keywords_list):
                        continue
                        
                    # Extract Remote Version
                    remote_version = extract_version(title)
                    is_upgrade = False
                    reason = "date" # default reason
                    
                    # Date Handling
                    added_str = item.get('publishDate') or item.get('added')
                    upload_date = None
                    if added_str:
                        try:
                            upload_date = datetime.fromisoformat(added_str.replace("Z", "+00:00"))
                            if upload_date.tzinfo:
                                upload_date = upload_date.astimezone(None).replace(tzinfo=None)
                        except ValueError:
                            pass

                    # LOGIC: Version Check vs Date Check
                    if game.current_version and remote_version:
                        comparison = compare_versions(game.current_version, remote_version)
                        if comparison == 1:
                            is_upgrade = True
                            reason = f"version (v{remote_version} > v{game.current_version})"
                        elif comparison == -1 or comparison == 0:
                            # Explicitly older or same version, skip regardless of date
                            continue
                        else:
                            # Comparison failed, fallback to date
                            if upload_date and upload_date > game.current_version_date:
                                is_upgrade = True
                    else:
                        # Fallback to date if either version is missing
                        if upload_date and upload_date > game.current_version_date:
                            is_upgrade = True

                    if not is_upgrade:
                        continue

                    # Check Duplicate
                    existing = session.exec(
                        select(Release).where(Release.raw_title == title).where(Release.game_id == game.id)
                    ).first()
                    
                    if existing:
                        continue

                    # Valid new release
                    release = Release(
                        game_id=game.id,
                        raw_title=title,
                        parsed_version=remote_version,
                        upload_date=upload_date or datetime.utcnow(),
                        indexer=indexer,
                        magnet_url=item.get('magnetUrl') or item.get('downloadUrl'),
                        info_url=info_url,
                        size=str(int(size / 1024 / 1024)) + " MB" if size else "?",
                    )
                    session.add(release)
                    new_releases_count += 1
                    logger.info(f"New release found for {game.title}: {title} [{reason}]")
                
                if new_releases_count > 0:
                    session.add(game)
                
                # Update scan timestamp
                game.last_scanned_at = datetime.utcnow()
                session.add(game)
                session.commit()

    async def close(self):
        await self.client.aclose()