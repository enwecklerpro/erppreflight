from pydantic import BaseModel, Field, ConfigDict
from typing import Dict, Any, Optional, List
from src.models.enums import EngineType, ArtifactType


class ArtifactReference(BaseModel):
    artifact_id: Optional[str] = None
    file_name: str
    artifact_type: ArtifactType
    storage_key: Optional[str] = None
    raw_content: Optional[str] = None


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
    target_release: str = Field("S4H_2023", alias="target_release", description="SAP target release (e.g. S4H_2023)")
    artifact_s3_key: Optional[str] = Field(None, alias="artifact_s3_key", description="S3 storage key for artifact")
    artifact_type: ArtifactType = Field(ArtifactType.JSON, alias="artifact_type")
    configuration: Dict[str, Any] = Field(default_factory=dict)
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)
    
    # Direct payload support for test fixtures and local execution
    raw_content: Optional[str] = Field(None, description="Inline payload content when S3 is bypassed")
    artifacts: List[ArtifactReference] = Field(default_factory=list)
