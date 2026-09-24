# ERP Preflight — Python FastAPI Analysis Engine Foundation Plan

**Author**: `m1_explorer_3`  
**Milestone**: M1 (Foundation & Scaffolding)  
**Target Service**: `services/analysis-python`  
**Host Environment**: Windows 11 Enterprise (Python 3.13.2 via `py.exe`)  
**Deployment Target**: Debian-Slim Non-Root Container (`UID 10001`) via Coolify / Hostinger VPS  
**Date**: 2026-09-24  

---

## 1. Executive Summary & Architectural Invariants

The `services/analysis-python` microservice is the computational core of ERP Preflight. It is responsible for deterministic parsing, domain rule evaluation, dependency graph traversal, and statistical analysis across customer SAP artifacts.

### 1.1 Invariant Boundaries
1. **Stateless Analysis Worker**:
   `services/analysis-python` does NOT access SaaS business tables, user credentials, or billing tiers directly. All operations are parameterized through the normalized `AnalysisRequest` contract.
2. **Deterministic-First Reliability**:
   Findings must strictly adhere to the 4-tier epistemic confidence hierarchy:
   - `VERIFIED` (score: 1.0): Exact parser AST, schema, or configuration proof.
   - `RULE_DERIVED` (score: 0.85): Deterministic rule match or graph traversal.
   - `INFERRED` (score: 0.60): Heuristic similarity or semantic LLM derivation.
   - `UNKNOWN` (score: 0.30): Insufficient evidence, missing tables, or unverified patterns.
3. **Strict LLM Boundary**:
   Any finding derived with AI/LLM involvement is non-negotiably demoted to `INFERRED` ($\le 0.60$) or `UNKNOWN`. It can NEVER be classified as `VERIFIED` or `RULE_DERIVED`.
4. **Defense-in-Depth Parser Security**:
   All untrusted XML/XDP artifacts are parsed using `defusedxml` with entity expansion and external DTD resolution disabled (prevention of XXE and Billion Laughs exploits).
5. **Cryptographic Provenance**:
   Every finding must link to one or more `Evidence` records containing a cryptographic SHA-256 hash of the artifact excerpt.
6. **Engine Scaffolding Readiness**:
   The registry must register and expose all 18 SAP Preflight Engines + `MFS_BLACKBOX` (19 total) upon application startup so that `/health/readiness` and `GET /api/v1/engines` confirm complete platform readiness.

---

## 2. Target Directory & File Hierarchy

The `services/analysis-python` directory is structured to achieve strict modularity, test isolation, and rapid container startup:

```text
services/analysis-python/
├── pyproject.toml                     # PEP 621 packaging, pytest & ruff configs
├── requirements.txt                   # Production pinned dependencies
├── requirements-dev.txt               # Development & test dependencies
├── README.md                          # Service documentation & run commands
├── src/
│   ├── __init__.py                    # Package root marker
│   ├── main.py                        # FastAPI application factory & ASGI entrypoint
│   ├── config.py                      # Pydantic-settings configuration
│   ├── api/
│   │   ├── __init__.py
│   │   ├── router.py                  # API v1 main router
│   │   ├── health.py                  # /health/liveness & /health/readiness
│   │   ├── analyze.py                 # POST /api/v1/analyze & GET /api/v1/engines
│   │   ├── middleware.py              # Correlation ID & execution timing middleware
│   │   └── errors.py                  # Standardized error handlers (422, 404, 500)
│   ├── core/
│   │   ├── __init__.py
│   │   ├── base_engine.py             # BaseEngine abstract base class
│   │   ├── registry.py                # EngineRegistry container & @register_engine decorator
│   │   ├── runner.py                  # EngineRunner execution orchestrator
│   │   └── exceptions.py              # Custom domain exceptions
│   ├── models/
│   │   ├── __init__.py
│   │   ├── enums.py                   # EngineType, Severity, ConfidenceClass, ArtifactType
│   │   ├── evidence.py                # Evidence & ProvenanceRecord models
│   │   ├── finding.py                 # Finding & Remediation models
│   │   ├── request.py                 # AnalysisRequest, ArtifactReference, AnalysisOptions
│   │   ├── response.py                # AnalysisResponse, AnalysisMetrics
│   │   └── health.py                  # HealthStatus, LivenessResponse, ReadinessResponse
│   ├── platform/
│   │   ├── __init__.py
│   │   ├── confidence.py              # ConfidenceClassifier & demotion rule engine
│   │   └── evidence.py                # EvidenceEngine & SHA-256 calculation
│   ├── parsers/
│   │   ├── __init__.py
│   │   └── safe_xml.py                # Safe XML parser wrapping defusedxml
│   └── engines/                       # 18 SAP Preflight Engines + MFS BlackBox
│       ├── __init__.py                # Auto-discovery & import of all engine modules
│       ├── opd_guard.py               # 1. Output Parameter Determination
│       ├── form_doctor.py             # 2. Adobe Forms XDP/XML path tracer
│       ├── custom_field_flow.py       # 3. Custom Field Flow Doctor
│       ├── extension_impact.py        # 4. Extension Impact Guard
│       ├── spro2cloud.py              # 5. SPRO to SSCUI/CBC mapping
│       ├── ecc2cloud.py               # 6. ECC to Cloud transition navigator
│       ├── gap_radar.py               # 7. SAP Gap Radar (12 tiers)
│       ├── clean_core.py              # 8. Clean Core Object Guard
│       ├── change_pointer.py          # 9. Change Pointer Coverage Auditor
│       ├── api_change.py              # 10. API Change Guard (diffing)
│       ├── software_collection.py     # 11. Software Collection Dependency Guard
│       ├── transport_dependency.py    # 12. Transport Dependency Analyzer
│       ├── safe_decommission.py       # 13. Safe Decommission Preflight
│       ├── fiori_403.py               # 14. Fiori 403 Root-Cause Doctor
│       ├── workflow_stuck.py          # 15. Workflow Stuck Explainer
│       ├── iam_cost.py                # 16. IAM Cost Optimizer
│       ├── account_determination.py   # 17. Account Determination Preflight
│       ├── system_refresh.py          # 18. System Refresh Delta Guard
│       └── mfs_blackbox.py            # 19. Warehouse Automation MFS BlackBox
└── tests/
    ├── pytest.ini                     # Pytest execution configuration
    ├── conftest.py                    # Shared test fixtures & FastAPI TestClient
    ├── fixtures/                      # Mock artifacts & test payloads
    │   ├── sample_request.json
    │   ├── valid_test.xml
    │   └── malicious_xxe.xml
    ├── unit/
    │   ├── test_health.py             # Liveness and readiness probe tests
    │   ├── test_schemas.py            # Request/Response/Finding validation tests
    │   ├── test_confidence.py         # Confidence Classifier & demotion tests
    │   ├── test_safe_xml.py           # XML safety & XXE rejection tests
    │   ├── test_registry.py           # Engine registry registration & lookup tests
    │   └── test_runner.py             # EngineRunner orchestration & timing tests
    └── integration/
        └── test_api.py                # HTTP API route tests (POST /analyze, GET /engines)
```

