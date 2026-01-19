import logging
import asyncio
from datetime import datetime
from sqlmodel import Session, select
from app.database import engine
from app.services.qbit import QBitService
from app.services.prowlarr import ProwlarrService
from app.models import Game, GameStatus

logger = logging.getLogger("repackarr")

async def run_sync_library():
    """Sync games from qBittorrent"""
    logger.info("Starting library sync...")
    qbit = QBitService()
    try:
        with Session(engine) as session:
            await qbit.sync_games(session)
    finally:
        await qbit.close()
    logger.info("Library sync completed.")

async def run_search_updates():
    """Search for updates on Prowlarr for monitored games"""
    logger.info("Starting update search...")
    prowlarr = ProwlarrService()
    try:
        monitored_game_ids = []
        with Session(engine) as session:
            statement = select(Game.id).where(Game.status == GameStatus.MONITORED)
            monitored_game_ids = session.exec(statement).all()
            
        logger.info(f"Scanning {len(monitored_game_ids)} monitored games...")
        
        # Create tasks for concurrent execution (throttled by Semaphore inside service)
        # Each task handles its own DB session safely
        tasks = [prowlarr.search_for_game(game_id) for game_id in monitored_game_ids]
        await asyncio.gather(*tasks)
            
    except Exception as e:
        logger.error(f"Error in update search: {e}")
    finally:
        await prowlarr.close()
    logger.info("Update search completed.")

async def run_scan_cycle():
    """Main Orchestration: Sync qBit -> Scan Prowlarr"""
    logger.info("Starting full scan cycle...")
    
    # 1. Sync from qBittorrent
    await run_sync_library()
        
    # 2. Scan Prowlarr for Monitored Games
    await run_search_updates()
    
    logger.info("Full scan cycle completed.")
