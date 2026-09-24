import uuid
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from src.models.enums import Severity, ConfidenceClass
from src.models.evidence import Evidence


class Finding(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    rule_id: str = Field(..., description="Deterministic rule identifier (e.g. OPD_STEP_FAILED)")
    severity: Severity = Field(..., description="Severity classification")
    category: str = Field(..., description="Finding category or functional area")
    title: str = Field(..., description="Concise human-readable finding title")
    description: str = Field(..., description="Detailed explanation of the issue detected")
    confidence: ConfidenceClass = Field(..., description="Epistemic confidence class")
    confidence_score: float = Field(default=1.0, ge=0.0, le=1.0)
    remediation: str = Field(..., description="Actionable technical recommendation")
    evidence: List[Evidence] = Field(default_factory=list, description="Provenance evidence records")
    technical_details: Dict[str, Any] = Field(default_factory=dict, description="Engine-specific debug details")
    affected_objects: List[str] = Field(default_factory=list, description="Names of impacted SAP objects")
    fingerprint: Optional[str] = None
    is_ai_generated: bool = Field(default=False, description="Flag indicating LLM or probabilistic generation")