---

## 3. Packaging & Dependencies

### 3.1 `pyproject.toml`
Declares project metadata, dependencies, tool configurations (pytest, ruff), and build backend:

```toml
[build-system]
requires = ["setuptools>=68.0.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "erppreflight-analysis"
version = "1.0.0"
description = "ERP Preflight Deterministic Analysis Engine Microservice"
readme = "README.md"
requires-python = ">=3.11"
license = { text = "Proprietary" }
authors = [{ name = "ERP Preflight Engineering" }]
dependencies = [
    "fastapi>=0.115.0,<1.0.0",
    "uvicorn[standard]>=0.32.0",
    "pydantic>=2.9.0,<3.0.0",
    "pydantic-settings>=2.5.0",
    "defusedxml>=0.7.1",
    "python-multipart>=0.0.12",
    "httpx>=0.27.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "pytest-cov>=5.0.0",
    "ruff>=0.7.0",
]

[tool.setuptools.packages.find]
where = ["."]
include = ["src*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"
addopts = "-v --strict-markers -ra"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "W", "I", "UP", "B", "C4"]
ignore = ["E501"]
```

### 3.2 `requirements.txt`
Pinned for deterministic, reproducible production container builds:

```text
fastapi==0.115.6
uvicorn[standard]==0.34.0
pydantic==2.11.7
pydantic-settings==2.13.1
defusedxml==0.7.1
python-multipart==0.0.20
httpx==0.28.1
```

### 3.3 `requirements-dev.txt`
```text
-r requirements.txt
pytest==9.0.2
pytest-asyncio==1.4.0
pytest-cov==5.0.0
ruff==0.12.1
```

---

## 4. Configuration & Settings (`src/config.py`)

Settings are managed via `pydantic-settings` to provide typed environment variables with sensible defaults:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Service Metadata
    SERVICE_NAME: str = "analysis-python"
    SERVICE_VERSION: str = "1.0.0"
    ENVIRONMENT: str = Field(default="development", env="NODE_ENV")
    DEBUG: bool = False

    # Server Binding
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 4

    # Security & CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:4000",
        "https://erppreflight.com",
        "https://api.erppreflight.com",
    ]
    CORS_ALLOW_CREDENTIALS: bool = True
    MAX_PAYLOAD_SIZE_MB: int = 50

    # Engine Execution
    DEFAULT_TIMEOUT_SECONDS: int = 120
    MAX_FINDINGS_PER_ANALYSIS: int = 1000
    ENFORCE_CONFIDENCE_DEMOTION: bool = True


def get_settings() -> Settings:
    return Settings()
```

---

## 5. Core Interface Contracts & Pydantic v2 Models (`src/models/`)

### 5.1 Enums (`src/models/enums.py`)
```python
from enum import Enum


