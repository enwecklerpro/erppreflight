"""Transport Dependency Analyzer Engine.

Authoritative preflight analysis of SAP CTS (Change and Transport System) Transport Requests:
- Object collisions across concurrent / open transports (TR_OBJECT_COLLISION)
- Cross-transport call dependency & sequence inversion risks (TR_CALL_DEPENDENCY_SEQUENCE_RISK)
- Overtaker transport & code downgrade risks (TR_OVERTAKER_DOWNGRADE_RISK)
- Customizing table entries transported ahead of table structure (TR_CUSTOMIZING_AHEAD_OF_STRUCTURE)
- Deterministic topological import sequencing (recommendedImportSequence)
- Circular transport dependency detection (TR_CIRCULAR_DEPENDENCY_DETECTED)

Complies with Cardinal Axioms 1 & 2 (14-Point Engine Anatomy).
"""

from __future__ import annotations

import csv
import io
import json
import re
import time
from collections import defaultdict, deque
from typing import Any, Dict, List, Optional, Set, Tuple, Union

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
from src.parsers.safe_xml import SafeXmlParser
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine


# ==============================================================================
# Domain Input Schemas & CTS Models (Point 2: Input Schema)
# ==============================================================================

class E070Record(BaseModel):
    """Transport Request Header Record (CTS table E070)."""
    model_config = ConfigDict(extra="ignore")

    trkorr: str = Field(..., description="Transport request identifier (e.g. DEVK900101)")
    trfunction: str = Field("K", description="Type: K=Workbench, W=Customizing, T=ToC, C=Relocation, S=Task")
    trstatus: str = Field("D", description="Status: D=Modifiable, R=Released, N=Imported")
    as4user: Optional[str] = Field(None, description="Request owner / author")
    as4date: Optional[str] = Field(None, description="Date of last modification / release (YYYYMMDD)")
    as4time: Optional[str] = Field(None, description="Time of last modification / release (HHMMSS)")
    tarsystem: Optional[str] = Field(None, description="Target system (e.g. QAS, PRD)")
    strkorr: Optional[str] = Field(None, description="Parent transport request for tasks")
    timestamp: Optional[str] = Field(None, description="Combined sortable timestamp string")
    line_number: Optional[int] = Field(None, description="1-indexed line number in source artifact")
    column_number: Optional[int] = Field(None, description="1-indexed column number in source artifact")
    snippet: str = Field("", description="Raw line or record excerpt")


class E071Record(BaseModel):
    """Transport Request Object Entry Record (CTS table E071)."""
    model_config = ConfigDict(extra="ignore")

    trkorr: str = Field(..., description="Transport request identifier")
    pgmid: str = Field("R3TR", description="Program ID (R3TR, LIMU, CORR)")
    object: str = Field(..., description="Object Type (CLAS, TABL, PROG, FUGR, VIEW, etc.)")
    obj_name: str = Field(..., description="Repository Object Name")
    objfunc: str = Field(" ", description="Function (' '=Standard, K=Key entries, D=Delete)")
    line_number: Optional[int] = Field(None, description="1-indexed line number in source artifact")
    column_number: Optional[int] = Field(None, description="1-indexed column number in source artifact")
    snippet: str = Field("", description="Raw line or record excerpt")

    @property
    def canonical_object_key(self) -> str:
        """Returns standard normalized object representation: OBJECT OBJ_NAME."""
        clean_type = self.object.strip().upper()
        clean_name = self.obj_name.strip().upper()
        return f"{clean_type} {clean_name}"


class E071KRecord(BaseModel):
    """Transport Request Table Keys Record (CTS table E071K)."""
    model_config = ConfigDict(extra="ignore")

    trkorr: str = Field(..., description="Transport request identifier")
    pgmid: str = Field("R3TR", description="Program ID")
    object: str = Field("TABU", description="Object Type (typically TABU)")
    obj_name: str = Field("", description="Object / table name")
    tablename: str = Field(..., description="Database Table Name")
    mastertype: Optional[str] = Field(None, description="Master type")
    mastername: Optional[str] = Field(None, description="Master name")
    tabkey: str = Field("*", description="Transported table key specification")
    line_number: Optional[int] = Field(None, description="1-indexed line number in source artifact")
    column_number: Optional[int] = Field(None, description="1-indexed column number in source artifact")
    snippet: str = Field("", description="Raw line or record excerpt")


class CallReference(BaseModel):
    """Cross-Transport Call / Syntax Reference."""
    model_config = ConfigDict(extra="ignore")

    caller_tr: Optional[str] = Field(None, description="Calling transport request")
    caller_object: str = Field(..., description="Calling object (e.g. PROG ZREPORT, CLAS ZCL_A)")
    callee_tr: Optional[str] = Field(None, description="Target transport defining the referenced object")
    callee_object: str = Field(..., description="Referenced object (e.g. CLAS ZCL_ORDER_HANDLER)")
    reference_type: str = Field("CALL_METHOD", description="CALL_METHOD, CALL_FUNCTION, SELECT_TABLE, INHERITS_FROM")
    line_number: Optional[int] = Field(None, description="1-indexed line number in source artifact")
    column_number: Optional[int] = Field(None, description="1-indexed column number in source artifact")
    snippet: str = Field("", description="Raw line or record excerpt")


class CTSNormalizedData(BaseModel):
    """Aggregated container for normalized CTS transport records."""
    model_config = ConfigDict(extra="ignore")

    headers: Dict[str, E070Record] = Field(default_factory=dict)
    objects_by_tr: Dict[str, List[E071Record]] = Field(default_factory=lambda: defaultdict(list))
    keys_by_tr: Dict[str, List[E071KRecord]] = Field(default_factory=lambda: defaultdict(list))
    call_references: List[CallReference] = Field(default_factory=list)
    planned_sequence: List[str] = Field(default_factory=list)
    artifact_path: str = "transport/cts_export.json"
    raw_content: str = ""

    def all_transports(self) -> Set[str]:
        trs: Set[str] = set()
        trs.update(self.headers.keys())
        trs.update(self.objects_by_tr.keys())
        trs.update(self.keys_by_tr.keys())
        for ref in self.call_references:
            if ref.caller_tr:
                trs.add(ref.caller_tr)
            if ref.callee_tr:
                trs.add(ref.callee_tr)
        for s in self.planned_sequence:
            trs.add(s)
        return trs


# ==============================================================================
# Helper Functions (Point 6: Coordinate & Evidence Extraction)
# ==============================================================================

def _locate_line_in_text(raw_text: str, token: str) -> Tuple[Optional[int], Optional[int], str]:
    """Deterministically locates the 1-indexed line, column, and snippet of a token in raw text."""
    if not raw_text or not token:
        return None, None, ""
    lines = raw_text.splitlines()
    token_str = str(token).strip()
    if not token_str:
        return None, None, ""

    # Primary exact search
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


