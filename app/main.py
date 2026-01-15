import logging
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.config import get_settings
from app.database import create_db_and_tables
from app.services.manager import run_scan_cycle
from app.routers import ui

# Logging Setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("repackarr")
settings = get_settings()

# Scheduler Setup
scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_db_and_tables()
    
    # Schedule the scan job
    scheduler.add_job(
        run_scan_cycle, 
        'interval', 
        minutes=settings.CRON_INTERVAL_MINUTES,
        id='scan_job',
        replace_existing=True
    )
    scheduler.start()
    logger.info(f"Scheduler started. Interval: {settings.CRON_INTERVAL_MINUTES} mins")
    
    yield
    
    # Shutdown
    scheduler.shutdown()

app = FastAPI(title="Repackarr", lifespan=lifespan)

# Static Files (for icons or custom css if needed later)
# app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Security: Basic Auth Middleware
security = HTTPBasic()

async def get_current_username(credentials: HTTPBasicCredentials = Depends(security)):
    if not settings.AUTH_USERNAME or not settings.AUTH_PASSWORD:
        return "admin" # Auth disabled if env vars not set

    current_username_bytes = credentials.username.encode("utf8")
    correct_username_bytes = settings.AUTH_USERNAME.encode("utf8")
    is_correct_username = secrets.compare_digest(
        current_username_bytes, correct_username_bytes
    )
    
    current_password_bytes = credentials.password.encode("utf8")
    correct_password_bytes = settings.AUTH_PASSWORD.encode("utf8")
    is_correct_password = secrets.compare_digest(
        current_password_bytes, correct_password_bytes
    )
    
    if not (is_correct_username and is_correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

# Include Routers with Auth Dependency
app.include_router(ui.router, dependencies=[Depends(get_current_username)])

@app.get("/health")
def health_check():
    return {"status": "ok"}
