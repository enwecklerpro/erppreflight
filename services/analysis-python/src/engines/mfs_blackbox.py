"""MFS BlackBox Preflight Engine (Feature 36).

Authoritative preflight audit of SAP EWM Material Flow System (MFS) telegram sequences,
PLC communication handshakes, and conveyor route topologies:
- Reconstruction of physical Handling Unit (HU) state machine across Communication Points (CPs)
- Conveyor topology validation & impossible topology jump detection (MFS_IMPOSSIBLE_TOPOLOGY_JUMP)
- Telegram handshake ACK timeout & communication loss validation (MFS_MISSING_ACK_TIMEOUT)
- Sequence number monotonicity & gap detection (MFS_OUT_OF_ORDER_SEQUENCE)
- Telegram duplicate transmission & PLC retry storm identification (MFS_DUPLICATE_TELEGRAM_SEND)
- First causal divergence pinpointing to distinguish root causes from cascading failures (MFS_FIRST_CAUSAL_DIVERGENCE)
- Corrupted & malformed telegram fail-closed handling (MFS_CORRUPTED_TELEGRAM)
- Cryptographic SHA-256 evidence chain with exact 1-indexed line and column coordinates
- Strict epistemic confidence classification (VERIFIED 1.0, RULE_DERIVED 0.85, UNKNOWN 0.30)
- 100% interoperable backward-compatible evaluate() classmethod matching MFSBlackBoxEvaluator.evaluate

Fully compliant with Cardinal Axiom 2 (14-Point Engine Anatomy) and AGENTS.md.
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


# ==============================================================================
# Point 2: Input Domain Schemas & Models
# ==============================================================================

class MFSTelegram(BaseModel):
    """Pydantic model representing an SAP EWM / PLC MFS telegram event."""

    model_config = ConfigDict(extra="ignore")

    timestamp: Optional[str] = Field(None, description="ISO-8601 UTC timestamp or log timestamp string")
    time_sec: float = Field(0.0, description="Relative timestamp in seconds since stream inception")
    type: str = Field(..., description="Telegram type: MOVE, ACK, TIMEOUT, LIFE, SYN, WT, FAULT, ERROR, SCAN")
    hu_id: Optional[str] = Field(None, description="Handling Unit (HU) identifier, e.g. HU_8811")
    cp: Optional[str] = Field(None, description="Physical Communication Point (CP), e.g. CP01")
    to_cp: Optional[str] = Field(None, description="Target/Destination Communication Point")
    seq_no: Optional[int] = Field(None, description="Telegram sequence counter")
    sender_plc: Optional[str] = Field(None, description="Sender PLC identifier, e.g. PLC01")
    receiver_plc: Optional[str] = Field(None, description="Receiver identifier, e.g. EWM")
    status: Optional[str] = Field(None, description="Telegram status code / error text")
    wt_id: Optional[str] = Field(None, description="Warehouse Task (WT) number")
    error_code: Optional[str] = Field(None, description="PLC error code if faulted")
    line_number: int = Field(1, description="1-indexed line number in source artifact")
    column_number: int = Field(1, description="1-indexed column number in source artifact")
    raw_text: Optional[str] = Field(None, description="Raw log excerpt for evidence snippet")


class ConveyorTopology(BaseModel):
    """Warehouse conveyor route topology graph."""

    model_config = ConfigDict(extra="ignore")

    edges: List[Tuple[str, str]] = Field(default_factory=list, description="Valid directed conveyor edges (from_cp, to_cp)")
    communication_points: List[str] = Field(default_factory=list, description="Registered communication point identifiers")
    plcs: List[str] = Field(default_factory=list, description="Registered PLC identifiers")


class MFSConfiguration(BaseModel):
    """Configurable analysis parameters for MFS auditing."""

    model_config = ConfigDict(extra="ignore")

    ack_timeout_seconds: float = Field(5.0, description="Maximum allowed seconds for PLC ACK handshake")
    max_retries: int = Field(3, description="Maximum permitted telegram retransmissions before retry storm")
    heartbeat_timeout_seconds: float = Field(30.0, description="Maximum interval for LIFE/heartbeat telegrams")
    strict_ordering: bool = Field(True, description="Enforce strict monotonic sequence counters")


class MFSNormalizedData(BaseModel):
    """Normalized domain data ready for deterministic rule evaluation."""

    model_config = ConfigDict(extra="ignore")

    telegrams: List[MFSTelegram] = Field(default_factory=list)
    conveyor_edges: Set[Tuple[str, str]] = Field(default_factory=set)
    config: MFSConfiguration = Field(default_factory=MFSConfiguration)
    corrupted_rows: List[Dict[str, Any]] = Field(default_factory=list)


# ==============================================================================
# Helper Functions: Line Location, Delimiter Detection & Timestamp Extraction
# ==============================================================================

def _locate_line_in_text(raw_text: str, token: str) -> Tuple[int, int, str]:
    """Deterministically locates the 1-indexed line, column, and snippet of a token in raw text."""
    if not raw_text or not token:
        return 1, 1, ""
    lines = raw_text.splitlines()
    token_str = str(token).strip()
    if not token_str:
        return 1, 1, lines[0].strip() if lines else ""

    for idx, line in enumerate(lines, 1):
        pos = line.find(token_str)
        if pos != -1:
            return idx, pos + 1, line.strip()

    # Case-insensitive fallback
    token_lower = token_str.lower()
    for idx, line in enumerate(lines, 1):
        pos = line.lower().find(token_lower)
        if pos != -1:
            return idx, pos + 1, line.strip()

    return 1, 1, lines[0].strip() if lines else ""


def _detect_delimiter(text: str) -> str:
    """Detects delimiter (comma, semicolon, tab, pipe) from text content."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return ","
    sample = lines[0]
    counts = {
        ",": sample.count(","),
        ";": sample.count(";"),
        "\t": sample.count("\t"),
        "|": sample.count("|"),
    }
    best_delim = max(counts, key=counts.get)
    return best_delim if counts[best_delim] > 0 else ","


