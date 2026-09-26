"""MFS BlackBox — incremental (bounded-memory) telegram processor.

One implementation serves both input paths of the MFS BlackBox engine:

* **inline** — ``raw_content`` / configuration (JSON telegram list or a delimited log held in memory), and
* **streaming** — multi-GB delimited logs spooled to disk by the ``/api/v1/analyze/stream`` endpoint and read
  line by line (:class:`src.core.streaming.SpooledArtifact`); the log is never loaded whole into memory.

Because both paths feed the same :class:`MfsStateMachine` with the same :class:`Telegram` records (produced by
the same :class:`MfsLineParser` for delimited logs), identical input yields byte-identical findings (Cardinal
Axiom 2 #4). Memory is bounded by the number of *distinct* handling units / channels / (HU, CP) pairs in the log
plus at most ``max_findings`` retained findings — never by the log size. Findings beyond ``max_findings`` are
counted per rule (``findingsSuppressed``) instead of being kept, and the response is marked PARTIAL.

Delimited logs are processed in two sequential passes over the line source: pass 1 collects the conveyor
topology (``EDGE,<from>,<to>`` rows may appear anywhere in the file), pass 2 evaluates the telegram stream —
exactly the semantics of the original whole-file parser.
"""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional, Set, Tuple

from src.models.enums import ConfidenceClass, Severity, TrustLevel
from src.models.finding import Finding
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine

EDGE_MARKERS = ("EDGE", "CONVEYOR_EDGE", "ROUTE")
HEADER_SIGNALS = ("type", "hu_id", "cp")
_TIME_RE = re.compile(r"(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)")


def parse_time_sec(val: Any, timestamp_str: Optional[str] = None) -> float:
    """Converts time_sec or an ISO / log timestamp (HH:MM:SS[.fff]) into float seconds."""
    if val is not None:
        try:
            return float(val)
        except (ValueError, TypeError):
            pass
    if timestamp_str:
        m = _TIME_RE.search(str(timestamp_str))
        if m:
            hh, mm, ss = m.groups()
            return float(hh) * 3600.0 + float(mm) * 60.0 + float(ss)
    return 0.0


def detect_delimiter(first_line: str) -> str:
    """Delimiter (comma, semicolon, tab, pipe) with the most occurrences in the first non-empty line."""
    sample = first_line.strip()
    counts = {",": sample.count(","), ";": sample.count(";"), "\t": sample.count("\t"), "|": sample.count("|")}
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else ","


@dataclass(slots=True)
class Telegram:
    """One normalised MFS telegram (lightweight: created once per log line)."""

    type: str
    time_sec: float = 0.0
    timestamp: Optional[str] = None
    hu_id: Optional[str] = None
    cp: Optional[str] = None
    to_cp: Optional[str] = None
    seq_no: Optional[int] = None
    sender_plc: Optional[str] = None
    receiver_plc: Optional[str] = None
    status: Optional[str] = None
    line_number: int = 1
    column_number: int = 1
    raw_text: Optional[str] = None


@dataclass(slots=True)
class CorruptRecord:
    line_number: int
    raw_line: str
    error: str


# ---------------------------------------------------------------------------------------------------------
# Delimited log parser (line by line)
# ---------------------------------------------------------------------------------------------------------


def _split_row(line: str, delimiter: str) -> List[str]:
    if '"' not in line:
        return line.split(delimiter)
    return next(csv.reader([line], delimiter=delimiter), [])


# Header rows contain a cell equal (case-insensitively) to type / hu_id / cp. Cheap substring pre-check first;
# the exact per-cell check runs only when it may match.
_CP_SPELLINGS = ("cp", "CP", "Cp", "cP")
# Characters str.strip() removes from ASCII text.
_ASCII_WS = re.compile(r"[ \t\n\r\x0b\x0c\x1c-\x1f]")
_EDGE_FIRST_CHARS = frozenset("ECRecr \t\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0")
_FIELDS = ("type", "hu_id", "cp", "to_cp", "timestamp", "time_sec", "seq_no", "sender_plc", "receiver_plc", "status")


