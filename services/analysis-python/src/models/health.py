from pydantic import BaseModel, Field
from typing import Dict, Any
from datetime import datetime, timezone


class LivenessResponse(BaseModel):
    status: str = "ok"
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    service: str = "analysis-python"
    version: str = "1.0.0"


class ReadinessResponse(BaseModel):
    status: str = "ready"
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    service: str = "analysis-python"
    version: str = "1.0.0"
    engines_registered: int = Field(default=0)
    checks: Dict[str, Any] = Field(default_factory=dict)
