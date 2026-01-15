import logging
import asyncio
from datetime import datetime
from sqlmodel import Session, select
from app.database import engine
from app.services.qbit import QBitService
from app.services.prowlarr import ProwlarrService
from app.models import Game, GameStatus

logger = logging.getLogger("repackarr")

async def run_scan_cycle():
    """Main Orchestration: Sync qBit -> Scan Prowlarr"""
    logger.info("Starting scan cycle...")
    
    # 1. Sync from qBittorrent
    qbit = QBitService()
    try:
        with Session(engine) as session:
            await qbit.sync_games(session)
    finally:
        await qbit.close()
        
    # 2. Scan Prowlarr for Monitored Games
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
        logger.error(f"Error in scan cycle: {e}")
    finally:
        await prowlarr.close()
    
    logger.info("Scan cycle completed.")
