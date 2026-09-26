"""SAP Gap Radar Engine.

Authoritative preflight evaluation of technical and business requirements against
target SAP Cloud and Clean Core releases using a deterministic 12-tier clean core hierarchy.
Implements the 14-point engine anatomy mandated by Cardinal Axiom 2.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field

from src.core.base_engine import BaseEngine
from src.core.contracts import (
    ContractModel, InputContract, InputFormat, KnowledgeSource, RuleSpec, insufficient, rule_catalog,
)
from src.core.registry import register_engine
from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
    TrustLevel,
)
from src.models.finding import Finding
from src.models.request import AnalysisRequest
from src.models.response import AnalysisMetrics, AnalysisResponse
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine
from src.core.exceptions import EngineInputError
from src.parsers.json_input import parse_json_payload


class ResolutionTier(int, Enum):
    TIER_1_STANDARD = 1
    TIER_2_CONFIGURATION = 2
    TIER_3_KEY_USER = 3
    TIER_4_DEVELOPER_EXTENSIBILITY = 4
    TIER_5_RELEASED_CDS = 5
    TIER_6_RELEASED_API = 6
    TIER_7_RELEASED_BADI = 7
    TIER_8_BUSINESS_EVENT = 8
    TIER_9_SIDE_BY_SIDE = 9
    TIER_10_WORKAROUND = 10
    TIER_11_BLOCKED_OR_GAP = 11
    TIER_12_UNKNOWN = 12


TIER_METADATA: Dict[ResolutionTier, Dict[str, Any]] = {
    ResolutionTier.TIER_1_STANDARD: {
        "tier_name": "Standard Functionality (SAP Best Practices Scope Item)",
        "verdict": "SUPPORTED_STANDARD",
        "feasibility_score": 1.00,
        "default_severity": Severity.INFO,
    },
    ResolutionTier.TIER_2_CONFIGURATION: {
        "tier_name": "Standard Configuration (SSCUI / CBC Activity)",
        "verdict": "SUPPORTED_CONFIGURATION",
        "feasibility_score": 0.98,
        "default_severity": Severity.INFO,
    },
    ResolutionTier.TIER_3_KEY_USER: {
        "tier_name": "Key-User Extensibility (Custom Fields, Logic, CDS, UI)",
        "verdict": "SUPPORTED_KEY_USER",
        "feasibility_score": 0.95,
        "default_severity": Severity.INFO,
    },
    ResolutionTier.TIER_4_DEVELOPER_EXTENSIBILITY: {
        "tier_name": "Developer Extensibility (ABAP Cloud, On-Stack RAP)",
        "verdict": "SUPPORTED_DEVELOPER_EXTENSIBILITY",
        "feasibility_score": 0.90,
        "default_severity": Severity.INFO,
    },
    ResolutionTier.TIER_5_RELEASED_CDS: {
        "tier_name": "Released CDS Views (Contract C1)",
        "verdict": "SUPPORTED_RELEASED_CDS",
        "feasibility_score": 0.95,
        "default_severity": Severity.INFO,
    },
    ResolutionTier.TIER_6_RELEASED_API: {
        "tier_name": "Released APIs (OData / SOAP with Contract C1)",
        "verdict": "SUPPORTED_RELEASED_API",
        "feasibility_score": 0.95,
        "default_severity": Severity.INFO,
    },
    ResolutionTier.TIER_7_RELEASED_BADI: {
        "tier_name": "Released BAdI / Extension Point",
        "verdict": "SUPPORTED_DEVELOPER_EXTENSIBILITY",
        "feasibility_score": 0.90,
        "default_severity": Severity.INFO,
    },
    ResolutionTier.TIER_8_BUSINESS_EVENT: {
        "tier_name": "Business Events (SAP Event Mesh / CloudEvents)",
        "verdict": "SUPPORTED_BUSINESS_EVENT",
        "feasibility_score": 0.90,
        "default_severity": Severity.INFO,
    },
    ResolutionTier.TIER_9_SIDE_BY_SIDE: {
        "tier_name": "Side-by-Side Extensibility (SAP BTP)",
        "verdict": "SUPPORTED_SIDE_BY_SIDE",
        "feasibility_score": 0.85,
        "default_severity": Severity.INFO,
    },
    ResolutionTier.TIER_10_WORKAROUND: {
        "tier_name": "Supported Workaround",
        "verdict": "SUPPORTED_WORKAROUND",
        "feasibility_score": 0.70,
        "default_severity": Severity.MINOR,
    },
    ResolutionTier.TIER_11_BLOCKED_OR_GAP: {
        "tier_name": "Clean Core Violation (Blocked) / Known Product Gap",
        "verdict": "BLOCKED_CLEAN_CORE_VIOLATION",
        "feasibility_score": 0.00,
        "default_severity": Severity.CRITICAL,
    },
    ResolutionTier.TIER_12_UNKNOWN: {
        "tier_name": "Unknown / Review Required",
        "verdict": "UNKNOWN_REQUIREMENT",
        "feasibility_score": 0.40,
        "default_severity": Severity.MINOR,
    },
}


class RequirementItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: Optional[str] = None
    title: Optional[str] = None
    requirement: str
    target_release: Optional[str] = None
    scope_items: List[str] = Field(default_factory=list)
    product_edition: Optional[str] = "Public"


def _locate_token_in_text(raw_text: str, token: str) -> Tuple[Optional[int], Optional[int], str]:
    """Deterministically identifies the 1-indexed line, column, and snippet of a token."""
    if not raw_text or not token:
        return None, None, ""
    lines = raw_text.splitlines()
    # Case-insensitive search for token
    token_lower = token.lower()
    for idx, line in enumerate(lines, 1):
        pos = line.lower().find(token_lower)
        if pos != -1:
            return idx, pos + 1, line.strip()
    return None, None, ""


# ==== ENGINE CONTRACT (rule catalog + input contract) ====
from pydantic import model_validator


def _gap(verdict: str, title: str, sev: Severity, remediation: str) -> RuleSpec:
    return RuleSpec(f"GAP_RADAR_{verdict}", title, sev, remediation, "MIGRATION_CLEAN_CORE")


RULES = rule_catalog(
    _gap("SUPPORTED_STANDARD", "Requirement met by standard scope item (tier 1)", Severity.INFO,
         "Activate the SAP Best Practices scope item; do not build custom objects for this requirement."),
    _gap("SUPPORTED_CONFIGURATION", "Requirement met by configuration (tier 2)", Severity.INFO,
         "Configure via the SSCUI / Central Business Configuration activity; record it in the configuration "
         "workbook."),
    _gap("SUPPORTED_KEY_USER", "Requirement met by key-user extensibility (tier 3)", Severity.INFO,
         "Implement with Custom Fields / Custom Logic / Custom CDS Views apps and transport via Software "
         "Collections."),
    _gap("SUPPORTED_DEVELOPER_EXTENSIBILITY", "Requirement met by developer extensibility (tier 4/7)",
         Severity.INFO,
         "Implement in ABAP Cloud (RAP / released BAdI) in a tier-1 software component; no classic enhancements."),
    _gap("SUPPORTED_RELEASED_CDS", "Requirement met by released CDS views (tier 5)", Severity.INFO,
         "Consume the released (C1) CDS view; never read the underlying tables."),
    _gap("SUPPORTED_RELEASED_API", "Requirement met by released API (tier 6)", Severity.INFO,
         "Use the released OData/SOAP API with a Communication Arrangement."),
    _gap("SUPPORTED_BUSINESS_EVENT", "Requirement met by business events (tier 8)", Severity.INFO,
         "Subscribe to the released business event via SAP Event Mesh / Advanced Event Mesh (Enterprise Event "
         "Enablement)."),
    _gap("SUPPORTED_SIDE_BY_SIDE", "Requirement met side-by-side on SAP BTP (tier 9)", Severity.INFO,
         "Build the extension on SAP BTP (CAP / Build Apps) using released APIs and events."),
    _gap("SUPPORTED_WORKAROUND", "Requirement only met by a workaround (tier 10)", Severity.MINOR,
         "Document the workaround, its owner and an exit plan; re-check at every release."),
    _gap("BLOCKED_CLEAN_CORE_VIOLATION", "Requirement implies a Clean Core violation (tier 11)", Severity.CRITICAL,
         "Direct table writes / modifications are not possible in the cloud; redesign against released APIs, "
         "RAP business objects or BAdIs."),
    _gap("KNOWN_PRODUCT_GAP", "Known product gap (tier 11)", Severity.MAJOR,
         "Track the SAP roadmap item, raise an influence request, or cover the gap with a BTP extension."),
    _gap("UNKNOWN_REQUIREMENT", "Requirement could not be classified (tier 12)", Severity.MINOR,
         "Refine the requirement statement (process, object, integration point) and re-run, or assess manually."),
)


class GapRequirementsInput(ContractModel):
    """Requirements JSON: {'requirements': [...]}, a single {'requirement': '…'} / {'text': '…'} or a list."""
    requirements: Optional[List[Any]] = None
    requirement: Optional[str] = None
    text: Optional[str] = None

    @model_validator(mode="after")
    def _require_requirement(self) -> "GapRequirementsInput":
        for r in self.requirements or []:
            if isinstance(r, str) and r.strip():
                return self
            if isinstance(r, dict) and str(r.get("requirement") or "").strip():
                return self
        if (self.requirement or "").strip() or (self.text or "").strip():
            return self
        raise insufficient("No requirement statement supplied ('requirement', 'text' or 'requirements').")


def _gap_text_check(text: str) -> Optional[str]:
    words = re.findall(r"[A-Za-z]{2,}", text)
    if len(words) < 3:
        return "a plain-text requirement must be a statement of at least three words."
    return None


INPUT_CONTRACT = InputContract(
    formats=(InputFormat.JSON, InputFormat.TEXT),
    summary=(
        "Business / technical requirement statements: JSON {'requirements': [{'requirement': '…', 'scope_items': "
        "[...]}]}, {'requirement': '…'}, a JSON list, or a plain-text requirement statement."
    ),
    required=("At least one non-empty requirement statement",),
    json_model=GapRequirementsInput,
    json_array_field="requirements",
    text_check=_gap_text_check,
)


# ==== END ENGINE CONTRACT ====


@register_engine
class GapRadarEngine(BaseEngine):
    """Engine resolving customer requirements against SAP Cloud Clean Core hierarchy."""

    engine_type = EngineType.SAP_GAP_RADAR
    rule_prefix = "GAP_RADAR"
    finding_codes = RULES
    input_contract = INPUT_CONTRACT
    knowledge_sources = (
        KnowledgeSource(
            name="12-tier Clean Core resolution keyword rules", location="src/engines/gap_radar.py:GapRadarEngine.*_REGEX",
            source="Curated keyword heuristics mapped to SAP extensibility tiers (Clean Core guidelines)",
            release="S4HC_2408", verification_status="CURATED_UNVERIFIED", entries=len(TIER_METADATA),
        ),
    )
    name = "SAP Gap Radar"
    description = "Fit-to-standard vs custom delta analyzer with Clean Core recommendations"
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.TXT]

    # Pre-compiled regex patterns for deterministic tier resolution
    TIER_11_BLOCKED_REGEX = re.compile(
        r"(select\s+\*\s+from|"
        r"update\s+bseg|"
        r"update\s+mara|"
        r"update\s+vbak|"
        r"update\s+bkpf|"
        r"direct\s+db|"
        r"directly\s+in\s+database|"
        r"modify\s+standard\s+table|"
        r"direct\s+database\s+write|"
        r"classic\s+user\s+exit|"
        r"core\s+modification)",
        re.IGNORECASE,
    )

    TIER_11_GAP_REGEX = re.compile(
        r"(product\s+gap|"
        r"unsupported\s+country\s+version|"
        r"missing\s+country\s+localization|"
        r"scheduled\s+on\s+sap\s+roadmap)",
        re.IGNORECASE,
    )

    TIER_8_EVENT_REGEX = re.compile(
        r"(webhook|"
        r"cloud\s+events|"
        r"event\s+mesh|"
        r"business\s+event|"
        r"trigger\s+external\s+webhook|"
        r"event-driven|"
        r"pub/sub)",
        re.IGNORECASE,
    )

    TIER_7_BADI_REGEX = re.compile(
        r"(custom\s+pricing\s+logic|"
        r"\bbadi\b|"
        r"badi_pricing_complete|"
        r"badi_fins_acdoc_ext_persistence|"
        r"developer\s+badi|"
        r"enhancement\s+spot)",
        re.IGNORECASE,
    )

    TIER_3_KEY_USER_REGEX = re.compile(
        r"(custom\s+field|"
        r"\byy1_\w*|\bzz1_\w*|"
        r"key-user\s+extensibility|"
        r"ui\s+adaptation|"
        r"custom\s+logic\s+via\s+key-user|"
        r"custom\s+analytical\s+query)",
        re.IGNORECASE,
    )

    TIER_1_STANDARD_REGEX = re.compile(
        r"(standard\s+purchase\s+order|"
        r"standard\s+sales\s+order|"
        r"standard\s+billing|"
        r"goods\s+receipt\s+processing|"
        r"best\s+practice\s+scope\s+item|"
        r"\bscope\s+item\s+(?:18j|bd9|j45|22z|bnz)\b)",
        re.IGNORECASE,
    )

    TIER_2_CONFIG_REGEX = re.compile(
        r"(sscui|"
        r"\bcbc\b|"
        r"central\s+business\s+configuration|"
        r"configure\s+payment\s+terms|"
        r"pricing\s+procedure\s+determination|"
        r"tax\s+calculation\s+procedure|"
        r"document\s+type\s+configuration|"
        r"account\s+assignment\s+category)",
        re.IGNORECASE,
    )

    TIER_4_DEV_EXT_REGEX = re.compile(
        r"(rap\s+business\s+object|"
        r"custom\s+rap\s+service|"
        r"abap\s+cloud|"
        r"managed\s+rap|"
        r"unmanaged\s+rap|"
        r"tier\s+1\s+extensibility|"
        r"custom\s+entity)",
        re.IGNORECASE,
    )

    TIER_5_CDS_REGEX = re.compile(
        r"(released\s+cds|"
        r"contract\s+c1\s+cds|"
        r"\bi_product\b|\bi_journalentry\b|\bi_customer\b|\bi_supplier\b|"
        r"\bi_salesorder\b|\bi_purchaseorderapi01\b)",
        re.IGNORECASE,
    )

    TIER_6_API_REGEX = re.compile(
        r"(released\s+api|"
        r"contract\s+c1\s+api|"
        r"odata\s+api|"
        r"soap\s+api|"
        r"communication\s+scenario|"
        r"api_business_partner|"
        r"api_purchaseorder_process_srv)",
        re.IGNORECASE,
    )

    TIER_9_SIDE_BY_SIDE_REGEX = re.compile(
        r"(\bsap\s+btp\b|"
        r"side-by-side|"
        r"btp\s+cloud\s+foundry|"
        r"btp\s+kyma|"
        r"cap\s+application|"
        r"sap\s+build\s+apps|"
        r"external\s+portal)",
        re.IGNORECASE,
    )

    TIER_10_WORKAROUND_REGEX = re.compile(
        r"(supported\s+workaround|"
        r"batch\s+job\s+emulation|"
        r"staging\s+table|"
        r"temporary\s+middleware\s+enrichment|"
        r"dual\s+maintenance)",
        re.IGNORECASE,
    )

    @classmethod
    def resolve_tier(cls, requirement_text: str) -> Tuple[ResolutionTier, str, float, Severity, str]:
        """Deterministically classifies requirement text into one of 12 clean core tiers.

        Returns: (tier, verdict, feasibility_score, severity, matched_keyword)
        """
        text = requirement_text.strip()
        if not text:
            meta = TIER_METADATA[ResolutionTier.TIER_12_UNKNOWN]
            return (
                ResolutionTier.TIER_12_UNKNOWN,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                "",
            )

        # 1. Clean Core Violation takes absolute precedence (Direct DB write/classic modification)
        m = cls.TIER_11_BLOCKED_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_11_BLOCKED_OR_GAP]
            return (
                ResolutionTier.TIER_11_BLOCKED_OR_GAP,
                "BLOCKED_CLEAN_CORE_VIOLATION",
                0.00,
                Severity.CRITICAL,
                m.group(0),
            )

        m = cls.TIER_11_GAP_REGEX.search(text)
        if m:
            return (
                ResolutionTier.TIER_11_BLOCKED_OR_GAP,
                "KNOWN_PRODUCT_GAP",
                0.20,
                Severity.MAJOR,
                m.group(0),
            )

        # 2. Tier 8: Business Events (SAP Event Mesh / CloudEvents)
        m = cls.TIER_8_EVENT_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_8_BUSINESS_EVENT]
            return (
                ResolutionTier.TIER_8_BUSINESS_EVENT,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 3. Tier 7: Released BAdIs
        m = cls.TIER_7_BADI_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_7_RELEASED_BADI]
            return (
                ResolutionTier.TIER_7_RELEASED_BADI,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 4. Tier 3: Key-User Extensibility
        m = cls.TIER_3_KEY_USER_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_3_KEY_USER]
            return (
                ResolutionTier.TIER_3_KEY_USER,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 5. Tier 1: Standard Best Practice Functionality
        m = cls.TIER_1_STANDARD_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_1_STANDARD]
            return (
                ResolutionTier.TIER_1_STANDARD,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 6. Tier 2: Standard Configuration (SSCUI / CBC)
        m = cls.TIER_2_CONFIG_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_2_CONFIGURATION]
            return (
                ResolutionTier.TIER_2_CONFIGURATION,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 7. Tier 4: Developer Extensibility (RAP BO / ABAP Cloud)
        m = cls.TIER_4_DEV_EXT_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_4_DEVELOPER_EXTENSIBILITY]
            return (
                ResolutionTier.TIER_4_DEVELOPER_EXTENSIBILITY,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 8. Tier 5: Released CDS Views
        m = cls.TIER_5_CDS_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_5_RELEASED_CDS]
            return (
                ResolutionTier.TIER_5_RELEASED_CDS,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 9. Tier 6: Released APIs
        m = cls.TIER_6_API_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_6_RELEASED_API]
            return (
                ResolutionTier.TIER_6_RELEASED_API,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 10. Tier 9: Side-by-Side BTP
        m = cls.TIER_9_SIDE_BY_SIDE_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_9_SIDE_BY_SIDE]
            return (
                ResolutionTier.TIER_9_SIDE_BY_SIDE,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 11. Tier 10: Supported Workaround
        m = cls.TIER_10_WORKAROUND_REGEX.search(text)
        if m:
            meta = TIER_METADATA[ResolutionTier.TIER_10_WORKAROUND]
            return (
                ResolutionTier.TIER_10_WORKAROUND,
                meta["verdict"],
                meta["feasibility_score"],
                meta["default_severity"],
                m.group(0),
            )

        # 12. Tier 12: Unknown / Review Required
        meta = TIER_METADATA[ResolutionTier.TIER_12_UNKNOWN]
        return (
            ResolutionTier.TIER_12_UNKNOWN,
            meta["verdict"],
            meta["feasibility_score"],
            meta["default_severity"],
            text[:30],
        )

    @classmethod
    def evaluate(cls, requirement_text: str, target_release: str = "2023") -> Dict[str, Any]:
        """Direct deterministic evaluation helper matching E2E test harness expectations."""
        tier, verdict, score, severity, matched = cls.resolve_tier(requirement_text)
        _meta = TIER_METADATA[tier]

        code = f"GAP_RADAR_{verdict}"
        findings = [
            {
                "code": code,
                "severity": severity.value if isinstance(severity, Severity) else str(severity),
                "tier": int(tier),
                "confidence": "RULE_DERIVED",
                "verdict": verdict,
                "feasibility_score": score,
                "matched_token": matched,
            }
        ]

        return {
            "status": "COMPLETED",
            "resolution_tier": int(tier),
            "verdict": verdict,
            "feasibility_score": score,
            "findings": findings,
            "target_release": target_release,
        }

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        rules_evaluated = 0
        findings: List[Finding] = []

        raw_text = (request.raw_content or "").strip()
        artifact_path = request.artifact_s3_key or "requirements/gap_radar.json"
        _full_artifact_hash = EvidenceEngine.compute_sha256(raw_text) if raw_text else hashlib.sha256(b"{}").hexdigest()

        # Parse requirements from raw_text or configuration
        items: List[RequirementItem] = []
        if raw_text and raw_text[:1] in ("{", "["):
            parsed = parse_json_payload(raw_text, self.rule_prefix)
            if isinstance(parsed, dict):
                if "requirements" in parsed and isinstance(parsed["requirements"], list):
                    for r in parsed["requirements"]:
                        if isinstance(r, dict):
                            items.append(RequirementItem(**r))
                        elif isinstance(r, str):
                            items.append(RequirementItem(requirement=r))
                elif "requirement" in parsed:
                    items.append(RequirementItem(**parsed))
                elif "text" in parsed:
                    items.append(RequirementItem(requirement=parsed["text"]))
            elif isinstance(parsed, list):
                for r in parsed:
                    if isinstance(r, dict):
                        items.append(RequirementItem(**r))
                    elif isinstance(r, str):
                        items.append(RequirementItem(requirement=r))
        elif raw_text:
            # Plain text requirement statement
            items.append(RequirementItem(requirement=raw_text))

        if not items and request.configuration:
            cfg = request.configuration
            if "requirement" in cfg:
                items.append(RequirementItem(requirement=str(cfg["requirement"])))
            elif "requirements" in cfg and isinstance(cfg["requirements"], list):
                for r in cfg["requirements"]:
                    if isinstance(r, dict):
                        items.append(RequirementItem(**r))
                    elif isinstance(r, str):
                        items.append(RequirementItem(requirement=r))

        items = [it for it in items if it.requirement and it.requirement.strip()]
        if not items:
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "No requirement statement supplied; nothing can be classified against the Clean Core tiers.",
            )

        primary_tier = ResolutionTier.TIER_12_UNKNOWN
        primary_verdict = "UNKNOWN_REQUIREMENT"
        feasibility_scores: List[float] = []

        for req_idx, item in enumerate(items, 1):
            rules_evaluated += 12  # Evaluated across all 12 tiers
            req_text = item.requirement
            tier, verdict, score, severity, token = self.resolve_tier(req_text)
            meta = TIER_METADATA[tier]

            if req_idx == 1:
                primary_tier = tier
                primary_verdict = verdict
            feasibility_scores.append(score)

            line_no, col_no, snippet = _locate_token_in_text(raw_text or req_text, token or req_text)
            snippet_content = snippet or req_text or "Empty requirement specification"

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=snippet_content,
                line_number=line_no,
                column_number=col_no,
                snippet=snippet_content,
                provenance=ConfidenceClass.RULE_DERIVED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )

            # Formulate structured title, description, and remediation
            code = f"GAP_RADAR_{verdict}"
            if verdict == "SUPPORTED_STANDARD":
                title = "Requirement Supported via Standard Functionality (Tier 1)"
                desc = (
                    f"Requirement '{req_text}' is completely fulfilled by standard SAP S/4HANA Best Practice "
                    f"scope items without custom development."
                )
                remediation = (
                    "Activate and utilize standard SAP Best Practice scope item. Do not create custom Z-objects "
                    "or custom code."
                )
            elif verdict == "SUPPORTED_CONFIGURATION":
                title = "Requirement Supported via Standard Configuration (Tier 2)"
                desc = (
                    f"Requirement '{req_text}' can be achieved via standard SSCUI or Central Business "
                    f"Configuration (CBC) activities."
                )
                remediation = "Configure standard business settings via SSCUI/CBC activities in the implementation project."
            elif verdict == "SUPPORTED_KEY_USER":
                title = "Requirement Supported via Key-User Extensibility (Tier 3)"
                desc = (
                    f"Requirement '{req_text}' can be fulfilled using SAP Key-User Extensibility (Custom Fields, "
                    f"Custom Logic, or UI Adaptation)."
                )
                remediation = "Use Fiori app 'Custom Fields' or 'Custom Logic' to extend business objects without modifying core code."
            elif verdict == "SUPPORTED_DEVELOPER_EXTENSIBILITY":
                if tier == ResolutionTier.TIER_7_RELEASED_BADI:
                    title = "Requirement Supported via Released BAdI (Tier 7)"
                    desc = (
                        f"Requirement '{req_text}' is supported via released BAdI in ABAP Cloud "
                        f"(Tier 1 Developer Extensibility)."
                    )
                    remediation = (
                        "Implement released BAdI in ABAP Cloud using ADT and clean core release contracts (Contract C1)."
                    )
                else:
                    title = "Requirement Supported via Developer Extensibility (Tier 4)"
                    desc = (
                        f"Requirement '{req_text}' can be implemented on-stack using ABAP Cloud and "
                        f"the RESTful Application Programming (RAP) model."
                    )
                    remediation = "Develop custom RAP business object or service adhering strictly to ABAP for Cloud Development."
            elif verdict == "SUPPORTED_RELEASED_CDS":
                title = "Requirement Supported via Released CDS Views (Tier 5)"
                desc = f"Requirement '{req_text}' can consume released standard CDS views (Contract C1)."
                remediation = "Query released CDS view projection instead of querying classic transparent tables."
            elif verdict == "SUPPORTED_RELEASED_API":
                title = "Requirement Supported via Released API (Tier 6)"
                desc = f"Requirement '{req_text}' is supported via standard released OData/SOAP APIs."
                remediation = "Integrate using released SAP Business Accelerator Hub APIs with Contract C1."
            elif verdict == "SUPPORTED_BUSINESS_EVENT":
                title = "Requirement Supported via Business Events (Tier 8)"
                desc = (
                    f"Requirement '{req_text}' can be implemented via SAP Event Mesh / CloudEvents "
                    f"and event-driven webhooks."
                )
                remediation = "Subscribe to standard business events in SAP Event Mesh or Advanced Event Mesh."
            elif verdict == "SUPPORTED_SIDE_BY_SIDE":
                title = "Requirement Supported via Side-by-Side Extensibility (Tier 9)"
                desc = f"Requirement '{req_text}' is best suited for side-by-side deployment on SAP BTP."
                remediation = "Build side-by-side extension application on SAP BTP using CAP, Kyma, or Cloud Foundry."
            elif verdict == "SUPPORTED_WORKAROUND":
                title = "Requirement Supported via Documented Workaround (Tier 10)"
                desc = f"Requirement '{req_text}' requires a documented intermediate pattern or staging workaround."
                remediation = "Implement documented workaround and register in technical debt register for cloud roadmap retirement."
            elif verdict == "BLOCKED_CLEAN_CORE_VIOLATION":
                title = "Requirement Blocked: Clean Core Violation (Tier 11)"
                desc = (
                    f"Requirement '{req_text}' attempts direct database table modifications or classic modifications, "
                    f"which strictly violates SAP Clean Core."
                )
                remediation = (
                    "Reject direct database writes or core modifications. Redesign using released RAP Business Objects, "
                    "standard BAPIs, or Key-User extension scenarios."
                )
            elif verdict == "KNOWN_PRODUCT_GAP":
                title = "Known Product Gap: Scheduled on Roadmap (Tier 11)"
                desc = f"Requirement '{req_text}' is a known standard product gap scheduled on the SAP S/4HANA roadmap."
                remediation = "Review SAP Roadmap Explorer for targeted release delivery or request Early Adopter access."
            else:
                title = "Unknown Requirement: Architectural Review Required (Tier 12)"
                desc = f"Requirement '{req_text}' cannot be resolved automatically against standard catalogs."
                remediation = "Perform manual Fit-to-Standard workshop and enterprise architectural review."

            finding = Finding(
                rule_id=code,
                severity=severity,
                category="MIGRATION_CLEAN_CORE",
                title=title,
                description=desc,
                confidence=ConfidenceClass.UNKNOWN if tier == ResolutionTier.TIER_12_UNKNOWN else ConfidenceClass.RULE_DERIVED,
                confidence_score=0.30 if tier == ResolutionTier.TIER_12_UNKNOWN else (0.85 if score > 0 else 1.0),
                remediation=remediation,
                evidence=[ev],
                technical_details={
                    "code": code,
                    "tier": int(tier),
                    "tierName": meta["tier_name"],
                    "verdict": verdict,
                    "feasibilityScore": score,
                    "matchedKeyword": token,
                    "requirementIndex": req_idx,
                    "targetRelease": request.target_release,
                },
                affected_objects=[token] if token else [],
            )

            # Invariant: Classify confidence and demote missing evidence
            classified_finding = ConfidenceClassifier.classify(finding)
            findings.append(classified_finding)

        elapsed_ms = int((time.perf_counter() - start_time) * 1000)
        avg_feasibility = round(sum(feasibility_scores) / len(feasibility_scores), 2) if feasibility_scores else 0.0

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=AnalysisMetrics(
                execution_time_ms=elapsed_ms,
                rules_evaluated=rules_evaluated,
                artifacts_scanned=1,
                additional_metrics={
                    "resolution_tier": int(primary_tier),
                    "verdict": primary_verdict,
                    "feasibility_score": avg_feasibility,
                    "total_requirements": len(items),
                    "target_release": request.target_release,
                    "engine": "gap_radar",
                },
            ),
        )
