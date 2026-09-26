"""MFS BlackBox — bounded-memory streaming of multi-GB telegram logs (closes KNOWN_LIMITATIONS E3).

* determinism: the inline transport (raw_content) and the streaming transport (/api/v1/analyze/stream, spooled
  body read line by line) produce byte-identical findings for identical input;
* memory bound: tracemalloc peak while analysing a >= 200 MB synthetic log stays far below the log size;
* Hypothesis properties: arbitrary chunking of the body never changes the lines / findings;
* the HTTP endpoint (framing, engine capability, size cap, input contract).
"""

from __future__ import annotations

import asyncio
import json
import sys
import tracemalloc
from pathlib import Path
from typing import AsyncIterator, List

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import src.engines  # noqa: E402,F401
from src.core.registry import EngineRegistry  # noqa: E402
from src.core.runner import EngineRunner  # noqa: E402
from src.core.streaming import (  # noqa: E402
    MAX_LINE_BYTES,
    SpooledArtifact,
    StreamFramingError,
    StreamTooLargeError,
    TextLineSource,
    read_framed_stream,
)
from src.models.enums import AnalysisStatus, ArtifactType, ConfidenceClass, EngineType  # noqa: E402
from src.models.request import AnalysisOptions, AnalysisRequest  # noqa: E402
from support.mfs_synthetic_log import log_text, write_log  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "domain6"


def _request(raw: str | None = None, **kw) -> AnalysisRequest:
    return AnalysisRequest(
        job_id=kw.pop("job_id", "stream-job"), tenant_id="t", project_id="p", engine_type=kw.pop("engine_type", EngineType.MFS_BLACKBOX),
        raw_content=raw, artifact_type=ArtifactType.CSV, artifact_s3_key=kw.pop("artifact_s3_key", "tenants/t/projects/p/f/log.csv"),
        **kw,
    )


async def _chunks(data: bytes, size: int) -> AsyncIterator[bytes]:
    for i in range(0, len(data), size):
        yield data[i:i + size]


def _spool(text: str, tmp_path: Path, chunk: int = 7919, metadata: dict | None = None) -> SpooledArtifact:
    body = json.dumps(metadata or {"job_id": "x"}).encode() + b"\n" + text.encode("utf-8")
    meta, art = asyncio.run(read_framed_stream(_chunks(body, chunk), max_artifact_bytes=1 << 40, spool_dir=str(tmp_path)))
    assert json.loads(meta) == (metadata or {"job_id": "x"})
    return art


def _dump(resp) -> List[dict]:
    return [f.model_dump(mode="json") for f in resp.findings]


def _both(text: str, tmp_path: Path, **kw):
    inline = asyncio.run(EngineRunner.execute(_request(text, **kw)))
    with _spool(text, tmp_path) as art:
        streamed = asyncio.run(EngineRunner.execute_stream(_request(None, **kw), art))
    return inline, streamed


def _assert_identical(inline, streamed):
    assert inline.status == streamed.status
    assert _dump(inline) == _dump(streamed)
    a, b = inline.metrics.additional_metrics, streamed.metrics.additional_metrics
    for key in ("total_telegrams_parsed", "active_hus", "incident_duration_seconds", "telegram_error_rate",
                "first_causal_divergence", "topology_edges_count", "corrupted_rows_count", "artifactSha256",
                "bytesProcessed", "linesProcessed", "findingsSuppressed"):
        assert a.get(key) == b.get(key), key
    assert a["inputMode"] == "INLINE_LOG" and b["inputMode"] == "STREAM"


