from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator
from functools import lru_cache
from pathlib import Path
from typing import Self


class Settings(BaseSettings):
    """
    Application configuration loaded from environment variables.
    All settings can be overridden via .env file or environment variables.
    """
    
    # App Config
    APP_NAME: str = "Repackarr"
    APP_VERSION: str = "1.0.0"
    DATA_DIR: Path = Path("/app/data")
    LOG_LEVEL: str = "INFO"
    CRON_INTERVAL_MINUTES: int = 60
    
    # Auth (Optional - leave empty to disable)
    AUTH_USERNAME: str | None = None
    AUTH_PASSWORD: str | None = None

    # qBittorrent Connection (Required)
    QBIT_HOST: str
    QBIT_USERNAME: str
    QBIT_PASSWORD: str
    QBIT_CATEGORY: str = "games"

    # Prowlarr Connection (Required)
    PROWLARR_URL: str
    PROWLARR_API_KEY: str

    # IGDB Integration (Optional - for game covers)
    IGDB_CLIENT_ID: str | None = None
    IGDB_CLIENT_SECRET: str | None = None
    
    # Filtering Settings
    PLATFORM_FILTER: str = "Windows,Linux"
    IGNORED_KEYWORDS: str = "OST,Soundtrack,Wallpaper,Update Only,Crack Only"

    @field_validator('QBIT_HOST', 'PROWLARR_URL')
    @classmethod
    def validate_url(cls, v: str) -> str:
        """Ensure URLs are properly formatted."""
        v = v.strip().rstrip('/')
        if not v.startswith(('http://', 'https://')):
            raise ValueError('URL must start with http:// or https://')
        return v

    @field_validator('CRON_INTERVAL_MINUTES')
    @classmethod
    def validate_interval(cls, v: int) -> int:
        """Ensure scan interval is reasonable."""
        if v < 5:
            raise ValueError('Scan interval must be at least 5 minutes')
        if v > 1440:
            raise ValueError('Scan interval cannot exceed 24 hours (1440 minutes)')
        return v

    @model_validator(mode='after')
    def validate_auth(self) -> Self:
        """Ensure both username and password are set if auth is enabled."""
        if (self.AUTH_USERNAME and not self.AUTH_PASSWORD) or \
           (self.AUTH_PASSWORD and not self.AUTH_USERNAME):
            raise ValueError('Both AUTH_USERNAME and AUTH_PASSWORD must be set for authentication')
        return self

    @property
    def platform_list(self) -> list[str]:
        """Get platform filter as lowercase list."""
        return [p.strip().lower() for p in self.PLATFORM_FILTER.split(",") if p.strip()]

    @property
    def ignored_keywords_list(self) -> list[str]:
        """Get ignored keywords as lowercase list."""
        return [k.strip().lower() for k in self.IGNORED_KEYWORDS.split(",") if k.strip()]
    
    @property
    def is_auth_enabled(self) -> bool:
        """Check if authentication is enabled."""
        return bool(self.AUTH_USERNAME and self.AUTH_PASSWORD)
    
    @property
    def is_igdb_enabled(self) -> bool:
        """Check if IGDB integration is configured."""
        return bool(self.IGDB_CLIENT_ID and self.IGDB_CLIENT_SECRET)

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()
