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

logger = logging.getLogger("repackarr")


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
        with Session(engine) as session:
            synced = await qbit.sync_games(session)
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
        
        # Run searches concurrently (throttled by semaphore in service)
        tasks = [prowlarr.search_for_game(game.id) for game in monitored_games]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        for i, res in enumerate(results):
            game_title = monitored_games[i].title
            if isinstance(res, dict):
                total_found += res.get("total_found", 0)
                total_added += res.get("added", 0)
                if res.get("error"):
                    scan_details.append(f"{game_title}: {res['error']}")
            elif isinstance(res, Exception):
                scan_details.append(f"{game_title}: Exception {str(res)}")
            
    except Exception as e:
        logger.error(f"Update search failed: {e}")
        scan_details.append(f"Global Error: {str(e)}")
    finally:
        await prowlarr.close()
    
    # Save Scan Log
    duration = (datetime.utcnow() - start_time).total_seconds()
    
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
                    "errors": scan_details[:10]  # Limit error details
                })
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
    
    # Step 1: Sync from qBittorrent
    synced = await run_sync_library()
        
    # Step 2: Search Prowlarr for updates
    scanned = await run_search_updates()
    
    duration = (datetime.utcnow() - start_time).total_seconds()
    logger.info(f"Scan cycle completed in {duration:.1f}s")
    logger.info("=" * 50)