class MfsLineParser:
    """Stateful parser for CSV / TSV / pipe telegram logs (header row detection, EDGE rows, positional fallback)."""

    __slots__ = ("delimiter", "header_map", "_idx")

    def __init__(self, delimiter: str):
        self.delimiter = delimiter
        self.header_map: Dict[str, int] = {}
        self._idx: Optional[Tuple[Optional[int], ...]] = None

    @staticmethod
    def edge_of(line: str, delimiter: str) -> Optional[Tuple[str, str]]:
        """(from, to) when the line is a topology declaration ``EDGE,<from>,<to>``."""
        # Allocation-free fast path for the vast majority of (telegram) lines.
        if not line or (line[0] not in _EDGE_FIRST_CHARS and not line[0].isspace()):
            return None
        head = line.lstrip()[:13].upper()
        if not head.startswith(("EDGE", "CONVEYOR_EDGE", "ROUTE")):
            return None
        row = [c.strip() for c in _split_row(line, delimiter)]
        if row and row[0].upper() in EDGE_MARKERS and len(row) >= 3:
            return row[1].upper(), row[2].upper()
        return None

    def parse(self, line_number: int, line: str) -> Optional[Telegram | CorruptRecord]:
        """Telegram / CorruptRecord for a data row; None for blank, EDGE and header rows."""
        row = _split_row(line, self.delimiter)
        # str.strip() per cell only when the line contains whitespace (saves one list per typical log row).
        cleaned = row if (line.isascii() and _ASCII_WS.search(line) is None) else [c.strip() for c in row]
        if not any(cleaned):
            return None
        if len(cleaned) >= 3 and cleaned[0].upper() in EDGE_MARKERS:
            return None
        ll = line.lower()
        if "type" in ll or "hu_id" in ll or any(c in cleaned for c in _CP_SPELLINGS):
            lower = [c.lower() for c in cleaned]
            if "type" in lower or "hu_id" in lower or "cp" in lower:
                self.header_map = {col: i for i, col in enumerate(lower)}
                self._idx = tuple(self.header_map.get(f) for f in _FIELDS)
                return None
        n = len(cleaned)
        idx = self._idx
        if idx is not None:
            i_type, i_hu, i_cp, i_to, i_ts, i_tsec, i_seq, i_snd, i_rcv, i_st = idx
            t_type = cleaned[i_type] if i_type is not None and i_type < n else None
            if t_type and not t_type.isupper():
                t_type = t_type.upper()
            if not t_type:
                return CorruptRecord(line_number, line, "Missing 'type' value")
            hu_id = cleaned[i_hu] if i_hu is not None and i_hu < n else None
            cp = cleaned[i_cp] if i_cp is not None and i_cp < n else None
            to_cp = cleaned[i_to] if i_to is not None and i_to < n else None
            ts = cleaned[i_ts] if i_ts is not None and i_ts < n else None
            t_sec_val = cleaned[i_tsec] if i_tsec is not None and i_tsec < n else None
            seq = cleaned[i_seq] if i_seq is not None and i_seq < n else None
            sender = cleaned[i_snd] if i_snd is not None and i_snd < n else None
            receiver = cleaned[i_rcv] if i_rcv is not None and i_rcv < n else None
            status = cleaned[i_st] if i_st is not None and i_st < n else None
        else:
            # Positional fallback: timestamp, type, hu_id, cp, seq_no, sender_plc, receiver_plc, status, time_sec
            ts = cleaned[0] if n > 0 else None
            t_type = cleaned[1].upper() if n > 1 else None
            hu_id = cleaned[2] if n > 2 else None
            cp = cleaned[3] if n > 3 else None
            to_cp = None
            seq = cleaned[4] if n > 4 else None
            sender = cleaned[5] if n > 5 else None
            receiver = cleaned[6] if n > 6 else None
            status = cleaned[7] if n > 7 else None
            t_sec_val = cleaned[8] if n > 8 else None
        if not t_type:
            return CorruptRecord(line_number, line, "Empty telegram type")
        return Telegram(
            t_type,
            parse_time_sec(t_sec_val, ts),
            ts,
            hu_id or None,
            cp or None,
            to_cp or None,
            int(seq) if seq and seq.isdigit() else None,
            sender or None,
            receiver or None,
            status or None,
            line_number,
            1,
            line,
        )


def first_non_empty(lines: Iterable[Tuple[int, str]]) -> Optional[str]:
    for _no, line in lines:
        if line.strip():
            return line
    return None


