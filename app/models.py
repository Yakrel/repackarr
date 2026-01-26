from datetime import datetime
from typing import Optional, List
from sqlmodel import Field, SQLModel, Relationship
from enum import Enum


class GameStatus(str, Enum):
    """Status options for games in the library."""
    MONITORED = "monitored"
    IGNORED = "ignored"


class GameBase(SQLModel):
    """Base model for Game with common attributes."""
    title: str = Field(index=True, description="Display title of the game")
    search_query: str = Field(description="Query string used to search for updates")
    current_version_date: datetime = Field(description="Date of the currently installed version")
    current_version: Optional[str] = Field(default=None, description="Version string if detected")
    status: GameStatus = Field(default=GameStatus.MONITORED, description="Monitoring status")
    platform_filter: str = Field(default="Windows", description="Allowed platforms")
    is_manual: bool = Field(default=False, description="True if manually added (not from qBittorrent)")
    
    # IGDB Metadata
    igdb_id: Optional[int] = Field(default=None, description="IGDB game identifier")
    cover_url: Optional[str] = Field(default=None, description="URL to game cover image")


class Game(GameBase, table=True):
    """
    Represents a game in the library.
    Games are synced from qBittorrent and monitored for updates via Prowlarr.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_scanned_at: Optional[datetime] = Field(default=None, description="Last Prowlarr scan timestamp")
    
    releases: List["Release"] = Relationship(
        back_populates="game",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )
    
    @property
    def has_updates(self) -> bool:
        """Check if game has pending update releases."""
        return any(not r.is_ignored for r in self.releases)
    
    @property
    def update_count(self) -> int:
        """Count of non-ignored releases."""
        return sum(1 for r in self.releases if not r.is_ignored)


class ReleaseBase(SQLModel):
    """Base model for Release with common attributes."""
    raw_title: str = Field(description="Original release title from indexer")
    parsed_version: Optional[str] = Field(default=None, description="Extracted version string")
    upload_date: datetime = Field(description="Release upload/publish date")
    indexer: str = Field(description="Source indexer name")
    magnet_url: Optional[str] = Field(default=None, description="Magnet or download URL")
    info_url: Optional[str] = Field(default=None, description="Information page URL")
    size: Optional[str] = Field(default=None, description="Human-readable file size")
    is_ignored: bool = Field(default=False, description="Whether release is dismissed")


class Release(ReleaseBase, table=True):
    """
    Represents a found release/update for a game.
    Releases are discovered during Prowlarr scans and can be confirmed or dismissed.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    game_id: int = Field(foreign_key="game.id", index=True)
    found_at: datetime = Field(default_factory=datetime.utcnow)
    
    game: Optional[Game] = Relationship(back_populates="releases")
    
    @property
    def display_date(self) -> str:
        """Format upload date for display."""
        return self.upload_date.strftime('%Y-%m-%d')
    
    @property
    def download_link(self) -> Optional[str]:
        """Get best available download link."""
        return self.info_url or self.magnet_url


class AppSetting(SQLModel, table=True):
    """
    Key-value storage for application runtime settings.
    Overrides environment variables when present.
    """
    key: str = Field(primary_key=True, description="Setting key (e.g., SEARCH_INTERVAL)")
    value: str = Field(description="Setting value as string")
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ScanLog(SQLModel, table=True):
    """
    History of scan operations.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    duration_seconds: float = Field(default=0.0)
    games_processed: int = Field(default=0)
    updates_found: int = Field(default=0)
    status: str = Field(default="success")  # success, failed
    details: Optional[str] = Field(default=None, description="JSON details or error message")
    skip_details: Optional[str] = Field(default=None, description="JSON array of skipped releases with reasons")


class IgnoredRelease(SQLModel, table=True):
    """
    Releases that user has explicitly chosen to ignore permanently.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    game_id: int = Field(foreign_key="game.id", index=True)
    release_title: str = Field(description="Release title to match")
    raw_title: str = Field(description="Full original title from Prowlarr")
    ignored_at: datetime = Field(default_factory=datetime.utcnow)
    
    __table_args__ = (
        {"sqlite_autoincrement": True},
    )
