"""Change Pointer Coverage Auditor Engine.

Authoritative preflight audit of SAP ALE / IDoc Change Pointer configuration:
- Global change pointer activation (BD61 / TBDA1)
- Message type activation (BD50 / TBDA2)
- Field-level trigger linkages (BD52 / TBD62)
- ABAP Dictionary change document flags (DD04L-CHGFLAG)
- Custom field coverage (YY1_ / ZZ_)
- Reduced message type filtering (BD53)
- Runtime change pointer reconciliation & backlog inspection (BDCP2)

Fully compliant with Cardinal Axiom 2 (14-Point Engine Anatomy).
"""

from __future__ import annotations

import csv
import io
import json
import re
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, ConfigDict, Field

from src.core.base_engine import BaseEngine
from src.core.contracts import (
    ContractModel, InputContract, InputFormat, RuleSpec, insufficient, rule_catalog,
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
from src.parsers.json_input import parse_json_object


# ==============================================================================
# Input Domain Schemas & Models (Point 2: Input Schema)
# ==============================================================================

class BD52FieldEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    table: str
    field: str
    change_document_object: Optional[str] = None
    message_type: Optional[str] = None


class DD04LEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    table: Optional[str] = None
    field: Optional[str] = None
    data_element: Optional[str] = None
    change_document_flag: bool = False


class BDCP2SampleEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    message_type: Optional[str] = None
    table: Optional[str] = None
    field: Optional[str] = None
    process_status: str = " "  # ' ' = unprocessed, 'X' = processed
    count: int = 1


class ChangePointerNormalizedData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    bd61_active: bool = True
    bd50_msg_types: Set[str] = Field(default_factory=set)
    bd52_fields: List[Tuple[str, str]] = Field(default_factory=list)
    expected_fields: List[Tuple[str, str]] = Field(default_factory=list)
    change_document_object: str = ""
    # No default message type: it must come from the customer's configuration (BD50 / target_message_type).
    target_message_type: Optional[str] = None
    bd52_supplied: bool = False
    # CUSTOMER (explicit expected_fields), STANDARD_PROFILE (curated SAP profile) or BD52 (self-consistency only)
    expected_fields_source: str = "BD52"
    dd04l_metadata: Dict[str, DD04LEntry] = Field(default_factory=dict)
    bdcp2_samples: List[BDCP2SampleEntry] = Field(default_factory=list)
    bd53_reduced_fields: Set[str] = Field(default_factory=set)


# ==============================================================================
# Standard SAP Message Type Defaults & Fallback Catalogs
# ==============================================================================

MESSAGE_TYPE_OBJECT_MAP: Dict[str, str] = {
    "MATMAS": "MATERIAL",
    "DEBMAS": "DEBI",
    "CREMAS": "KRED",
    "BOMMAT": "STUE",
    "INFREC": "INFREC",
    "COND_A": "COND_A",
    "GLMAST": "GLMAST",
    "COSMAS": "COST_CENTER",
}

STANDARD_MESSAGE_PROFILES: Dict[str, List[Tuple[str, str]]] = {
    "MATMAS": [
        ("MARA", "MATKL"),
        ("MARA", "MEINS"),
        ("MARA", "BRGEW"),
        ("MARA", "NTGEW"),
        ("MARA", "GEWEI"),
        ("MARA", "GROES"),
        ("MARA", "BISMT"),
        ("MAKT", "MAKTX"),
        ("MARC", "WERKS"),
    ],
    "DEBMAS": [
        ("KNA1", "NAME1"),
        ("KNA1", "ORT01"),
        ("KNA1", "PSTLZ"),
        ("KNA1", "LAND1"),
        ("KNA1", "STRAS"),
        ("KNB1", "BUKRS"),
    ],
    "CREMAS": [
        ("LFA1", "NAME1"),
        ("LFA1", "ORT01"),
        ("LFA1", "PSTLZ"),
        ("LFA1", "LAND1"),
        ("LFA1", "STRAS"),
        ("LFB1", "BUKRS"),
    ],
}

CUSTOM_FIELD_PATTERN = re.compile(r"^(YY1_|ZZ|Z_)", re.IGNORECASE)


# ==============================================================================
# Line Location Helper for Cryptographic Evidence Chains (Point 6)
# ==============================================================================

def _locate_line_in_text(raw_text: str, token: str) -> Tuple[Optional[int], Optional[int], str]:
    """Deterministically locates the 1-indexed line, column, and snippet of a token in raw text."""
    if not raw_text or not token:
        return None, None, ""
    lines = raw_text.splitlines()
    token_str = str(token).strip()
    if not token_str:
        return None, None, ""

    for idx, line in enumerate(lines, 1):
        pos = line.find(token_str)
        if pos != -1:
            return idx, pos + 1, line.strip()

    # Case-insensitive secondary search
    token_lower = token_str.lower()
    for idx, line in enumerate(lines, 1):
        pos = line.lower().find(token_lower)
        if pos != -1:
            return idx, pos + 1, line.strip()

    return None, None, ""


# ==============================================================================
# Change Pointer Coverage Auditor Engine (Cardinal Axiom 2)
# ==============================================================================

# ==== ENGINE CONTRACT (rule catalog + input contract) ====
RULES = rule_catalog(
    RuleSpec(
        "CP_GLOBAL_DEACTIVATED", "Change pointers globally deactivated (BD61)", Severity.CRITICAL,
        "Run BD61 in the sending client, set 'Change pointers activated - generally' and transport the "
        "customizing (table TBDA1).", "ALE_GLOBAL_CONFIGURATION",
    ),
    RuleSpec(
        "CP_MSG_TYPE_DEACTIVATED", "Message type change pointers inactive (BD50)", Severity.CRITICAL,
        "Activate change pointers for the message type in BD50 (table TBDA2) and transport the entry.",
        "ALE_MESSAGE_TYPE_CONFIGURATION",
    ),
    RuleSpec(
        "CP_FIELD_NOT_CONFIGURED_BD52", "Expected field not linked in BD52", Severity.MAJOR,
        "Add the table/field to the message type's change document object in BD52 (table TBD62); otherwise "
        "changes to the field never create change pointers.", "ALE_FIELD_LINKAGE",
    ),
    RuleSpec(
        "CP_FIELD_DD04L_CHGFLAG_MISSING", "Data element not change-document relevant", Severity.MAJOR,
        "In SE11 set 'Change document' on the data element (DD04L-LOGFLAG) of the field and regenerate the "
        "change document object (SCDO).", "DATA_DICTIONARY_GOVERNANCE",
    ),
    RuleSpec(
        "CP_CUSTOM_FIELD_OMITTED_BD52", "Custom field omitted from BD52", Severity.MAJOR,
        "Add the custom (YY1_/ZZ) field to BD52 for the message type and extend the IDoc segment / mapping so "
        "the value is distributed.", "EXTENSIBILITY_GOVERNANCE",
    ),
    RuleSpec(
        "CP_FIELD_FILTERED_BD53", "Field filtered by reduced message type (BD53)", Severity.MINOR,
        "Review the reduced message type in BD53 and select the field if downstream systems need it.",
        "ALE_REDUCED_MESSAGE_TYPE",
    ),
    RuleSpec(
        "CP_RUNTIME_UNPROCESSED_BACKLOG", "Unprocessed change pointer backlog (BDCP2)", Severity.MAJOR,
        "Schedule / repair report RBDMIDOC (BD21) for the message type, check SM37 job logs, and clean up "
        "processed pointers with RBDCPCLR2.", "RUNTIME_RECONCILIATION",
    ),
)


class ChangePointerInput(ContractModel):
    signal_fields = (
        "target_message_type", "message_type", "bd50_msg_types", "bd50", "message_types",
        "bd52_fields", "bd52", "fields",
    )
    signal_message = (
        "Change pointer audit requires a message type ('target_message_type' / BD50) and the BD52 field "
        "configuration."
    )


_CP_RECORD_TYPES = {"BD61", "TBDA1", "BD50", "TBDA2", "BD52", "TBD62", "EXPECTED", "EXP", "DD04L", "BDCP2", "BDCP",
                    "BD53"}


def _cp_text_check(text: str) -> Optional[str]:
    for line in text.splitlines():
        first = line.split(",")[0].split(";")[0].strip().upper()
        if first in _CP_RECORD_TYPES:
            return None
    return (
        "CSV export must use record-type rows (BD61,<X>; BD50,<MESTYP>,<X>; BD52,<MESTYP>,<OBJ>,<TABLE>,<FIELD>; "
        "DD04L,…; BDCP2,…)."
    )


INPUT_CONTRACT = InputContract(
    formats=(InputFormat.JSON, InputFormat.CSV, InputFormat.TEXT),
    summary=(
        "ALE change pointer configuration: JSON {'target_message_type', 'bd61_active', 'bd50_msg_types', "
        "'bd52_fields', 'expected_fields', 'dd04l_metadata', 'bdcp2_samples', 'bd53_reduced_fields'} or a "
        "record-type CSV (BD61/BD50/BD52/DD04L/BDCP2 rows)."
    ),
    required=("message type (target_message_type or active BD50 entry)", "BD52 field configuration"),
    json_model=ChangePointerInput,
    text_check=_cp_text_check,
)


# ==== END ENGINE CONTRACT ====


@register_engine
class ChangePointerEngine(BaseEngine):
    """Authoritative preflight engine for ALE / IDoc Change Pointer auditing."""

    # Point 1: Metadata
    engine_type = EngineType.CHANGE_POINTER_COVERAGE_AUDITOR
    rule_prefix = "CP"
    finding_codes = RULES
    input_contract = INPUT_CONTRACT
    name = "Change Pointer Coverage Auditor"
    description = "BD61/BD50/BD52 change pointer configuration and event trigger validation"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.CSV, ArtifactType.TXT]

    def _normalize_boolean(self, val: Any) -> bool:
        if isinstance(val, bool):
            return val
        if isinstance(val, (int, float)):
            return val != 0
        if isinstance(val, str):
            clean = val.strip().upper()
            return clean in ("X", "TRUE", "1", "YES", "ACTIVE", "T")
        return False

    def _parse_inputs(self, request: AnalysisRequest) -> Tuple[ChangePointerNormalizedData, str, str]:
        """Parses and normalizes input artifacts across JSON, CSV, and request configurations."""
        raw_text = request.raw_content or ""
        artifact_path = request.artifact_s3_key or "change_pointer/configuration.json"

        # Check for multi-artifact payload
        if not raw_text and request.artifacts:
            for art in request.artifacts:
                if art.raw_content:
                    raw_text = art.raw_content
                    artifact_path = art.file_name
                    break

        data = ChangePointerNormalizedData()

        stripped = raw_text.strip() if raw_text else ""
        if stripped.startswith("{") or stripped.startswith("["):
            # Parse JSON input (malformed JSON is reported, never replaced by {})
            parsed = parse_json_object(raw_text, self.rule_prefix)
        elif not raw_text and request.configuration:
            parsed = request.configuration
        elif raw_text and ("\n" in raw_text or "," in raw_text or ";" in raw_text):
            # Parse Tabular CSV input
            parsed = self._parse_csv_content(raw_text)
        else:
            parsed = request.configuration or {}

        # 1. Parse BD61 global activation flag
        raw_bd61 = parsed.get("bd61_active", parsed.get("bd61", parsed.get("TBDA1-AKTIV", True)))
        data.bd61_active = self._normalize_boolean(raw_bd61)

        # 2. Parse BD50 message types
        raw_bd50 = parsed.get("bd50_msg_types", parsed.get("bd50", parsed.get("message_types", [])))
        if isinstance(raw_bd50, (list, set, tuple)):
            for item in raw_bd50:
                if isinstance(item, str):
                    data.bd50_msg_types.add(item.strip().upper())
                elif isinstance(item, dict):
                    m_type = item.get("message_type") or item.get("mestype") or item.get("MESTYPE")
                    active = item.get("active", item.get("aktiv", True))
                    if m_type and self._normalize_boolean(active):
                        data.bd50_msg_types.add(str(m_type).strip().upper())
        elif isinstance(raw_bd50, dict):
            for k, v in raw_bd50.items():
                if self._normalize_boolean(v):
                    data.bd50_msg_types.add(str(k).strip().upper())

        # Determine target message type and change document object
        target_msg = parsed.get("target_message_type", parsed.get("message_type"))
        if not target_msg and data.bd50_msg_types:
            target_msg = sorted(list(data.bd50_msg_types))[0]
        data.target_message_type = str(target_msg).strip().upper() if target_msg else None

        cd_obj = parsed.get("change_document_object", parsed.get("cd_object"))
        if not cd_obj and data.target_message_type:
            cd_obj = MESSAGE_TYPE_OBJECT_MAP.get(data.target_message_type, "")
        data.change_document_object = str(cd_obj or "").upper()

        # If BD50 is empty in payload, default to checking target_message_type
        if (
            data.target_message_type
            and not data.bd50_msg_types
            and "bd50_msg_types" not in parsed
            and "bd50" not in parsed
        ):
            data.bd50_msg_types.add(data.target_message_type)

        # 3. Parse BD52 configured fields
        data.bd52_supplied = any(k in parsed for k in ("bd52_fields", "bd52", "fields"))
        raw_bd52 = parsed.get("bd52_fields", parsed.get("bd52", parsed.get("fields", [])))
        data.bd52_fields = self._normalize_field_list(raw_bd52)

        # 4. Parse expected fields
        raw_expected = parsed.get("expected_fields", parsed.get("expected", []))
        if raw_expected:
            data.expected_fields = self._normalize_field_list(raw_expected)
            data.expected_fields_source = "CUSTOMER"
        else:
            # Fallback to standard message type profile or BD52 fields
            default_profile = STANDARD_MESSAGE_PROFILES.get(data.target_message_type)
            if default_profile and not parsed.get("empty_expected_allowed"):
                # If explicit empty list was passed, respect it
                if "expected_fields" in parsed and isinstance(parsed["expected_fields"], list) and len(parsed["expected_fields"]) == 0:
                    data.expected_fields = []
                else:
                    data.expected_fields = list(default_profile)
                    data.expected_fields_source = "STANDARD_PROFILE"
            else:
                data.expected_fields = list(data.bd52_fields)

        # 5. Parse DD04L metadata
        raw_dd04l = parsed.get("dd04l_metadata", parsed.get("dd04l", {}))
        if isinstance(raw_dd04l, dict):
            for k, v in raw_dd04l.items():
                key = str(k).upper().replace("/", "")
                if isinstance(v, dict):
                    chg = self._normalize_boolean(v.get("change_document_flag", v.get("chgflag", True)))
                    de = v.get("data_element", v.get("rollname"))
                    data.dd04l_metadata[key] = DD04LEntry(change_document_flag=chg, data_element=de)
                elif isinstance(v, bool):
                    data.dd04l_metadata[key] = DD04LEntry(change_document_flag=v)
        elif isinstance(raw_dd04l, list):
            for item in raw_dd04l:
                if isinstance(item, dict):
                    tbl = item.get("table", item.get("tabname", ""))
                    fld = item.get("field", item.get("fieldname", ""))
                    chg = self._normalize_boolean(item.get("change_document_flag", item.get("chgflag", True)))
                    de = item.get("data_element", item.get("rollname"))
                    key = f"{tbl}-{fld}".upper() if tbl and fld else str(item.get("key", "")).upper()
                    data.dd04l_metadata[key] = DD04LEntry(table=tbl, field=fld, change_document_flag=chg, data_element=de)

        # 6. Parse BDCP2 runtime samples
        raw_bdcp2 = parsed.get("bdcp2_samples", parsed.get("bdcp2", []))
        if isinstance(raw_bdcp2, list):
            for sample in raw_bdcp2:
                if isinstance(sample, dict):
                    m_type = sample.get("message_type") or sample.get("mestype")
                    tbl = sample.get("table") or sample.get("tabname")
                    fld = sample.get("field") or sample.get("fldname")
                    proc = str(sample.get("process_status", sample.get("process", " "))).strip().upper()
                    cnt = int(sample.get("count", sample.get("pointer_count", 1)))
                    data.bdcp2_samples.append(
                        BDCP2SampleEntry(
                            message_type=m_type,
                            table=tbl,
                            field=fld,
                            process_status=proc or " ",
                            count=cnt,
                        )
                    )

        # 7. Parse BD53 reduced message type fields
        raw_bd53 = parsed.get("bd53_reduced_fields", parsed.get("bd53", []))
        if isinstance(raw_bd53, (list, set, tuple)):
            for item in raw_bd53:
                if isinstance(item, str):
                    data.bd53_reduced_fields.add(item.strip().upper())
                elif isinstance(item, (list, tuple)) and len(item) >= 2:
                    data.bd53_reduced_fields.add(f"{item[0]}-{item[1]}".upper())
                elif isinstance(item, dict):
                    t = item.get("table", item.get("tabname"))
                    f = item.get("field", item.get("fieldname"))
                    if t and f:
                        data.bd53_reduced_fields.add(f"{t}-{f}".upper())

        return data, artifact_path, raw_text

    def _normalize_field_list(self, raw_fields: Any) -> List[Tuple[str, str]]:
        """Converts heterogeneous field representations into canonical [(TABLE, FIELD)] tuples."""
        results: List[Tuple[str, str]] = []
        if not raw_fields or not isinstance(raw_fields, (list, tuple, set)):
            return results

        for item in raw_fields:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                tbl = str(item[0]).strip().upper()
                fld = str(item[1]).strip().upper()
                if tbl and fld:
                    results.append((tbl, fld))
            elif isinstance(item, dict):
                tbl = str(item.get("table") or item.get("tabname") or "").strip().upper()
                fld = str(item.get("field") or item.get("fieldname") or item.get("fldname") or "").strip().upper()
                if tbl and fld:
                    results.append((tbl, fld))
            elif isinstance(item, str):
                parts = item.replace("/", "").split("-") if "-" in item else item.split(".")
                if len(parts) >= 2:
                    tbl = parts[0].strip().upper()
                    fld = parts[1].strip().upper()
                    results.append((tbl, fld))

        # Return deterministically sorted list
        return sorted(list(set(results)))

    def _parse_csv_content(self, csv_text: str) -> Dict[str, Any]:
        """Parses CSV exports from BD61, BD50, BD52, DD04L."""
        result: Dict[str, Any] = {
            "bd61_active": True,
            "bd50_msg_types": [],
            "bd52_fields": [],
            "expected_fields": [],
            "dd04l_metadata": {},
            "bdcp2_samples": [],
        }

        reader = csv.reader(io.StringIO(csv_text))
        for row in reader:
            if not row or not any(row):
                continue
            first = row[0].strip().upper()
            if first in ("BD61", "TBDA1"):
                # e.g. BD61,X
                val = row[1].strip() if len(row) > 1 else "X"
                result["bd61_active"] = self._normalize_boolean(val)
            elif first in ("BD50", "TBDA2"):
                # e.g. BD50,MATMAS,X
                if len(row) > 1:
                    m_type = row[1].strip().upper()
                    active = row[2].strip() if len(row) > 2 else "X"
                    if self._normalize_boolean(active):
                        result["bd50_msg_types"].append(m_type)
            elif first in ("BD52", "TBD62"):
                # e.g. BD52,MATMAS,MATERIAL,MARA,MATKL or BD52,MARA,MATKL
                if len(row) >= 5:
                    result["bd52_fields"].append((row[3].strip().upper(), row[4].strip().upper()))
                elif len(row) >= 3:
                    result["bd52_fields"].append((row[1].strip().upper(), row[2].strip().upper()))
            elif first in ("EXPECTED", "EXP"):
                if len(row) >= 3:
                    result["expected_fields"].append((row[1].strip().upper(), row[2].strip().upper()))
            elif first in ("DD04L",):
                # e.g. DD04L,MARA,MATKL,X,MATKL
                if len(row) >= 4:
                    tbl, fld, chg = row[1].strip().upper(), row[2].strip().upper(), row[3].strip()
                    key = f"{tbl}-{fld}"
                    result["dd04l_metadata"][key] = {"change_document_flag": self._normalize_boolean(chg)}
            elif first in ("BDCP2", "BDCP"):
                # e.g. BDCP2,MATMAS,MARA,MATKL,X,10
                if len(row) >= 4:
                    result["bdcp2_samples"].append({
                        "message_type": row[1].strip().upper(),
                        "table": row[2].strip().upper(),
                        "field": row[3].strip().upper(),
                        "process_status": row[4].strip().upper() if len(row) > 4 else " ",
                        "count": int(row[5]) if len(row) > 5 and row[5].isdigit() else 1,
                    })

        return result

    # ==========================================================================
    # Main Engine Evaluation Pipeline (Point 4: Pure Rule Evaluation)
    # ==========================================================================

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        rules_evaluated = 0
        findings: List[Finding] = []

        # Parse and normalize inputs
        data, artifact_path, raw_text = self._parse_inputs(request)
        if not data.target_message_type:
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "No message type supplied: provide 'target_message_type' or active BD50 message types.",
            )
        if not data.bd52_supplied:
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                f"BD52 (TBD62) field configuration for message type '{data.target_message_type}' was not supplied; "
                "field-level change pointer coverage cannot be assessed.",
            )
        from_standard_profile = data.expected_fields_source == "STANDARD_PROFILE"

        # ----------------------------------------------------------------------
        # Rule 1: Global Change Pointer Activation (BD61)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        if not data.bd61_active:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, "bd61")
            if line_no is None:
                snippet = '"bd61_active": false'
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or "bd61_active: false",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet,
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="CP_GLOBAL_DEACTIVATED",
                severity=Severity.CRITICAL,
                category="ALE_GLOBAL_CONFIGURATION",
                title="Global Change Pointers Deactivated (BD61)",
                description=(
                    "Global change pointer activation is disabled in client configuration table TBDA1. "
                    "When BD61 is deactivated, SAP function module CHANGE_POINTERS_CREATE exits immediately "
                    "without creating change pointers in BDCP2, disabling master data synchronization for all message types."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Execute transaction BD61 in the target client, check the 'Change pointers activated - generally' "
                    "checkbox, and save the customizing entry."
                ),
                evidence=[ev],
                technical_details={"table": "TBDA1", "field": "AKTIV", "current_value": " "},
                affected_objects=["TBDA1", "BD61"],
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 2: Message Type Activation (BD50)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        msg_type_active = data.target_message_type in data.bd50_msg_types
        if not msg_type_active:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, data.target_message_type)
            if line_no is None:
                snippet = f'"bd50_msg_types": {list(data.bd50_msg_types)}'
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"bd50_msg_type_{data.target_message_type}_inactive",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet,
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="CP_MSG_TYPE_DEACTIVATED",
                severity=Severity.CRITICAL,
                category="ALE_MESSAGE_TYPE_CONFIGURATION",
                title=f"Message Type Deactivated in BD50: {data.target_message_type}",
                description=(
                    f"Message type '{data.target_message_type}' is deactivated in table TBDA2. Changes to related "
                    "master data objects will not trigger outbound change pointers for this interface."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    f"Execute transaction BD50, locate message type '{data.target_message_type}', check the 'Active' "
                    "flag checkbox, and transport the customization."
                ),
                evidence=[ev],
                technical_details={"table": "TBDA2", "message_type": data.target_message_type, "active": False},
                affected_objects=[f"BD50:{data.target_message_type}"],
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 3: Field-Level Linkage Audit (BD52)
        # ----------------------------------------------------------------------
        active_bd52_set = set(data.bd52_fields)
        missing_fields: List[Tuple[str, str]] = []
        covered_fields: List[Tuple[str, str]] = []

        for tbl, fld in data.expected_fields:
            rules_evaluated += 1
            if (tbl, fld) in active_bd52_set:
                covered_fields.append((tbl, fld))
            else:
                missing_fields.append((tbl, fld))
                token_to_search = fld if fld in raw_text else tbl
                line_no, col_no, snippet = _locate_line_in_text(raw_text, token_to_search)
                if line_no is None:
                    snippet = None
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text,
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet,
                    # Expectations from the built-in SAP profile are curated knowledge, not customer evidence.
                    provenance=ConfidenceClass.RULE_DERIVED if from_standard_profile else ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CURATED_RULE if from_standard_profile else TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="CP_FIELD_NOT_CONFIGURED_BD52",
                    severity=Severity.MAJOR,
                    category="ALE_FIELD_LINKAGE",
                    title=f"Trigger Field Missing in BD52: {tbl}-{fld}",
                    description=(
                        f"Field '{tbl}-{fld}' is expected to trigger change pointers for message type "
                        f"'{data.target_message_type}' (Change Document Object '{data.change_document_object}'), "
                        "but is missing in table TBD62 (transaction BD52). Modifications to this field will not generate change pointers."
                    ),
                    confidence=ConfidenceClass.RULE_DERIVED if from_standard_profile else ConfidenceClass.VERIFIED,
                    confidence_score=0.85 if from_standard_profile else 1.0,
                    remediation=(
                        f"Execute transaction BD52, enter message type '{data.target_message_type}', and add an entry: "
                        f"Object='{data.change_document_object}', Table='{tbl}', Field='{fld}'."
                    ),
                    evidence=[ev],
                    technical_details={
                        "messageType": data.target_message_type,
                        "changeDocumentObject": data.change_document_object,
                        "table": tbl,
                        "field": fld,
                        "expectedFieldSource": data.expected_fields_source,
                    },
                    affected_objects=[f"{tbl}-{fld}"],
                )
                findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 4: ABAP Dictionary Change Document Flag (DD04L)
        # ----------------------------------------------------------------------
        dd04l_missing_flags: List[str] = []
        for tbl, fld in active_bd52_set:
            rules_evaluated += 1
            field_key = f"{tbl}-{fld}".upper()
            dd_entry = data.dd04l_metadata.get(field_key)

            # Check if DD04L flag explicitly configured as false
            if dd_entry is not None and not dd_entry.change_document_flag:
                dd04l_missing_flags.append(field_key)
                line_no, col_no, snippet = _locate_line_in_text(raw_text, fld)
                if line_no is None:
                    snippet = f'"{field_key}": {{"change_document_flag": false}}'
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or f"{field_key}_no_chgflag",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet,
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="CP_FIELD_DD04L_CHGFLAG_MISSING",
                    severity=Severity.MAJOR,
                    category="DATA_DICTIONARY_GOVERNANCE",
                    title=f"Data Element Lacks Change Document Flag in DD04L: {field_key}",
                    description=(
                        f"Field '{field_key}' is configured in BD52 to trigger change pointers, but its underlying "
                        "data element in DD04L does not have the 'Change document' flag enabled. Consequently, "
                        "SAP update function modules will skip writing change records to CDPOS, and BDCP2 change "
                        "pointers will silently fail to generate."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        f"Open transaction SE11 for the data element of '{field_key}', select the 'Further Characteristics' "
                        "tab, check the 'Change Document' checkbox, and activate the data element."
                    ),
                    evidence=[ev],
                    technical_details={
                        "table": tbl,
                        "field": fld,
                        "data_element": dd_entry.data_element or "UNKNOWN",
                        "chgflag": False,
                    },
                    affected_objects=[field_key],
                )
                findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 5: Custom Field Omission in BD52 (YY1_ / ZZ_)
        # ----------------------------------------------------------------------
        custom_fields_detected: List[Tuple[str, str]] = []
        for tbl, fld in data.expected_fields:
            if CUSTOM_FIELD_PATTERN.match(fld):
                custom_fields_detected.append((tbl, fld))

        for tbl, fld in custom_fields_detected:
            rules_evaluated += 1
            if (tbl, fld) not in active_bd52_set:
                field_key = f"{tbl}-{fld}"
                line_no, col_no, snippet = _locate_line_in_text(raw_text, fld)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or field_key,
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'"{tbl}", "{fld}"',
                    provenance=ConfidenceClass.RULE_DERIVED,
                    source_type=TrustLevel.CURATED_RULE,
                )
                f = Finding(
                    rule_id="CP_CUSTOM_FIELD_OMITTED_BD52",
                    severity=Severity.MAJOR,
                    category="EXTENSIBILITY_GOVERNANCE",
                    title=f"Custom Extension Field Omitted from BD52: {field_key}",
                    description=(
                        f"Custom extension field '{field_key}' is defined on table '{tbl}' but is omitted from BD52 "
                        f"for message type '{data.target_message_type}'. Modifications to this custom field will not "
                        "trigger outbound ALE replication."
                    ),
                    confidence=ConfidenceClass.RULE_DERIVED,
                    confidence_score=0.85,
                    remediation=(
                        f"Maintain BD52 for message type '{data.target_message_type}' and add custom field '{fld}' "
                        f"under table '{tbl}' and object '{data.change_document_object}'."
                    ),
                    evidence=[ev],
                    technical_details={"table": tbl, "custom_field": fld, "message_type": data.target_message_type},
                    affected_objects=[field_key],
                )
                findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 6: Reduced Message Type Filtering (BD53)
        # ----------------------------------------------------------------------
        for tbl, fld in active_bd52_set:
            field_key = f"{tbl}-{fld}".upper()
            rules_evaluated += 1
            if field_key in data.bd53_reduced_fields or fld in data.bd53_reduced_fields:
                line_no, col_no, snippet = _locate_line_in_text(raw_text, fld)
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or f"{field_key}_reduced_bd53",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or f'"{field_key}"',
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="CP_FIELD_FILTERED_BD53",
                    severity=Severity.MINOR,
                    category="ALE_REDUCED_MESSAGE_TYPE",
                    title=f"Field Suppressed by Reduced Message Type (BD53): {field_key}",
                    description=(
                        f"Field '{field_key}' is configured in BD52 to trigger change pointers, but is filtered out "
                        "in the reduced message type definition. Change pointers will be created, but the field value "
                        "will be suppressed from the generated IDoc."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        f"Review transaction BD53 for reduced message type and enable field '{fld}' if synchronization is required."
                    ),
                    evidence=[ev],
                    technical_details={"table": tbl, "field": fld, "reduced_filter": True},
                    affected_objects=[field_key],
                )
                findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 7: Runtime Reconciliation & Backlog Inspection (BDCP2)
        # ----------------------------------------------------------------------
        unprocessed_backlog = 0
        runtime_field_counts: Dict[str, int] = {}

        for sample in data.bdcp2_samples:
            rules_evaluated += 1
            k = f"{sample.table or ''}-{sample.field or ''}".upper()
            if sample.process_status == " ":
                unprocessed_backlog += sample.count
            runtime_field_counts[k] = runtime_field_counts.get(k, 0) + sample.count

        # Check for heavy unprocessed backlog (> 100 pointers)
        if unprocessed_backlog > 100:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, "bdcp2")
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"bdcp2_unprocessed_{unprocessed_backlog}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f'"unprocessed_count": {unprocessed_backlog}',
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="CP_RUNTIME_UNPROCESSED_BACKLOG",
                severity=Severity.MAJOR,
                category="RUNTIME_RECONCILIATION",
                title=f"High Unprocessed Change Pointer Backlog in BDCP2 ({unprocessed_backlog} entries)",
                description=(
                    f"Found {unprocessed_backlog} unprocessed change pointers in table BDCP2 for message type "
                    f"'{data.target_message_type}'. This indicates that program RBDMIDOC is either not scheduled, "
                    "failing with runtime errors, or backlogged."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    f"Inspect background jobs in transaction SM37 for job 'RBDMIDOC' / message type "
                    f"'{data.target_message_type}'. Verify frequency and review job logs for IDoc dispatch aborts."
                ),
                evidence=[ev],
                technical_details={
                    "message_type": data.target_message_type,
                    "unprocessed_count": unprocessed_backlog,
                },
                affected_objects=["BDCP2", "RBDMIDOC"],
            )
            findings.append(ConfidenceClassifier.classify(f))

        # Calculate coverage percentage
        total_exp = len(data.expected_fields)
        covered_count = len(covered_fields)
        cov_pct = round((covered_count / total_exp * 100.0) if total_exp else 100.0, 1)

        # Telemetry & execution metrics
        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        additional_metrics = {
            "global_active": data.bd61_active,
            "message_type_active": msg_type_active,
            "total_expected_fields": total_exp,
            "covered_fields": covered_count,
            "coverage_percentage": cov_pct,
            "missing_fields": [f"{t}-{f}" for t, f in missing_fields],
            "dd04l_missing_flags": dd04l_missing_flags,
            "unprocessed_backlog_count": unprocessed_backlog,
            # Dual camelCase aliases for OpenAPI / Evaluator compatibility
            "globalActive": data.bd61_active,
            "messageTypeActive": msg_type_active,
            "totalExpectedFields": total_exp,
            "coveredFields": covered_count,
            "coveragePercentage": cov_pct,
        }

        # Status determination: PARTIAL if global BD61 disabled, else COMPLETED
        status = AnalysisStatus.PARTIAL if not data.bd61_active else AnalysisStatus.COMPLETED

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=status,
            findings=findings,
            metrics=AnalysisMetrics(
                execution_time_ms=elapsed_ms,
                rules_evaluated=max(rules_evaluated, 1),
                artifacts_scanned=max(1, len(request.artifacts)),
                additional_metrics=additional_metrics,
            ),
        )