def _normalize_obj_string(obj_str: str) -> Tuple[str, str, str]:
    """Normalizes object string like 'CLAS ZCL_ORDER_HANDLER' into (pgmid, object_type, object_name)."""
    parts = obj_str.strip().split()
    if len(parts) >= 3 and parts[0].upper() in ("R3TR", "LIMU", "CORR"):
        return parts[0].upper(), parts[1].upper(), " ".join(parts[2:]).strip().upper()
    elif len(parts) >= 2:
        return "R3TR", parts[0].upper(), " ".join(parts[1:]).strip().upper()
    elif len(parts) == 1:
        # Fallback single word, assume generic object
        return "R3TR", "OBJ", parts[0].strip().upper()
    return "R3TR", "OBJ", "UNKNOWN"


def _format_timestamp(as4date: Optional[str], as4time: Optional[str]) -> str:
    """Formats date and time into a sortable string (YYYYMMDDHHMMSS)."""
    d = re.sub(r"[^0-9]", "", as4date or "")
    t = re.sub(r"[^0-9]", "", as4time or "")
    d = d.ljust(8, "0")[:8]
    t = t.ljust(6, "0")[:6]
    return f"{d}{t}"


# ==============================================================================
# Transport Dependency Analyzer Engine (Point 1: Metadata)
# ==============================================================================

