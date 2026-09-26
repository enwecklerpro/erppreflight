import hashlib
import json
from abc import ABC, abstractmethod
from typing import Any, ClassVar, Dict, List, Optional, Tuple

from src.core.contracts import InputContract, KnowledgeSource, RuleSpec, standard_input_rules
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
    knowledge_sources: ClassVar[Tuple[KnowledgeSource, ...]] = ()

    # Streaming transport (POST /api/v1/analyze/stream): engines that can evaluate a multi-GB artifact line by
    # line with bounded memory set supports_streaming and implement analyze_stream(); streaming_formats lists
    # the sniffed formats they accept on that path.
    supports_streaming: ClassVar[bool] = False
    streaming_formats: ClassVar[Tuple[Any, ...]] = ()

    @abstractmethod
    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Executes deterministic analysis against input request."""
        pass

    async def analyze_stream(self, request: AnalysisRequest, source: Any) -> AnalysisResponse:
        """Bounded-memory analysis of a spooled artifact (``src.core.streaming.LineSource``)."""
        raise NotImplementedError(f"{self.engine_type.value} does not support the streaming transport")

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

    def rule_version(self, code: str) -> Optional[str]:
        """Version of one declared rule: engine version + digest of its catalog entry (Part 04 §4.10).

        Changes whenever the rule's title, default severity, category or remediation text changes, or the
        engine version is bumped, so persisted findings record exactly which rule definition produced them."""
        spec = self.get_rule_catalog().get(code)
        if spec is None:
            return None
        canonical = json.dumps(spec.as_dict(), sort_keys=True, separators=(",", ":"))
        return f"{self.version}#{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:16]}"

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

    # ------------------------------------------------------------------ SDK
    def engine_health_checks(self) -> List[Tuple[str, bool, str]]:
        """Engine-specific health checks (override to verify knowledge files etc.)."""
        return []

    def health(self) -> Dict[str, Any]:
        """Operational self-check for the Admin Trust Center (Axiom 2 #13, Engine SDK §5.12)."""
        checks: List[Tuple[str, bool, str]] = [
            ("rule_catalog_declared", bool(self.finding_codes), f"{len(self.finding_codes)} finding codes"),
            (
                "remediation_complete",
                all(spec.remediation.strip() for spec in self.get_rule_catalog().values()),
                "every declared code has remediation text",
            ),
            ("input_contract_declared", self.input_contract is not None, "explicit input contract"),
        ]
        try:
            checks.extend(self.engine_health_checks())
        except Exception as exc:  # noqa: BLE001 — a failing check is reported, not raised
            checks.append(("engine_specific_checks", False, type(exc).__name__))
        ok = all(c[1] for c in checks)
        return {
            "engine_type": self.engine_type.value,
            "status": "OPERATIONAL" if ok else "DEGRADED",
            "checks": [{"name": n, "ok": passed, "detail": d} for n, passed, d in checks],
        }

    @staticmethod
    def contract_probes() -> List[Tuple[str, Dict[str, Any]]]:
        """Test-generation hook: adversarial request payloads every engine must reject without a verdict.

        Used by the parametrized contract test for all registered engines (Axiom 2 #8/#10)."""
        from src.parsers.json_input import MAX_JSON_DEPTH
        from src.parsers.safe_xml import MAX_XML_DEPTH
        import base64

        random_bytes = bytes((i * 131 + 17) % 256 for i in range(512))  # fixed pseudo-random, deterministic
        depth = MAX_JSON_DEPTH + 1
        xml_depth = MAX_XML_DEPTH + 1
        return [
            ("empty", {"raw_content": ""}),
            ("whitespace", {"raw_content": "   \n\t  \r\n"}),
            ("random_bytes_base64", {"raw_content": base64.b64encode(random_bytes).decode(), "raw_content_encoding": "base64"}),
            ("empty_object", {"raw_content": "{}"}),
            ("empty_array", {"raw_content": "[]"}),
            ("malformed_json", {"raw_content": '{"key": [1, 2, {"open": '}),
            ("malformed_xml", {"raw_content": "<root><unclosed attr='x'></root>"}),
            ("json_nesting_bomb", {"raw_content": "[" * depth + "]" * depth}),
            ("json_object_nesting_bomb", {"raw_content": '{"a":' * depth + "1" + "}" * depth}),
            ("xml_nesting_bomb", {"raw_content": "<a>" * xml_depth + "</a>" * xml_depth}),
            ("unrelated_json", {"raw_content": '{"hello": "world", "n": 1}'}),
        ]

    def get_catalog_entry(self) -> Dict[str, Any]:
        """Full admin-visibility entry: metadata, rule inventory (with remediation) and input contract."""
        entry = self.get_metadata()
        catalog = self.get_rule_catalog()
        entry["rules"] = [{**catalog[c].as_dict(), "version": self.rule_version(c)} for c in sorted(catalog)]
        entry["input_validation_rule_codes"] = sorted(set(catalog) - set(self.finding_codes))
        entry["input_contract"] = self.input_contract.describe() if self.input_contract else None
        entry["knowledge_sources"] = [k.as_dict() for k in self.knowledge_sources]
        entry["streaming"] = {
            "supported": bool(self.supports_streaming),
            "formats": [getattr(f, "value", str(f)) for f in self.streaming_formats],
        }
        entry["health"] = self.health()
        return entry
