from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator
from typing import List, Union
import json


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

    CORS_ORIGINS: Union[str, List[str]] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:4000",
        "https://erppreflight.com",
    ]
    CORS_ALLOW_CREDENTIALS: bool = True
    MAX_PAYLOAD_SIZE_MB: int = 50
    # Streaming transport (POST /api/v1/analyze/stream): artifact size cap and spool directory (default: system
    # temp dir). The body is spooled to disk, never held in memory.
    MAX_STREAM_SIZE_MB: int = 20480
    STREAM_SPOOL_DIR: str = ""
    # Disk / concurrency guards of the streaming transport: at most MAX_CONCURRENT_STREAMS bodies are spooled
    # at once (further requests wait up to STREAM_QUEUE_TIMEOUT_SECONDS, then 503), and spooling stops with 507
    # before the spool volume's free space drops below STREAM_MIN_FREE_DISK_MB.
    MAX_CONCURRENT_STREAMS: int = 2
    STREAM_QUEUE_TIMEOUT_SECONDS: int = 600
    STREAM_MIN_FREE_DISK_MB: int = 1024

    DEFAULT_TIMEOUT_SECONDS: int = 120
    MAX_FINDINGS_PER_ANALYSIS: int = 1000
    ENFORCE_CONFIDENCE_DEMOTION: bool = True

    @field_validator("CORS_ORIGINS", mode="after")
    @classmethod
    def parse_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("[") and v.endswith("]"):
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v


def get_settings() -> Settings:
    return Settings()