@register_engine
class TransportDependencyEngine(BaseEngine):
    """Authoritative preflight engine for SAP CTS transport sequence & collision auditing."""

    # Point 1: Metadata
    engine_type = EngineType.TRANSPORT_DEPENDENCY_ANALYZER
    rule_prefix = "TR"
    name = "Transport Dependency Analyzer"
    description = "CTS transport sequence, cross-transport dictionary dependency validator"
    version = "2.0.0"
    supported_artifact_types = [
        ArtifactType.JSON,
        ArtifactType.CSV,
        ArtifactType.XML,
        ArtifactType.TXT,
    ]

    # ==========================================================================
    # Multi-Format Parsers (Point 3: Deterministic Parser)
    # ==========================================================================

    def _parse_inputs(self, request: AnalysisRequest) -> CTSNormalizedData:
        """Parses and normalizes input artifacts across JSON, CSV, and XML payloads."""
        raw_text = request.raw_content or ""
        artifact_path = request.artifact_s3_key or "transport/cts_export.json"

        # Check for multi-artifact payload
        if not raw_text and request.artifacts:
            for art in request.artifacts:
                if art.raw_content:
                    raw_text = art.raw_content
                    artifact_path = art.file_name
                    break

        data = CTSNormalizedData(artifact_path=artifact_path, raw_content=raw_text)

        # 1. XML Artifact Detection
        if raw_text and raw_text.strip().startswith("<"):
            try:
                self._parse_xml_content(raw_text, data)
                return data
            except Exception:
                pass

        # 2. JSON Artifact Detection
        if raw_text and (raw_text.strip().startswith("{") or raw_text.strip().startswith("[")):
            try:
                parsed_json = json.loads(raw_text)
                self._parse_json_content(parsed_json, data, raw_text)
                return data
            except Exception:
                pass

        # 3. CSV Artifact Detection (Lines with commas or semicolons)
        if raw_text and ("\n" in raw_text or "," in raw_text or ";" in raw_text):
            self._parse_csv_content(raw_text, data)
            return data

        # 4. Fallback to request configuration dictionary
        if request.configuration:
            self._parse_json_content(request.configuration, data, "")
            return data

        return data

    def _parse_json_content(self, parsed: Any, data: CTSNormalizedData, raw_text: str) -> None:
        """Parses JSON data structures into normalized CTS records."""
        if not isinstance(parsed, dict):
            return

        # Handle planned sequence
        planned = parsed.get("planned_sequence") or parsed.get("plannedSequence") or parsed.get("import_sequence")
        if isinstance(planned, list):
            data.planned_sequence = [str(x).strip().upper() for x in planned if x]

        # Case A: Shorthand 'transports' dictionary mapping TR -> list of objects
        raw_trs = parsed.get("transports")
        if isinstance(raw_trs, dict):
            for tr_id, objs in raw_trs.items():
                clean_tr = str(tr_id).strip().upper()
                line_no, col_no, snip = _locate_line_in_text(raw_text, tr_id)
                data.headers[clean_tr] = E070Record(
                    trkorr=clean_tr,
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snip,
                )
                if isinstance(objs, list):
                    for obj_item in objs:
                        obj_str = str(obj_item).strip()
                        pgmid, o_type, o_name = _normalize_obj_string(obj_str)
                        o_line, o_col, o_snip = _locate_line_in_text(raw_text, obj_str)
                        rec = E071Record(
                            trkorr=clean_tr,
                            pgmid=pgmid,
                            object=o_type,
                            obj_name=o_name,
                            line_number=o_line,
                            column_number=o_col,
                            snippet=o_snip or snip,
                        )
                        data.objects_by_tr[clean_tr].append(rec)
        elif not any(k in parsed for k in ("e070", "e071", "e071k", "transports")):
            # Direct mapping at top level: {"DEVK9001": ["CLAS ZCL_A"]}
            for tr_id, objs in parsed.items():
                if isinstance(objs, list) and tr_id not in ("call_references", "callReferences", "planned_sequence", "plannedSequence"):
                    clean_tr = str(tr_id).strip().upper()
                    line_no, col_no, snip = _locate_line_in_text(raw_text, tr_id)
                    data.headers[clean_tr] = E070Record(
                        trkorr=clean_tr,
                        line_number=line_no,
                        column_number=col_no,
                        snippet=snip,
                    )
                    for obj_item in objs:
                        obj_str = str(obj_item).strip()
                        pgmid, o_type, o_name = _normalize_obj_string(obj_str)
                        o_line, o_col, o_snip = _locate_line_in_text(raw_text, obj_str)
                        rec = E071Record(
                            trkorr=clean_tr,
                            pgmid=pgmid,
                            object=o_type,
                            obj_name=o_name,
                            line_number=o_line,
                            column_number=o_col,
                            snippet=o_snip or snip,
                        )
                        data.objects_by_tr[clean_tr].append(rec)

        # Case B: Standard CTS Table Exports (E070, E071, E071K)
        # 1. E070 Headers
        raw_e070 = parsed.get("e070") or parsed.get("E070") or []
        if isinstance(raw_e070, list):
            for row in raw_e070:
                if isinstance(row, dict):
                    tr = str(row.get("trkorr") or row.get("TRKORR") or "").strip().upper()
                    if tr:
                        line_no, col_no, snip = _locate_line_in_text(raw_text, tr)
                        as4date = str(row.get("as4date") or row.get("AS4DATE") or "")
                        as4time = str(row.get("as4time") or row.get("AS4TIME") or "")
                        ts = row.get("timestamp") or _format_timestamp(as4date, as4time)
                        data.headers[tr] = E070Record(
                            trkorr=tr,
                            trfunction=str(row.get("trfunction") or row.get("TRFUNCTION") or "K").upper(),
                            trstatus=str(row.get("trstatus") or row.get("TRSTATUS") or "D").upper(),
                            as4user=row.get("as4user") or row.get("AS4USER"),
                            as4date=as4date or None,
                            as4time=as4time or None,
                            tarsystem=row.get("tarsystem") or row.get("TARSYSTEM"),
                            strkorr=row.get("strkorr") or row.get("STRKORR"),
                            timestamp=ts or None,
                            line_number=line_no,
                            column_number=col_no,
                            snippet=snip,
                        )

        # 2. E071 Object List
        raw_e071 = parsed.get("e071") or parsed.get("E071") or []
        if isinstance(raw_e071, list):
            for row in raw_e071:
                if isinstance(row, dict):
                    tr = str(row.get("trkorr") or row.get("TRKORR") or "").strip().upper()
                    obj = str(row.get("object") or row.get("OBJECT") or "").strip().upper()
                    obj_name = str(row.get("obj_name") or row.get("OBJ_NAME") or "").strip().upper()
                    if tr and obj_name:
                        line_no, col_no, snip = _locate_line_in_text(raw_text, obj_name)
                        rec = E071Record(
                            trkorr=tr,
                            pgmid=str(row.get("pgmid") or row.get("PGMID") or "R3TR").upper(),
                            object=obj or "OBJ",
                            obj_name=obj_name,
                            objfunc=str(row.get("objfunc") or row.get("OBJFUNC") or " "),
                            line_number=line_no,
                            column_number=col_no,
                            snippet=snip,
                        )
                        data.objects_by_tr[tr].append(rec)
                        if tr not in data.headers:
                            data.headers[tr] = E070Record(trkorr=tr, line_number=line_no, snippet=snip)

        # 3. E071K Table Keys
        raw_e071k = parsed.get("e071k") or parsed.get("E071K") or []
        if isinstance(raw_e071k, list):
            for row in raw_e071k:
                if isinstance(row, dict):
                    tr = str(row.get("trkorr") or row.get("TRKORR") or "").strip().upper()
                    tbl = str(row.get("tablename") or row.get("TABLENAME") or row.get("obj_name") or "").strip().upper()
                    if tr and tbl:
                        line_no, col_no, snip = _locate_line_in_text(raw_text, tbl)
                        key_rec = E071KRecord(
                            trkorr=tr,
                            pgmid=str(row.get("pgmid") or row.get("PGMID") or "R3TR").upper(),
                            object=str(row.get("object") or row.get("OBJECT") or "TABU").upper(),
                            obj_name=tbl,
                            tablename=tbl,
                            mastertype=row.get("mastertype") or row.get("MASTERTYPE"),
                            mastername=row.get("mastername") or row.get("MASTERNAME"),
                            tabkey=str(row.get("tabkey") or row.get("TABKEY") or "*"),
                            line_number=line_no,
                            column_number=col_no,
                            snippet=snip,
                        )
                        data.keys_by_tr[tr].append(key_rec)
                        if tr not in data.headers:
                            data.headers[tr] = E070Record(trkorr=tr, trfunction="W", line_number=line_no, snippet=snip)

        # 4. Call references / syntax dependencies
        raw_calls = parsed.get("call_references") or parsed.get("callReferences") or parsed.get("dependencies") or []
        if isinstance(raw_calls, list):
            for item in raw_calls:
                if isinstance(item, dict):
                    caller_obj = str(item.get("caller_object") or item.get("caller") or item.get("source") or "").strip().upper()
                    callee_obj = str(item.get("callee_object") or item.get("callee") or item.get("target") or "").strip().upper()
                    caller_tr = item.get("caller_tr") or item.get("source_tr") or item.get("trkorr")
                    callee_tr = item.get("callee_tr") or item.get("target_tr")
                    if caller_obj or caller_tr:
                        line_no, col_no, snip = _locate_line_in_text(raw_text, callee_obj or caller_obj)
                        ref = CallReference(
                            caller_tr=str(caller_tr).strip().upper() if caller_tr else None,
                            caller_object=caller_obj or "UNKNOWN_CALLER",
                            callee_tr=str(callee_tr).strip().upper() if callee_tr else None,
                            callee_object=callee_obj or "UNKNOWN_CALLEE",
                            reference_type=str(item.get("reference_type") or item.get("type") or "CALL_METHOD").upper(),
                            line_number=line_no,
                            column_number=col_no,
                            snippet=snip,
                        )
                        data.call_references.append(ref)

    def _parse_csv_content(self, csv_text: str, data: CTSNormalizedData) -> None:
        """Parses CSV content representing CTS E070, E071, or E071K table records."""
        lines = csv_text.splitlines()
        if not lines:
            return

        # Sniff delimiter
        first_line = lines[0]
        delimiter = ";" if ";" in first_line and first_line.count(";") > first_line.count(",") else ","

        reader = csv.reader(io.StringIO(csv_text), delimiter=delimiter)
        raw_rows = list(reader)
        if not raw_rows:
            return

        header = [c.strip().upper() for c in raw_rows[0]]
        has_header = any(h in header for h in ("TRKORR", "OBJECT", "OBJ_NAME", "TABLENAME", "TRFUNCTION"))

        start_idx = 1 if has_header else 0

        # Build column index mapping
        col_map: Dict[str, int] = {}
        if has_header:
            for idx, col in enumerate(header):
                col_map[col] = idx

        for line_idx, row in enumerate(raw_rows[start_idx:], start=start_idx + 1):
            if not row or not any(row):
                continue

            snip = delimiter.join(row).strip()

            # Helper getter
            def get_col(name: str, fallback_idx: int) -> str:
                if name in col_map and col_map[name] < len(row):
                    return row[col_map[name]].strip()
                if not has_header and fallback_idx < len(row):
                    return row[fallback_idx].strip()
                return ""

            tr = get_col("TRKORR", 0).upper()
            if not tr:
                continue

            # Determine row type
            record_type = get_col("RECORD_TYPE", 999).upper()
            if not record_type and row and row[0].strip().upper() in ("E070", "E071", "E071K"):
                record_type = row[0].strip().upper()

            obj_col = get_col("OBJECT", 1).upper()
            obj_name = get_col("OBJ_NAME", 2).strip()
            tbl_name = get_col("TABLENAME", 2).strip()

            tr_func = get_col("TRFUNCTION", 999).strip().upper()
            corr_flag = get_col("CORRFLAG", 999).strip().upper()
            has_tr_func_or_corr = bool(tr_func or corr_flag)
            if not has_header and len(row) >= 2 and row[1].strip().upper() in ("K", "W", "T", "C", "S", "M") and not bool(obj_name):
                has_tr_func_or_corr = True

            is_e070 = record_type == "E070" or (has_tr_func_or_corr and not bool(obj_name))
            is_e071k = record_type == "E071K" or obj_col == "TABU" or (bool(tbl_name) and not bool(obj_name))
            is_e071 = record_type == "E071" or bool(obj_name)

            if is_e070:
                # E070 Header row
                as4date = get_col("AS4DATE", 4)
                as4time = get_col("AS4TIME", 5)
                data.headers[tr] = E070Record(
                    trkorr=tr,
                    trfunction=tr_func or get_col("TRFUNCTION", 1).upper() or "K",
                    trstatus=get_col("TRSTATUS", 2).upper() or "D",
                    as4user=get_col("AS4USER", 3) or None,
                    as4date=as4date or None,
                    as4time=as4time or None,
                    timestamp=_format_timestamp(as4date, as4time),
                    line_number=line_idx,
                    snippet=snip,
                )
            elif is_e071k:
                # E071K Key row
                tbl = (tbl_name or obj_name).strip().upper()
                if tbl:
                    data.keys_by_tr[tr].append(
                        E071KRecord(
                            trkorr=tr,
                            object="TABU",
                            obj_name=tbl,
                            tablename=tbl,
                            tabkey=get_col("TABKEY", 3) or "*",
                            line_number=line_idx,
                            snippet=snip,
                        )
                    )
                    if tr not in data.headers:
                        as4date = get_col("AS4DATE", 999) or None
                        as4time = get_col("AS4TIME", 999) or None
                        data.headers[tr] = E070Record(
                            trkorr=tr,
                            trfunction=tr_func or "W",
                            trstatus=get_col("TRSTATUS", 999).upper() or "D",
                            as4user=get_col("AS4USER", 999) or None,
                            as4date=as4date,
                            as4time=as4time,
                            timestamp=_format_timestamp(as4date, as4time) if (as4date or as4time) else None,
                            line_number=line_idx,
                            snippet=snip,
                        )
                    else:
                        hdr = data.headers[tr]
                        row_status = get_col("TRSTATUS", 999).upper()
                        if row_status and hdr.trstatus == "D":
                            hdr.trstatus = row_status
                        row_user = get_col("AS4USER", 999)
                        if row_user and not hdr.as4user:
                            hdr.as4user = row_user
                        row_date = get_col("AS4DATE", 999)
                        row_time = get_col("AS4TIME", 999)
                        if row_date and not hdr.as4date:
                            hdr.as4date = row_date
                            hdr.as4time = row_time or None
                            hdr.timestamp = _format_timestamp(row_date, row_time)
            elif is_e071:
                # E071 Object row
                if not obj_name and len(row) > 1:
                    # Shorthand: TR, "CLAS ZCL_ORDER"
                    full_obj = row[1].strip()
                    pgmid, o_type, o_name = _normalize_obj_string(full_obj)
                else:
                    pgmid = get_col("PGMID", 999).upper() or "R3TR"
                    o_type = obj_col or "OBJ"
                    o_name = obj_name.strip().upper()

                if o_name:
                    data.objects_by_tr[tr].append(
                        E071Record(
                            trkorr=tr,
                            pgmid=pgmid,
                            object=o_type,
                            obj_name=o_name,
                            line_number=line_idx,
                            snippet=snip,
                        )
                    )
                    if tr not in data.headers:
                        as4date = get_col("AS4DATE", 999) or None
                        as4time = get_col("AS4TIME", 999) or None
                        data.headers[tr] = E070Record(
                            trkorr=tr,
                            trfunction=tr_func or "K",
                            trstatus=get_col("TRSTATUS", 999).upper() or "D",
                            as4user=get_col("AS4USER", 999) or None,
                            as4date=as4date,
                            as4time=as4time,
                            timestamp=_format_timestamp(as4date, as4time) if (as4date or as4time) else None,
                            line_number=line_idx,
                            snippet=snip,
                        )
                    else:
                        hdr = data.headers[tr]
                        row_status = get_col("TRSTATUS", 999).upper()
                        if row_status and hdr.trstatus == "D":
                            hdr.trstatus = row_status
                        row_user = get_col("AS4USER", 999)
                        if row_user and not hdr.as4user:
                            hdr.as4user = row_user
                        row_date = get_col("AS4DATE", 999)
                        row_time = get_col("AS4TIME", 999)
                        if row_date and not hdr.as4date:
                            hdr.as4date = row_date
                            hdr.as4time = row_time or None
                            hdr.timestamp = _format_timestamp(row_date, row_time)
            else:
                # Fallback shorthand row: TR, "CLAS ZCL_ORDER"
                if len(row) > 1 and row[1].strip():
                    full_obj = row[1].strip()
                    pgmid, o_type, o_name = _normalize_obj_string(full_obj)
                    if o_name:
                        data.objects_by_tr[tr].append(
                            E071Record(
                                trkorr=tr,
                                pgmid=pgmid,
                                object=o_type,
                                obj_name=o_name,
                                line_number=line_idx,
                                snippet=snip,
                            )
                        )
                        if tr not in data.headers:
                            data.headers[tr] = E070Record(trkorr=tr, line_number=line_idx, snippet=snip)

    def _parse_xml_content(self, xml_text: str, data: CTSNormalizedData) -> None:
        """Parses Defused XML containing CTS export records."""
        root = SafeXmlParser.parse_string(xml_text)

        # 1. E070 Headers
        for e070 in root.iter("E070"):
            for rec in e070.findall("RECORD"):
                tr = (rec.get("TRKORR") or rec.get("trkorr") or "").strip().upper()
                if tr:
                    line_no = int(rec.get("line_number", getattr(rec, "sourceline", 1)))
                    col_no = int(rec.get("column_number", getattr(rec, "sourcecolumn", 1)))
                    as4date = rec.get("AS4DATE") or rec.get("as4date")
                    as4time = rec.get("AS4TIME") or rec.get("as4time")
                    data.headers[tr] = E070Record(
                        trkorr=tr,
                        trfunction=(rec.get("TRFUNCTION") or rec.get("trfunction") or "K").upper(),
                        trstatus=(rec.get("TRSTATUS") or rec.get("trstatus") or "D").upper(),
                        as4user=rec.get("AS4USER") or rec.get("as4user"),
                        as4date=as4date,
                        as4time=as4time,
                        timestamp=_format_timestamp(as4date, as4time),
                        line_number=line_no,
                        column_number=col_no,
                        snippet=f'<RECORD TRKORR="{tr}"/>',
                    )

        # 2. E071 Objects
        for e071 in root.iter("E071"):
            for rec in e071.findall("RECORD"):
                tr = (rec.get("TRKORR") or rec.get("trkorr") or "").strip().upper()
                obj = (rec.get("OBJECT") or rec.get("object") or "OBJ").strip().upper()
                name = (rec.get("OBJ_NAME") or rec.get("obj_name") or "").strip().upper()
                if tr and name:
                    line_no = int(rec.get("line_number", getattr(rec, "sourceline", 1)))
                    col_no = int(rec.get("column_number", getattr(rec, "sourcecolumn", 1)))
                    data.objects_by_tr[tr].append(
                        E071Record(
                            trkorr=tr,
                            pgmid=(rec.get("PGMID") or rec.get("pgmid") or "R3TR").upper(),
                            object=obj,
                            obj_name=name,
                            line_number=line_no,
                            column_number=col_no,
                            snippet=f'<RECORD TRKORR="{tr}" OBJECT="{obj}" OBJ_NAME="{name}"/>',
                        )
                    )
                    if tr not in data.headers:
                        data.headers[tr] = E070Record(trkorr=tr, line_number=line_no)

        # 3. E071K Table Keys
        for e071k in root.iter("E071K"):
            for rec in e071k.findall("RECORD"):
                tr = (rec.get("TRKORR") or rec.get("trkorr") or "").strip().upper()
                tbl = (rec.get("TABLENAME") or rec.get("tablename") or rec.get("OBJ_NAME") or "").strip().upper()
                if tr and tbl:
                    line_no = int(rec.get("line_number", getattr(rec, "sourceline", 1)))
                    col_no = int(rec.get("column_number", getattr(rec, "sourcecolumn", 1)))
                    data.keys_by_tr[tr].append(
                        E071KRecord(
                            trkorr=tr,
                            tablename=tbl,
                            tabkey=rec.get("TABKEY") or rec.get("tabkey") or "*",
                            line_number=line_no,
                            column_number=col_no,
                            snippet=f'<RECORD TRKORR="{tr}" TABLENAME="{tbl}"/>',
                        )
                    )
                    if tr not in data.headers:
                        data.headers[tr] = E070Record(trkorr=tr, trfunction="W", line_number=line_no)

        # 4. Dependencies / Call references
        for dep_parent in root.iter("DEPENDENCIES"):
            for call in dep_parent.findall("CALL"):
                c_tr = (call.get("CALLER_TR") or call.get("caller_tr") or "").strip().upper()
                c_obj = (call.get("CALLER_OBJECT") or call.get("caller_object") or "").strip().upper()
                t_tr = (call.get("CALLEE_TR") or call.get("callee_tr") or "").strip().upper()
                t_obj = (call.get("CALLEE_OBJECT") or call.get("callee_object") or "").strip().upper()
                if c_obj or t_obj:
                    line_no = int(call.get("line_number", getattr(call, "sourceline", 1)))
                    data.call_references.append(
                        CallReference(
                            caller_tr=c_tr or None,
                            caller_object=c_obj or "UNKNOWN_CALLER",
                            callee_tr=t_tr or None,
                            callee_object=t_obj or "UNKNOWN_CALLEE",
                            reference_type=call.get("TYPE") or "CALL_METHOD",
                            line_number=line_no,
                        )
                    )

    # ==========================================================================
    # Pure Deterministic Evaluation Engine (Point 4: Pure Rule Evaluation)
    # ==========================================================================

    @classmethod
    def evaluate(
        cls,
        transport_objects: Union[Dict[str, List[str]], Dict[str, Any]],
        call_references: Optional[List[Dict[str, Any]]] = None,
        table_keys: Optional[List[Dict[str, Any]]] = None,
        planned_sequence: Optional[List[str]] = None,
        transport_metadata: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Direct deterministic evaluation helper matching E2E test harness expectations.

        Evaluates:
        1. Object collisions across concurrent transports (TR_OBJECT_COLLISION).
        2. Cross-transport call dependency & sequence inversion risks (TR_CALL_DEPENDENCY_SEQUENCE_RISK).
        3. Overtaker / downgrade risks (TR_OVERTAKER_DOWNGRADE_RISK).
        4. Customizing table entries ahead of structural table definitions (TR_CUSTOMIZING_AHEAD_OF_STRUCTURE).
        5. Topological import sequence calculation (recommendedImportSequence).
        """
        # Normalize input payload
        data = CTSNormalizedData()

        if planned_sequence:
            data.planned_sequence = [str(x).strip().upper() for x in planned_sequence]

        # 1. Ingest metadata headers if supplied
        if transport_metadata:
            for tr_id, meta in transport_metadata.items():
                clean_tr = str(tr_id).strip().upper()
                as4date = meta.get("as4date") or meta.get("AS4DATE")
                as4time = meta.get("as4time") or meta.get("AS4TIME")
                ts = meta.get("timestamp") or _format_timestamp(as4date, as4time)
                data.headers[clean_tr] = E070Record(
                    trkorr=clean_tr,
                    trfunction=str(meta.get("trfunction") or meta.get("TRFUNCTION") or "K").upper(),
                    trstatus=str(meta.get("trstatus") or meta.get("TRSTATUS") or "D").upper(),
                    as4user=meta.get("as4user") or meta.get("AS4USER"),
                    as4date=as4date,
                    as4time=as4time,
                    timestamp=ts or None,
                )

        # 2. Ingest transport objects
        if isinstance(transport_objects, dict):
            # Check if this is a dict containing {"transports": {...}} or CTS table keys
            if "transports" in transport_objects and isinstance(transport_objects["transports"], dict):
                cls_inst = cls()
                cls_inst._parse_json_content(transport_objects, data, "")
            elif any(k in transport_objects for k in ("e070", "e071", "e071k")):
                cls_inst = cls()
                cls_inst._parse_json_content(transport_objects, data, "")
            else:
                for tr_id, objs in transport_objects.items():
                    clean_tr = str(tr_id).strip().upper()
                    if clean_tr not in data.headers:
                        data.headers[clean_tr] = E070Record(trkorr=clean_tr)
                    if isinstance(objs, list):
                        for obj_item in objs:
                            obj_str = str(obj_item).strip()
                            pgmid, o_type, o_name = _normalize_obj_string(obj_str)
                            data.objects_by_tr[clean_tr].append(
                                E071Record(
                                    trkorr=clean_tr,
                                    pgmid=pgmid,
                                    object=o_type,
                                    obj_name=o_name,
                                )
                            )

        # 3. Ingest table keys if supplied
        if table_keys:
            for k in table_keys:
                tr = str(k.get("trkorr") or k.get("TRKORR") or "").strip().upper()
                tbl = str(k.get("tablename") or k.get("TABLENAME") or "").strip().upper()
                if tr and tbl:
                    data.keys_by_tr[tr].append(
                        E071KRecord(
                            trkorr=tr,
                            tablename=tbl,
                            tabkey=str(k.get("tabkey") or k.get("TABKEY") or "*"),
                        )
                    )
                    if tr not in data.headers:
                        data.headers[tr] = E070Record(trkorr=tr, trfunction="W")

        # 4. Ingest call references if supplied
        if call_references:
            for call in call_references:
                c_tr = call.get("caller_tr") or call.get("source_tr")
                c_obj = str(call.get("caller_object") or call.get("caller") or "").strip().upper()
                t_tr = call.get("callee_tr") or call.get("target_tr")
                t_obj = str(call.get("callee_object") or call.get("callee") or "").strip().upper()
                data.call_references.append(
                    CallReference(
                        caller_tr=str(c_tr).strip().upper() if c_tr else None,
                        caller_object=c_obj,
                        callee_tr=str(t_tr).strip().upper() if t_tr else None,
                        callee_object=t_obj,
                        reference_type=str(call.get("reference_type") or "CALL_METHOD").upper(),
                    )
                )

        # Execute pure deterministic rule logic
        return cls._run_deterministic_rules(data)

    @classmethod
    def _run_deterministic_rules(cls, data: CTSNormalizedData) -> Dict[str, Any]:
        """Pure evaluation algorithm detecting collisions, sequence inversions, downgrades, and import order."""
        findings: List[Dict[str, Any]] = []
        all_trs: Set[str] = data.all_transports()

        # Track prerequisites for topological ordering: prerequisite_edges[A] = set of B that must follow A (A -> B)
        # In other words, dependency A -> B means A must be imported BEFORE B.
        prereq_graph: Dict[str, Set[str]] = defaultdict(set)
        in_degree: Dict[str, int] = {tr: 0 for tr in all_trs}

        # Index: object_key -> Dict[tr, E071Record]
        object_to_tr_records: Dict[str, Dict[str, E071Record]] = defaultdict(dict)
        table_name_to_tr: Dict[str, str] = {}  # TABL name -> Workbench TR defining it

        for tr, rec_list in data.objects_by_tr.items():
            for rec in rec_list:
                key = rec.canonical_object_key
                # Prevent counting duplicate objects within same TR as collisions
                if tr not in object_to_tr_records[key]:
                    object_to_tr_records[key][tr] = rec
                if rec.object == "TABL":
                    table_name_to_tr[rec.obj_name] = tr

        # ----------------------------------------------------------------------
        # Rule 1: Object Collision Across Transports (TR_OBJECT_COLLISION)
        # ----------------------------------------------------------------------
        collisions: Dict[str, List[str]] = {}
        for obj_key, tr_map in sorted(object_to_tr_records.items()):
            tr_list = sorted(list(tr_map.keys()))
            if len(tr_list) > 1:
                collisions[obj_key] = tr_list
                findings.append({
                    "code": "TR_OBJECT_COLLISION",
                    "severity": "CRITICAL",
                    "object": obj_key,
                    "transports": tr_list,
                    "conflictingTransports": tr_list,
                    "title": f"Object Collision Across Concurrent Transports: {obj_key}",
                    "message": f"Repository object '{obj_key}' is modified in multiple concurrent transports: {', '.join(tr_list)}.",
                    "confidence": "VERIFIED",
                    "confidence_score": 1.0,
                    "remediation": (
                        f"Consolidate changes into a single transport request, or use SAP ChaRM / CSOL "
                        f"(Cross-System Object Locking) to serialize transport releases. Ensure changes from "
                        f"{', '.join(tr_list[:-1])} are merged before {tr_list[-1]} is imported."
                    ),
                    "technicalDetails": {
                        "object": obj_key,
                        "conflictingTransports": tr_list,
                        "collision_count": len(tr_list),
                    },
                })

        # ----------------------------------------------------------------------
        # Rule 2: Cross-Transport Call Dependency & Sequence Inversion (TR_CALL_DEPENDENCY_SEQUENCE_RISK)
        # ----------------------------------------------------------------------
        for ref in data.call_references:
            caller_tr = ref.caller_tr
            callee_tr = ref.callee_tr
            caller_obj = ref.caller_object
            callee_obj = ref.callee_object

            # Resolve caller TR if omitted by scanning objects
            if not caller_tr:
                for obj_k, tr_dict in object_to_tr_records.items():
                    if caller_obj in obj_k or obj_k.endswith(caller_obj):
                        caller_tr = sorted(list(tr_dict.keys()))[0]
                        break

            # Resolve callee TR if omitted by scanning objects
            if not callee_tr:
                for obj_k, tr_dict in object_to_tr_records.items():
                    if callee_obj in obj_k or obj_k.endswith(callee_obj):
                        callee_tr = sorted(list(tr_dict.keys()))[0]
                        break

            # Missing prerequisite check
            if not callee_tr and caller_tr:
                findings.append({
                    "code": "TR_CALL_DEPENDENCY_SEQUENCE_RISK",
                    "severity": "CRITICAL",
                    "object": caller_obj,
                    "title": f"Missing Prerequisite Transport for Object: {callee_obj}",
                    "message": (
                        f"Object '{caller_obj}' in transport {caller_tr} references '{callee_obj}', "
                        f"but no transport defining this object is included in the import queue."
                    ),
                    "confidence": "RULE_DERIVED",
                    "confidence_score": 0.85,
                    "remediation": f"Include the transport defining '{callee_obj}' into the STMS import queue.",
                    "technicalDetails": {
                        "caller_tr": caller_tr,
                        "caller_object": caller_obj,
                        "missing_object": callee_obj,
                    },
                })
                continue

            if caller_tr and callee_tr and caller_tr != callee_tr:
                # callee_tr MUST precede caller_tr (callee_tr -> caller_tr)
                if caller_tr not in prereq_graph[callee_tr]:
                    prereq_graph[callee_tr].add(caller_tr)
                    in_degree[caller_tr] = in_degree.get(caller_tr, 0) + 1

                # Check sequence inversion against user's planned sequence
                if data.planned_sequence and caller_tr in data.planned_sequence and callee_tr in data.planned_sequence:
                    idx_caller = data.planned_sequence.index(caller_tr)
                    idx_callee = data.planned_sequence.index(callee_tr)
                    if idx_caller < idx_callee:
                        findings.append({
                            "code": "TR_CALL_DEPENDENCY_SEQUENCE_RISK",
                            "severity": "CRITICAL",
                            "object": caller_obj,
                            "transports": [caller_tr, callee_tr],
                            "title": f"Cross-Transport Call Sequence Inversion: {caller_tr} ahead of {callee_tr}",
                            "message": (
                                f"Object '{caller_obj}' in transport {caller_tr} depends on '{callee_obj}' "
                                f"in transport {callee_tr}. Planned sequence imports {caller_tr} (pos {idx_caller + 1}) "
                                f"before prerequisite {callee_tr} (pos {idx_callee + 1}), causing runtime syntax errors (SYNTAX_ERROR)."
                            ),
                            "confidence": "RULE_DERIVED",
                            "confidence_score": 0.85,
                            "remediation": f"Re-order import queue: Import prerequisite {callee_tr} before {caller_tr}.",
                            "technicalDetails": {
                                "caller_tr": caller_tr,
                                "caller_object": caller_obj,
                                "callee_tr": callee_tr,
                                "callee_object": callee_obj,
                                "planned_sequence": data.planned_sequence,
                            },
                        })
                else:
                    # Generic cross-transport dependency finding when sequence not specified
                    findings.append({
                        "code": "TR_CALL_DEPENDENCY_SEQUENCE_RISK",
                        "severity": "CRITICAL",
                        "object": caller_obj,
                        "transports": [caller_tr, callee_tr],
                        "title": f"Cross-Transport Call Dependency: {caller_tr} -> {callee_tr}",
                        "message": (
                            f"Object '{caller_obj}' in transport {caller_tr} depends on '{callee_obj}' "
                            f"in transport {callee_tr}. {callee_tr} must precede {caller_tr}."
                        ),
                        "confidence": "RULE_DERIVED",
                        "confidence_score": 0.85,
                        "remediation": f"Enforce prerequisite sequencing: Import {callee_tr} before {caller_tr}.",
                        "technicalDetails": {
                            "caller_tr": caller_tr,
                            "caller_object": caller_obj,
                            "callee_tr": callee_tr,
                            "callee_object": callee_obj,
                        },
                    })

        # ----------------------------------------------------------------------
        # Rule 3: Overtaker / Downgrade Risk (TR_OVERTAKER_DOWNGRADE_RISK)
        # ----------------------------------------------------------------------
        for obj_key, tr_map in sorted(object_to_tr_records.items()):
            if len(tr_map) > 1:
                # Compare pairs of colliding transports for timestamp inversion
                tr_list = sorted(list(tr_map.keys()))
                for i in range(len(tr_list)):
                    for j in range(i + 1, len(tr_list)):
                        tr_a = tr_list[i]
                        tr_b = tr_list[j]
                        head_a = data.headers.get(tr_a)
                        head_b = data.headers.get(tr_b)

                        ts_a = head_a.timestamp if head_a else None
                        ts_b = head_b.timestamp if head_b else None

                        # If both timestamps exist and differ
                        if ts_a and ts_b and ts_a != ts_b:
                            older_tr, newer_tr = (tr_a, tr_b) if ts_a < ts_b else (tr_b, tr_a)
                            # Correct order: older_tr MUST be imported BEFORE newer_tr
                            if newer_tr not in prereq_graph[older_tr]:
                                prereq_graph[older_tr].add(newer_tr)
                                in_degree[newer_tr] = in_degree.get(newer_tr, 0) + 1

                            # If user planned to import newer_tr BEFORE older_tr -> DOWNGRADE RISK!
                            if data.planned_sequence and older_tr in data.planned_sequence and newer_tr in data.planned_sequence:
                                idx_older = data.planned_sequence.index(older_tr)
                                idx_newer = data.planned_sequence.index(newer_tr)
                                if idx_newer < idx_older:
                                    findings.append({
                                        "code": "TR_OVERTAKER_DOWNGRADE_RISK",
                                        "severity": "BLOCKER",
                                        "object": obj_key,
                                        "transports": [older_tr, newer_tr],
                                        "title": f"Overtaker Downgrade Risk on Object: {obj_key}",
                                        "message": (
                                            f"Transport {older_tr} contains an older version of '{obj_key}' than {newer_tr}, "
                                            f"but is scheduled to be imported AFTER {newer_tr} (pos {idx_older + 1} vs {idx_newer + 1}). "
                                            f"This sequence will overwrite newer changes with older code (software regression)."
                                        ),
                                        "confidence": "RULE_DERIVED",
                                        "confidence_score": 0.85,
                                        "remediation": (
                                            f"Halt import of {older_tr}. Re-base modifications onto the latest version from "
                                            f"{newer_tr}, re-test, and generate a new forward transport request."
                                        ),
                                        "technicalDetails": {
                                            "object": obj_key,
                                            "older_transport": older_tr,
                                            "newer_transport": newer_tr,
                                            "planned_sequence": data.planned_sequence,
                                        },
                                    })
                        elif data.planned_sequence and tr_a in data.planned_sequence and tr_b in data.planned_sequence:
                            # When timestamps are absent, sequential naming (e.g. DEVK900101 < DEVK900105)
                            # is evaluated if order is reversed
                            if tr_a < tr_b:
                                older_tr, newer_tr = tr_a, tr_b
                            else:
                                older_tr, newer_tr = tr_b, tr_a

                            idx_older = data.planned_sequence.index(older_tr)
                            idx_newer = data.planned_sequence.index(newer_tr)
                            if idx_newer < idx_older:
                                findings.append({
                                    "code": "TR_OVERTAKER_DOWNGRADE_RISK",
                                    "severity": "BLOCKER",
                                    "object": obj_key,
                                    "transports": [older_tr, newer_tr],
                                    "title": f"Overtaker Downgrade Risk on Object: {obj_key}",
                                    "message": (
                                        f"Transport {older_tr} (older sequence) is planned after {newer_tr} "
                                        f"(pos {idx_older + 1} vs {idx_newer + 1}) for object '{obj_key}', "
                                        f"risking software regression."
                                    ),
                                    "confidence": "RULE_DERIVED",
                                    "confidence_score": 0.85,
                                    "remediation": f"Ensure {older_tr} is imported before {newer_tr} or cancel {older_tr}.",
                                    "technicalDetails": {
                                        "object": obj_key,
                                        "older_transport": older_tr,
                                        "newer_transport": newer_tr,
                                    },
                                })

        # ----------------------------------------------------------------------
        # Rule 4: Customizing Ahead of Structure (TR_CUSTOMIZING_AHEAD_OF_STRUCTURE)
        # ----------------------------------------------------------------------
        for cust_tr, key_list in sorted(data.keys_by_tr.items()):
            for k_rec in key_list:
                tbl = k_rec.tablename
                wb_tr = table_name_to_tr.get(tbl)
                if wb_tr and wb_tr != cust_tr:
                    # wb_tr MUST precede cust_tr
                    if cust_tr not in prereq_graph[wb_tr]:
                        prereq_graph[wb_tr].add(cust_tr)
                        in_degree[cust_tr] = in_degree.get(cust_tr, 0) + 1

                    # Check against planned sequence
                    is_violation = False
                    if data.planned_sequence:
                        if wb_tr not in data.planned_sequence:
                            is_violation = True
                        elif cust_tr in data.planned_sequence:
                            idx_cust = data.planned_sequence.index(cust_tr)
                            idx_wb = data.planned_sequence.index(wb_tr)
                            if idx_cust < idx_wb:
                                is_violation = True

                    if is_violation or not data.planned_sequence:
                        findings.append({
                            "code": "TR_CUSTOMIZING_AHEAD_OF_STRUCTURE",
                            "severity": "BLOCKER",
                            "object": f"TABL {tbl}",
                            "transports": [cust_tr, wb_tr],
                            "title": f"Customizing Data Ahead of Table Structure: {tbl}",
                            "message": (
                                f"Customizing table keys for table '{tbl}' in transport {cust_tr} (E071K) are "
                                f"scheduled without or ahead of DDIC table definition in Workbench transport {wb_tr}. "
                                f"Importing table entries before the table exists in the target database will trigger "
                                f"import abort (RC=8/12)."
                            ),
                            "confidence": "VERIFIED",
                            "confidence_score": 1.0,
                            "remediation": (
                                f"Import Workbench transport {wb_tr} containing DDIC table '{tbl}' "
                                f"before importing Customizing transport {cust_tr}."
                            ),
                            "technicalDetails": {
                                "table": tbl,
                                "customizing_tr": cust_tr,
                                "workbench_tr": wb_tr,
                                "tabkey": k_rec.tabkey,
                            },
                        })

        # ----------------------------------------------------------------------
        # Rule 5: Topological Sequencing Engine (recommendedImportSequence)
        # ----------------------------------------------------------------------
        # Cycle Detection via 3-Color Recursive DFS
        visited: Dict[str, int] = {}  # 0=unvisited, 1=visiting, 2=visited
        cycle_detected: List[str] = []

        def dfs_cycle(u: str, path: List[str]) -> bool:
            visited[u] = 1
            for v in sorted(prereq_graph.get(u, set())):
                if visited.get(v, 0) == 1:
                    cycle_idx = path.index(v) if v in path else 0
                    cycle_detected.extend(path[cycle_idx:] + [v])
                    return True
                if visited.get(v, 0) == 0:
                    if dfs_cycle(v, path + [v]):
                        return True
            visited[u] = 2
            return False

        for node in sorted(all_trs):
            if visited.get(node, 0) == 0:
                if dfs_cycle(node, [node]):
                    break

        if cycle_detected:
            cycle_str = " -> ".join(cycle_detected)
            findings.append({
                "code": "TR_CIRCULAR_DEPENDENCY_DETECTED",
                "severity": "BLOCKER",
                "object": cycle_detected[0] if cycle_detected else "CIRCULAR_CTS",
                "transports": list(set(cycle_detected)),
                "title": f"Circular Transport Dependency Detected: {cycle_str}",
                "message": (
                    f"Circular dependency cycle detected between transports: {cycle_str}. "
                    f"Mutual dependencies prevent deterministic sequential import."
                ),
                "confidence": "VERIFIED",
                "confidence_score": 1.0,
                "remediation": "Merge circular transport requests into a single transport collection via STMS.",
                "technicalDetails": {
                    "cycle": cycle_detected,
                },
            })
            # Remove feedback edges to allow topological sort fallback
            for idx in range(len(cycle_detected) - 1):
                u = cycle_detected[idx]
                v = cycle_detected[idx + 1]
                if v in prereq_graph[u]:
                    prereq_graph[u].remove(v)
                    in_degree[v] = max(0, in_degree.get(v, 1) - 1)

        # Kahn's Algorithm with deterministic lexicographical tie-breaking
        ready_queue = deque(sorted([tr for tr in all_trs if in_degree.get(tr, 0) == 0]))
        recommended_seq: List[str] = []

        cur_in_degree = dict(in_degree)
        while ready_queue:
            curr = ready_queue.popleft()
            recommended_seq.append(curr)

            # Newly unlocked neighbors
            next_ready: List[str] = []
            for neighbor in sorted(prereq_graph.get(curr, set())):
                cur_in_degree[neighbor] -= 1
                if cur_in_degree[neighbor] == 0:
                    next_ready.append(neighbor)

            # Sort next ready nodes and merge into ready_queue to guarantee deterministic ordering
            for nr in sorted(next_ready):
                if nr not in ready_queue:
                    ready_queue.append(nr)
            ready_queue = deque(sorted(ready_queue))

        # Append any remaining disconnected or cycle nodes deterministically
        for tr in sorted(all_trs):
            if tr not in recommended_seq:
                recommended_seq.append(tr)

        total_objects = sum(len(objs) for objs in data.objects_by_tr.values())
        dep_risks = sum(1 for f in findings if f["code"] == "TR_CALL_DEPENDENCY_SEQUENCE_RISK")
        overtaker_risks = sum(1 for f in findings if f["code"] == "TR_OVERTAKER_DOWNGRADE_RISK")
        customizing_ahead = sum(1 for f in findings if f["code"] == "TR_CUSTOMIZING_AHEAD_OF_STRUCTURE")

        return {
            "status": "COMPLETED",
            "total_transports": len(all_trs),
            "total_objects": total_objects,
            "collisions_count": len(collisions),
            "dependency_risks_count": dep_risks,
            "overtaker_risks_count": overtaker_risks,
            "customizing_ahead_count": customizing_ahead,
            "recommended_import_sequence": recommended_seq,
            "recommendedImportSequence": recommended_seq,
            "findings": findings,
            "metrics": {
                "totalTransports": len(all_trs),
                "totalObjects": total_objects,
                "collisionsCount": len(collisions),
                "dependencyRisksCount": dep_risks,
                "overtakerRisksCount": overtaker_risks,
                "customizingAheadCount": customizing_ahead,
                "recommendedImportSequence": recommended_seq,
            },
        }

    # ==========================================================================
    # Asynchronous Platform Runner (Point 11 & Point 12: Telemetry & Serialization)
    # ==========================================================================

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Full asynchronous platform execution method."""
        start_time = time.perf_counter()

        data = self._parse_inputs(request)
        eval_result = self._run_deterministic_rules(data)

        findings: List[Finding] = []
        rules_evaluated = 5  # 5 deterministic core rules

        for raw_f in eval_result["findings"]:
            code = raw_f["code"]
            obj_name = raw_f.get("object", "UNKNOWN")
            conf_str = raw_f.get("confidence", "VERIFIED")

            # Determine coordinates and evidence snippet (None when the token cannot be located;
            # the confidence classifier then demotes the finding to UNKNOWN)
            line_no: Optional[int] = None
            col_no: Optional[int] = None
            snip = ""

            if data.raw_content:
                candidates: List[str] = [str(obj_name)]
                parts = str(obj_name).split()
                if len(parts) > 1:
                    candidates.append(parts[-1])
                candidates.extend(str(t) for t in (raw_f.get("transports") or []))
                for token in candidates:
                    line, c, s = _locate_line_in_text(data.raw_content, token)
                    if line is not None:
                        line_no, col_no, snip = line, c, s
                        break

            # Epistemic Confidence Mapping
            if conf_str == "VERIFIED":
                confidence = ConfidenceClass.VERIFIED
                trust_score = 1.0
            elif conf_str == "RULE_DERIVED":
                confidence = ConfidenceClass.RULE_DERIVED
                trust_score = 0.85
            elif conf_str == "INFERRED":
                confidence = ConfidenceClass.INFERRED
                trust_score = 0.60
            else:
                confidence = ConfidenceClass.UNKNOWN
                trust_score = 0.30

            ev = EvidenceEngine.create_evidence(
                artifact_path=data.artifact_path,
                content=snip or data.raw_content or code,
                line_number=line_no,
                column_number=col_no,
                snippet=snip or f"Transport finding: {code} on {obj_name}",
                provenance=confidence,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )

            # Severity Mapping
            sev_raw = raw_f.get("severity", "CRITICAL")
            if sev_raw == "BLOCKER":
                severity = Severity.BLOCKER
            elif sev_raw == "CRITICAL":
                severity = Severity.CRITICAL
            elif sev_raw == "MAJOR":
                severity = Severity.MAJOR
            elif sev_raw == "MINOR":
                severity = Severity.MINOR
            else:
                severity = Severity.INFO

            finding = Finding(
                rule_id=code,
                severity=severity,
                category="RELEASE_AND_TRANSPORT",
                title=raw_f.get("title", f"Transport Violation: {code}"),
                description=raw_f.get("message", f"Transport dependency violation on {obj_name}"),
                confidence=confidence,
                confidence_score=trust_score,
                remediation=raw_f.get("remediation", "Resolve transport sequence conflicts in STMS."),
                evidence=[ev],
                technical_details=raw_f.get("technicalDetails", raw_f),
                affected_objects=[obj_name] if obj_name else raw_f.get("transports", []),
            )

            classified = ConfidenceClassifier.classify(finding)
            findings.append(classified)

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
                    "total_transports": eval_result["total_transports"],
                    "total_objects": eval_result["total_objects"],
                    "collisions_count": eval_result["collisions_count"],
                    "dependency_risks_count": eval_result["dependency_risks_count"],
                    "overtaker_risks_count": eval_result["overtaker_risks_count"],
                    "customizing_ahead_count": eval_result["customizing_ahead_count"],
                    "recommended_import_sequence": eval_result["recommended_import_sequence"],
                    "recommendedImportSequence": eval_result["recommendedImportSequence"],
                    "engine": "transport_dependency_analyzer",
                },
            ),
        )
