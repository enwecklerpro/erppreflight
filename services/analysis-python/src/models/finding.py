import hashlib
import uuid
from pydantic import BaseModel, Field, model_validator
from typing import List, Dict, Any, Optional
from src.models.enums import Severity, ConfidenceClass
from src.models.evidence import Evidence

# Fixed namespace for deterministic (UUIDv5) finding identifiers.
FINDING_ID_NAMESPACE = uuid.UUID("6f1c2d4e-8a3b-5c7d-9e0f-1a2b3c4d5e6f")


def compute_finding_fingerprint(finding: "Finding", engine_type: Optional[str] = None) -> str:
    """Deterministic SHA-256 fingerprint over engine, rule, evidence coordinates and affected objects.

    Two identical artifact inputs produce the same fingerprint (Axiom 2, point 4).
    """
    evidence_keys = sorted(
        f"{e.sha256}:{e.line_number if e.line_number is not None else ''}:"
        f"{e.column_number if e.column_number is not None else ''}"
        for e in (finding.evidence or [])
    )
    parts = [
        str(engine_type or ""),
        finding.rule_id,
        "|".join(evidence_keys),
        "|".join(sorted(str(o) for o in (finding.affected_objects or []))),
    ]
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def compute_finding_id(fingerprint: str, scope: str = "", ordinal: int = 0) -> str:
    """Deterministic UUIDv5 derived from the fingerprint, an optional scope (job id) and an ordinal."""
    return str(uuid.uuid5(FINDING_ID_NAMESPACE, f"{scope}:{fingerprint}:{ordinal}"))


class Finding(BaseModel):
    id: str = Field(default="", description="Deterministic UUIDv5 derived from the finding fingerprint")
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

    @model_validator(mode="after")
    def _derive_deterministic_id(self) -> "Finding":
        # No random identifiers: derive from content when not explicitly supplied.
        # EngineRunner re-derives id/fingerprint (scoped to job and engine) before returning.
        if not self.id:
            self.id = compute_finding_id(compute_finding_fingerprint(self))
        return self