# ------------------------------------------------------------------------------------------ determinism
def test_golden_csv_fixture_identical(tmp_path):
    text = (FIXTURES / "mfs_telegram_log.csv").read_text(encoding="utf-8")
    inline, streamed = _both(text, tmp_path, configuration={"conveyor_edges": [["CP01", "CP02"]]})
    _assert_identical(inline, streamed)
    assert any(f.rule_id == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP" for f in streamed.findings)


def test_synthetic_log_with_every_incident_identical(tmp_path):
    text = log_text(600_000, incident_every=40)
    inline, streamed = _both(text, tmp_path)
    _assert_identical(inline, streamed)
    codes = {f.rule_id for f in streamed.findings}
    assert {"MFS_IMPOSSIBLE_TOPOLOGY_JUMP", "MFS_OUT_OF_ORDER_SEQUENCE", "MFS_DUPLICATE_TELEGRAM_SEND",
            "MFS_MISSING_ACK_TIMEOUT", "MFS_CORRUPTED_TELEGRAM", "MFS_FIRST_CAUSAL_DIVERGENCE"} <= codes
    for f in streamed.findings:
        assert f.evidence and len(f.evidence[0].sha256) == 64
        assert f.evidence[0].line_number >= 1


def test_topology_rows_after_the_telegrams_still_apply(tmp_path):
    """Two passes: EDGE rows at the end of a 1 MB log govern every telegram, as in the whole-file engine."""
    text = log_text(1_000_000, edges_at_end=True, incident_every=10_000_000)
    inline, streamed = _both(text, tmp_path)
    _assert_identical(inline, streamed)
    assert streamed.status == AnalysisStatus.COMPLETED
    assert streamed.findings == []


def test_crlf_and_blank_lines_identical(tmp_path):
    text = log_text(50_000, incident_every=30).replace("\n", "\r\n") + "\r\n\r\n"
    inline, streamed = _both(text, tmp_path)
    _assert_identical(inline, streamed)


def test_finding_cap_is_identical_and_partial(tmp_path):
    text = log_text(400_000, incident_every=5)
    inline, streamed = _both(text, tmp_path, options=AnalysisOptions(max_findings=25))
    _assert_identical(inline, streamed)
    assert streamed.status == AnalysisStatus.PARTIAL
    assert len(streamed.findings) == 25
    assert streamed.findings[-1].rule_id == "MFS_FIRST_CAUSAL_DIVERGENCE"
    metrics = streamed.metrics.additional_metrics
    assert metrics["findingsTruncated"] is True
    suppressed = sum(metrics["findingsSuppressed"].values())
    assert metrics["totalFindingsBeforeTruncation"] == len(streamed.findings) + suppressed
    # Corrupted-record findings are retained first (ordering of the whole-file engine).
    first_non_corrupt = next(i for i, f in enumerate(streamed.findings) if f.rule_id != "MFS_CORRUPTED_TELEGRAM")
    assert all(f.rule_id != "MFS_CORRUPTED_TELEGRAM" for f in streamed.findings[first_non_corrupt:])


def test_overlong_line_is_bounded_identically(tmp_path):
    header = "timestamp,type,hu_id,cp,seq_no,sender_plc,receiver_plc,status,time_sec\n"
    rows = "t,MOVE,HU_1,CP01,1,PLC01,EWM,OK,1.0\n" + "x" * (MAX_LINE_BYTES + 5000) + "\nt,MOVE,HU_1,CP07,2,PLC01,EWM,OK,2.0\n"
    inline, streamed = _both(header + rows, tmp_path)
    _assert_identical(inline, streamed)
    corrupt = [f for f in streamed.findings if f.rule_id == "MFS_CORRUPTED_TELEGRAM"]
    assert corrupt and corrupt[0].evidence[0].line_number == 3


def test_artifact_hash_and_counts(tmp_path):
    text = log_text(120_000, incident_every=1000)
    with _spool(text, tmp_path) as art:
        src = TextLineSource(text)
        assert (art.sha256, art.size_bytes, art.line_count) == (src.sha256, src.size_bytes, src.line_count)
        assert list(art.iter_lines()) == list(src.iter_lines())
        resp = asyncio.run(EngineRunner.execute_stream(_request(None), art))
    import hashlib
    assert resp.metrics.additional_metrics["artifactSha256"] == hashlib.sha256(text.encode()).hexdigest()


# ------------------------------------------------------------------------------------------ properties
_ROW = st.builds(
    lambda typ, hu, cp, seq, t, status: f"2026-09-24T00:00:00Z,{typ},{hu},{cp},{seq},PLC01,EWM,{status},{t}",
    st.sampled_from(["MOVE", "ACK", "TIMEOUT", "LIFE", "", "move"]),
    st.sampled_from(["HU_1", "HU_2", "HU_3", ""]),
    st.sampled_from(["CP01", "CP02", "CP03", "CP09", ""]),
    st.one_of(st.integers(min_value=0, max_value=30).map(str), st.just("")),
    st.floats(min_value=0, max_value=100, allow_nan=False).map(lambda v: f"{v:.2f}"),
    st.sampled_from(["OK", "RETRY", ""]),
)
_LINE = st.one_of(_ROW, _ROW, _ROW, st.just("EDGE,CP01,CP02"), st.just(""), st.text(max_size=40).filter(lambda s: "\n" not in s and "\r" not in s))


@settings(max_examples=60, deadline=5000, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
@given(st.lists(_LINE, min_size=1, max_size=40), st.integers(min_value=1, max_value=97))
def test_property_inline_equals_stream(tmp_path, lines, chunk):
    text = "timestamp,type,hu_id,cp,seq_no,sender_plc,receiver_plc,status,time_sec\n" + "\n".join(lines) + "\n"
    inline = asyncio.run(EngineRunner.execute(_request(text)))
    with _spool(text, tmp_path, chunk=chunk) as art:
        streamed = asyncio.run(EngineRunner.execute_stream(_request(None), art))
    assert inline.status == streamed.status
    assert _dump(inline) == _dump(streamed)


@settings(max_examples=80, deadline=3000, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
@given(st.text(max_size=300), st.integers(min_value=1, max_value=64))
def test_property_chunking_never_changes_lines(tmp_path, text, chunk):
    with _spool(text, tmp_path, chunk=chunk) as art:
        assert list(art.iter_lines()) == list(TextLineSource(text).iter_lines())
        assert art.sha256 == TextLineSource(text).sha256


# ------------------------------------------------------------------------------------------ framing
def test_framing_errors(tmp_path):
    with pytest.raises(StreamFramingError):
        asyncio.run(read_framed_stream(_chunks(b"", 10), 1000, str(tmp_path)))
    with pytest.raises(StreamFramingError):
        asyncio.run(read_framed_stream(_chunks(b"x" * (2 * 1024 * 1024), 65536), 1 << 30, str(tmp_path)))
    with pytest.raises(StreamTooLargeError):
        asyncio.run(read_framed_stream(_chunks(b"{}\n" + b"a" * 5000, 100), 1000, str(tmp_path)))
    assert list(tmp_path.iterdir()) == []  # spool files are removed on error


# ------------------------------------------------------------------------------------------ memory bound
def test_memory_bound_on_200mb_log(tmp_path):
    """tracemalloc peak while evaluating a >= 200 MB log is bounded (a whole-file read would need > 200 MB)."""
    path = tmp_path / "mfs_200mb.log"
    size, sha, lines = write_log(path, 200 * 1024 * 1024)
    assert size >= 200 * 1024 * 1024
    art = SpooledArtifact(str(path), size, sha, lines)
    engine = EngineRegistry.get(EngineType.MFS_BLACKBOX)
    tracemalloc.start()
    try:
        tracemalloc.reset_peak()
        resp = asyncio.run(engine.analyze_stream(_request(None), art))
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert peak < 48 * 1024 * 1024, f"peak {peak} bytes"
    metrics = resp.metrics.additional_metrics
    assert metrics["bytesProcessed"] == size and metrics["artifactSha256"] == sha
    assert metrics["total_telegrams_parsed"] > 2_500_000
    codes = {f.rule_id for f in resp.findings}
    assert {"MFS_IMPOSSIBLE_TOPOLOGY_JUMP", "MFS_OUT_OF_ORDER_SEQUENCE", "MFS_DUPLICATE_TELEGRAM_SEND",
            "MFS_MISSING_ACK_TIMEOUT", "MFS_CORRUPTED_TELEGRAM"} <= codes


# ------------------------------------------------------------------------------------------ HTTP endpoint
def _body(meta: dict, artifact: bytes) -> bytes:
    return json.dumps(meta).encode() + b"\n" + artifact


META = {"job_id": "http-stream", "tenant_id": "t", "project_id": "p", "engine_type": "MFS_BLACKBOX",
        "artifact_s3_key": "tenants/t/projects/p/f/log.csv", "artifact_type": "CSV"}


def test_endpoint_streams_and_matches_inline(client):
    text = log_text(300_000, incident_every=50)
    res = client.post("/api/v1/analyze/stream", content=_body(META, text.encode()))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "COMPLETED"
    assert body["metrics"]["additional_metrics"]["inputMode"] == "STREAM"
    assert body["metrics"]["additional_metrics"]["telemetry"]["memoryMeasurement"] == "RSS_PEAK_DELTA"
    inline = client.post("/api/v1/analyze", json={**META, "raw_content": text}).json()
    assert [f["id"] for f in inline["findings"]] == [f["id"] for f in body["findings"]]
    assert inline["findings"] == body["findings"]


def test_endpoint_rejects_non_streaming_engine(client):
    res = client.post("/api/v1/analyze/stream", content=_body({**META, "engine_type": "OPD_GUARD"}, b"a,b\n1,2\n"))
    assert res.status_code == 422


def test_endpoint_rejects_bad_framing_and_inline_content(client):
    assert client.post("/api/v1/analyze/stream", content=b"").status_code == 400
    assert client.post("/api/v1/analyze/stream", content=b"not json\nabc").status_code == 400
    res = client.post("/api/v1/analyze/stream", content=_body({**META, "raw_content": "x"}, b"a"))
    assert res.status_code == 400


def test_endpoint_json_artifact_is_an_input_error_not_a_verdict(client):
    res = client.post("/api/v1/analyze/stream", content=_body(META, b'{"telegrams": [{"type": "MOVE"}]}'))
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "FAILED"
    assert [f["rule_id"] for f in body["findings"]] == ["MFS_INVALID_INPUT"]
    assert body["findings"][0]["confidence"] == ConfidenceClass.UNKNOWN.value


def test_endpoint_contract_rejects_unrelated_csv(client):
    res = client.post("/api/v1/analyze/stream", content=_body(META, b"name,city\nalice,berlin\nbob,paris\n"))
    assert res.json()["findings"][0]["rule_id"] == "MFS_INVALID_INPUT"


def test_endpoint_size_cap(client, monkeypatch):
    monkeypatch.setenv("MAX_STREAM_SIZE_MB", "0")
    res = client.post("/api/v1/analyze/stream", content=_body(META, b"timestamp,type,hu_id,cp\n"))
    assert res.status_code == 413


def test_catalog_advertises_streaming(client):
    entry = client.get("/api/v1/engines/MFS_BLACKBOX").json()
    assert entry["streaming"] == {"supported": True, "formats": ["CSV"]}
    assert client.get("/api/v1/engines/OPD_GUARD").json()["streaming"]["supported"] is False