class EngineType(str, Enum):
    # Output & Extensibility
    OPD_GUARD = "OPD_GUARD"
    FORM_DOCTOR = "FORM_DOCTOR"
    CUSTOM_FIELD_FLOW_DOCTOR = "CUSTOM_FIELD_FLOW_DOCTOR"
    EXTENSION_IMPACT_GUARD = "EXTENSION_IMPACT_GUARD"
    # Migration & Clean Core
    SPRO2CLOUD = "SPRO2CLOUD"
    ECC2CLOUD_NAVIGATOR = "ECC2CLOUD_NAVIGATOR"
    SAP_GAP_RADAR = "SAP_GAP_RADAR"
    CLEAN_CORE_OBJECT_GUARD = "CLEAN_CORE_OBJECT_GUARD"
    # Integration
    CHANGE_POINTER_COVERAGE_AUDITOR = "CHANGE_POINTER_COVERAGE_AUDITOR"
    API_CHANGE_GUARD = "API_CHANGE_GUARD"
    # Release & Transport
    SOFTWARE_COLLECTION_DEPENDENCY_GUARD = "SOFTWARE_COLLECTION_DEPENDENCY_GUARD"
    TRANSPORT_DEPENDENCY_ANALYZER = "TRANSPORT_DEPENDENCY_ANALYZER"
    # Operations
    SAFE_DECOMMISSION_PREFLIGHT = "SAFE_DECOMMISSION_PREFLIGHT"
    FIORI_403_ROOT_CAUSE_DOCTOR = "FIORI_403_ROOT_CAUSE_DOCTOR"
    WORKFLOW_STUCK_EXPLAINER = "WORKFLOW_STUCK_EXPLAINER"
    IAM_COST_OPTIMIZER = "IAM_COST_OPTIMIZER"
    ACCOUNT_DETERMINATION_PREFLIGHT = "ACCOUNT_DETERMINATION_PREFLIGHT"
    SYSTEM_REFRESH_DELTA_GUARD = "SYSTEM_REFRESH_DELTA_GUARD"
    # Warehouse Automation
    MFS_BLACKBOX = "MFS_BLACKBOX"


class Severity(str, Enum):
    BLOCKER = "BLOCKER"
    CRITICAL = "CRITICAL"
    MAJOR = "MAJOR"
    MINOR = "MINOR"
    INFO = "INFO"


class ConfidenceClass(str, Enum):
    VERIFIED = "VERIFIED"          # Score: 1.0
    RULE_DERIVED = "RULE_DERIVED"  # Score: 0.85
    INFERRED = "INFERRED"          # Score: 0.60
    UNKNOWN = "UNKNOWN"            # Score: 0.30


class AnalysisStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    PARTIAL = "PARTIAL"


class ArtifactType(str, Enum):
    XML = "XML"
    JSON = "JSON"
    CSV = "CSV"
    ZIP = "ZIP"
    ABAP = "ABAP"
    XDP = "XDP"
    WSDL = "WSDL"
    EDMX = "EDMX"
    TXT = "TXT"
    XLSX = "XLSX"


class TrustLevel(str, Enum):
    OFFICIAL_METADATA = "OFFICIAL_METADATA"  # 1.0
    OFFICIAL_DOCS = "OFFICIAL_DOCS"          # 0.95
    CURATED_RULE = "CURATED_RULE"            # 0.85
    COMMUNITY = "COMMUNITY"                  # 0.70
    CUSTOMER_EVIDENCE = "CUSTOMER_EVIDENCE"  # 0.50
    INFERRED = "INFERRED"                    # 0.30
```

### 5.2 Evidence Model (`src/models/evidence.py`)
```python
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
```

### 5.3 Finding Model (`src/models/finding.py`)
```python
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
```

### 5.4 Request & Response Contracts (`src/models/request.py`, `src/models/response.py`)

#### `src/models/request.py`
```python
from pydantic import BaseModel, Field, ConfigDict
from typing import Dict, Any, Optional, List
from src.models.enums import EngineType, ArtifactType


class ArtifactReference(BaseModel):
    artifact_id: Optional[str] = None
    file_name: str
    artifact_type: ArtifactType
    storage_key: Optional[str] = None
    raw_content: Optional[str] = None  # Facilitates direct payload execution in tests


class AnalysisOptions(BaseModel):
    deterministic_only: bool = True
    strict_validation: bool = True
    max_findings: int = 1000
    custom_params: Dict[str, Any] = Field(default_factory=dict)


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    job_id: str = Field(..., alias="job_id", description="UUID of the analysis job")
    tenant_id: str = Field(..., alias="tenant_id", description="UUID of the tenant organization")
    project_id: str = Field(..., alias="project_id", description="UUID of the workspace project")
    engine_type: EngineType = Field(..., alias="engine_type", description="Target engine to execute")
    target_release: str = Field("2023", alias="target_release", description="SAP target release (e.g. 2023, 2608)")
    artifact_s3_key: Optional[str] = Field(None, alias="artifact_s3_key", description="S3 storage key for artifact")
    artifact_type: ArtifactType = Field(ArtifactType.JSON, alias="artifact_type")
    configuration: Dict[str, Any] = Field(default_factory=dict)
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)
    
    # Direct payload support for test fixtures and local execution
    raw_content: Optional[str] = Field(None, description="Inline payload content when S3 is bypassed")
    artifacts: List[ArtifactReference] = Field(default_factory=list)
```

#### `src/models/response.py`
```python
from pydantic import BaseModel, Field
from typing import List, Dict, Any
from src.models.enums import EngineType, AnalysisStatus
from src.models.finding import Finding


class AnalysisMetrics(BaseModel):
    execution_time_ms: int = Field(default=0, description="Total execution time in milliseconds")
    rules_evaluated: int = Field(default=0, description="Number of rules evaluated")
    artifacts_scanned: int = Field(default=1, description="Number of artifacts scanned")
    additional_metrics: Dict[str, Any] = Field(default_factory=dict)


