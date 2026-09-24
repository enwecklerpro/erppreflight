import re
from typing import List, Dict, Optional
from dataclasses import dataclass, field


@dataclass
class EngineRecommendation:
    engine_type: str
    confidence: float
    rationale: str
    required_artifacts_present: List[str] = field(default_factory=list)
    missing_artifacts_required: List[str] = field(default_factory=list)

    def __post_init__(self):
        # HARD INVARIANT: AI / Router recommendation confidence can NEVER exceed 0.60 (INFERRED)
        if self.confidence > 0.60:
            self.confidence = 0.60


@dataclass
class RouterClassificationResult:
    status: str
    recommended_engines: List[EngineRecommendation]
    suggested_workflow: str
    missing_artifacts_checklist: List[str] = field(default_factory=list)
    execution_mode: str = "DETERMINISTIC_FAST_PATH"


class AIProblemRouter:
    """Deterministic Artifact Intent Classifier & Pluggable LLM Gateway Router."""

    ENGINE_KEYWORDS: Dict[str, List[str]] = {
        "FORM_DOCTOR": ["xdp", "adobe", "smartform", "sapscript", "form"],
        "OPD_GUARD": ["opd", "brfplus", "determination", "output type", "channel"],
        "CUSTOM_FIELD_FLOW_DOCTOR": ["custom_field", "yy1_", "cfd", "badi"],
        "EXTENSION_IMPACT_GUARD": ["blast_radius", "extension_impact", "abapgit", "dependency"],
        "SPRO2CLOUD": ["spro", "img", "simg", "sscui"],
        "ECC2CLOUD_NAVIGATOR": ["st03n", "readiness_check", "ecc2cloud", "workload"],
        "SAP_GAP_RADAR": ["gap", "requirement", "clean_core_gap", "scope_item"],
        "CLEAN_CORE_OBJECT_GUARD": ["abap", "clean_core", "tier1", "classic_modification"],
        "CHANGE_POINTER_COVERAGE_AUDITOR": ["change_pointer", "bd52", "bd61", "bd50", "bdcp2"],
        "API_CHANGE_GUARD": ["api_change", "edmx", "openapi", "odata", "wsdl"],
        "SOFTWARE_COLLECTION_DEPENDENCY_GUARD": ["software_collection", "collection", "extensibility_item"],
        "TRANSPORT_DEPENDENCY_ANALYZER": ["transport", "e070", "e071", "cts", "devk90"],
        "SAFE_DECOMMISSION_PREFLIGHT": ["decommission", "usr02", "unused_code", "retired"],
        "FIORI_403_ROOT_CAUSE_DOCTOR": ["fiori", "403", "su53", "s_service", "s_start", "iwfnd"],
        "WORKFLOW_STUCK_EXPLAINER": ["workflow", "swwwihead", "stuck_workflow", "work_item"],
        "IAM_COST_OPTIMIZER": ["iam", "license", "pfcg", "agr_1251", "fiori_catalog"],
        "ACCOUNT_DETERMINATION_PREFLIGHT": ["account_determination", "obyc", "vkoa", "t030", "coa"],
        "SYSTEM_REFRESH_DELTA_GUARD": ["system_refresh", "bdls", "refresh_delta", "rfc_destination"],
        "MFS_BLACKBOX": ["mfs", "telegram", "ewm_mfs", "plc", "conveyor"],
    }

    ARTIFACT_EXTENSIONS: Dict[str, str] = {
        "xdp": "FORM_DOCTOR",
        "abap": "CLEAN_CORE_OBJECT_GUARD",
        "edmx": "API_CHANGE_GUARD",
    }

    @classmethod
    def route_query(
        cls,
        problem_text: str = "",
        artifact_names: Optional[List[str]] = None,
        target_release: Optional[str] = None,
    ) -> RouterClassificationResult:
        """Classifies intent using deterministic pattern matching first, then fallback."""
        artifacts = artifact_names or []
        matched_engines: Dict[str, List[str]] = {}
        missing_checklist: List[str] = []

        combined_input = f"{problem_text.lower()} {' '.join(a.lower() for a in artifacts)}"

        # 1. Match based on artifact extensions
        for art in artifacts:
            ext = art.rsplit(".", 1)[-1].lower() if "." in art else ""
            if ext in cls.ARTIFACT_EXTENSIONS:
                engine = cls.ARTIFACT_EXTENSIONS[ext]
                matched_engines.setdefault(engine, []).append(f"file extension .{ext}")

        # 2. Match based on keywords in problem text and filenames
        for engine, keywords in cls.ENGINE_KEYWORDS.items():
            for kw in keywords:
                if re.search(rf"\b{re.escape(kw)}\b", combined_input):
                    matched_engines.setdefault(engine, []).append(f"matched keyword '{kw}'")

        recommendations: List[EngineRecommendation] = []
        for eng, reasons in matched_engines.items():
            present_arts = [a for a in artifacts if any(kw in a.lower() for kw in cls.ENGINE_KEYWORDS.get(eng, []))]
            # Max confidence capped at 0.60 per epistemic invariant
            confidence = min(0.60, 0.40 + 0.10 * len(reasons))
            recommendations.append(EngineRecommendation(
                engine_type=eng,
                confidence=confidence,
                rationale=", ".join(reasons),
                required_artifacts_present=present_arts,
                missing_artifacts_required=[],
            ))

        # Sort recommendations by confidence desc
        recommendations.sort(key=lambda r: r.confidence, reverse=True)

        status = "SUCCESS" if recommendations else "UNKNOWN_INTENT"
        workflow = "MULTI_ENGINE_CHAIN" if len(recommendations) > 1 else "SINGLE_ENGINE"

        return RouterClassificationResult(
            status=status,
            recommended_engines=recommendations,
            suggested_workflow=workflow,
            missing_artifacts_checklist=missing_checklist,
            execution_mode="DETERMINISTIC_FAST_PATH",
        )
