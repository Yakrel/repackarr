from sqlmodel import SQLModel, create_engine, Session
from app.config import get_settings
import os

settings = get_settings()

# Ensure data directory exists
os.makedirs(settings.DATA_DIR, exist_ok=True)

sqlite_file_name = f"{settings.DATA_DIR}/repackarr.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

# check_same_thread=False is needed for FastAPI multithreading with SQLite
connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
