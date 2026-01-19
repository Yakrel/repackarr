"""
Service manager for orchestrating scan operations.
Coordinates library sync and update search across services.
"""
import logging
import asyncio
from datetime import datetime
from sqlmodel import Session, select
from app.database import engine
from app.services.qbit import QBitService
from app.services.prowlarr import ProwlarrService
from app.models import Game, GameStatus

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
    logger.info("Starting Prowlarr update search...")
    prowlarr = ProwlarrService()
    scanned = 0
    
    try:
        # Get all monitored game IDs
        with Session(engine) as session:
            statement = select(Game.id).where(Game.status == GameStatus.MONITORED)
            monitored_game_ids = list(session.exec(statement).all())
            
        scanned = len(monitored_game_ids)
        logger.info(f"Scanning {scanned} monitored game(s)...")
        
        # Run searches concurrently (throttled by semaphore in service)
        tasks = [prowlarr.search_for_game(game_id) for game_id in monitored_game_ids]
        await asyncio.gather(*tasks, return_exceptions=True)
            
    except Exception as e:
        logger.error(f"Update search failed: {e}")
    finally:
        await prowlarr.close()
        
    logger.info("Update search completed.")
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
