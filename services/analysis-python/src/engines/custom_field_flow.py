"""Custom Field Flow Doctor Engine.

Authoritative preflight evaluation of custom field propagation across standard
SAP business document chains (e.g. PO Item -> Supplier Invoice -> Journal Entry).
Implements the 14-point engine anatomy mandated by Cardinal Axiom 2.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, ConfigDict, Field

from src.core.base_engine import BaseEngine
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
from src.parsers.json_input import parse_json_object


class HopStatus(str, Enum):
    SUPPORTED = "SUPPORTED"
    CUSTOM_LOGIC = "CUSTOM_LOGIC"
    BLOCKED = "BLOCKED"
    UNKNOWN = "UNKNOWN"


class FieldDataType(str, Enum):
    CHAR = "CHAR"
    STRING = "STRING"
    NUMC = "NUMC"
    DEC = "DEC"
    CURR = "CURR"
    AMOUNT = "AMOUNT"
    QUANTITY = "QUANTITY"
    DATS = "DATS"
    TIMS = "TIMS"
    BOOL = "BOOL"
    UNKNOWN = "UNKNOWN"


class ContextFieldDefinition(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str = Field(default="CHAR")
    length: Optional[int] = Field(default=None)
    decimals: Optional[int] = Field(default=0)
    description: Optional[str] = None
    status: str = Field(default="ACTIVE")


class BusinessScenarioConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    scenario_id: str
    source_context: str
    target_context: str
    active: bool = True
    required_badi: Optional[str] = None


# Authoritative SAP Business Extension Scenarios and propagation catalog
STANDARD_PROPAGATION_CATALOG: Dict[Tuple[str, str], Dict[str, Any]] = {
    ("MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"): {
        "status": HopStatus.SUPPORTED,
        "scenario_id": "BUS_SCENARIO_PO_TO_INV",
        "description": "Purchase Order Item to Supplier Invoice Item",
        "required_badi": None,
        "min_release": "S4HC_1808",
    },
    ("MM_PURCHASE_ORDER_ITEM", "LE_DELIVERY_ITEM"): {
        "status": HopStatus.SUPPORTED,
        "scenario_id": "BUS_SCENARIO_PO_TO_DELIV",
        "description": "Purchase Order Item to Inbound Delivery Item",
        "required_badi": None,
        "min_release": "S4HC_1808",
    },
    ("MM_PURCHASE_REQUISITION_ITEM", "MM_PURCHASE_ORDER_ITEM"): {
        "status": HopStatus.SUPPORTED,
        "scenario_id": "BUS_SCENARIO_PREQ_TO_PO",
        "description": "Purchase Requisition Item to Purchase Order Item",
        "required_badi": None,
        "min_release": "S4HC_1808",
    },
    ("MM_PURCHASE_CONTRACT_ITEM", "MM_PURCHASE_ORDER_ITEM"): {
        "status": HopStatus.SUPPORTED,
        "scenario_id": "BUS_SCENARIO_PCTR_TO_PO",
        "description": "Purchase Contract Item to Purchase Order Item",
        "required_badi": None,
        "min_release": "S4HC_1808",
    },
    ("SD_SALES_ORDER_ITEM", "LE_SHP_DELIVERY_ITEM"): {
        "status": HopStatus.SUPPORTED,
        "scenario_id": "BUS_SCENARIO_SO_TO_DELIV",
        "description": "Sales Order Item to Outbound Delivery Item",
        "required_badi": None,
        "min_release": "S4HC_1808",
    },
    ("SD_SALES_ORDER_ITEM", "SD_BILLING_DOC_ITEM"): {
        "status": HopStatus.SUPPORTED,
        "scenario_id": "BUS_SCENARIO_SO_TO_INV",
        "description": "Sales Order Item to Billing Document Item",
        "required_badi": None,
        "min_release": "S4HC_1808",
    },
    ("LE_SHP_DELIVERY_ITEM", "SD_BILLING_DOC_ITEM"): {
        "status": HopStatus.SUPPORTED,
        "scenario_id": "BUS_SCENARIO_DELIV_TO_INV",
        "description": "Outbound Delivery Item to Billing Document Item",
        "required_badi": None,
        "min_release": "S4HC_1808",
    },
    ("MM_SUPPLIER_INVOICE_ITEM", "FI_JOURNAL_ENTRY_ITEM"): {
        "status": HopStatus.CUSTOM_LOGIC,
        "scenario_id": "BUS_SCENARIO_INV_TO_JE_BADI",
        "description": "Supplier Invoice Item to Journal Entry Item via BAdI persistence",
        "required_badi": "BADI_FINS_ACDOC_EXT_PERSISTENCE",
        "alternative_badis": ["BADI_DATA_PROVIDER"],
        "min_release": "S4HC_1908",
    },
    ("SD_BILLING_DOC_ITEM", "FI_JOURNAL_ENTRY_ITEM"): {
        "status": HopStatus.CUSTOM_LOGIC,
        "scenario_id": "BUS_SCENARIO_BILLING_TO_JE_BADI",
        "description": "Billing Document Item to Journal Entry Item via BAdI persistence",
        "required_badi": "BADI_FINS_ACDOC_EXT_PERSISTENCE",
        "alternative_badis": ["BADI_DATA_PROVIDER"],
        "min_release": "S4HC_1908",
    },
    ("MM_PURCHASE_ORDER_ITEM", "FI_JOURNAL_ENTRY_ITEM"): {
        "status": HopStatus.BLOCKED,
        "scenario_id": None,
        "description": "Direct PO Item to Journal Entry jump is architecturally invalid",
        "required_badi": None,
        "reason": "Direct propagation bypasses supplier invoice / goods receipt postings; violates document flow integrity",
    },
    ("SD_SALES_ORDER_ITEM", "FI_JOURNAL_ENTRY_ITEM"): {
        "status": HopStatus.BLOCKED,
        "scenario_id": None,
        "description": "Direct Sales Order Item to Journal Entry jump is architecturally invalid",
        "required_badi": None,
        "reason": "Direct propagation bypasses billing document creation; violates document flow integrity",
    },
}


def _locate_line_in_text(raw_text: str, token: str) -> Tuple[Optional[int], Optional[int], str]:
    """Deterministically identifies the 1-indexed line, column, and snippet of a token."""
    if not raw_text or not token:
        return None, None, ""
    lines = raw_text.splitlines()
    for idx, line in enumerate(lines, 1):
        pos = line.find(token)
        if pos != -1:
            return idx, pos + 1, line.strip()
    return None, None, ""


@register_engine
class CustomFieldFlowEngine(BaseEngine):
    """Engine verifying custom field lineage, hop compatibility, and BAdI requirements."""

    engine_type = EngineType.CUSTOM_FIELD_FLOW_DOCTOR
    rule_prefix = "FIELD"
    name = "Custom Field Flow Doctor"
    description = "Extension field lineage from CDS views through BAPIs to UI annotations"
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.TXT, ArtifactType.XML]

    PREFIX_REGEX = re.compile(r"^[YZ][YZ]1_[A-Z0-9_]{1,26}$")

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        rules_evaluated = 0
        findings: List[Finding] = []

        raw_text = request.raw_content or ""
        artifact_path = request.artifact_s3_key or "custom_fields/custom_field_flow.json"
        _full_artifact_hash = EvidenceEngine.compute_sha256(raw_text) if raw_text else hashlib.sha256(b"{}").hexdigest()

        # Parse payload from raw_content or configuration
        payload: Dict[str, Any] = {}
        if raw_text and raw_text.strip():
            # Malformed JSON is reported as FIELD_PARSE_ERROR, never replaced by {}
            payload = parse_json_object(raw_text, self.rule_prefix)
        else:
            payload = request.configuration or {}

        raw_field_name = payload.get("field_name") or payload.get("id")
        if not raw_field_name or not str(raw_field_name).strip():
            # No default identity: the custom field under analysis must be supplied.
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "No custom field supplied: provide 'field_name' and its 'hops' / 'field_definitions'.",
            )
        field_name = str(raw_field_name).strip()
        raw_hops = payload.get("hops") or []
        raw_field_defs = payload.get("field_definitions") or {}
        if not isinstance(raw_hops, list):
            raise EngineInputError(f"{self.rule_prefix}_INVALID_INPUT", "Field 'hops' must be a list.")
        if not isinstance(raw_field_defs, dict):
            raise EngineInputError(f"{self.rule_prefix}_INVALID_INPUT", "Field 'field_definitions' must be an object.")
        for list_key in ("active_scenarios", "active_badis", "badi_implementations"):
            if payload.get(list_key) is not None and not isinstance(payload.get(list_key), list):
                raise EngineInputError(f"{self.rule_prefix}_INVALID_INPUT", f"Field '{list_key}' must be a list.")
        active_scenarios: Set[str] = set(payload.get("active_scenarios") or [])
        active_badis: Set[str] = set(payload.get("active_badis") or [])

        # Parse BAdI implementations if provided as structured objects
        for badi_obj in payload.get("badi_implementations") or []:
            if isinstance(badi_obj, dict):
                b_name = badi_obj.get("badi_definition") or badi_obj.get("name")
                status = badi_obj.get("status", "ACTIVE")
                if b_name and status == "ACTIVE":
                    active_badis.add(b_name)
            elif isinstance(badi_obj, str):
                active_badis.add(badi_obj)

        # Standardize hops into list of (source_context, target_context)
        normalized_hops: List[Tuple[str, str]] = []
        for h in raw_hops:
            if isinstance(h, (list, tuple)) and len(h) >= 2:
                normalized_hops.append((str(h[0]), str(h[1])))
            elif isinstance(h, dict) and "source_context" in h and "target_context" in h:
                normalized_hops.append((str(h["source_context"]), str(h["target_context"])))

        # Standardize field definitions
        field_definitions: Dict[str, ContextFieldDefinition] = {}
        for ctx_key, def_data in raw_field_defs.items():
            if isinstance(def_data, dict):
                field_definitions[ctx_key] = ContextFieldDefinition(**def_data)
            elif isinstance(def_data, ContextFieldDefinition):
                field_definitions[ctx_key] = def_data

        # ----------------------------------------------------------------------
        # Rule 1: Custom Field Prefix Validation
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        if not self.PREFIX_REGEX.match(field_name):
            line_no, col_no, snippet = _locate_line_in_text(raw_text, field_name)
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or field_name,
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f'"field_name": "{field_name}"',
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="FIELD_NAME_INVALID_PREFIX",
                severity=Severity.MAJOR,
                category="EXTENSIBILITY_GOVERNANCE",
                title=f"Invalid Custom Field Prefix: {field_name}",
                description=(
                    f"Custom field '{field_name}' does not follow the required SAP Key-User "
                    "extensibility prefix standard ('YY1_' or 'ZZ1_'). Unprefixed fields cannot "
                    "be registered in the standard key-user extensibility registry."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation="Rename the field using the standard 'YY1_' prefix (e.g. 'YY1_" + field_name.lstrip("Z_Y") + "').",
                evidence=[ev],
                technical_details={"field_name": field_name},
                affected_objects=[field_name],
            )
            findings.append(ConfidenceClassifier.classify(f))

        total_hops = len(normalized_hops)
        supported_hops = 0
        custom_logic_hops = 0
        blocked_hops = 0

        # ----------------------------------------------------------------------
        # Evaluate Each Propagation Hop
        # ----------------------------------------------------------------------
        for source_ctx, target_ctx in normalized_hops:
            rules_evaluated += 1
            hop_pair = (source_ctx, target_ctx)
            catalog_entry = STANDARD_PROPAGATION_CATALOG.get(hop_pair)

            src_def = field_definitions.get(source_ctx)
            tgt_def = field_definitions.get(target_ctx)

            # Rule 2: Missing Target Context Definition
            rules_evaluated += 1
            if tgt_def is None:
                line_no, col_no, snippet = _locate_line_in_text(raw_text, target_ctx)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or target_ctx,
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'"{target_ctx}"',
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="FIELD_MISSING_TARGET_CONTEXT",
                    severity=Severity.CRITICAL,
                    category="DATA_MODEL_INTEGRITY",
                    title=f"Field Not Defined in Target Context: {target_ctx}",
                    description=(
                        f"Custom field '{field_name}' is scheduled for propagation from '{source_ctx}' "
                        f"to '{target_ctx}', but no field definition exists in target business context '{target_ctx}'. "
                        "Propagation cannot occur into a non-existent context."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        f"Open the 'Custom Fields' app in SAP Fiori, locate field '{field_name}', "
                        f"and enable it for target business context '{target_ctx}'."
                    ),
                    evidence=[ev],
                    technical_details={
                        "field_name": field_name,
                        "source_context": source_ctx,
                        "target_context": target_ctx,
                    },
                    affected_objects=[field_name, target_ctx],
                )
                findings.append(ConfidenceClassifier.classify(f))
                blocked_hops += 1
                continue

            # Rule 3: Type and Length Mismatch
            rules_evaluated += 1
            if src_def and tgt_def:
                src_type = (src_def.type or "CHAR").upper()
                tgt_type = (tgt_def.type or "CHAR").upper()
                src_len = src_def.length or 0
                tgt_len = tgt_def.length or 0

                # Type mismatch check
                if src_type != tgt_type:
                    line_no, col_no, snippet = _locate_line_in_text(raw_text, target_ctx)
                    ev = EvidenceEngine.create_evidence(
                        artifact_path=artifact_path,
                        content=raw_text or target_ctx,
                        line_number=line_no,
                        column_number=col_no,
                        snippet=snippet or f'"{source_ctx}": {{"type": "{src_type}"}}',
                        provenance=ConfidenceClass.VERIFIED,
                        source_type=TrustLevel.CUSTOMER_EVIDENCE,
                    )
                    f = Finding(
                        rule_id="FIELD_TYPE_MISMATCH",
                        severity=Severity.MAJOR,
                        category="DATA_MODEL_INTEGRITY",
                        title=f"Incompatible Data Types Across Hop ({source_ctx} -> {target_ctx})",
                        description=(
                            f"Field '{field_name}' in source context '{source_ctx}' has data type '{src_type}', "
                            f"while target context '{target_ctx}' defines it as '{tgt_type}'. Incompatible types "
                            "prevent automatic business document propagation."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"Align the data types across business contexts. Target field '{field_name}' in "
                            f"'{target_ctx}' must match source type '{src_type}'."
                        ),
                        evidence=[ev],
                        technical_details={
                            "field_name": field_name,
                            "source_context": source_ctx,
                            "target_context": target_ctx,
                            "source_type": src_type,
                            "target_type": tgt_type,
                        },
                        affected_objects=[field_name, source_ctx, target_ctx],
                    )
                    findings.append(ConfidenceClassifier.classify(f))

                # Length truncation check
                elif src_len > 0 and tgt_len > 0 and src_len > tgt_len:
                    line_no, col_no, snippet = _locate_line_in_text(raw_text, f'"length": {tgt_len}')
                    if line_no is None:
                        line_no, col_no, snippet = _locate_line_in_text(raw_text, target_ctx)
                    ev = EvidenceEngine.create_evidence(
                        artifact_path=artifact_path,
                        content=raw_text or str(tgt_len),
                        line_number=line_no,
                        column_number=col_no,
                        snippet=snippet or f'"{target_ctx}": {{"length": {tgt_len}}}',
                        provenance=ConfidenceClass.VERIFIED,
                        source_type=TrustLevel.CUSTOMER_EVIDENCE,
                    )
                    f = Finding(
                        rule_id="FIELD_TYPE_MISMATCH",
                        severity=Severity.MAJOR,
                        category="DATA_MODEL_INTEGRITY",
                        title=f"Field Length Truncation Risk ({source_ctx} -> {target_ctx})",
                        description=(
                            f"Source field length ({src_len}) in '{source_ctx}' exceeds target field length ({tgt_len}) "
                            f"in '{target_ctx}'. Values will be truncated or cause runtime conversion exceptions during document posting."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"Increase the length of field '{field_name}' in target context '{target_ctx}' "
                            f"to at least {src_len} characters to match the source specification."
                        ),
                        evidence=[ev],
                        technical_details={
                            "field_name": field_name,
                            "source_context": source_ctx,
                            "target_context": target_ctx,
                            "source_length": src_len,
                            "target_length": tgt_len,
                        },
                        affected_objects=[field_name, target_ctx],
                    )
                    findings.append(ConfidenceClassifier.classify(f))

            # Rule 4: Catalog Propagation Status & BAdI Evaluation
            rules_evaluated += 1
            if catalog_entry is None:
                # Hop is completely uncataloged
                line_no, col_no, snippet = _locate_line_in_text(raw_text, source_ctx)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or f"{source_ctx}->{target_ctx}",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'["{source_ctx}", "{target_ctx}"]',
                    provenance=ConfidenceClass.RULE_DERIVED,
                    source_type=TrustLevel.CURATED_RULE,
                )
                f = Finding(
                    rule_id="FIELD_PROPAGATION_BLOCKED",
                    severity=Severity.CRITICAL,
                    category="DOCUMENT_FLOW",
                    title=f"Unrecognized Propagation Hop: {source_ctx} -> {target_ctx}",
                    description=(
                        f"No standard SAP business extension scenario exists to propagate fields directly from "
                        f"'{source_ctx}' to '{target_ctx}'. This jump crosses an unsupported document flow boundary."
                    ),
                    confidence=ConfidenceClass.RULE_DERIVED,
                    confidence_score=0.85,
                    remediation=(
                        "Verify whether intermediate document contexts (e.g. Inbound Delivery, Goods Receipt) "
                        "are required to maintain continuous standard document flow."
                    ),
                    evidence=[ev],
                    technical_details={"source_context": source_ctx, "target_context": target_ctx},
                    affected_objects=[field_name, source_ctx, target_ctx],
                )
                findings.append(ConfidenceClassifier.classify(f))
                blocked_hops += 1

            elif catalog_entry["status"] == HopStatus.BLOCKED:
                line_no, col_no, snippet = _locate_line_in_text(raw_text, source_ctx)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or f"{source_ctx}->{target_ctx}",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'["{source_ctx}", "{target_ctx}"]',
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CURATED_RULE,
                )
                reason = catalog_entry.get("reason", "Direct propagation violates SAP architectural boundary")
                f = Finding(
                    rule_id="FIELD_PROPAGATION_BLOCKED",
                    severity=Severity.CRITICAL,
                    category="DOCUMENT_FLOW",
                    title=f"Architecturally Blocked Hop: {source_ctx} -> {target_ctx}",
                    description=(
                        f"Direct propagation from '{source_ctx}' to '{target_ctx}' is blocked by SAP Clean Core architecture: {reason}."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        "Route the custom field through standard intermediate document contexts "
                        "(e.g. Purchase Order Item -> Supplier Invoice Item -> Journal Entry Item)."
                    ),
                    evidence=[ev],
                    technical_details={
                        "source_context": source_ctx,
                        "target_context": target_ctx,
                        "reason": reason,
                    },
                    affected_objects=[field_name, source_ctx, target_ctx],
                )
                findings.append(ConfidenceClassifier.classify(f))
                blocked_hops += 1

            elif catalog_entry["status"] == HopStatus.CUSTOM_LOGIC:
                required_badi = catalog_entry.get("required_badi") or "BADI_DATA_PROVIDER"
                alt_badis = catalog_entry.get("alternative_badis") or []
                all_acceptable = [required_badi] + alt_badis

                # Check if any required BAdI is implemented and active
                badi_matched = any(b in active_badis for b in all_acceptable)

                line_no, col_no, snippet = _locate_line_in_text(raw_text, target_ctx)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or required_badi,
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'"{target_ctx}"',
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.OFFICIAL_METADATA,
                )

                if not badi_matched:
                    rules_evaluated += 1
                    f = Finding(
                        rule_id="FIELD_BADI_REQUIRED_NOT_FOUND",
                        severity=Severity.MAJOR,
                        category="CUSTOM_LOGIC",
                        title=f"Required BAdI Implementation Missing ({source_ctx} -> {target_ctx})",
                        description=(
                            f"Propagation from '{source_ctx}' to '{target_ctx}' does not occur automatically via standard scenario. "
                            f"It requires an active Cloud BAdI implementation of '{required_badi}', which was not found in the uploaded configuration."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"Implement and publish Cloud BAdI '{required_badi}' (or '{', '.join(alt_badis)}') "
                            f"in the 'Custom Logic' app to transfer field '{field_name}' into accounting persistence."
                        ),
                        evidence=[ev],
                        technical_details={
                            "source_context": source_ctx,
                            "target_context": target_ctx,
                            "required_badi": required_badi,
                            "alternative_badis": alt_badis,
                            "active_badis_found": sorted(list(active_badis)),
                        },
                        affected_objects=[field_name, required_badi],
                    )
                    findings.append(ConfidenceClassifier.classify(f))
                    custom_logic_hops += 1
                else:
                    rules_evaluated += 1
                    f = Finding(
                        rule_id="FIELD_PROPAGATION_REQUIRES_BADI",
                        severity=Severity.INFO,
                        category="CUSTOM_LOGIC",
                        title=f"BAdI Logic Active for Propagation ({source_ctx} -> {target_ctx})",
                        description=(
                            f"Propagation from '{source_ctx}' to '{target_ctx}' is handled by active BAdI implementation '{required_badi}'."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation="Verify test coverage of BAdI logic during regression testing.",
                        evidence=[ev],
                        technical_details={
                            "source_context": source_ctx,
                            "target_context": target_ctx,
                            "badi": required_badi,
                        },
                        affected_objects=[field_name, required_badi],
                    )
                    findings.append(ConfidenceClassifier.classify(f))
                    custom_logic_hops += 1

            elif catalog_entry["status"] == HopStatus.SUPPORTED:
                scenario_id = catalog_entry.get("scenario_id")
                # If active_scenarios is explicitly provided, verify it is enabled
                if active_scenarios and scenario_id and (scenario_id not in active_scenarios):
                    line_no, col_no, snippet = _locate_line_in_text(raw_text, scenario_id)
                    ev = EvidenceEngine.create_evidence(
                        artifact_path=artifact_path,
                        content=raw_text or scenario_id,
                        line_number=line_no,
                        column_number=col_no,
                        snippet=snippet or f'"{scenario_id}"',
                        provenance=ConfidenceClass.VERIFIED,
                        source_type=TrustLevel.OFFICIAL_METADATA,
                    )
                    f = Finding(
                        rule_id="FIELD_PROPAGATION_BLOCKED",
                        severity=Severity.MAJOR,
                        category="EXTENSIBILITY_GOVERNANCE",
                        title=f"Extension Scenario Not Activated: {scenario_id}",
                        description=(
                            f"Standard scenario '{scenario_id}' connecting '{source_ctx}' to '{target_ctx}' "
                            "is available in SAP S/4HANA but is currently inactive for this field."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"In the 'Custom Fields' app, navigate to 'Business Scenarios' for field '{field_name}' "
                            f"and enable scenario '{scenario_id}'."
                        ),
                        evidence=[ev],
                        technical_details={
                            "field_name": field_name,
                            "scenario_id": scenario_id,
                            "source_context": source_ctx,
                            "target_context": target_ctx,
                        },
                        affected_objects=[field_name, scenario_id],
                    )
                    findings.append(ConfidenceClassifier.classify(f))
                    blocked_hops += 1
                else:
                    supported_hops += 1

        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

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
                    "total_hops": total_hops,
                    "supported_hops": supported_hops,
                    "custom_logic_hops": custom_logic_hops,
                    "blocked_hops": blocked_hops,
                    "field_name": field_name,
                },
            ),
        )
