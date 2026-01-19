from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path

class Settings(BaseSettings):
    # App Config
    APP_NAME: str = "Repackarr"
    DATA_DIR: Path = Path("/app/data")
    LOG_LEVEL: str = "INFO"
    CRON_INTERVAL_MINUTES: int = 60
    
    # Auth
    AUTH_USERNAME: str | None = None
    AUTH_PASSWORD: str | None = None

    # qBittorrent
    QBIT_HOST: str
    QBIT_USERNAME: str
    QBIT_PASSWORD: str
    QBIT_CATEGORY: str = "games"

    # Prowlarr
    PROWLARR_URL: str
    PROWLARR_API_KEY: str

    # IGDB (Optional but recommended)
    IGDB_CLIENT_ID: str | None = None
    IGDB_CLIENT_SECRET: str | None = None
    
    # Business Logic
    PLATFORM_FILTER: str = "Windows,Linux" # Comma separated
    IGNORED_KEYWORDS: str = "OST,Soundtrack,Wallpaper,Update Only,Crack Only"

    @property
    def platform_list(self) -> list[str]:
        return [p.strip().lower() for p in self.PLATFORM_FILTER.split(",") if p.strip()]

    @property
    def ignored_keywords_list(self) -> list[str]:
        return [k.strip().lower() for k in self.IGNORED_KEYWORDS.split(",") if k.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore" # Ignore extra env vars

@lru_cache()
def get_settings():
    return Settings()
