from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel, Relationship
from enum import Enum

class GameStatus(str, Enum):
    MONITORED = "monitored"
    IGNORED = "ignored"

class GameBase(SQLModel):
    title: str = Field(index=True)
    search_query: str
    current_version_date: datetime
    current_version: Optional[str] = None
    status: str = Field(default=GameStatus.MONITORED)
    platform_filter: str = "Windows,Linux"
    
    # Metadata
    igdb_id: Optional[int] = None
    cover_url: Optional[str] = None

class Game(GameBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_scanned_at: Optional[datetime] = None
    
    releases: list["Release"] = Relationship(back_populates="game", sa_relationship_kwargs={"cascade": "all, delete-orphan"})

class ReleaseBase(SQLModel):
    raw_title: str
    parsed_version: Optional[str] = None
    upload_date: datetime
    indexer: str
    magnet_url: Optional[str] = None
    info_url: Optional[str] = None
    size: Optional[str] = None
    is_ignored: bool = Field(default=False)

class Release(ReleaseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    game_id: int = Field(foreign_key="game.id")
    found_at: datetime = Field(default_factory=datetime.utcnow)
    
    game: Game = Relationship(back_populates="releases")