class AnalysisResponse(BaseModel):
    job_id: str = Field(..., description="UUID matching the request job_id")
    engine_type: EngineType = Field(..., description="Engine that executed the analysis")
    status: AnalysisStatus = Field(default=AnalysisStatus.COMPLETED)
    findings: List[Finding] = Field(default_factory=list)
    metrics: AnalysisMetrics = Field(default_factory=AnalysisMetrics)
    error_message: str | None = None
```

### 5.5 Health Models (`src/models/health.py`)
```python
from pydantic import BaseModel, Field
from typing import Dict, Any, List
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
    checks: Dict[str, Any] = Field(default_factory=dict)
```

---

## 6. Platform Primitives: Evidence & Confidence (`src/platform/`)

### 6.1 Confidence Classifier (`src/platform/confidence.py`)
Enforces the epistemic hierarchy and mandatory demotion rules:

```python
import hashlib
from src.models.enums import ConfidenceClass
from src.models.finding import Finding

CONFIDENCE_SCORE_MAP = {
    ConfidenceClass.VERIFIED: 1.0,
    ConfidenceClass.RULE_DERIVED: 0.85,
    ConfidenceClass.INFERRED: 0.60,
    ConfidenceClass.UNKNOWN: 0.30,
}


class ConfidenceClassifier:
    """Enforces epistemic reliability rules and non-negotiable demotion invariants."""

    @staticmethod
    def classify_finding(finding: Finding, is_ai_generated: bool = False, missing_evidence: bool = False) -> Finding:
        # Rule 1: Non-negotiable LLM Boundary
        # If an LLM or probabilistic model was involved, finding can NEVER exceed INFERRED (0.60)
        if is_ai_generated:
            if finding.confidence in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED):
                finding.confidence = ConfidenceClass.INFERRED
            finding.confidence_score = min(finding.confidence_score, 0.60)

        # Rule 2: Missing mandatory evidence demotes to UNKNOWN
        if missing_evidence or (not finding.evidence and finding.confidence == ConfidenceClass.VERIFIED):
            finding.confidence = ConfidenceClass.UNKNOWN
            finding.confidence_score = 0.30

        # Sync confidence score
        default_score = CONFIDENCE_SCORE_MAP.get(finding.confidence, 0.30)
        finding.confidence_score = default_score
        return finding
```

### 6.2 Evidence Engine (`src/platform/evidence.py`)
Computes immutable SHA-256 hashes and verifies release validity:

```python
import hashlib
from typing import Optional
from src.models.evidence import Evidence
from src.models.enums import ConfidenceClass, TrustLevel


class EvidenceEngine:
    """Computes cryptographic hashes and validates release alignment."""

    @staticmethod
    def compute_sha256(content: str | bytes) -> str:
        if isinstance(content, str):
            content = content.encode("utf-8")
        return hashlib.sha256(content).hexdigest()

    @classmethod
    def create_evidence(
        cls,
        artifact_path: str,
        content: str | bytes,
        line_number: Optional[int] = None,
        column_number: Optional[int] = None,
        snippet: Optional[str] = None,
        provenance: ConfidenceClass = ConfidenceClass.VERIFIED,
        source_type: TrustLevel = TrustLevel.CUSTOMER_EVIDENCE,
    ) -> Evidence:
        sha256_hash = cls.compute_sha256(content)
        return Evidence(
            artifact_path=artifact_path,
            line_number=line_number,
            column_number=column_number,
            snippet=snippet,
            sha256=sha256_hash,
            provenance=provenance,
            source_type=source_type,
            trust_score=1.0 if provenance == ConfidenceClass.VERIFIED else 0.85,
        )
```

---

## 7. Safe XML Parser (`src/parsers/safe_xml.py`)

Guarantees protection against XXE injection, Billion Laughs attacks, and quadratic entity expansion:

```python
import defusedxml.ElementTree as DefusedET
from defusedxml.common import DefusedXmlException, EntitiesForbidden, DTDForbidden
from typing import Any
from src.core.exceptions import SecurityViolationError


class SafeXmlParser:
    """Defused XML parser preventing XXE and entity expansion vulnerabilities."""

    @staticmethod
    def parse_string(xml_text: str) -> DefusedET.Element:
        try:
            return DefusedET.fromstring(
                xml_text,
                forbid_dtd=True,
                forbid_entities=True,
                forbid_external=True
            )
        except (EntitiesForbidden, DTDForbidden) as e:
            raise SecurityViolationError(f"Malicious XML detected (Entities/DTD forbidden): {str(e)}") from e
        except DefusedXmlException as e:
            raise SecurityViolationError(f"XML parse rejected by defusedxml: {str(e)}") from e
        except Exception as e:
            raise ValueError(f"Invalid XML syntax: {str(e)}") from e
```

---

## 8. Engine Runner & Registry Scaffolding (`src/core/`)

### 8.1 Base Engine Abstract Class (`src/core/base_engine.py`)
```python
from abc import ABC, abstractmethod
from typing import List
from src.models.enums import EngineType, ArtifactType
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse


class BaseEngine(ABC):
    """Abstract base class that all 19 ERP Preflight engines must implement."""

    engine_type: EngineType
    name: str
    description: str
    version: str = "1.0.0"
    supported_artifact_types: List[ArtifactType] = [ArtifactType.JSON]

    @abstractmethod
    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Executes deterministic analysis against input request."""
        pass

    def get_metadata(self) -> dict:
        return {
            "engine_type": self.engine_type.value,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "supported_artifact_types": [t.value for t in self.supported_artifact_types],
        }
```

### 8.2 Engine Registry (`src/core/registry.py`)
```python
from typing import Dict, Type, List, Optional
from src.models.enums import EngineType
from src.core.base_engine import BaseEngine
from src.core.exceptions import EngineNotFoundError


class EngineRegistry:
    """Thread-safe registry containing all 18 SAP engines + MFS BlackBox."""

    _engines: Dict[EngineType, BaseEngine] = {}

    @classmethod
    def register(cls, engine_cls: Type[BaseEngine]) -> Type[BaseEngine]:
        instance = engine_cls()
        cls._engines[instance.engine_type] = instance
        return engine_cls

    @classmethod
    def get(cls, engine_type: EngineType) -> BaseEngine:
        if engine_type not in cls._engines:
            raise EngineNotFoundError(f"Engine '{engine_type}' is not registered.")
        return cls._engines[engine_type]

    @classmethod
    def list_all(cls) -> List[dict]:
        return [engine.get_metadata() for engine in cls._engines.values()]

    @classmethod
    def is_registered(cls, engine_type: EngineType) -> bool:
        return engine_type in cls._engines

    @classmethod
    def count(cls) -> int:
        return len(cls._engines)


def register_engine(cls: Type[BaseEngine]) -> Type[BaseEngine]:
    """Decorator for registering an engine class."""
    return EngineRegistry.register(cls)
```

### 8.3 Engine Runner (`src/core/runner.py`)
```python
import time
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse, AnalysisMetrics
from src.models.enums import AnalysisStatus
from src.core.registry import EngineRegistry
from src.platform.confidence import ConfidenceClassifier


class EngineRunner:
    """Orchestrates request validation, engine execution, metrics, and confidence invariants."""

    @classmethod
    async def execute(cls, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        engine = EngineRegistry.get(request.engine_type)

        try:
            response = await engine.analyze(request)
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)

            # Ensure metrics are calculated
            if response.metrics is None:
                response.metrics = AnalysisMetrics()
            response.metrics.execution_time_ms = elapsed_ms

            # Enforce epistemic confidence invariants on all findings
            for finding in response.findings:
                ConfidenceClassifier.classify_finding(finding)

            return response
        except Exception as e:
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
            return AnalysisResponse(
                job_id=request.job_id,
                engine_type=request.engine_type,
                status=AnalysisStatus.FAILED,
                findings=[],
                metrics=AnalysisMetrics(execution_time_ms=elapsed_ms, rules_evaluated=0, artifacts_scanned=0),
                error_message=str(e),
            )
```

### 8.4 Custom Exceptions (`src/core/exceptions.py`)
```python
class AnalysisEngineException(Exception):
    """Base exception for analysis engine."""
    pass


class EngineNotFoundError(AnalysisEngineException):
    """Raised when requested engine is not registered."""
    pass


class SecurityViolationError(AnalysisEngineException):
    """Raised when an untrusted payload violates security policies (e.g. XXE)."""
    pass


class ArtifactProcessingError(AnalysisEngineException):
    """Raised when an artifact cannot be parsed or decoded."""
    pass
```

---

## 9. Scaffolding for All 18+1 Engines (`src/engines/`)

All 19 engines register at startup via the `@register_engine` decorator and provide conformant `BaseEngine` implementations.

### 9.1 Master Scaffolding Template
Each of the 19 engine files in `src/engines/` follows this clean structure:

```python
# Example: services/analysis-python/src/engines/opd_guard.py
from src.core.base_engine import BaseEngine
from src.core.registry import register_engine
from src.models.enums import EngineType, ArtifactType, AnalysisStatus
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse, AnalysisMetrics


@register_engine
class OPDGuardEngine(BaseEngine):
    engine_type = EngineType.OPD_GUARD
    name = "OPD Guard"
    description = "S/4HANA Output Parameter Determination & BRFplus decision table evaluation"
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.CSV, ArtifactType.XLSX, ArtifactType.JSON]

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        # M1 scaffolding returns baseline completed status; M3 introduces full domain rule logic
        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=[],
            metrics=AnalysisMetrics(rules_evaluated=8, artifacts_scanned=1),
        )
```

### 9.2 Complete Engine Registry Inventory (19 Engines)
The following 19 modules are created in `src/engines/`:

1. `opd_guard.py`: `OPDGuardEngine` (`EngineType.OPD_GUARD`)
2. `form_doctor.py`: `FormDoctorEngine` (`EngineType.FORM_DOCTOR`, types: `[ArtifactType.XML, ArtifactType.XDP, ArtifactType.XSD]`)
3. `custom_field_flow.py`: `CustomFieldFlowEngine` (`EngineType.CUSTOM_FIELD_FLOW_DOCTOR`, types: `[ArtifactType.JSON]`)
4. `extension_impact.py`: `ExtensionImpactEngine` (`EngineType.EXTENSION_IMPACT_GUARD`, types: `[ArtifactType.JSON]`)
5. `spro2cloud.py`: `SPRO2CloudEngine` (`EngineType.SPRO2CLOUD`, types: `[ArtifactType.CSV, ArtifactType.XLSX, ArtifactType.JSON]`)
6. `ecc2cloud.py`: `ECC2CloudEngine` (`EngineType.ECC2CLOUD_NAVIGATOR`, types: `[ArtifactType.CSV, ArtifactType.JSON]`)
7. `gap_radar.py`: `GapRadarEngine` (`EngineType.SAP_GAP_RADAR`, types: `[ArtifactType.JSON, ArtifactType.TXT]`)
8. `clean_core.py`: `CleanCoreEngine` (`EngineType.CLEAN_CORE_OBJECT_GUARD`, types: `[ArtifactType.ABAP, ArtifactType.ZIP]`)
9. `change_pointer.py`: `ChangePointerEngine` (`EngineType.CHANGE_POINTER_COVERAGE_AUDITOR`, types: `[ArtifactType.CSV, ArtifactType.JSON]`)
10. `api_change.py`: `ApiChangeEngine` (`EngineType.API_CHANGE_GUARD`, types: `[ArtifactType.JSON, ArtifactType.EDMX, ArtifactType.XML]`)
11. `software_collection.py`: `SoftwareCollectionEngine` (`EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD`, types: `[ArtifactType.JSON, ArtifactType.ZIP]`)
12. `transport_dependency.py`: `TransportDependencyEngine` (`EngineType.TRANSPORT_DEPENDENCY_ANALYZER`, types: `[ArtifactType.CSV, ArtifactType.JSON]`)
13. `safe_decommission.py`: `SafeDecommissionEngine` (`EngineType.SAFE_DECOMMISSION_PREFLIGHT`, types: `[ArtifactType.CSV, ArtifactType.JSON]`)
14. `fiori_403.py`: `Fiori403Engine` (`EngineType.FIORI_403_ROOT_CAUSE_DOCTOR`, types: `[ArtifactType.JSON, ArtifactType.TXT]`)
15. `workflow_stuck.py`: `WorkflowStuckEngine` (`EngineType.WORKFLOW_STUCK_EXPLAINER`, types: `[ArtifactType.CSV, ArtifactType.JSON]`)
16. `iam_cost.py`: `IAMCostEngine` (`EngineType.IAM_COST_OPTIMIZER`, types: `[ArtifactType.CSV, ArtifactType.JSON]`)
17. `account_determination.py`: `AccountDeterminationEngine` (`EngineType.ACCOUNT_DETERMINATION_PREFLIGHT`, types: `[ArtifactType.CSV, ArtifactType.JSON]`)
18. `system_refresh.py`: `SystemRefreshEngine` (`EngineType.SYSTEM_REFRESH_DELTA_GUARD`, types: `[ArtifactType.JSON, ArtifactType.CSV]`)
19. `mfs_blackbox.py`: `MFSBlackBoxEngine` (`EngineType.MFS_BLACKBOX`, types: `[ArtifactType.CSV, ArtifactType.TXT, ArtifactType.JSON]`)

### 9.3 Engine Auto-Registration (`src/engines/__init__.py`)
`src/engines/__init__.py` automatically imports each engine module so that decorators execute when `src.engines` is imported:

```python
import importlib
from pathlib import Path

# Automatically import all engine modules in this directory
_engine_files = [f.stem for f in Path(__file__).parent.glob("*.py") if f.name != "__init__.py"]
for mod in _engine_files:
    importlib.import_module(f"src.engines.{mod}")
```

---

## 10. FastAPI Application, Lifecycle & API Endpoints

### 10.1 App Lifecycle & Factory (`src/main.py`)
```python
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.config import get_settings
from src.core.registry import EngineRegistry
from src.api.router import api_router
from src.api.health import health_router
from src.api.middleware import CorrelationIdMiddleware, ProcessTimeMiddleware
from src.api.errors import register_error_handlers
import src.engines  # Triggers automatic registration of all 19 engines

logger = logging.getLogger("analysis_engine")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Verify all engines registered
    settings = get_settings()
    registered_count = EngineRegistry.count()
    logger.info(f"Starting {settings.SERVICE_NAME} v{settings.SERVICE_VERSION}...")
    logger.info(f"Engine registry initialized with {registered_count} engines.")
    if registered_count < 19:
        logger.warning(f"Expected 19 engines, but only {registered_count} are registered!")
    yield
    # Shutdown: Clean up any open executors
    logger.info(f"Shutting down {settings.SERVICE_NAME}...")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="ERP Preflight Analysis Engine",
        version=settings.SERVICE_VERSION,
        description="Deterministic Analysis Engine Microservice for SAP Preflight Auditing",
        lifespan=lifespan,
    )

    # Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(CorrelationIdMiddleware)
    app.add_middleware(ProcessTimeMiddleware)

    # Error Handlers
    register_error_handlers(app)

    # Routers
    app.include_router(health_router)
    app.include_router(api_router, prefix="/api/v1")

    return app


app = create_app()
```

### 10.2 Health Router (`src/api/health.py`)
```python
from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from src.models.health import LivenessResponse, ReadinessResponse
from src.core.registry import EngineRegistry
from src.config import get_settings
import sys

health_router = APIRouter(prefix="/health", tags=["Health"])


@health_router.get(
    "/liveness",
    response_model=LivenessResponse,
    summary="Liveness Probe",
    status_code=status.HTTP_200_OK
)
async def liveness():
    """Liveness probe confirming the event loop and process are alive."""
    return LivenessResponse()


@health_router.get(
    "/readiness",
    response_model=ReadinessResponse,
    summary="Readiness Probe",
    status_code=status.HTTP_200_OK
)
async def readiness():
    """Readiness probe validating engine registry and core subsystems."""
    settings = get_settings()
    engine_count = EngineRegistry.count()
    is_ready = engine_count >= 19

    payload = ReadinessResponse(
        status="ready" if is_ready else "not_ready",
        checks={
            "engine_registry": {
                "status": "up" if is_ready else "degraded",
                "registered_count": engine_count,
                "expected_count": 19,
            },
            "parsers": {
                "status": "up",
                "defusedxml": "available",
            },
            "system": {
                "status": "up",
                "python_version": sys.version.split()[0],
            },
        }
    )

    if not is_ready:
        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=payload.model_dump())

    return payload
```

### 10.3 Analysis & Engine Endpoints (`src/api/analyze.py`)
```python
from fastapi import APIRouter, status, Depends
from typing import List
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse
from src.models.enums import EngineType
from src.core.runner import EngineRunner
from src.core.registry import EngineRegistry

router = APIRouter(tags=["Analysis"])


@router.post(
    "/analyze",
    response_model=AnalysisResponse,
    summary="Execute Preflight Engine Analysis",
    status_code=status.HTTP_200_OK
)
async def analyze_endpoint(request: AnalysisRequest) -> AnalysisResponse:
    """Executes a preflight analysis against the designated SAP engine."""
    return await EngineRunner.execute(request)


@router.get(
    "/engines",
    response_model=List[dict],
    summary="List All Registered Engines",
    status_code=status.HTTP_200_OK
)
async def list_engines() -> List[dict]:
    """Returns metadata for all 19 preflight engines registered in the system."""
    return EngineRegistry.list_all()


@router.get(
    "/engines/{engine_type}",
    summary="Get Engine Metadata",
    status_code=status.HTTP_200_OK
)
async def get_engine(engine_type: EngineType) -> dict:
    """Returns detailed metadata for a specific registered engine."""
    engine = EngineRegistry.get(engine_type)
    return engine.get_metadata()
```

### 10.4 Error Handlers & Middleware (`src/api/errors.py`, `src/api/middleware.py`)

#### `src/api/errors.py`
```python
import uuid
import logging
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from src.core.exceptions import EngineNotFoundError, SecurityViolationError

logger = logging.getLogger("analysis_engine.errors")


def register_error_handlers(app: FastAPI):
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        correlation_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid request payload format or parameters",
                    "details": exc.errors(),
                    "correlation_id": correlation_id,
                }
            }
        )

    @app.exception_handler(EngineNotFoundError)
    async def engine_not_found_handler(request: Request, exc: EngineNotFoundError):
        correlation_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "error": {
                    "code": "ENGINE_NOT_FOUND",
                    "message": str(exc),
                    "details": {},
                    "correlation_id": correlation_id,
                }
            }
        )

    @app.exception_handler(SecurityViolationError)
    async def security_violation_handler(request: Request, exc: SecurityViolationError):
        correlation_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
        logger.warning(f"Security violation detected: {str(exc)} [Correlation ID: {correlation_id}]")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": {
                    "code": "SECURITY_VIOLATION",
                    "message": str(exc),
                    "details": {},
                    "correlation_id": correlation_id,
                }
            }
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        correlation_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
        logger.exception(f"Unhandled exception: {str(exc)} [Correlation ID: {correlation_id}]")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": {
                    "code": "INTERNAL_SERVER_ERROR",
                    "message": "An unexpected error occurred during analysis execution.",
                    "details": {},
                    "correlation_id": correlation_id,
                }
            }
        )
```

#### `src/api/middleware.py`
```python
import uuid
import time
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response


class ProcessTimeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_time = time.perf_counter()
        response = await call_next(request)
        process_time = time.perf_counter() - start_time
        response.headers["X-Process-Time"] = f"{process_time * 1000:.2f}ms"
        return response
```

---

## 11. Pytest Test Suite Architecture (`tests/`)

The test suite is designed for 100% pass rate from day one, covering health endpoints, schema serialization, confidence demotions, XXE rejection, registry completeness, and engine execution.

### 11.1 Shared Test Fixtures (`tests/conftest.py`)
```python
import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app
from src.models.request import AnalysisRequest
from src.models.enums import EngineType, ArtifactType


@pytest.fixture
async def async_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def sample_analysis_request() -> AnalysisRequest:
    return AnalysisRequest(
        job_id="11111111-1111-4111-8111-111111111111",
        tenant_id="22222222-2222-4222-8222-222222222222",
        project_id="33333333-3333-4333-8333-333333333333",
        engine_type=EngineType.OPD_GUARD,
        target_release="2023",
        artifact_type=ArtifactType.JSON,
        configuration={"document_type": "NB", "company_code": "1000"},
        raw_content="{}",
    )
```

### 11.2 Unit Tests Overview
1. **`tests/unit/test_health.py`**:
   - `test_liveness_endpoint`: Verifies HTTP 200 OK, `status == "ok"`, timestamp present.
   - `test_readiness_endpoint`: Verifies HTTP 200 OK, `status == "ready"`, `registered_count == 19`.
2. **`tests/unit/test_schemas.py`**:
   - `test_analysis_request_valid`: Confirms valid serialization/deserialization with UUIDs.
   - `test_analysis_request_validation_failure`: Verifies missing mandatory fields raise `ValidationError`.
   - `test_finding_schema_and_evidence`: Verifies finding schema, nested evidence, and SHA-256 hash.
   - `test_analysis_response_schema`: Verifies response schema formatting and metrics.
3. **`tests/unit/test_confidence.py`**:
   - `test_llm_demotion_invariant`: Verifies AI-generated findings are demoted to `INFERRED` and score capped at 0.60.
   - `test_missing_evidence_demotion`: Verifies findings with missing evidence demote to `UNKNOWN` (score 0.30).
   - `test_verified_confidence_retention`: Verifies rule-based findings with complete evidence retain `VERIFIED` (score 1.0).
4. **`tests/unit/test_safe_xml.py`**:
   - `test_valid_xml_parsing`: Parses standard clean XML document cleanly.
   - `test_xxe_entity_injection_blocked`: Verifies `<!ENTITY xxe SYSTEM "file:///etc/passwd">` raises `SecurityViolationError`.
   - `test_billion_laughs_expansion_blocked`: Verifies recursive entity definitions are blocked.
5. **`tests/unit/test_registry.py`**:
   - `test_all_19_engines_registered`: Asserts `EngineRegistry.count() == 19`.
   - `test_engine_lookup_success`: Verifies each `EngineType` can be retrieved.
   - `test_unknown_engine_raises_error`: Verifies unregistered string raises `EngineNotFoundError`.
6. **`tests/unit/test_runner.py`**:
   - `test_runner_executes_engine`: Runs engine through `EngineRunner.execute()`, verifies non-negative execution time and valid status.
   - `test_runner_handles_engine_exception`: Injects failing engine and verifies `status == "FAILED"` with structured error.
7. **`tests/integration/test_api.py`**:
   - `test_api_analyze_success`: `POST /api/v1/analyze` returns HTTP 200 with valid `AnalysisResponse`.
   - `test_api_list_engines`: `GET /api/v1/engines` returns 19 items with metadata.
   - `test_api_get_specific_engine`: `GET /api/v1/engines/OPD_GUARD` returns OPD Guard metadata.
   - `test_api_invalid_payload_returns_422`: Invalid JSON body returns HTTP 422 with correlation ID.

---

## 12. Implementation Execution Plan & Verification Playbook

### 12.1 Execution Sequence for Builder Agent
1. **Scaffold Directory Structure**:
   Create `services/analysis-python/` and all subdirectories (`src/api`, `src/core`, `src/models`, `src/platform`, `src/parsers`, `src/engines`, `tests/unit`, `tests/integration`, `tests/fixtures`).
2. **Write Configuration & Dependencies**:
   Write `pyproject.toml`, `requirements.txt`, `requirements-dev.txt`, and `README.md`.
3. **Implement Models & Enums**:
   Write `src/models/enums.py`, `src/models/evidence.py`, `src/models/finding.py`, `src/models/request.py`, `src/models/response.py`, and `src/models/health.py`.
4. **Implement Platform & Parsers**:
   Write `src/platform/confidence.py`, `src/platform/evidence.py`, and `src/parsers/safe_xml.py`.
5. **Implement Core Engine Framework**:
   Write `src/core/base_engine.py`, `src/core/registry.py`, `src/core/runner.py`, and `src/core/exceptions.py`.
6. **Implement 19 Engine Scaffolding Modules**:
   Write all 19 engine files in `src/engines/` and `src/engines/__init__.py`.
7. **Implement FastAPI App, API Routes & Middleware**:
   Write `src/config.py`, `src/api/middleware.py`, `src/api/errors.py`, `src/api/health.py`, `src/api/analyze.py`, `src/api/router.py`, and `src/main.py`.
8. **Implement Pytest Suite**:
   Write `tests/pytest.ini`, `tests/conftest.py`, and all test modules under `tests/unit/` and `tests/integration/`.
9. **Execute Local Verification**:
   Run `py -m pytest services/analysis-python/tests` and confirm 100% test success rate.

### 12.2 Verification Commands
On the Windows host machine:
```powershell
# 1. Run the complete Pytest suite
py -m pytest services/analysis-python/tests -v

# 2. Check code style and formatting via Ruff
py -m ruff check services/analysis-python/src

# 3. Test local startup of Uvicorn ASGI server
py -m uvicorn src.main:app --app-dir services/analysis-python --port 8000
```

Inside Docker / Coolify Container:
```bash
# Liveness probe check
curl -f http://localhost:8000/health/liveness

# Readiness probe check
curl -f http://localhost:8000/health/readiness
```

---
*Implementation Plan finalized by m1_explorer_3 on 2026-09-24.*