def collect_topology(lines: Iterable[Tuple[int, str]], delimiter: str) -> Set[Tuple[str, str]]:
    """Pass 1: every conveyor edge declared in the log."""
    edges: Set[Tuple[str, str]] = set()
    for _no, line in lines:
        edge = MfsLineParser.edge_of(line, delimiter)
        if edge is not None:
            edges.add(edge)
    return edges


def iter_log_records(lines: Iterable[Tuple[int, str]], delimiter: str) -> Iterator[Telegram | CorruptRecord]:
    """Pass 2: telegrams and corrupt records in file order."""
    parser = MfsLineParser(delimiter)
    for line_number, line in lines:
        rec = parser.parse(line_number, line)
        if rec is not None:
            yield rec


# ---------------------------------------------------------------------------------------------------------
# JSON telegram list -> records (inline path only; JSON is never streamed)
# ---------------------------------------------------------------------------------------------------------


def _locate_line(raw_text: str, token: str) -> Tuple[Optional[int], Optional[int], str]:
    if not raw_text or not token:
        return None, None, ""
    token_str = str(token).strip()
    if not token_str:
        return None, None, ""
    lines = raw_text.splitlines()
    for idx, line in enumerate(lines, 1):
        pos = line.find(token_str)
        if pos != -1:
            return idx, pos + 1, line.strip()
    token_lower = token_str.lower()
    for idx, line in enumerate(lines, 1):
        pos = line.lower().find(token_lower)
        if pos != -1:
            return idx, pos + 1, line.strip()
    return None, None, ""


def json_records(telegrams_raw: List[Any], text: str) -> List[Telegram | CorruptRecord]:
    """Telegram / corrupt records of a JSON telegram list (line numbers located in the source text)."""
    out: List[Telegram | CorruptRecord] = []
    for idx, t in enumerate(telegrams_raw, 1):
        if not isinstance(t, dict):
            out.append(CorruptRecord(idx, str(t), "Telegram entry is not an object"))
            continue
        t_type = t.get("type")
        if not t_type:
            out.append(CorruptRecord(idx, str(t), "Missing mandatory 'type' field"))
            continue
        hu = t.get("hu_id")
        line_no, col_no, snippet = _locate_line(text, hu or t_type)
        seq_val = None
        if t.get("seq_no") is not None:
            try:
                seq_val = int(t.get("seq_no"))
            except (ValueError, TypeError):
                seq_val = None
        out.append(Telegram(
            type=str(t_type).upper(),
            time_sec=parse_time_sec(t.get("time_sec"), t.get("timestamp")),
            timestamp=t.get("timestamp"),
            hu_id=hu,
            cp=t.get("cp"),
            to_cp=t.get("to_cp"),
            seq_no=seq_val,
            sender_plc=t.get("sender_plc"),
            receiver_plc=t.get("receiver_plc"),
            status=t.get("status"),
            line_number=line_no if line_no is not None else idx,
            column_number=col_no if col_no is not None else 1,
            raw_text=snippet or json.dumps(t),
        ))
    return out


def configuration_records(raw_telegrams: List[Any]) -> List[Telegram | CorruptRecord]:
    """Telegrams supplied through request.configuration['telegrams'] (no source text: line = list position)."""
    out: List[Telegram | CorruptRecord] = []
    for idx, t in enumerate(raw_telegrams, 1):
        if not isinstance(t, dict):
            continue
        seq = t.get("seq_no")
        out.append(Telegram(
            type=str(t.get("type", "UNKNOWN")).upper(),
            time_sec=parse_time_sec(t.get("time_sec"), t.get("timestamp")),
            timestamp=t.get("timestamp"),
            hu_id=t.get("hu_id"),
            cp=t.get("cp"),
            to_cp=t.get("to_cp"),
            seq_no=int(seq) if seq is not None and str(seq).isdigit() else None,
            sender_plc=t.get("sender_plc"),
            receiver_plc=t.get("receiver_plc"),
            status=t.get("status"),
            line_number=idx,
            raw_text=json.dumps(t),
        ))
    return out


# ---------------------------------------------------------------------------------------------------------
# State machine (rules 0–4)
# ---------------------------------------------------------------------------------------------------------


@dataclass
class MfsRunResult:
    findings: List[Finding]
    first_divergence: Optional[Finding]
    rules_evaluated: int
    total_telegrams: int
    active_hus: int
    duration_seconds: float
    corrupted_rows: int
    total_findings: int
    suppressed: Dict[str, int] = field(default_factory=dict)


