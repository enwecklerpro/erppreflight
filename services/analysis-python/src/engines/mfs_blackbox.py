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
- Bounded-memory streaming of multi-GB delimited logs (src/engines/mfs_processor.py): the inline and the
  streaming transport share one line parser and one state machine, so identical input gives identical findings

Fully compliant with Cardinal Axiom 2 (14-Point Engine Anatomy) and AGENTS.md.
"""

from __future__ import annotations

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
from src.config import get_settings
from src.core.exceptions import EngineInputError
from src.core.streaming import LineSource, TextLineSource
from src.engines.mfs_processor import (
    CorruptRecord,
    MfsRunResult,
    MfsStateMachine,
    Telegram,
    collect_topology,
    configuration_records,
    detect_delimiter,
    first_non_empty,
    iter_log_records,
    json_records,
)
from src.models.request import AnalysisRequest
from src.models.response import AnalysisMetrics, AnalysisResponse
from src.parsers.json_input import parse_json_payload


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


# ==============================================================================
# Point 1: Metadata & Point 3-7: Engine Implementation
# ==============================================================================

# ==== ENGINE CONTRACT (rule catalog + input contract) ====
RULES = rule_catalog(
    RuleSpec(
        "MFS_CORRUPTED_TELEGRAM", "Malformed telegram record", Severity.MAJOR,
        "Check the PLC / MFS telegram structure definition (/SCWM/MFS telegram structures) and the log export; "
        "corrupted records were excluded from the reconstruction.", "DATA_INTEGRITY",
    ),
    RuleSpec(
        "MFS_OUT_OF_ORDER_SEQUENCE", "Telegram sequence out of order or with gaps", Severity.MAJOR,
        "Check the communication channel's sequence number handling and resend buffer (/SCWM/MFS_CP_CHANNEL "
        "monitoring); lost telegrams must be resynchronised with the PLC.", "TELEGRAM_ORDERING",
    ),
    RuleSpec(
        "MFS_DUPLICATE_TELEGRAM_SEND", "Duplicate telegram retransmission (retry storm)", Severity.MAJOR,
        "Investigate missing / late ACKs that trigger retransmission; tune the resend interval and max retries in "
        "the channel configuration.", "TELEGRAM_RETRY_STORM",
    ),
    RuleSpec(
        "MFS_IMPOSSIBLE_TOPOLOGY_JUMP", "HU moved between non-adjacent conveyor points", Severity.CRITICAL,
        "Verify the conveyor segment / communication point definitions against the physical layout and check "
        "for missed scanner reads between the two points.", "CONVEYOR_TOPOLOGY",
    ),
    RuleSpec(
        "MFS_MISSING_ACK_TIMEOUT", "Telegram not acknowledged within timeout", Severity.CRITICAL,
        "Check PLC connectivity and the channel's ACK timeout; unacknowledged moves leave warehouse tasks open.",
        "TELEGRAM_HANDSHAKE",
    ),
    RuleSpec(
        "MFS_FIRST_CAUSAL_DIVERGENCE", "First causal divergence in the incident timeline", Severity.CRITICAL,
        "Start the root-cause analysis at the referenced telegram; later anomalies are likely consequences.",
        "CAUSAL_DIAGNOSTICS",
    ),
)


class MfsInput(ContractModel):
    signal_fields = ("telegrams", "type")
    signal_message = "No MFS telegrams supplied: expected {'telegrams': [{type, hu_id, cp, seq_no, time_sec, …}]}."


INPUT_CONTRACT = InputContract(
    formats=(InputFormat.JSON, InputFormat.CSV),
    summary=(
        "MFS telegram log: CSV/TSV/pipe log with a header row (type, hu_id, cp, seq_no, sender_plc, receiver_plc, "
        "status, time_sec/timestamp; EDGE,<from>,<to> rows declare conveyor topology) or JSON "
        "{'telegrams': [...], 'conveyor_edges': [[from, to]], 'configuration': {ack_timeout_seconds, max_retries}}. "
        "Inline payloads are bounded by the service payload limit; delimited logs of any size (multi-GB) are "
        "streamed through POST /api/v1/analyze/stream and processed line by line with bounded memory."
    ),
    required=("At least one telegram with a 'type'",),
    json_model=MfsInput,
    json_array_field="telegrams",
    csv_signal_columns=("type", "hu_id", "cp"),
)


# ==== END ENGINE CONTRACT ====


@register_engine
class MFSBlackBoxEngine(BaseEngine):
    """Material Flow System (MFS) BlackBox Preflight & Causal Diagnostics Engine."""

    # Point 1: Metadata
    engine_type = EngineType.MFS_BLACKBOX
    rule_prefix = "MFS"
    finding_codes = RULES
    input_contract = INPUT_CONTRACT
    name = "MFS BlackBox"
    description = "Material Flow System / EWM telegram sequence and telegram buffer auditor"
    version = "1.1.0"
    supported_artifact_types = [ArtifactType.CSV, ArtifactType.TXT, ArtifactType.JSON]

    # Point 3 (streaming): multi-GB delimited logs arrive through POST /api/v1/analyze/stream.
    supports_streaming = True
    streaming_formats = (InputFormat.CSV,)

    # ==========================================================================
    # Point 3: Deterministic Parser / Normalizer (inline + streaming share it)
    # ==========================================================================

    @staticmethod
    def _artifact_path(request: AnalysisRequest) -> str:
        path = request.artifact_s3_key or "mfs/mfs_telegram_log.json"
        if not request.raw_content and request.artifacts:
            for art in request.artifacts:
                if art.raw_content:
                    return art.file_name or path
        return path

    @staticmethod
    def _inline_text(request: AnalysisRequest) -> str:
        if request.raw_content:
            return request.raw_content
        for art in request.artifacts:
            if art.raw_content:
                return art.raw_content
        return ""

    def _max_findings(self, request: AnalysisRequest) -> int:
        settings = get_settings()
        return max(2, min(int(request.options.max_findings), int(settings.MAX_FINDINGS_PER_ANALYSIS)))

    def _configuration(self, request: AnalysisRequest, parsed_cfg: Optional[Dict[str, Any]] = None) -> MFSConfiguration:
        cfg = MFSConfiguration()
        if isinstance(parsed_cfg, dict):
            try:
                if "ack_timeout_seconds" in parsed_cfg:
                    cfg.ack_timeout_seconds = float(parsed_cfg["ack_timeout_seconds"])
                if "max_retries" in parsed_cfg:
                    cfg.max_retries = int(parsed_cfg["max_retries"])
            except (TypeError, ValueError):
                raise EngineInputError(
                    f"{self.rule_prefix}_INVALID_INPUT",
                    "configuration.ack_timeout_seconds / max_retries must be numeric.",
                ) from None
        options = request.configuration or {}
        for key, cast in (("ack_timeout_seconds", float), ("max_retries", int)):
            if key in options:
                try:
                    setattr(cfg, key, cast(options[key]))
                except (ValueError, TypeError):
                    pass
        return cfg

    @staticmethod
    def _configuration_edges(request: AnalysisRequest) -> Set[Tuple[str, str]]:
        edges: Set[Tuple[str, str]] = set()
        raw_edges = (request.configuration or {}).get("conveyor_edges")
        if isinstance(raw_edges, list):
            for e in raw_edges:
                if isinstance(e, (list, tuple)) and len(e) >= 2:
                    edges.add((str(e[0]).strip(), str(e[1]).strip()))
        return edges

    def _run_log(self, request: AnalysisRequest, source: LineSource) -> Tuple[MfsRunResult, Set[Tuple[str, str]]]:
        """Two sequential passes over a delimited telegram log (topology, then telegram stream)."""
        first = first_non_empty(source.iter_lines())
        if first is None:
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "No MFS telegrams supplied: the telegram log is empty.",
            )
        delimiter = detect_delimiter(first)
        edges = collect_topology(source.iter_lines(), delimiter) or self._configuration_edges(request)
        machine = MfsStateMachine(self._artifact_path(request), edges, self._max_findings(request))
        for rec in iter_log_records(source.iter_lines(), delimiter):
            machine.feed(rec)
        return machine.finish(), edges

    def _run_json(self, request: AnalysisRequest, text: str) -> Tuple[MfsRunResult, Set[Tuple[str, str]], MFSConfiguration]:
        parsed = parse_json_payload(text, self.rule_prefix)
        edges: Set[Tuple[str, str]] = set()
        cfg_block: Optional[Dict[str, Any]] = None
        if isinstance(parsed, dict):
            topology = parsed.get("topology")
            edges_raw = parsed.get("conveyor_edges", topology.get("edges", []) if isinstance(topology, dict) else [])
            for e in edges_raw if isinstance(edges_raw, list) else []:
                if isinstance(e, (list, tuple)) and len(e) >= 2:
                    edges.add((str(e[0]).strip(), str(e[1]).strip()))
            block = parsed.get("configuration", parsed.get("options", {}))
            cfg_block = block if isinstance(block, dict) else None
        cfg = self._configuration(request, cfg_block)
        telegrams_raw = parsed.get("telegrams", parsed) if isinstance(parsed, dict) else parsed
        if not isinstance(telegrams_raw, list):
            telegrams_raw = [telegrams_raw]
        records = json_records(telegrams_raw, text)
        if not any(isinstance(r, Telegram) for r in records):
            config_telegrams = (request.configuration or {}).get("telegrams")
            if isinstance(config_telegrams, list):
                records = [r for r in records if isinstance(r, CorruptRecord)] + configuration_records(config_telegrams)
        if not edges:
            edges = self._configuration_edges(request)
        machine = MfsStateMachine(self._artifact_path(request), edges, self._max_findings(request))
        for rec in records:
            machine.feed(rec)
        return machine.finish(), edges, cfg

    def _run_configuration(self, request: AnalysisRequest) -> Tuple[MfsRunResult, Set[Tuple[str, str]]]:
        config_telegrams = (request.configuration or {}).get("telegrams")
        records = configuration_records(config_telegrams) if isinstance(config_telegrams, list) else []
        edges = self._configuration_edges(request)
        machine = MfsStateMachine(self._artifact_path(request), edges, self._max_findings(request))
        for rec in records:
            machine.feed(rec)
        return machine.finish(), edges

    # ==========================================================================
    # Main Engine Analyze Methods
    # ==========================================================================

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Inline payload (JSON / delimited log held in memory, or configuration telegrams)."""
        start_time = time.perf_counter()
        text = self._inline_text(request)
        stripped = text.strip()
        source: Optional[LineSource] = None
        if stripped.startswith("{") or stripped.startswith("["):
            result, edges, _cfg = self._run_json(request, text)
            mode = "INLINE_JSON"
        elif stripped and ("\n" in stripped or "," in stripped or ";" in stripped or "|" in stripped or "\t" in stripped):
            source = TextLineSource(text)
            self._configuration(request)
            result, edges = self._run_log(request, source)
            mode = "INLINE_LOG"
        else:
            result, edges = self._run_configuration(request)
            mode = "CONFIGURATION"
        if source is None and stripped:
            source = TextLineSource(text)
        return self._response(request, result, edges, start_time, mode, source)

    async def analyze_stream(self, request: AnalysisRequest, source: LineSource) -> AnalysisResponse:
        """Streaming transport: the log is read line by line from the spooled request body (bounded memory)."""
        start_time = time.perf_counter()
        self._configuration(request)
        result, edges = self._run_log(request, source)
        return self._response(request, result, edges, start_time, "STREAM", source)

    def _response(
        self,
        request: AnalysisRequest,
        result: MfsRunResult,
        edges: Set[Tuple[str, str]],
        start_time: float,
        mode: str,
        source: Optional[LineSource],
    ) -> AnalysisResponse:
        if result.total_telegrams == 0:
            if result.corrupted_rows:
                first_line = result.findings[0].technical_details.get("line_number") if result.findings else None
                raise EngineInputError(
                    f"{self.rule_prefix}_INVALID_INPUT",
                    f"None of the {result.corrupted_rows} telegram records is valid (each needs at least a "
                    "'type'); the telegram stream cannot be reconstructed.",
                    line_number=first_line,
                )
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "No MFS telegrams supplied: provide a telegram log (CSV with a type / hu_id / cp header, or JSON "
                "{'telegrams': [...]}) — conveyor topology alone cannot be analysed.",
            )

        first = result.first_divergence
        first_div_summary = None
        if first is not None:
            first_div_summary = {
                "code": first.rule_id,
                "severity": first.severity.value,
                "title": first.title,
                "confidence": first.confidence.value,
                "time_sec": first.technical_details.get("time_sec", 0.0),
                "hu_id": first.technical_details.get("hu_id"),
                "from_cp": first.technical_details.get("from_cp"),
                "to_cp": first.technical_details.get("to_cp"),
            }
        total = result.total_telegrams
        additional: Dict[str, Any] = {
            "total_telegrams_parsed": total,
            "active_hus": result.active_hus,
            "incident_duration_seconds": round(result.duration_seconds, 3),
            "telegram_error_rate": round(result.total_findings / total, 4) if total > 0 else 0.0,
            "first_causal_divergence": first_div_summary,
            "topology_edges_count": len(edges),
            "corrupted_rows_count": result.corrupted_rows,
            "inputMode": mode,
        }
        if source is not None:
            additional["artifactSha256"] = source.sha256
            additional["bytesProcessed"] = source.size_bytes
            additional["linesProcessed"] = source.line_count
        status = AnalysisStatus.COMPLETED
        if result.suppressed:
            status = AnalysisStatus.PARTIAL
            additional["findingsTruncated"] = True
            additional["totalFindingsBeforeTruncation"] = result.total_findings
            additional["maxFindings"] = self._max_findings(request)
            additional["findingsSuppressed"] = result.suppressed
        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=status,
            findings=result.findings,
            error_message=(
                f"{sum(result.suppressed.values())} further finding(s) beyond the {self._max_findings(request)} "
                "finding limit were counted but not returned (see findingsSuppressed)."
                if result.suppressed else None
            ),
            metrics=AnalysisMetrics(
                execution_time_ms=int((time.perf_counter() - start_time) * 1000),
                rules_evaluated=result.rules_evaluated,
                artifacts_scanned=1,
                additional_metrics=additional,
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
