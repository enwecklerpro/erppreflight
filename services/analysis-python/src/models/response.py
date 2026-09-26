from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from src.models.enums import EngineType, AnalysisStatus
from src.models.finding import Finding


class AnalysisMetrics(BaseModel):
    execution_time_ms: int = Field(default=0, description="Total execution time in milliseconds")
    rules_evaluated: int = Field(default=0, description="Number of rules evaluated")
    artifacts_scanned: int = Field(default=1, description="Number of artifacts scanned")
    peak_memory_bytes: int = Field(default=0, description="Peak traced Python heap during execution (tracemalloc)")
    finding_count: int = Field(default=0, description="Number of findings returned")
    unknown_finding_count: int = Field(default=0, description="Findings classified UNKNOWN")
    unknown_finding_rate: float = Field(default=0.0, description="unknown_finding_count / finding_count")
    rules_declared: int = Field(default=0, description="Size of the engine's declared rule catalog")
    additional_metrics: Dict[str, Any] = Field(default_factory=dict)


class AnalysisResponse(BaseModel):
    job_id: str = Field(..., description="UUID matching the request job_id")
    engine_type: EngineType = Field(..., description="Engine that executed the analysis")
    status: AnalysisStatus = Field(default=AnalysisStatus.COMPLETED)
    findings: List[Finding] = Field(default_factory=list)
    metrics: AnalysisMetrics = Field(default_factory=AnalysisMetrics)
    error_message: Optional[str] = None