class MfsStateMachine:
    """Pure, single-pass rule evaluation over the telegram stream (Cardinal Axiom 2 #4).

    ``max_findings`` bounds the retained findings: when exceeded, the earliest ``max_findings - 1`` findings are
    kept (corrupted-record findings first, as in the whole-file engine), later ones are only counted, and the
    first-causal-divergence summary still reflects the complete stream."""

    def __init__(self, artifact_path: str, conveyor_edges: Set[Tuple[str, str]], max_findings: int):
        self.artifact_path = artifact_path
        self.edges = conveyor_edges
        self.cap = max(2, int(max_findings))
        self.rules_evaluated = 0
        self._corrupt: List[Finding] = []
        self._stream: List[Finding] = []
        self._corrupt_total = 0
        self._stream_total = 0
        self._first_corrupt: Optional[Finding] = None
        self._first_stream: Optional[Finding] = None
        self.suppressed: Dict[str, int] = {}
        self.hu_positions: Dict[str, str] = {}
        self.plc_last_seq: Dict[str, int] = {}
        # (hu, type, cp) -> [send count, first send time]
        self.recent_sends: Dict[Tuple[str, str, str], List[float]] = {}
        self.active_hus: Set[str] = set()
        self.total_telegrams = 0
        self.first_time: Optional[float] = None
        self.last_time: float = 0.0

    # -- retention -------------------------------------------------------------------------------------
    def _keep(self, rule_id: str, build: Callable[[], Finding], corrupt: bool = False) -> None:
        """Counts a finding and constructs it only when it is retained (or is the first of its kind), so a log
        with millions of anomalies costs O(max_findings) finding objects, not O(anomalies)."""
        first_missing = (self._first_corrupt if corrupt else self._first_stream) is None
        # Reserve one slot for the causal-divergence summary.
        has_room = len(self._corrupt) + len(self._stream) < self.cap - 1
        evict = not has_room and corrupt and bool(self._stream)
        finding: Optional[Finding] = build() if (has_room or evict or first_missing) else None
        if corrupt:
            self._corrupt_total += 1
            if first_missing:
                self._first_corrupt = finding
        else:
            self._stream_total += 1
            if first_missing:
                self._first_stream = finding
        if has_room:
            (self._corrupt if corrupt else self._stream).append(finding)
        elif evict:
            # Corrupted-record findings precede telegram findings in the output: evict the latest telegram one.
            evicted = self._stream.pop()
            self.suppressed[evicted.rule_id] = self.suppressed.get(evicted.rule_id, 0) + 1
            self._corrupt.append(finding)
        else:
            self.suppressed[rule_id] = self.suppressed.get(rule_id, 0) + 1

    def _evidence(self, snippet: str, line: int, col: int, provenance: ConfidenceClass):
        return EvidenceEngine.create_evidence(
            artifact_path=self.artifact_path,
            content=snippet,
            line_number=line,
            column_number=col,
            snippet=snippet,
            provenance=provenance,
            source_type=TrustLevel.CUSTOMER_EVIDENCE,
        )

    # -- rule 0 ----------------------------------------------------------------------------------------
    def corrupted(self, rec: CorruptRecord) -> None:
        self.rules_evaluated += 1
        self._keep("MFS_CORRUPTED_TELEGRAM", lambda: self._corrupted_finding(rec), corrupt=True)

    def _corrupted_finding(self, rec: CorruptRecord) -> Finding:
        line_no, snippet = rec.line_number, rec.raw_line
        ev = EvidenceEngine.create_evidence(
            artifact_path=self.artifact_path,
            content=snippet or f"corrupted_line_{line_no}",
            line_number=line_no,
            column_number=1,
            snippet=snippet,
            provenance=ConfidenceClass.UNKNOWN,
            source_type=TrustLevel.CUSTOMER_EVIDENCE,
        )
        return ConfidenceClassifier.classify(Finding(
            rule_id="MFS_CORRUPTED_TELEGRAM",
            severity=Severity.MAJOR,
            category="DATA_INTEGRITY",
            title=f"Corrupted or Malformed MFS Telegram at Line {line_no}",
            description=(
                f"Line {line_no} of telegram artifact '{self.artifact_path}' could not be parsed deterministically: "
                f"{rec.error or 'Malformed syntax'}. Telemetry evaluation fails closed for unparseable records."
            ),
            confidence=ConfidenceClass.UNKNOWN,
            confidence_score=0.30,
            remediation=(
                "Verify the EWM telegram log export format. Ensure standard delimiter and column layouts "
                "are preserved from transaction /SCWM/MFS_TELEGRAM."
            ),
            evidence=[ev],
            technical_details={"line_number": line_no, "error": rec.error},
            affected_objects=[f"LINE_{line_no}"],
        ))

    # -- rules 1–3 -------------------------------------------------------------------------------------
    def telegram(self, t: Telegram) -> None:
        self.total_telegrams += 1
        if self.first_time is None:
            self.first_time = t.time_sec
        self.last_time = t.time_sec
        if t.hu_id:
            self.active_hus.add(t.hu_id)

        t_type, hu, cp, time_sec = t.type, t.hu_id, t.cp, t.time_sec
        plc = t.sender_plc or "PLC_DEFAULT"
        snippet_text = t.raw_text or f"[{t.time_sec}s] {t_type} HU={hu} CP={cp}"

        # Rule 1: sequence counter monotonicity & gaps
        if t.seq_no is not None:
            self.rules_evaluated += 1
            last_seq = self.plc_last_seq.get(plc)
            if last_seq is not None:
                if t.seq_no <= last_seq and not (last_seq >= 9990 and t.seq_no <= 10):
                    self._keep("MFS_OUT_OF_ORDER_SEQUENCE", lambda: ConfidenceClassifier.classify(Finding(
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
                        evidence=[self._evidence(snippet_text, t.line_number, t.column_number, ConfidenceClass.VERIFIED)],
                        technical_details={"plc": plc, "seq_no": t.seq_no, "last_seq": last_seq, "time_sec": time_sec},
                        affected_objects=[plc, f"SEQ_{t.seq_no}"],
                    )))
                elif t.seq_no > last_seq + 1:
                    gap_count = t.seq_no - last_seq - 1
                    self._keep("MFS_OUT_OF_ORDER_SEQUENCE", lambda: ConfidenceClassifier.classify(Finding(
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
                        evidence=[self._evidence(snippet_text, t.line_number, t.column_number, ConfidenceClass.VERIFIED)],
                        technical_details={
                            "plc": plc, "seq_no": t.seq_no, "last_seq": last_seq, "gap": gap_count, "time_sec": time_sec,
                        },
                        affected_objects=[plc, f"GAP_{last_seq + 1}_TO_{t.seq_no - 1}"],
                    )))
            self.plc_last_seq[plc] = t.seq_no

        # Rule 2: movement, retry storms and impossible topology jumps
        if t_type == "MOVE":
            self.rules_evaluated += 1
            if hu and cp:
                key = (hu, t_type, cp)
                history = self.recent_sends.get(key)
                if history is not None:
                    count, first_time, last_time = history
                    if abs(time_sec - last_time) <= 2.0 or (t.status and "RETRY" in t.status.upper()):
                        repeat_count = int(count) + 1
                        self._keep("MFS_DUPLICATE_TELEGRAM_SEND", lambda: ConfidenceClassifier.classify(Finding(
                            rule_id="MFS_DUPLICATE_TELEGRAM_SEND",
                            severity=Severity.MAJOR,
                            category="TELEGRAM_RETRY_STORM",
                            title=f"Duplicate Telegram Retransmission (Retry Storm): HU '{hu}' at CP '{cp}'",
                            description=(
                                f"Identical {t_type} telegram for Handling Unit '{hu}' at communication point '{cp}' "
                                f"resent {repeat_count} times within {round(time_sec - first_time, 2)}s "
                                "without intervening PLC acknowledgment. This indicates an active retry storm."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=(
                                "Tune the PLC handshake retransmission timer in SAP EWM MFS PLC configuration. "
                                "Verify function module /SCWM/MFS_ACK_RECEIVE latency under peak conveyor loads."
                            ),
                            evidence=[self._evidence(snippet_text, t.line_number, t.column_number, ConfidenceClass.VERIFIED)],
                            technical_details={"hu_id": hu, "cp": cp, "repeat_count": repeat_count, "time_sec": time_sec},
                            affected_objects=[hu, cp],
                        )))
                    history[0] = count + 1
                    history[2] = time_sec
                else:
                    self.recent_sends[key] = [1, time_sec, time_sec]

                prev_cp = self.hu_positions.get(hu)
                if prev_cp and prev_cp != cp and (prev_cp, cp) not in self.edges:
                    self._keep("MFS_IMPOSSIBLE_TOPOLOGY_JUMP", lambda: ConfidenceClassifier.classify(Finding(
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
                        evidence=[self._evidence(snippet_text, t.line_number, t.column_number, ConfidenceClass.VERIFIED)],
                        technical_details={"hu_id": hu, "from_cp": prev_cp, "to_cp": cp, "time_sec": time_sec},
                        affected_objects=[hu, prev_cp, cp],
                    )))
                self.hu_positions[hu] = cp

        # Rule 3: handshake ACK / timeout
        elif t_type == "ACK":
            self.rules_evaluated += 1
        elif t_type == "TIMEOUT":
            self.rules_evaluated += 1
            location = cp or self.hu_positions.get(hu or "")
            self._keep("MFS_MISSING_ACK_TIMEOUT", lambda: ConfidenceClassifier.classify(Finding(
                rule_id="MFS_MISSING_ACK_TIMEOUT",
                severity=Severity.CRITICAL,
                category="TELEGRAM_HANDSHAKE",
                title=f"Missing Telegram Handshake ACK Timeout: HU '{hu or 'UNKNOWN'}'",
                description=(
                    f"Telegram for Handling Unit '{hu or 'UNKNOWN'}' at Communication Point "
                    f"'{cp or self.hu_positions.get(hu or '', 'UNKNOWN')}' "
                    f"timed out at {time_sec}s without receiving a timely acknowledgment (ACK) from PLC '{plc}'."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Check PLC TCP/IP socket connection, telegram buffer status in /SCWM/MFS_TELEGRAM, "
                    "and handshake timeout parameters in SAP EWM MFS PLC configuration."
                ),
                evidence=[self._evidence(snippet_text, t.line_number, t.column_number, ConfidenceClass.VERIFIED)],
                technical_details={"hu_id": hu, "cp": location, "time_sec": time_sec, "plc": plc},
                affected_objects=[hu or "UNKNOWN_HU", cp or "UNKNOWN_CP"],
            )))

    def feed(self, rec: Telegram | CorruptRecord) -> None:
        if isinstance(rec, CorruptRecord):
            self.corrupted(rec)
        else:
            self.telegram(rec)

    # -- rule 4 ----------------------------------------------------------------------------------------
    def finish(self) -> MfsRunResult:
        self.rules_evaluated += 1
        findings = self._corrupt + self._stream
        first = self._first_corrupt or self._first_stream
        total = self._corrupt_total + self._stream_total
        if first is not None:
            first.technical_details["first_causal_divergence"] = True
            if total > 1:
                root_ev = first.evidence[0] if first.evidence else self._evidence(first.title, 1, 1, ConfidenceClass.VERIFIED)
                causal = Finding(
                    rule_id="MFS_FIRST_CAUSAL_DIVERGENCE",
                    severity=Severity.CRITICAL,
                    category="CAUSAL_DIAGNOSTICS",
                    title=f"First Causal Divergence: {first.title}",
                    description=(
                        f"Earliest system invariant violation occurred at line {first.technical_details.get('time_sec', 0.0)}s: "
                        f"{first.description} This root incident cascaded into {total - 1} subsequent downstream failures."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=first.remediation,
                    evidence=[root_ev],
                    technical_details={
                        "root_cause_rule_id": first.rule_id,
                        "root_cause_title": first.title,
                        "earliest_time_sec": first.technical_details.get("time_sec", 0.0),
                        "downstream_cascade_count": total - 1,
                    },
                    affected_objects=first.affected_objects,
                )
                findings.append(ConfidenceClassifier.classify(causal))
                total += 1
        duration = (self.last_time - self.first_time) if self.total_telegrams >= 2 and self.first_time is not None else 0.0
        return MfsRunResult(
            findings=findings,
            first_divergence=first,
            rules_evaluated=self.rules_evaluated,
            total_telegrams=self.total_telegrams,
            active_hus=len(self.active_hus),
            duration_seconds=duration,
            corrupted_rows=self._corrupt_total,
            total_findings=total,
            suppressed=dict(sorted(self.suppressed.items())),
        )
