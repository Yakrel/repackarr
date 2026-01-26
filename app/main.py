"""
Repackarr - Library Update Monitor for Game Collections

A self-hosted application that monitors your qBittorrent game library
and searches Prowlarr for newer releases.
"""
import logging
import secrets
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from app.config import get_settings
from sqlmodel import Session, select
from app.database import create_db_and_tables, engine
from app.models import AppSetting
from app.services.manager import run_scan_cycle
from app.routers import ui
from app.scheduler import scheduler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("repackarr")

# Load settings
settings = get_settings()

# Security - auto mode allows optional credentials
security = HTTPBasic(auto_error=False)


def load_settings_from_db():
    """Load runtime settings from database and update global config."""
    try:
        with Session(engine) as session:
            db_settings = session.exec(select(AppSetting)).all()
            for s in db_settings:
                if hasattr(settings, s.key):
                    # Convert string value to correct type
                    target_type = type(getattr(settings, s.key))
                    try:
                        if target_type == int:
                            val = int(s.value)
                        elif target_type == bool:
                            val = s.value.lower() == "true"
                        elif target_type == list:
                            val = s.value.split(",")
                        else:
                            val = s.value
                        
                        setattr(settings, s.key, val)
                        logger.debug(f"Loaded setting {s.key}={val} from DB")
                    except ValueError:
                        logger.error(f"Failed to convert setting {s.key} value '{s.value}' to {target_type}")
    except Exception as e:
        logger.error(f"Failed to load settings from DB: {e}")


async def verify_credentials(
    request: Request,
    credentials: Optional[HTTPBasicCredentials] = Depends(security)
) -> str:
    """
    Verify HTTP Basic Auth credentials.
    
    Returns username if auth is disabled or credentials are valid.
    Raises HTTPException if credentials are invalid.
    """
    # Skip auth if not configured
    if not settings.is_auth_enabled:
        return "anonymous"
    
    # Auth is enabled but no credentials provided
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Basic"},
        )

    # Constant-time comparison to prevent timing attacks
    is_correct_username = secrets.compare_digest(
        credentials.username.encode("utf8"),
        settings.AUTH_USERNAME.encode("utf8")
    )
    is_correct_password = secrets.compare_digest(
        credentials.password.encode("utf8"),
        settings.AUTH_PASSWORD.encode("utf8")
    )
    
    if not (is_correct_username and is_correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    
    return credentials.username


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager."""
    # Startup
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    
    # Initialize database
    create_db_and_tables()
    logger.info("Database initialized")
    
    # Run migrations
    from app.migration_runner import run_migrations
    try:
        run_migrations()
    except Exception as e:
        logger.error(f"Migration error: {e}")
    
    # Load dynamic settings
    load_settings_from_db()
    
    # Configure and start scheduler
    scheduler.add_job(
        run_scan_cycle, 
        'interval', 
        minutes=settings.CRON_INTERVAL_MINUTES,
        id='scan_job',
        replace_existing=True,
        misfire_grace_time=300  # 5 minute grace period
    )
    scheduler.start()
    logger.info(f"Scheduler started (interval: {settings.CRON_INTERVAL_MINUTES} min)")
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    scheduler.shutdown(wait=False)


# Create FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Library Update Monitor for Game Collections",
    lifespan=lifespan
)

# Include routers with authentication
app.include_router(
    ui.router, 
    dependencies=[Depends(verify_credentials)]
)


@app.get("/health", tags=["System"])
def health_check():
    """Health check endpoint for container orchestration."""
    return {
        "status": "ok",
        "version": settings.APP_VERSION
    }
