"""Deterministic synthetic MFS telegram logs for streaming / memory-bound tests (no randomness, no clock).

``write_log(path, target_bytes)`` writes a realistic CSV telegram log of at least ``target_bytes`` without ever
holding it in memory: 4 PLC channels, a recycled pool of conveyor totes (handling units) moving
CP01 -> CP02 -> CP03 -> CP04 with ACK handshakes, plus a small, fixed number of injected incidents (topology
jump, sequence gap, retry storm, ACK timeout, corrupted row) at deterministic positions. Returns
(size_bytes, sha256, line_count).
"""

from __future__ import annotations

import hashlib
from typing import Dict, Tuple

HEADER = "timestamp,type,hu_id,cp,seq_no,sender_plc,receiver_plc,status,time_sec\n"
ROUTE = ("CP01", "CP02", "CP03", "CP04")
PLCS = ("PLC01", "PLC02", "PLC03", "PLC04")
HU_POOL = 5000
INCIDENT_EVERY = 20_000  # telegram cycles between injected incidents (~1 per 11 MB)


def _ts(sec: float) -> str:
    h = int(sec // 3600) % 24
    m = int(sec // 60) % 60
    s = sec % 60
    return f"2026-09-24T{h:02d}:{m:02d}:{s:06.3f}Z"


def iter_log(target_bytes: int, edges_at_end: bool = False, incident_every: int = INCIDENT_EVERY):
    """Yields log lines (with newline) until at least ``target_bytes`` were produced."""
    produced = len(HEADER)
    yield HEADER
    # Conveyor loop: totes return from CP04 to CP01 and are reused.
    edges = [f"EDGE,{a},{b}\n" for a, b in zip(ROUTE, ROUTE[1:] + ROUTE[:1])]
    if not edges_at_end:
        for e in edges:
            produced += len(e)
            yield e
    seq: Dict[str, int] = {p: 0 for p in PLCS}
    cycle = 0
    t = 0.0
    while produced < target_bytes:
        hu = f"HU_{cycle % HU_POOL:06d}"
        plc = PLCS[cycle % len(PLCS)]
        incident = (cycle % incident_every) == incident_every - 1
        kind = (cycle // incident_every) % 5
        for step, cp in enumerate(ROUTE):
            t += 0.5
            seq[plc] += 1
            if incident and kind == 0 and step == 2:
                cp = "CP09"  # impossible topology jump
            if incident and kind == 1 and step == 1:
                seq[plc] += 7  # sequence gap
            line = f"{_ts(t)},MOVE,{hu},{cp},{seq[plc]},{plc},EWM,OK,{t:.3f}\n"
            produced += len(line)
            yield line
            if incident and kind == 2 and step == 1:
                t += 0.4
                seq[plc] += 1
                line = f"{_ts(t)},MOVE,{hu},{cp},{seq[plc]},{plc},EWM,RETRY,{t:.3f}\n"  # retry storm
                produced += len(line)
                yield line
            if incident and kind == 3 and step == 3:
                t += 5.0
                line = f"{_ts(t)},TIMEOUT,{hu},{cp},,{plc},EWM,NO_ACK,{t:.3f}\n"  # ACK timeout
                produced += len(line)
                yield line
                continue
            t += 0.1
            line = f"{_ts(t)},ACK,{hu},{cp},,EWM,{plc},OK,{t:.3f}\n"
            produced += len(line)
            yield line
        if incident and kind == 4:
            line = "###CORRUPTED###\n"  # corrupted record (no type)
            produced += len(line)
            yield line
        cycle += 1
    if edges_at_end:
        for e in edges:
            yield e


def write_log(path, target_bytes: int, edges_at_end: bool = False, incident_every: int = INCIDENT_EVERY) -> Tuple[int, str, int]:
    digest = hashlib.sha256()
    size = 0
    lines = 0
    buf = []
    buf_len = 0
    with open(path, "wb") as fh:
        for line in iter_log(target_bytes, edges_at_end, incident_every):
            data = line.encode("ascii")
            buf.append(data)
            buf_len += len(data)
            lines += 1
            if buf_len >= 1 << 20:
                chunk = b"".join(buf)
                fh.write(chunk)
                digest.update(chunk)
                size += len(chunk)
                buf, buf_len = [], 0
        if buf:
            chunk = b"".join(buf)
            fh.write(chunk)
            digest.update(chunk)
            size += len(chunk)
    return size, digest.hexdigest(), lines


def log_text(target_bytes: int, edges_at_end: bool = False, incident_every: int = INCIDENT_EVERY) -> str:
    """Small in-memory variant for inline-vs-stream equality tests."""
    return "".join(iter_log(target_bytes, edges_at_end, incident_every))
