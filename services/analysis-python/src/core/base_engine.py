from abc import ABC, abstractmethod
from typing import Any, ClassVar, Dict, List, Optional, Tuple

from src.core.contracts import InputContract, RuleSpec, standard_input_rules
from src.models.enums import ArtifactType, EngineType
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse

# Operational domain per engine (spec parts 06–09).
ENGINE_DOMAINS: Dict[EngineType, str] = {
    EngineType.OPD_GUARD: "Output & Extensibility",
    EngineType.FORM_DOCTOR: "Output & Extensibility",
    EngineType.CUSTOM_FIELD_FLOW_DOCTOR: "Output & Extensibility",
    EngineType.EXTENSION_IMPACT_GUARD: "Output & Extensibility",
    EngineType.SPRO2CLOUD: "Migration & Clean Core",
    EngineType.ECC2CLOUD_NAVIGATOR: "Migration & Clean Core",
    EngineType.SAP_GAP_RADAR: "Migration & Clean Core",
    EngineType.CLEAN_CORE_OBJECT_GUARD: "Migration & Clean Core",
    EngineType.CHANGE_POINTER_COVERAGE_AUDITOR: "Integration",
    EngineType.API_CHANGE_GUARD: "Integration",
    EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD: "Release & Transport",
    EngineType.TRANSPORT_DEPENDENCY_ANALYZER: "Release & Transport",
    EngineType.SAFE_DECOMMISSION_PREFLIGHT: "Operations",
    EngineType.FIORI_403_ROOT_CAUSE_DOCTOR: "Operations",
    EngineType.WORKFLOW_STUCK_EXPLAINER: "Operations",
    EngineType.IAM_COST_OPTIMIZER: "Operations",
    EngineType.ACCOUNT_DETERMINATION_PREFLIGHT: "Operations",
    EngineType.SYSTEM_REFRESH_DELTA_GUARD: "Operations",
    EngineType.MFS_BLACKBOX: "Warehouse Automation",
}

DEFAULT_TARGET_RELEASES: Tuple[str, ...] = ("S4H_2022", "S4H_2023", "S4HANA_CLOUD_2402", "S4HANA_CLOUD_2408")


class BaseEngine(ABC):
    """Abstract base class that all 19 ERP Preflight engines implement.

    Each engine declares in one place (Axiom 2 #1, #2, #5, #13, #14):
    - ``finding_codes``: its complete rule inventory with remediation text;
    - ``input_contract``: accepted formats + Pydantic model for structured input.
    """

    engine_type: EngineType
    name: str
    description: str
    version: str = "1.0.0"
    supported_artifact_types: List[ArtifactType] = [ArtifactType.JSON]
    # Prefix for runner-generated input findings (<prefix>_INSUFFICIENT_INPUT / _PARSE_ERROR / _INVALID_INPUT).
    rule_prefix: str = ""
    # True when the engine can consume binary payloads (request.get_raw_bytes()), e.g. ZIP / XLSX.
    accepts_binary_input: bool = False
    target_releases: Tuple[str, ...] = DEFAULT_TARGET_RELEASES
    finding_codes: ClassVar[Dict[str, RuleSpec]] = {}
    input_contract: ClassVar[Optional[InputContract]] = None

    @abstractmethod
    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Executes deterministic analysis against input request."""
        pass

    def get_rule_prefix(self) -> str:
        return self.rule_prefix or self.engine_type.value

    def get_rule_catalog(self) -> Dict[str, RuleSpec]:
        """Engine-declared finding codes plus the runner-generated input-validation codes."""
        formats = (
            ", ".join(f.value for f in self.input_contract.formats)
            if self.input_contract else ", ".join(t.value for t in self.supported_artifact_types)
        )
        catalog = dict(standard_input_rules(self.get_rule_prefix(), self.name, formats))
        catalog.update(self.finding_codes)
        return catalog

    def get_metadata(self) -> Dict[str, Any]:
        return {
            "engine_type": self.engine_type.value,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "domain": ENGINE_DOMAINS.get(self.engine_type, "Unassigned"),
            "target_releases": list(self.target_releases),
            "supported_artifact_types": [t.value for t in self.supported_artifact_types],
            "rule_prefix": self.get_rule_prefix(),
            "rule_count": len(self.finding_codes),
            "rule_codes": sorted(self.finding_codes),
        }

    def get_catalog_entry(self) -> Dict[str, Any]:
        """Full admin-visibility entry: metadata, rule inventory (with remediation) and input contract."""
        entry = self.get_metadata()
        catalog = self.get_rule_catalog()
        entry["rules"] = [catalog[c].as_dict() for c in sorted(catalog)]
        entry["input_validation_rule_codes"] = sorted(set(catalog) - set(self.finding_codes))
        entry["input_contract"] = self.input_contract.describe() if self.input_contract else None
        return entry
