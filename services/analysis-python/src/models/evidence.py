from pydantic import BaseModel, Field
from typing import Optional
from src.models.enums import ConfidenceClass, TrustLevel


class Evidence(BaseModel):
    artifact_path: str = Field(..., description="Relative path or identifier of artifact")
    line_number: Optional[int] = Field(None, description="1-indexed line number in source artifact")
    column_number: Optional[int] = Field(None, description="1-indexed column number in source artifact")
    snippet: Optional[str] = Field(None, description="Code or configuration snippet excerpt")
    sha256: str = Field(..., description="Cryptographic SHA-256 hash of artifact or snippet")
    provenance: ConfidenceClass = Field(default=ConfidenceClass.VERIFIED)
    source_type: TrustLevel = Field(default=TrustLevel.CUSTOMER_EVIDENCE)
    source_url: Optional[str] = None
    trust_score: float = Field(default=1.0, ge=0.0, le=1.0)
