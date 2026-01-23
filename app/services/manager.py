"""
Service manager for orchestrating scan operations.
Coordinates library sync and update search across services.
"""
import logging
import asyncio
import json
from datetime import datetime
from sqlmodel import Session, select
from app.database import engine
from app.services.qbit import QBitService
from app.services.prowlarr import ProwlarrService
from app.models import Game, GameStatus, ScanLog
from app.progress import progress_manager

logger = logging.getLogger("repackarr")


def _process_skip_summary(all_skipped: list) -> dict:
    """
    Process and group skipped releases for summary.
    
    Args:
        all_skipped: List of skipped items per game
        
    Returns:
        Grouped summary dict
    """
    if not all_skipped:
        return {}
    
    summary = {
        "total_skipped": 0,
        "by_category": {
            "older": 0,
            "platform": 0,
            "keyword": 0,
            "title": 0,
            "duplicate": 0,
            "ignored": 0,
            "other": 0
        },
        "games": []
    }
    
    for game_skip in all_skipped:
        game_data = {
            "game": game_skip["game"],
            "total": len(game_skip["items"]),
            "categories": {},
            "notable_skips": []  # Only non-"older" skips
        }
        
        for item in game_skip["items"]:
            category = item.get("category", "other")
            
            # Count by category
            summary["by_category"][category] = summary["by_category"].get(category, 0) + 1
            game_data["categories"][category] = game_data["categories"].get(category, 0) + 1
            summary["total_skipped"] += 1
            
            # Only show details for interesting skips (not "older")
            if category != "older" and item.get("is_newer_date"):
                game_data["notable_skips"].append({
                    "title": item["title"][:60],  # Truncate long titles
                    "reason": item["reason"],
                    "indexer": item["indexer"],
                    "date": item.get("date", "N/A")
                })
        
        # Only add game if there are skips
        if game_data["total"] > 0:
            summary["games"].append(game_data)
    
    return summary


async def run_sync_library() -> int:
    """
    Sync games from qBittorrent to the local database.
    
    Returns:
        Number of games synced/updated
    """
    logger.info("Starting library sync from qBittorrent...")
    qbit = QBitService()
    synced = 0
    
    try:
        await progress_manager.start_scan("sync", 1)
        await progress_manager.update(0, "Connecting to qBittorrent...")
        
        with Session(engine) as session:
            synced = await qbit.sync_games(session)
            
        await progress_manager.update(1, "Library sync complete")
    except Exception as e:
        logger.error(f"Library sync failed: {e}")
    finally:
        await qbit.close()
        
    logger.info(f"Library sync completed. {synced} game(s) processed.")
    return synced


async def run_search_updates() -> int:
    """
    Search Prowlarr for updates for all monitored games.
    
    Returns:
        Number of games scanned
    """
    start_time = datetime.utcnow()
    logger.info("Starting Prowlarr update search...")
    prowlarr = ProwlarrService()
    scanned = 0
    total_found = 0
    total_added = 0
    scan_details = []
    
    try:
        # Get all monitored game IDs
        with Session(engine) as session:
            statement = select(Game).where(Game.status == GameStatus.MONITORED)
            monitored_games = list(session.exec(statement).all())
            
        scanned = len(monitored_games)
        logger.info(f"Scanning {scanned} monitored game(s)...")
        
        # Start progress tracking
        await progress_manager.start_scan("search", scanned)
        
        # Process results
        all_skipped = []
        
        # Search games one by one to track progress (still using semaphore for concurrent requests)
        for i, game in enumerate(monitored_games):
            await progress_manager.update(i, f"Searching: {game.title}")
            
            try:
                res = await prowlarr.search_for_game(game.id)
                
                if isinstance(res, dict):
                    total_found += res.get("total_found", 0)
                    total_added += res.get("added", 0)
                    
                    if res.get("error"):
                        scan_details.append(f"{game.title}: {res['error']}")
                    
                    # Collect skipped items if any
                    if res.get("skipped"):
                        all_skipped.append({
                            "game": game.title,
                            "game_id": game.id,
                            "items": res["skipped"]
                        })
            except Exception as e:
                scan_details.append(f"{game.title}: Exception {str(e)}")
        
        await progress_manager.update(scanned, "Search complete")
            
    except Exception as e:
        logger.error(f"Update search failed: {e}")
        scan_details.append(f"Global Error: {str(e)}")
    finally:
        await prowlarr.close()
    
    # Save Scan Log
    duration = (datetime.utcnow() - start_time).total_seconds()
    
    # Process and group skipped items
    skip_summary = _process_skip_summary(all_skipped)
    
    try:
        with Session(engine) as session:
            log_entry = ScanLog(
                started_at=start_time,
                duration_seconds=duration,
                games_processed=scanned,
                updates_found=total_added,
                status="success" if not scan_details else "partial_success",
                details=json.dumps({
                    "total_results_found": total_found,
                    "errors": scan_details[:10],  # Limit error details
                }),
                skip_details=json.dumps(skip_summary) if skip_summary else None
            )
            session.add(log_entry)
            session.commit()
    except Exception as e:
        logger.error(f"Failed to save scan log: {e}")
        
    logger.info(f"Update search completed. Found {total_added} updates.")
    return scanned


async def run_scan_cycle() -> None:
    """
    Run a full scan cycle: sync library then search for updates.
    
    This is the main orchestration function called by the scheduler.
    """
    start_time = datetime.utcnow()
    logger.info("=" * 50)
    logger.info("Starting full scan cycle...")
    
    try:
        # Step 1: Sync from qBittorrent
        synced = await run_sync_library()
            
        # Step 2: Search Prowlarr for updates
        scanned = await run_search_updates()
    finally:
        # Ensure progress is marked complete
        await progress_manager.complete()
    
    duration = (datetime.utcnow() - start_time).total_seconds()
    logger.info(f"Scan cycle completed in {duration:.1f}s")
    logger.info("=" * 50)