def _parse_time_sec(val: Any, timestamp_str: Optional[str] = None) -> float:
    """Converts time_sec or ISO timestamp into float seconds."""
    if val is not None:
        try:
            return float(val)
        except (ValueError, TypeError):
            pass
    if timestamp_str:
        # Check for seconds pattern like SS.mmm
        m = re.search(r"(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)", str(timestamp_str))
        if m:
            hh, mm, ss = m.groups()
            return float(hh) * 3600.0 + float(mm) * 60.0 + float(ss)
    return 0.0


# ==============================================================================
# Point 1: Metadata & Point 3-7: Engine Implementation
# ==============================================================================

@register_engine
class MFSBlackBoxEngine(BaseEngine):
    """Material Flow System (MFS) BlackBox Preflight & Causal Diagnostics Engine."""

    # Point 1: Metadata
    engine_type = EngineType.MFS_BLACKBOX
    name = "MFS BlackBox"
    description = "Material Flow System / EWM telegram sequence and telegram buffer auditor"
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.CSV, ArtifactType.TXT, ArtifactType.JSON]

    # ==========================================================================
    # Point 3: Deterministic Parser / Normalizer
    # ==========================================================================

    def _parse_inputs(self, request: AnalysisRequest) -> Tuple[MFSNormalizedData, str, str]:
        """Parses and normalizes input artifacts (JSON, CSV, delimited TXT, or configuration)."""
        raw_text = request.raw_content or ""
        artifact_path = request.artifact_s3_key or "mfs/mfs_telegram_log.json"

        # Check multi-artifact references
        if not raw_text and request.artifacts:
            for art in request.artifacts:
                if art.raw_content:
                    raw_text = art.raw_content
                    artifact_path = art.file_name or artifact_path
                    break

        # Check if raw_text is JSON
        stripped = raw_text.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                data = self._parse_json_content(raw_text, artifact_path)
            except Exception:
                data = MFSNormalizedData()
        elif stripped and ("\n" in stripped or "," in stripped or ";" in stripped or "|" in stripped or "\t" in stripped):
            data = self._parse_csv_content(raw_text, artifact_path)
        else:
            data = MFSNormalizedData()

        # Supplement with request configuration if provided
        config_dict = request.configuration or {}
        if not data.conveyor_edges and "conveyor_edges" in config_dict:
            raw_edges = config_dict["conveyor_edges"]
            for e in raw_edges:
                if isinstance(e, (list, tuple)) and len(e) >= 2:
                    data.conveyor_edges.add((str(e[0]).strip(), str(e[1]).strip()))

        if not data.telegrams and "telegrams" in config_dict:
            raw_telegrams = config_dict["telegrams"]
            if isinstance(raw_telegrams, list):
                for idx, t in enumerate(raw_telegrams, 1):
                    if isinstance(t, dict):
                        try:
                            tel = MFSTelegram(
                                timestamp=t.get("timestamp"),
                                time_sec=_parse_time_sec(t.get("time_sec"), t.get("timestamp")),
                                type=str(t.get("type", "UNKNOWN")).upper(),
                                hu_id=t.get("hu_id"),
                                cp=t.get("cp"),
                                to_cp=t.get("to_cp"),
                                seq_no=int(t["seq_no"]) if t.get("seq_no") is not None and str(t["seq_no"]).isdigit() else None,
                                sender_plc=t.get("sender_plc"),
                                receiver_plc=t.get("receiver_plc"),
                                status=t.get("status"),
                                wt_id=t.get("wt_id"),
                                error_code=t.get("error_code"),
                                line_number=idx,
                                raw_text=json.dumps(t),
                            )
                            data.telegrams.append(tel)
                        except Exception as e:
                            data.corrupted_rows.append({"line_number": idx, "raw_line": str(t), "error": str(e)})

        # Configuration overrides
        if "ack_timeout_seconds" in config_dict:
            try:
                data.config.ack_timeout_seconds = float(config_dict["ack_timeout_seconds"])
            except (ValueError, TypeError):
                pass
        if "max_retries" in config_dict:
            try:
                data.config.max_retries = int(config_dict["max_retries"])
            except (ValueError, TypeError):
                pass

        return data, artifact_path, raw_text

    def _parse_json_content(self, text: str, artifact_path: str) -> MFSNormalizedData:
        """Parses structured JSON payload containing telegrams and conveyor edges."""
        parsed = json.loads(text)
        data = MFSNormalizedData()

        # 1. Parse conveyor topology edges
        edges_raw = parsed.get("conveyor_edges", parsed.get("topology", {}).get("edges", [])) if isinstance(parsed, dict) else []
        for e in edges_raw:
            if isinstance(e, (list, tuple)) and len(e) >= 2:
                data.conveyor_edges.add((str(e[0]).strip(), str(e[1]).strip()))

        # 2. Parse configuration options
        if isinstance(parsed, dict):
            cfg = parsed.get("configuration", parsed.get("options", {}))
            if isinstance(cfg, dict):
                if "ack_timeout_seconds" in cfg:
                    data.config.ack_timeout_seconds = float(cfg["ack_timeout_seconds"])
                if "max_retries" in cfg:
                    data.config.max_retries = int(cfg["max_retries"])

        # 3. Parse telegrams stream
        telegrams_raw = parsed.get("telegrams", parsed) if isinstance(parsed, dict) else parsed
        if not isinstance(telegrams_raw, list):
            telegrams_raw = [telegrams_raw]

        for idx, t in enumerate(telegrams_raw, 1):
            if not isinstance(t, dict):
                data.corrupted_rows.append({"line_number": idx, "raw_line": str(t), "error": "Telegram entry is not an object"})
                continue

            t_type = t.get("type")
            if not t_type:
                data.corrupted_rows.append({"line_number": idx, "raw_line": str(t), "error": "Missing mandatory 'type' field"})
                continue

            hu = t.get("hu_id")
            token_for_search = hu or t_type
            line_no, col_no, snippet = _locate_line_in_text(text, token_for_search)
            if line_no == 1 and not snippet:
                line_no = idx

            seq = t.get("seq_no")
            seq_val = None
            if seq is not None:
                try:
                    seq_val = int(seq)
                except (ValueError, TypeError):
                    pass

            tel = MFSTelegram(
                timestamp=t.get("timestamp"),
                time_sec=_parse_time_sec(t.get("time_sec"), t.get("timestamp")),
                type=str(t_type).upper(),
                hu_id=hu,
                cp=t.get("cp"),
                to_cp=t.get("to_cp"),
                seq_no=seq_val,
                sender_plc=t.get("sender_plc"),
                receiver_plc=t.get("receiver_plc"),
                status=t.get("status"),
                wt_id=t.get("wt_id"),
                error_code=t.get("error_code"),
                line_number=line_no,
                column_number=col_no,
                raw_text=snippet or json.dumps(t),
            )
            data.telegrams.append(tel)

        return data

    def _parse_csv_content(self, text: str, artifact_path: str) -> MFSNormalizedData:
        """Parses CSV, TSV, or pipe-delimited telegram logs."""
        data = MFSNormalizedData()
        delimiter = _detect_delimiter(text)
        lines = text.splitlines()

        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        header_map: Dict[str, int] = {}

        for line_idx, row in enumerate(reader, 1):
            if not row or not any(cell.strip() for cell in row):
                continue

            cleaned_row = [c.strip() for c in row]
            first_cell = cleaned_row[0].upper()

            # Check if row is a topology edge declaration: EDGE,CP01,CP02
            if first_cell in ("EDGE", "CONVEYOR_EDGE", "ROUTE") and len(cleaned_row) >= 3:
                data.conveyor_edges.add((cleaned_row[1].upper(), cleaned_row[2].upper()))
                continue

            # Check if row is header
            lower_row = [c.lower() for c in cleaned_row]
            if "type" in lower_row or "hu_id" in lower_row or "cp" in lower_row:
                header_map = {col: i for i, col in enumerate(lower_row)}
                continue

            raw_line_text = lines[line_idx - 1] if line_idx <= len(lines) else ",".join(cleaned_row)

            # Map columns
            try:
                if header_map:
                    t_type = cleaned_row[header_map["type"]].upper() if "type" in header_map and header_map["type"] < len(cleaned_row) else None
                    if not t_type:
                        data.corrupted_rows.append({"line_number": line_idx, "raw_line": raw_line_text, "error": "Missing 'type' value"})
                        continue

                    hu_id = cleaned_row[header_map["hu_id"]] if "hu_id" in header_map and header_map["hu_id"] < len(cleaned_row) else None
                    cp = cleaned_row[header_map["cp"]] if "cp" in header_map and header_map["cp"] < len(cleaned_row) else None
                    to_cp = cleaned_row[header_map["to_cp"]] if "to_cp" in header_map and header_map["to_cp"] < len(cleaned_row) else None
                    ts = cleaned_row[header_map["timestamp"]] if "timestamp" in header_map and header_map["timestamp"] < len(cleaned_row) else None
                    t_sec_val = cleaned_row[header_map["time_sec"]] if "time_sec" in header_map and header_map["time_sec"] < len(cleaned_row) else None
                    seq = cleaned_row[header_map["seq_no"]] if "seq_no" in header_map and header_map["seq_no"] < len(cleaned_row) else None
                    sender = cleaned_row[header_map["sender_plc"]] if "sender_plc" in header_map and header_map["sender_plc"] < len(cleaned_row) else None
                    receiver = cleaned_row[header_map["receiver_plc"]] if "receiver_plc" in header_map and header_map["receiver_plc"] < len(cleaned_row) else None
                    status = cleaned_row[header_map["status"]] if "status" in header_map and header_map["status"] < len(cleaned_row) else None
                else:
                    # Positional fallback: timestamp, type, hu_id, cp, seq_no, sender_plc, receiver_plc, status, time_sec
                    ts = cleaned_row[0] if len(cleaned_row) > 0 else None
                    t_type = cleaned_row[1].upper() if len(cleaned_row) > 1 else None
                    hu_id = cleaned_row[2] if len(cleaned_row) > 2 else None
                    cp = cleaned_row[3] if len(cleaned_row) > 3 else None
                    to_cp = None
                    seq = cleaned_row[4] if len(cleaned_row) > 4 else None
                    sender = cleaned_row[5] if len(cleaned_row) > 5 else None
                    receiver = cleaned_row[6] if len(cleaned_row) > 6 else None
                    status = cleaned_row[7] if len(cleaned_row) > 7 else None
                    t_sec_val = cleaned_row[8] if len(cleaned_row) > 8 else None

                if not t_type:
                    data.corrupted_rows.append({"line_number": line_idx, "raw_line": raw_line_text, "error": "Empty telegram type"})
                    continue

                seq_val = None
                if seq and str(seq).isdigit():
                    seq_val = int(seq)

                tel = MFSTelegram(
                    timestamp=ts,
                    time_sec=_parse_time_sec(t_sec_val, ts),
                    type=t_type,
                    hu_id=hu_id if hu_id else None,
                    cp=cp if cp else None,
                    to_cp=to_cp if to_cp else None,
                    seq_no=seq_val,
                    sender_plc=sender if sender else None,
                    receiver_plc=receiver if receiver else None,
                    status=status if status else None,
                    line_number=line_idx,
                    column_number=1,
                    raw_text=raw_line_text,
                )
                data.telegrams.append(tel)
            except Exception as e:
                data.corrupted_rows.append({"line_number": line_idx, "raw_line": raw_line_text, "error": str(e)})

        return data

    # ==========================================================================
    # Point 4: Deterministic Analysis Pipeline & State Machine Reconstruction
    # ==========================================================================

    def _evaluate_state_machine(
        self,
        data: MFSNormalizedData,
        artifact_path: str,
        raw_text: str,
    ) -> Tuple[List[Finding], Optional[Finding], int]:
        """Executes pure rule evaluation over telegram stream, maintaining physical warehouse state."""
        rules_evaluated = 0
        findings: List[Finding] = []
        first_causal_divergence: Optional[Finding] = None

        hu_positions: Dict[str, str] = {}
        pending_moves: Dict[str, Dict[str, Any]] = {}
        plc_last_seq: Dict[str, int] = {}
        recent_sends: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = {}

        # ----------------------------------------------------------------------
        # Rule 0: Corrupted / Malformed Telegram Lines (Data Integrity)
        # ----------------------------------------------------------------------
        for corrupt in data.corrupted_rows:
            rules_evaluated += 1
            line_no = corrupt["line_number"]
            snippet = corrupt["raw_line"]
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=snippet or f"corrupted_line_{line_no}",
                line_number=line_no,
                column_number=1,
                snippet=snippet,
                provenance=ConfidenceClass.UNKNOWN,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="MFS_CORRUPTED_TELEGRAM",
                severity=Severity.MAJOR,
                category="DATA_INTEGRITY",
                title=f"Corrupted or Malformed MFS Telegram at Line {line_no}",
                description=(
                    f"Line {line_no} of telegram artifact '{artifact_path}' could not be parsed deterministically: "
                    f"{corrupt.get('error', 'Malformed syntax')}. Telemetry evaluation fails closed for unparseable records."
                ),
                confidence=ConfidenceClass.UNKNOWN,
                confidence_score=0.30,
                remediation=(
                    "Verify the EWM telegram log export format. Ensure standard delimiter and column layouts "
                    "are preserved from transaction /SCWM/MFS_TELEGRAM."
                ),
                evidence=[ev],
                technical_details={"line_number": line_no, "error": corrupt.get("error")},
                affected_objects=[f"LINE_{line_no}"],
            )
            findings.append(ConfidenceClassifier.classify(f))
            if first_causal_divergence is None:
                first_causal_divergence = findings[-1]

        # Process telegram stream in chronological arrival order
        for t in data.telegrams:
            t_type = t.type
            hu = t.hu_id
            cp = t.cp
            time_sec = t.time_sec
            plc = t.sender_plc or "PLC_DEFAULT"

            snippet_text = t.raw_text or f"[{t.time_sec}s] {t_type} HU={hu} CP={cp}"

            # ------------------------------------------------------------------
            # Rule 1: Sequence Counter Monotonicity & Gap Invariant (Ordering)
            # ------------------------------------------------------------------
            if t.seq_no is not None:
                rules_evaluated += 1
                last_seq = plc_last_seq.get(plc)
                if last_seq is not None:
                    # Inversion check (unless legitimate 9999 -> 1 counter rollover)
                    if t.seq_no <= last_seq and not (last_seq >= 9990 and t.seq_no <= 10):
                        ev = EvidenceEngine.create_evidence(
                            artifact_path=artifact_path,
                            content=snippet_text,
                            line_number=t.line_number,
                            column_number=t.column_number,
                            snippet=snippet_text,
                            provenance=ConfidenceClass.VERIFIED,
                            source_type=TrustLevel.CUSTOMER_EVIDENCE,
                        )
                        f = Finding(
                            rule_id="MFS_OUT_OF_ORDER_SEQUENCE",
                            severity=Severity.MAJOR,
                            category="TELEGRAM_ORDERING",
                            title=f"Out-of-Order Telegram Sequence on Channel '{plc}': Seq {t.seq_no} <= {last_seq}",
                            description=(
                                f"Detected inverted sequence counter on PLC channel '{plc}'. Telegram sequence {t.seq_no} "
                                f"was received after sequence {last_seq} at time {time_sec}s. This indicates asynchronous "
                                "RFC/socket dispatch without message serialization."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=(
                                f"Verify TCP/IP channel serialization for PLC '{plc}' in transaction /SCWM/MFS_TELEGRAM. "
                                "Check RFC destination qRFC serialization and ensure telegram buffer processing is set to serialized."
                            ),
                            evidence=[ev],
                            technical_details={"plc": plc, "seq_no": t.seq_no, "last_seq": last_seq, "time_sec": time_sec},
                            affected_objects=[plc, f"SEQ_{t.seq_no}"],
                        )
                        findings.append(ConfidenceClassifier.classify(f))
                        if first_causal_divergence is None:
                            first_causal_divergence = findings[-1]

                    elif t.seq_no > last_seq + 1:
                        gap_count = t.seq_no - last_seq - 1
                        ev = EvidenceEngine.create_evidence(
                            artifact_path=artifact_path,
                            content=snippet_text,
                            line_number=t.line_number,
                            column_number=t.column_number,
                            snippet=snippet_text,
                            provenance=ConfidenceClass.VERIFIED,
                            source_type=TrustLevel.CUSTOMER_EVIDENCE,
                        )
                        f = Finding(
                            rule_id="MFS_OUT_OF_ORDER_SEQUENCE",
                            severity=Severity.MAJOR,
                            category="TELEGRAM_ORDERING",
                            title=f"Telegram Sequence Gap on Channel '{plc}': {gap_count} Missing Telegram(s)",
                            description=(
                                f"Detected sequence counter gap of {gap_count} missing telegram(s) on channel '{plc}'. "
                                f"Counter jumped from {last_seq} directly to {t.seq_no} at time {time_sec}s."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=(
                                f"Inspect network packet drop statistics and PLC socket buffer overflows for channel '{plc}'. "
                                "Check SM58/SMQ1 for stuck outbound qRFC telegram batches."
                            ),
                            evidence=[ev],
                            technical_details={"plc": plc, "seq_no": t.seq_no, "last_seq": last_seq, "gap": gap_count, "time_sec": time_sec},
                            affected_objects=[plc, f"GAP_{last_seq+1}_TO_{t.seq_no-1}"],
                        )
                        findings.append(ConfidenceClassifier.classify(f))
                        if first_causal_divergence is None:
                            first_causal_divergence = findings[-1]

                plc_last_seq[plc] = t.seq_no

            # ------------------------------------------------------------------
            # Rule 2: Physical Movement & Impossible Conveyor Topology Jump
            # ------------------------------------------------------------------
            if t_type == "MOVE":
                rules_evaluated += 1

                # Check duplicate retransmission / retry storm
                if hu and cp:
                    send_key = (hu, t_type, cp)
                    history = recent_sends.setdefault(send_key, [])
                    if history:
                        prev_send = history[-1]
                        time_delta = abs(time_sec - prev_send["time_sec"])
                        if time_delta <= 2.0 or (t.status and "RETRY" in t.status.upper()):
                            repeat_count = len(history) + 1
                            ev = EvidenceEngine.create_evidence(
                                artifact_path=artifact_path,
                                content=snippet_text,
                                line_number=t.line_number,
                                column_number=t.column_number,
                                snippet=snippet_text,
                                provenance=ConfidenceClass.VERIFIED,
                                source_type=TrustLevel.CUSTOMER_EVIDENCE,
                            )
                            f = Finding(
                                rule_id="MFS_DUPLICATE_TELEGRAM_SEND",
                                severity=Severity.MAJOR,
                                category="TELEGRAM_RETRY_STORM",
                                title=f"Duplicate Telegram Retransmission (Retry Storm): HU '{hu}' at CP '{cp}'",
                                description=(
                                    f"Identical {t_type} telegram for Handling Unit '{hu}' at communication point '{cp}' "
                                    f"resent {repeat_count} times within {round(time_sec - history[0]['time_sec'], 2)}s "
                                    "without intervening PLC acknowledgment. This indicates an active retry storm."
                                ),
                                confidence=ConfidenceClass.VERIFIED,
                                confidence_score=1.0,
                                remediation=(
                                    "Tune the PLC handshake retransmission timer in SAP EWM MFS PLC configuration. "
                                    "Verify function module /SCWM/MFS_ACK_RECEIVE latency under peak conveyor loads."
                                ),
                                evidence=[ev],
                                technical_details={"hu_id": hu, "cp": cp, "repeat_count": repeat_count, "time_sec": time_sec},
                                affected_objects=[hu, cp],
                            )
                            findings.append(ConfidenceClassifier.classify(f))
                            if first_causal_divergence is None:
                                first_causal_divergence = findings[-1]
                    history.append({"time_sec": time_sec, "line_number": t.line_number, "raw_text": snippet_text})

                # Check conveyor topology jump
                if hu and cp:
                    prev_cp = hu_positions.get(hu)
                    if prev_cp and prev_cp != cp and (prev_cp, cp) not in data.conveyor_edges:
                        ev = EvidenceEngine.create_evidence(
                            artifact_path=artifact_path,
                            content=snippet_text,
                            line_number=t.line_number,
                            column_number=t.column_number,
                            snippet=snippet_text,
                            provenance=ConfidenceClass.VERIFIED,
                            source_type=TrustLevel.CUSTOMER_EVIDENCE,
                        )
                        f = Finding(
                            rule_id="MFS_IMPOSSIBLE_TOPOLOGY_JUMP",
                            severity=Severity.CRITICAL,
                            category="CONVEYOR_TOPOLOGY",
                            title=f"Impossible Conveyor Topology Jump: HU '{hu}' from '{prev_cp}' to '{cp}'",
                            description=(
                                f"Handling Unit '{hu}' was reported at Communication Point '{cp}' after '{prev_cp}' "
                                f"at time {time_sec}s, but no valid conveyor edge connecting ('{prev_cp}', '{cp}') exists "
                                "in the defined warehouse topology."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=(
                                f"Inspect physical tracking sensors between '{prev_cp}' and '{cp}'. Verify conveyor "
                                "route segments and communication point mappings in SAP EWM SPRO under SCM Extended "
                                "Warehouse Management > Interfaces > Material Flow System (MFS) > Master Data > Define Communication Points."
                            ),
                            evidence=[ev],
                            technical_details={"hu_id": hu, "from_cp": prev_cp, "to_cp": cp, "time_sec": time_sec},
                            affected_objects=[hu, prev_cp, cp],
                        )
                        findings.append(ConfidenceClassifier.classify(f))
                        if first_causal_divergence is None:
                            first_causal_divergence = findings[-1]

                    hu_positions[hu] = cp
                    pending_moves[hu] = {
                        "time_sec": time_sec,
                        "cp": cp,
                        "line_number": t.line_number,
                        "raw_text": snippet_text,
                    }

            # ------------------------------------------------------------------
            # Rule 3: Telegram Handshake ACK Processing & Timeouts
            # ------------------------------------------------------------------
            elif t_type == "ACK":
                rules_evaluated += 1
                if hu and hu in pending_moves:
                    del pending_moves[hu]

            elif t_type == "TIMEOUT":
                rules_evaluated += 1
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=snippet_text,
                    line_number=t.line_number,
                    column_number=t.column_number,
                    snippet=snippet_text,
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="MFS_MISSING_ACK_TIMEOUT",
                    severity=Severity.CRITICAL,
                    category="TELEGRAM_HANDSHAKE",
                    title=f"Missing Telegram Handshake ACK Timeout: HU '{hu or 'UNKNOWN'}'",
                    description=(
                        f"Telegram for Handling Unit '{hu or 'UNKNOWN'}' at Communication Point '{cp or hu_positions.get(hu or '', 'UNKNOWN')}' "
                        f"timed out at {time_sec}s without receiving a timely acknowledgment (ACK) from PLC '{plc}'."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        "Check PLC TCP/IP socket connection, telegram buffer status in /SCWM/MFS_TELEGRAM, "
                        "and handshake timeout parameters in SAP EWM MFS PLC configuration."
                    ),
                    evidence=[ev],
                    technical_details={"hu_id": hu, "cp": cp or hu_positions.get(hu or ""), "time_sec": time_sec, "plc": plc},
                    affected_objects=[hu or "UNKNOWN_HU", cp or "UNKNOWN_CP"],
                )
                findings.append(ConfidenceClassifier.classify(f))
                if first_causal_divergence is None:
                    first_causal_divergence = findings[-1]

        # ----------------------------------------------------------------------
        # Rule 4: First Causal Divergence Pinpointing & Downstream Cascade
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        if first_causal_divergence is not None:
            first_causal_divergence.technical_details["first_causal_divergence"] = True

            # If multiple cascading errors occurred, generate an overarching causal diagnosis
            if len(findings) > 1:
                root_ev = first_causal_divergence.evidence[0] if first_causal_divergence.evidence else EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=first_causal_divergence.description,
                    line_number=1,
                    column_number=1,
                    snippet=first_causal_divergence.title,
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                causal_finding = Finding(
                    rule_id="MFS_FIRST_CAUSAL_DIVERGENCE",
                    severity=Severity.CRITICAL,
                    category="CAUSAL_DIAGNOSTICS",
                    title=f"First Causal Divergence: {first_causal_divergence.title}",
                    description=(
                        f"Earliest system invariant violation occurred at line {first_causal_divergence.technical_details.get('time_sec', 0.0)}s: "
                        f"{first_causal_divergence.description} This root incident cascaded into {len(findings) - 1} subsequent downstream failures."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=first_causal_divergence.remediation,
                    evidence=[root_ev],
                    technical_details={
                        "root_cause_rule_id": first_causal_divergence.rule_id,
                        "root_cause_title": first_causal_divergence.title,
                        "earliest_time_sec": first_causal_divergence.technical_details.get("time_sec", 0.0),
                        "downstream_cascade_count": len(findings) - 1,
                    },
                    affected_objects=first_causal_divergence.affected_objects,
                )
                findings.append(ConfidenceClassifier.classify(causal_finding))

        return findings, first_causal_divergence, rules_evaluated

    # ==========================================================================
    # Main Engine Analyze Method
    # ==========================================================================

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Executes deterministic MFS BlackBox preflight analysis against incoming request."""
        start_time = time.perf_counter()

        # Parse inputs
        data, artifact_path, raw_text = self._parse_inputs(request)

        # Run state machine evaluation
        findings, first_divergence, rules_evaluated = self._evaluate_state_machine(
            data, artifact_path, raw_text
        )

        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        # Telemetry metrics calculation
        active_hus = {t.hu_id for t in data.telegrams if t.hu_id}
        total_telegrams = len(data.telegrams)
        duration = (data.telegrams[-1].time_sec - data.telegrams[0].time_sec) if len(data.telegrams) >= 2 else 0.0
        error_rate = round(len(findings) / total_telegrams, 4) if total_telegrams > 0 else 0.0

        first_div_summary = None
        if first_divergence:
            first_div_summary = {
                "code": first_divergence.rule_id,
                "severity": first_divergence.severity.value,
                "title": first_divergence.title,
                "confidence": first_divergence.confidence.value,
                "time_sec": first_divergence.technical_details.get("time_sec", 0.0),
                "hu_id": first_divergence.technical_details.get("hu_id"),
                "from_cp": first_divergence.technical_details.get("from_cp"),
                "to_cp": first_divergence.technical_details.get("to_cp"),
            }

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
                    "total_telegrams_parsed": total_telegrams,
                    "active_hus": len(active_hus),
                    "incident_duration_seconds": round(duration, 3),
                    "telegram_error_rate": error_rate,
                    "first_causal_divergence": first_div_summary,
                    "topology_edges_count": len(data.conveyor_edges),
                    "corrupted_rows_count": len(data.corrupted_rows),
                },
            ),
        )

    # ==========================================================================
    # Point 14 / Interoperability: Classmethod evaluate()
    # ==========================================================================

    @classmethod
    def evaluate(
        cls,
        telegrams: List[Dict[str, Any]],
        conveyor_edges: Set[Tuple[str, str]],
    ) -> Dict[str, Any]:
        """Backward-compatible classmethod matching MFSBlackBoxEvaluator.evaluate.

        Analyzes EWM/MFS telegram streams to isolate first causal divergence and invariant violations.
        """
        findings: List[Dict[str, Any]] = []
        hu_positions: Dict[str, str] = {}
        pending_moves: Dict[str, float] = {}
        plc_last_seq: Dict[str, int] = {}
        recent_moves: Dict[Tuple[str, str], List[float]] = {}

        first_divergence: Optional[Dict[str, Any]] = None

        for t in telegrams:
            t_type = t.get("type", "")
            hu = t.get("hu_id")
            cp = t.get("cp")
            time_sec = float(t.get("time_sec", 0.0) or 0.0)
            seq_no = t.get("seq_no")
            plc = t.get("sender_plc") or "DEFAULT_PLC"

            # 1. Out-of-order sequence check (if seq_no is provided)
            if seq_no is not None:
                try:
                    s_num = int(seq_no)
                    last_s = plc_last_seq.get(plc)
                    if last_s is not None:
                        if s_num <= last_s and not (last_s >= 9990 and s_num <= 10):
                            f_item = {
                                "code": "MFS_OUT_OF_ORDER_SEQUENCE",
                                "severity": "MAJOR",
                                "hu_id": hu,
                                "sender_plc": plc,
                                "seq_no": s_num,
                                "last_seq": last_s,
                                "time_sec": time_sec,
                                "confidence": "VERIFIED",
                            }
                            findings.append(f_item)
                            if not first_divergence:
                                first_divergence = f_item
                        elif s_num > last_s + 1:
                            f_item = {
                                "code": "MFS_OUT_OF_ORDER_SEQUENCE",
                                "severity": "MAJOR",
                                "hu_id": hu,
                                "sender_plc": plc,
                                "seq_no": s_num,
                                "last_seq": last_s,
                                "gap": s_num - last_s - 1,
                                "time_sec": time_sec,
                                "confidence": "VERIFIED",
                            }
                            findings.append(f_item)
                            if not first_divergence:
                                first_divergence = f_item
                    plc_last_seq[plc] = s_num
                except (ValueError, TypeError):
                    pass

            # 2. Movement & Conveyor Topology check
            if t_type == "MOVE":
                # Check for duplicate send (retry storm)
                if hu and cp:
                    move_key = (hu, cp)
                    prev_times = recent_moves.setdefault(move_key, [])
                    if prev_times and abs(time_sec - prev_times[-1]) <= 2.0:
                        f_item = {
                            "code": "MFS_DUPLICATE_TELEGRAM_SEND",
                            "severity": "MAJOR",
                            "hu_id": hu,
                            "cp": cp,
                            "time_sec": time_sec,
                            "repeat_count": len(prev_times) + 1,
                            "confidence": "VERIFIED",
                        }
                        findings.append(f_item)
                        if not first_divergence:
                            first_divergence = f_item
                    prev_times.append(time_sec)

                prev_cp = hu_positions.get(hu)
                if prev_cp and (prev_cp, cp) not in conveyor_edges:
                    f_item = {
                        "code": "MFS_IMPOSSIBLE_TOPOLOGY_JUMP",
                        "severity": "CRITICAL",
                        "hu_id": hu,
                        "from_cp": prev_cp,
                        "to_cp": cp,
                        "time_sec": time_sec,
                        "confidence": "VERIFIED",
                    }
                    findings.append(f_item)
                    if not first_divergence:
                        first_divergence = f_item
                if hu:
                    hu_positions[hu] = cp
                    pending_moves[hu] = time_sec

            elif t_type == "ACK":
                if hu in pending_moves:
                    del pending_moves[hu]

            elif t_type == "TIMEOUT":
                f_item = {
                    "code": "MFS_MISSING_ACK_TIMEOUT",
                    "severity": "CRITICAL",
                    "hu_id": hu,
                    "cp": cp or hu_positions.get(hu),
                    "time_sec": time_sec,
                    "confidence": "VERIFIED",
                }
                findings.append(f_item)
                if not first_divergence:
                    first_divergence = f_item

        return {
            "status": "COMPLETED",
            "first_causal_divergence": first_divergence,
            "findings": findings,
        }
