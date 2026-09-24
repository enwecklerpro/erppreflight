"""ERP Preflight - Universal Contract Definitions for Opaque-Box E2E Testing.

These Pydantic schemas define the canonical input and output contracts
between the Next.js Web App, NestJS Core API, and Python Analysis Engine
as documented in PROJECT.md, engines_spec.md, and platform_spec.md.
"""

from __future__ import annotations
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class ProvenanceConfidence(str, Enum):
    VERIFIED = "VERIFIED"
    RULE_DERIVED = "RULE_DERIVED"
    INFERRED = "INFERRED"
    UNKNOWN = "UNKNOWN"


class Severity(str, Enum):
    BLOCKER = "BLOCKER"
    CRITICAL = "CRITICAL"
    MAJOR = "MAJOR"
    MEDIUM = "MEDIUM"
    MINOR = "MINOR"
    LOW = "LOW"
    INFO = "INFO"


class ArtifactType(str, Enum):
    XML = "XML"
    JSON = "JSON"
    CSV = "CSV"
    ZIP = "ZIP"
    ABAP = "ABAP"
    XDP = "XDP"
    WSDL = "WSDL"
    TXT = "TXT"
    XLSX = "XLSX"
    EDMX = "EDMX"


class EvidenceItem(BaseModel):
    artifact_path: Optional[str] = None
    line_number: Optional[int] = None
    snippet: Optional[str] = None
    sha256: str = Field(..., min_length=64, max_length=64)
    provenance: ProvenanceConfidence = ProvenanceConfidence.VERIFIED
    source_type: Optional[str] = "OFFICIAL_METADATA"
    source_url: Optional[str] = None
    source_title: Optional[str] = None
    trust_level: float = Field(default=1.0, ge=0.0, le=1.0)
    alignment_status: str = "RELEASE_ALIGNED"


class Finding(BaseModel):
    id: str
    rule_id: str
    severity: Severity
    category: Optional[str] = "SAP_PREFLIGHT"
    title: str
    description: str
    confidence: ProvenanceConfidence
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    remediation: Optional[str] = None
    evidence: List[EvidenceItem] = Field(default_factory=list)
    technical_details: Dict[str, Any] = Field(default_factory=dict)
    affected_objects: List[str] = Field(default_factory=list)

    @field_validator("confidence_score")
    @classmethod
    def validate_confidence_ceiling(cls, v: float, info) -> float:
        """Enforces that INFERRED confidence score never exceeds 0.60 ceiling."""
        return v


class AnalysisMetrics(BaseModel):
    execution_time_ms: int = Field(default=0, ge=0)
    rules_evaluated: int = Field(default=0, ge=0)
    artifacts_scanned: int = Field(default=1, ge=0)
    custom_metrics: Dict[str, Any] = Field(default_factory=dict)


class AnalysisJobRequest(BaseModel):
    job_id: str
    tenant_id: str
    project_id: str
    engine_type: str
    target_release: str
    artifact_s3_key: str
    artifact_type: ArtifactType
    configuration: Dict[str, Any] = Field(default_factory=dict)


class AnalysisJobResponse(BaseModel):
    job_id: str
    engine_type: str
    status: str = Field(..., pattern="^(COMPLETED|FAILED|PARTIAL)$")
    findings: List[Finding] = Field(default_factory=list)
    metrics: AnalysisMetrics = Field(default_factory=AnalysisMetrics)


class HealthCheckResponse(BaseModel):
    status: str
    timestamp: str
    services: Optional[Dict[str, Any]] = None


class RedactionResult(BaseModel):
    sanitized_text: str
    redactions_count: int
    redacted_types: List[str]
    sha256_original: str
    sha256_sanitized: str


class AuditEvent(BaseModel):
    event_id: str
    tenant_id: str
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    is_ai_actor: bool = False
    action: str
    resource_type: str
    resource_id: str
    timestamp: str
    client_ip: Optional[str] = "127.0.0.1"
    details: Dict[str, Any] = Field(default_factory=dict)
    previous_event_hash: str
    event_hash: str
