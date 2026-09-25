from abc import ABC, abstractmethod
from typing import List, Dict, Any
from src.models.enums import EngineType, ArtifactType
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse


class BaseEngine(ABC):
    """Abstract base class that all 19 ERP Preflight engines implement."""

    engine_type: EngineType
    name: str
    description: str
    version: str = "1.0.0"
    supported_artifact_types: List[ArtifactType] = [ArtifactType.JSON]
    # Prefix for runner-generated input findings (<prefix>_INSUFFICIENT_INPUT / _PARSE_ERROR / _INVALID_INPUT).
    rule_prefix: str = ""
    # True when the engine can consume binary payloads (request.get_raw_bytes()), e.g. ZIP / XLSX.
    accepts_binary_input: bool = False

    @abstractmethod
    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Executes deterministic analysis against input request."""
        pass

    def get_rule_prefix(self) -> str:
        return self.rule_prefix or self.engine_type.value

    def get_metadata(self) -> Dict[str, Any]:
        return {
            "engine_type": self.engine_type.value,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "supported_artifact_types": [t.value for t in self.supported_artifact_types],
        }
