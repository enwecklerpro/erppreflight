from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    SERVICE_NAME: str = "analysis-python"
    SERVICE_VERSION: str = "1.0.0"
    ENVIRONMENT: str = Field(default="development")
    DEBUG: bool = False

    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 4

    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:4000",
        "https://erppreflight.com",
    ]
    CORS_ALLOW_CREDENTIALS: bool = True
    MAX_PAYLOAD_SIZE_MB: int = 50

    DEFAULT_TIMEOUT_SECONDS: int = 120
    MAX_FINDINGS_PER_ANALYSIS: int = 1000
    ENFORCE_CONFIDENCE_DEMOTION: bool = True


def get_settings() -> Settings:
    return Settings()
