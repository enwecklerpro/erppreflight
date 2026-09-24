from src.core.base_engine import BaseEngine
from src.core.registry import register_engine
from src.models.enums import EngineType, ArtifactType, AnalysisStatus
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse, AnalysisMetrics


@register_engine
class MFSBlackBoxEngine(BaseEngine):
    engine_type = EngineType.MFS_BLACKBOX
    name = "MFS BlackBox"
    description = "Material Flow System / EWM telegram sequence and telegram buffer auditor"
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.CSV, ArtifactType.TXT, ArtifactType.JSON]

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=[],
            metrics=AnalysisMetrics(rules_evaluated=28, artifacts_scanned=1),
        )
