# ruff: noqa: E402
"""ERP Preflight — Domain 6 Warehouse Automation (MFS BlackBox) Pytest Suite.

Engine Covered:
Feature 36: MFS BlackBox Preflight Engine (MFS_BLACKBOX)

Governing Standard: AGENTS.md, Cardinal Axiom 2 (14 architectural points), engine-authoring.md, sap-evidence.md
Pass Rate Requirement: 100% automated pass rate under pytest with Python 3.12/3.13
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import pytest

# Ensure services/analysis-python is in python path
for p in Path(__file__).resolve().parents:
    cand_srv = p / "services" / "analysis-python"
    if cand_srv.is_dir() and str(cand_srv) not in sys.path:
        sys.path.insert(0, str(cand_srv))
        break

import src.engines  # noqa: F401
from src.core.runner import EngineRunner
from src.core.registry import EngineRegistry
from src.engines.mfs_blackbox import MFSBlackBoxEngine
from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
)
from src.models.finding import Finding
from src.models.request import AnalysisRequest
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine


@pytest.fixture
def fixtures_dir() -> Path:
    """Returns absolute path to Domain 6 golden fixtures directory."""
    return Path(__file__).resolve().parents[1] / "fixtures" / "domain6"


# ==============================================================================
# 1. Point 1: Metadata & Registration Tests
# ==============================================================================

def test_mfs_engine_metadata():
    """Verifies MFS BlackBox engine registration, metadata, and 14-point anatomy Point 1."""
    engine = EngineRegistry.get(EngineType.MFS_BLACKBOX)
    assert engine is not None
    assert isinstance(engine, MFSBlackBoxEngine)

    meta = engine.get_metadata()
    assert meta["engine_type"] == "MFS_BLACKBOX"
    assert meta["name"] == "MFS BlackBox"
    assert "telegram sequence" in meta["description"].lower()
    assert meta["version"] == "1.1.0"  # 1.1.0: bounded-memory streaming transport
    assert "CSV" in meta["supported_artifact_types"]
    assert "JSON" in meta["supported_artifact_types"]
    assert "TXT" in meta["supported_artifact_types"]


# ==============================================================================
# 2. Golden Fixture Tests (Points 8 & 9)
# ==============================================================================

@pytest.mark.asyncio
async def test_mfs_normal_flow_json_fixture(fixtures_dir: Path):
    """Verifies that normal sequential telegram flow with timely ACKs produces 0 findings."""
    fixture_path = fixtures_dir / "mfs_normal_flow.json"
    assert fixture_path.exists(), f"Fixture missing: {fixture_path}"

    content = fixture_path.read_text(encoding="utf-8")
    req = AnalysisRequest(
        job_id="test-job-normal-01",
        tenant_id="tenant-d6-test",
        project_id="proj-d6-test",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=content,
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    assert response.status == AnalysisStatus.COMPLETED
    assert len(response.findings) == 0
    assert response.metrics.rules_evaluated > 0
    assert response.metrics.additional_metrics["total_telegrams_parsed"] == 8
    assert response.metrics.additional_metrics["telegram_error_rate"] == 0.0
    assert response.metrics.additional_metrics["first_causal_divergence"] is None


@pytest.mark.asyncio
async def test_mfs_jump_stream_json_fixture(fixtures_dir: Path):
    """Verifies detection of impossible conveyor topology jump in golden fixture."""
    fixture_path = fixtures_dir / "mfs_jump_stream.json"
    assert fixture_path.exists(), f"Fixture missing: {fixture_path}"

    content = fixture_path.read_text(encoding="utf-8")
    req = AnalysisRequest(
        job_id="test-job-jump-01",
        tenant_id="tenant-d6-test",
        project_id="proj-d6-test",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=content,
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    assert response.status == AnalysisStatus.COMPLETED
    assert len(response.findings) >= 1

    jump_finding = next((f for f in response.findings if f.rule_id == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP"), None)
    assert jump_finding is not None
    assert jump_finding.severity == Severity.CRITICAL
    assert jump_finding.confidence == ConfidenceClass.VERIFIED
    assert jump_finding.technical_details["from_cp"] == "CP01"
    assert jump_finding.technical_details["to_cp"] == "CP05"
    assert jump_finding.technical_details["hu_id"] == "HU_8811"
    assert "CP01" in jump_finding.affected_objects
    assert "CP05" in jump_finding.affected_objects

    # First causal divergence verified
    assert response.metrics.additional_metrics["first_causal_divergence"] is not None
    assert response.metrics.additional_metrics["first_causal_divergence"]["code"] == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP"


@pytest.mark.asyncio
async def test_mfs_ack_retry_storm_fixture(fixtures_dir: Path):
    """Verifies detection of duplicate send retry storm and missing ACK timeout."""
    fixture_path = fixtures_dir / "mfs_ack_retry_storm.json"
    assert fixture_path.exists(), f"Fixture missing: {fixture_path}"

    content = fixture_path.read_text(encoding="utf-8")
    req = AnalysisRequest(
        job_id="test-job-retry-01",
        tenant_id="tenant-d6-test",
        project_id="proj-d6-test",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=content,
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    assert response.status == AnalysisStatus.COMPLETED

    rule_ids = {f.rule_id for f in response.findings}
    assert "MFS_DUPLICATE_TELEGRAM_SEND" in rule_ids
    assert "MFS_MISSING_ACK_TIMEOUT" in rule_ids

    dup_finding = next(f for f in response.findings if f.rule_id == "MFS_DUPLICATE_TELEGRAM_SEND")
    assert dup_finding.severity == Severity.MAJOR
    assert dup_finding.confidence == ConfidenceClass.VERIFIED
    assert dup_finding.technical_details["repeat_count"] >= 2


@pytest.mark.asyncio
async def test_mfs_csv_log_fixture(fixtures_dir: Path):
    """Verifies CSV parsing, header mapping, and rule execution from CSV fixture."""
    fixture_path = fixtures_dir / "mfs_telegram_log.csv"
    assert fixture_path.exists(), f"Fixture missing: {fixture_path}"

    content = fixture_path.read_text(encoding="utf-8")
    req = AnalysisRequest(
        job_id="test-job-csv-01",
        tenant_id="tenant-d6-test",
        project_id="proj-d6-test",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=content,
        artifact_type=ArtifactType.CSV,
        configuration={"conveyor_edges": [["CP01", "CP02"]]},
    )

    response = await EngineRunner.execute(req)
    assert response.status == AnalysisStatus.COMPLETED
    assert response.metrics.additional_metrics["total_telegrams_parsed"] == 8

    # HU_5002 jumped to CP09 (no edge between CP01 and CP09)
    jump_f = next((f for f in response.findings if f.rule_id == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP"), None)
    assert jump_f is not None
    assert jump_f.technical_details["hu_id"] == "HU_5002"
    assert jump_f.technical_details["to_cp"] == "CP09"


# ==============================================================================
# 3. Rule-Specific Unit Tests (Point 4: Deterministic Analysis)
# ==============================================================================

@pytest.mark.asyncio
async def test_mfs_impossible_topology_jump_direct():
    """Verifies topology jump rule details, remediation text, and SPRO reference."""
    payload = {
        "conveyor_edges": [["CP_A", "CP_B"], ["CP_B", "CP_C"]],
        "telegrams": [
            {"time_sec": 1.0, "type": "MOVE", "hu_id": "HU_ALPHA", "cp": "CP_A"},
            {"time_sec": 2.0, "type": "ACK", "hu_id": "HU_ALPHA", "cp": "CP_A"},
            {"time_sec": 4.0, "type": "MOVE", "hu_id": "HU_ALPHA", "cp": "CP_Z"},
        ],
    }

    req = AnalysisRequest(
        job_id="test-job-jump-direct",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=json.dumps(payload),
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    assert any(f.rule_id == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP" for f in response.findings)

    f = next(f for f in response.findings if f.rule_id == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP")
    assert "/SCWM/MFS" in f.remediation or "Define Communication Points" in f.remediation
    assert f.technical_details["from_cp"] == "CP_A"
    assert f.technical_details["to_cp"] == "CP_Z"


@pytest.mark.asyncio
async def test_mfs_missing_ack_timeout_explicit():
    """Verifies that an explicit TIMEOUT telegram flags MFS_MISSING_ACK_TIMEOUT."""
    payload = {
        "conveyor_edges": [["CP01", "CP02"]],
        "telegrams": [
            {"time_sec": 10.0, "type": "MOVE", "hu_id": "HU_TIMEOUT_1", "cp": "CP01"},
            {"time_sec": 16.0, "type": "TIMEOUT", "hu_id": "HU_TIMEOUT_1", "cp": "CP01"},
        ],
    }

    req = AnalysisRequest(
        job_id="test-job-timeout-01",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=json.dumps(payload),
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    assert any(f.rule_id == "MFS_MISSING_ACK_TIMEOUT" for f in response.findings)
    f = next(f for f in response.findings if f.rule_id == "MFS_MISSING_ACK_TIMEOUT")
    assert f.severity == Severity.CRITICAL
    assert f.confidence == ConfidenceClass.VERIFIED
    assert f.confidence_score == 1.0


@pytest.mark.asyncio
async def test_mfs_first_causal_divergence_pinpointing():
    """Verifies that earliest failure is isolated as first causal divergence among cascading errors."""
    payload = {
        "conveyor_edges": [["CP01", "CP02"]],
        "telegrams": [
            {"time_sec": 1.0, "type": "MOVE", "hu_id": "HU_ROOT", "cp": "CP01"},
            {"time_sec": 2.0, "type": "TIMEOUT", "hu_id": "HU_ROOT", "cp": "CP01"},  # Earliest failure
            {"time_sec": 4.0, "type": "MOVE", "hu_id": "HU_ROOT", "cp": "CP01"},
            {"time_sec": 4.5, "type": "MOVE", "hu_id": "HU_ROOT", "cp": "CP01"},      # Duplicate send
            {"time_sec": 7.0, "type": "MOVE", "hu_id": "HU_ROOT", "cp": "CP99"},      # Impossible jump
        ],
    }

    req = AnalysisRequest(
        job_id="test-job-causal-01",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=json.dumps(payload),
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    first_div = response.metrics.additional_metrics.get("first_causal_divergence")
    assert first_div is not None
    assert first_div["code"] == "MFS_MISSING_ACK_TIMEOUT"
    assert first_div["time_sec"] == 2.0

    # Overarching causal diagnosis finding should be emitted for cascading failures
    causal_finding = next((f for f in response.findings if f.rule_id == "MFS_FIRST_CAUSAL_DIVERGENCE"), None)
    assert causal_finding is not None
    assert causal_finding.technical_details["root_cause_rule_id"] == "MFS_MISSING_ACK_TIMEOUT"
    assert causal_finding.technical_details["downstream_cascade_count"] >= 2


@pytest.mark.asyncio
async def test_mfs_out_of_order_sequence_inverted():
    """Verifies detection of sequence counter inversion on PLC channel."""
    payload = {
        "conveyor_edges": [["CP01", "CP02"]],
        "telegrams": [
            {"time_sec": 1.0, "type": "MOVE", "hu_id": "HU_SEQ", "cp": "CP01", "seq_no": 10, "sender_plc": "PLC_MAIN"},
            {"time_sec": 2.0, "type": "MOVE", "hu_id": "HU_SEQ", "cp": "CP02", "seq_no": 4, "sender_plc": "PLC_MAIN"},
        ],
    }

    req = AnalysisRequest(
        job_id="test-job-seq-01",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=json.dumps(payload),
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    f = next((f for f in response.findings if f.rule_id == "MFS_OUT_OF_ORDER_SEQUENCE"), None)
    assert f is not None
    assert f.severity == Severity.MAJOR
    assert f.confidence == ConfidenceClass.VERIFIED
    assert f.technical_details["seq_no"] == 4
    assert f.technical_details["last_seq"] == 10


@pytest.mark.asyncio
async def test_mfs_out_of_order_sequence_gap():
    """Verifies detection of sequence counter gap (dropped telegrams)."""
    payload = {
        "conveyor_edges": [["CP01", "CP02"]],
        "telegrams": [
            {"time_sec": 1.0, "type": "MOVE", "hu_id": "HU_GAP", "cp": "CP01", "seq_no": 100, "sender_plc": "PLC_A"},
            {"time_sec": 2.0, "type": "MOVE", "hu_id": "HU_GAP", "cp": "CP02", "seq_no": 105, "sender_plc": "PLC_A"},
        ],
    }

    req = AnalysisRequest(
        job_id="test-job-gap-01",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=json.dumps(payload),
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    f = next((f for f in response.findings if f.rule_id == "MFS_OUT_OF_ORDER_SEQUENCE"), None)
    assert f is not None
    assert f.technical_details["gap"] == 4  # 101, 102, 103, 104 missing


@pytest.mark.asyncio
async def test_mfs_duplicate_telegram_retry_storm():
    """Verifies duplicate telegram transmission detection (PLC retry storm)."""
    payload = {
        "conveyor_edges": [["CP01", "CP02"]],
        "telegrams": [
            {"time_sec": 10.0, "type": "MOVE", "hu_id": "HU_DUP", "cp": "CP01"},
            {"time_sec": 10.5, "type": "MOVE", "hu_id": "HU_DUP", "cp": "CP01"},
            {"time_sec": 11.0, "type": "MOVE", "hu_id": "HU_DUP", "cp": "CP01"},
        ],
    }

    req = AnalysisRequest(
        job_id="test-job-dup-01",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=json.dumps(payload),
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    dup_findings = [f for f in response.findings if f.rule_id == "MFS_DUPLICATE_TELEGRAM_SEND"]
    assert len(dup_findings) >= 1
    assert dup_findings[0].severity == Severity.MAJOR


# ==============================================================================
# 4. Multi-Delimiter & Data Ingestion Tests (Point 3: Deterministic Parser)
# ==============================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize("delimiter", [",", ";", "\t", "|"])
async def test_mfs_delimiter_detection_varieties(delimiter: str):
    """Verifies that parser automatically sniffs comma, semicolon, tab, and pipe delimiters."""
    lines = [
        delimiter.join(["timestamp", "type", "hu_id", "cp", "seq_no", "sender_plc", "receiver_plc", "status", "time_sec"]),
        delimiter.join(["2026-09-24T03:14:00Z", "MOVE", "HU_DELIM", "CP01", "1", "PLC01", "EWM", "OK", "1.0"]),
        delimiter.join(["2026-09-24T03:14:01Z", "ACK", "HU_DELIM", "CP01", "1", "EWM", "PLC01", "OK", "1.2"]),
        delimiter.join(["2026-09-24T03:14:03Z", "MOVE", "HU_DELIM", "CP02", "2", "PLC01", "EWM", "OK", "3.0"]),
    ]
    raw_content = "\n".join(lines)

    req = AnalysisRequest(
        job_id=f"test-delim-{delimiter}",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=raw_content,
        artifact_type=ArtifactType.CSV,
        configuration={"conveyor_edges": [["CP01", "CP02"]]},
    )

    response = await EngineRunner.execute(req)
    assert response.status == AnalysisStatus.COMPLETED
    assert response.metrics.additional_metrics["total_telegrams_parsed"] == 3
    assert len(response.findings) == 0


@pytest.mark.asyncio
async def test_mfs_corrupted_log_rows_fail_closed():
    """Verifies that corrupted log lines produce MFS_CORRUPTED_TELEGRAM with UNKNOWN confidence (0.30)."""
    corrupt_csv = (
        "timestamp,type,hu_id,cp,seq_no,sender_plc,receiver_plc,status,time_sec\n"
        "2026-09-24T03:14:00Z,MOVE,HU_VALID,CP01,1,PLC01,EWM,OK,1.0\n"
        "MALFORMED_LINE_WITHOUT_COLUMNS\n"
        "2026-09-24T03:14:02Z,,HU_NO_TYPE,CP01,2,PLC01,EWM,OK,2.0\n"
    )

    req = AnalysisRequest(
        job_id="test-job-corrupt-01",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=corrupt_csv,
        artifact_type=ArtifactType.CSV,
    )

    response = await EngineRunner.execute(req)
    corrupted_findings = [f for f in response.findings if f.rule_id == "MFS_CORRUPTED_TELEGRAM"]
    assert len(corrupted_findings) >= 1

    for cf in corrupted_findings:
        assert cf.confidence == ConfidenceClass.UNKNOWN
        assert cf.confidence_score == 0.30
        assert len(cf.evidence) > 0


# ==============================================================================
# 5. Cryptographic Evidence & Confidence Invariants (Points 6 & 7)
# ==============================================================================

@pytest.mark.asyncio
async def test_mfs_evidence_cryptographic_integrity():
    """Verifies that every finding contains cryptographic SHA-256 evidence with line/column coordinates."""
    payload = {
        "conveyor_edges": [["CP01", "CP02"]],
        "telegrams": [
            {"time_sec": 1.0, "type": "MOVE", "hu_id": "HU_EV1", "cp": "CP01"},
            {"time_sec": 2.0, "type": "MOVE", "hu_id": "HU_EV1", "cp": "CP99"},  # Jump
        ],
    }

    req = AnalysisRequest(
        job_id="test-job-ev-01",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=json.dumps(payload),
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    assert len(response.findings) >= 1

    for f in response.findings:
        assert len(f.evidence) > 0, f"Finding {f.rule_id} missing evidence records"
        for ev in f.evidence:
            assert ev.sha256, "Evidence SHA-256 cannot be empty"
            assert len(ev.sha256) == 64, "Evidence SHA-256 must be valid 64-char hex string"
            assert ev.line_number >= 1, "Line number must be 1-indexed"
            assert ev.column_number >= 1, "Column number must be 1-indexed"
            assert ev.snippet, "Evidence snippet cannot be empty"

            # Cryptographic verification against EvidenceEngine
            calc_hash = EvidenceEngine.compute_sha256(ev.snippet)
            assert ev.sha256 == calc_hash


@pytest.mark.asyncio
async def test_mfs_confidence_classifier_invariants():
    """Verifies confidence demotion: missing evidence demotes to UNKNOWN (0.30), AI ceiling (0.60)."""
    # 1. Test missing evidence demotion
    finding_no_ev = Finding(
        rule_id="MFS_TEST_RULE",
        severity=Severity.CRITICAL,
        category="TEST",
        title="Test finding without evidence",
        description="Test description",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Test remediation",
        evidence=[],
    )
    classified = ConfidenceClassifier.classify(finding_no_ev)
    assert classified.confidence == ConfidenceClass.UNKNOWN
    assert classified.confidence_score == 0.30

    # 2. Test AI involvement ceiling (capped at INFERRED 0.60)
    ev = EvidenceEngine.create_evidence(
        artifact_path="test.json",
        content="snippet",
        line_number=1,
        snippet="snippet",
        provenance=ConfidenceClass.VERIFIED,
    )
    finding_ai = Finding(
        rule_id="MFS_TEST_AI",
        severity=Severity.CRITICAL,
        category="TEST",
        title="AI-assisted finding",
        description="Test description",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Test remediation",
        evidence=[ev],
        is_ai_generated=True,
    )
    classified_ai = ConfidenceClassifier.classify(finding_ai)
    assert classified_ai.confidence == ConfidenceClass.INFERRED
    assert classified_ai.confidence_score <= 0.60


# ==============================================================================
# 6. Backward Compatibility: evaluate() Classmethod Tests
# ==============================================================================

def test_mfs_evaluate_classmethod_normal_flow():
    """Verifies that MFSBlackBoxEngine.evaluate matches MFSBlackBoxEvaluator on normal flow."""
    telegrams = [
        {"type": "MOVE", "hu_id": "HU_1", "cp": "CP01", "time_sec": 1.0},
        {"type": "ACK", "hu_id": "HU_1", "cp": "CP01", "time_sec": 1.2},
        {"type": "MOVE", "hu_id": "HU_1", "cp": "CP02", "time_sec": 3.0},
    ]
    edges = {("CP01", "CP02")}
    res = MFSBlackBoxEngine.evaluate(telegrams, edges)

    assert res["status"] == "COMPLETED"
    assert len(res["findings"]) == 0
    assert res["first_causal_divergence"] is None


def test_mfs_evaluate_classmethod_jump():
    """Verifies that MFSBlackBoxEngine.evaluate correctly detects topology jump."""
    telegrams = [
        {"type": "MOVE", "hu_id": "HU_8811", "cp": "CP01", "time_sec": 10.0},
        {"type": "ACK", "hu_id": "HU_8811", "cp": "CP01", "time_sec": 10.2},
        {"type": "MOVE", "hu_id": "HU_8811", "cp": "CP05", "time_sec": 12.5},
    ]
    edges = {("CP01", "CP02"), ("CP02", "CP03"), ("CP03", "CP04"), ("CP04", "CP05")}
    res = MFSBlackBoxEngine.evaluate(telegrams, edges)

    assert res["status"] == "COMPLETED"
    assert any(f["code"] == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP" for f in res["findings"])
    assert res["first_causal_divergence"] is not None
    assert res["first_causal_divergence"]["code"] == "MFS_IMPOSSIBLE_TOPOLOGY_JUMP"
    assert res["first_causal_divergence"]["from_cp"] == "CP01"
    assert res["first_causal_divergence"]["to_cp"] == "CP05"


def test_mfs_evaluate_classmethod_timeout():
    """Verifies that MFSBlackBoxEngine.evaluate flags missing ACK timeout."""
    telegrams = [
        {"type": "MOVE", "hu_id": "HU_1", "cp": "CP01", "time_sec": 1.0},
        {"type": "TIMEOUT", "hu_id": "HU_1", "cp": "CP01", "time_sec": 6.0},
    ]
    res = MFSBlackBoxEngine.evaluate(telegrams, set())

    assert any(f["code"] == "MFS_MISSING_ACK_TIMEOUT" for f in res["findings"])
    assert res["first_causal_divergence"]["code"] == "MFS_MISSING_ACK_TIMEOUT"


def test_mfs_evaluate_classmethod_earliest_failure():
    """Verifies that first_causal_divergence is chronologically the earliest failure."""
    telegrams = [
        {"type": "MOVE", "hu_id": "HU_1", "cp": "CP01", "time_sec": 1.0},
        {"type": "TIMEOUT", "hu_id": "HU_1", "cp": "CP01", "time_sec": 2.0},  # First divergence
        {"type": "MOVE", "hu_id": "HU_2", "cp": "CP09", "time_sec": 5.0},
    ]
    res = MFSBlackBoxEngine.evaluate(telegrams, set())
    assert res["first_causal_divergence"]["code"] == "MFS_MISSING_ACK_TIMEOUT"


def test_mfs_evaluate_classmethod_empty():
    """Verifies evaluate with empty telegram stream."""
    res = MFSBlackBoxEngine.evaluate([], set())
    assert res["status"] == "COMPLETED"
    assert len(res["findings"]) == 0
    assert res["first_causal_divergence"] is None


# ==============================================================================
# 7. Boundary, Null Safety & Telemetry Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_mfs_empty_payload_null_safety():
    """Verifies that empty string or null content does not crash the engine."""
    req = AnalysisRequest(
        job_id="test-job-empty",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content="",
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    # Empty input is rejected with a single UNKNOWN insufficient-input finding (no silent COMPLETED).
    assert response.status == AnalysisStatus.FAILED
    assert [f.rule_id for f in response.findings] == ["MFS_INSUFFICIENT_INPUT"]
    assert response.findings[0].confidence == ConfidenceClass.UNKNOWN


@pytest.mark.asyncio
async def test_mfs_telemetry_and_metrics_calculation():
    """Verifies that telemetry metrics accurately reflect duration, error rate, and active HUs."""
    telegrams = [
        {"time_sec": 1.0, "type": "MOVE", "hu_id": "HU_A", "cp": "CP01"},
        {"time_sec": 2.0, "type": "ACK", "hu_id": "HU_A", "cp": "CP01"},
        {"time_sec": 5.0, "type": "MOVE", "hu_id": "HU_B", "cp": "CP01"},
        {"time_sec": 6.0, "type": "ACK", "hu_id": "HU_B", "cp": "CP01"},
        {"time_sec": 11.0, "type": "MOVE", "hu_id": "HU_A", "cp": "CP09"},  # Jump (1 finding)
    ]
    payload = {
        "conveyor_edges": [["CP01", "CP02"]],
        "telegrams": telegrams,
    }

    req = AnalysisRequest(
        job_id="test-job-telemetry",
        tenant_id="t1",
        project_id="p1",
        engine_type=EngineType.MFS_BLACKBOX,
        raw_content=json.dumps(payload),
        artifact_type=ArtifactType.JSON,
    )

    response = await EngineRunner.execute(req)
    m = response.metrics
    assert m.rules_evaluated > 0
    assert m.additional_metrics["total_telegrams_parsed"] == 5
    assert m.additional_metrics["active_hus"] == 2
    assert m.additional_metrics["incident_duration_seconds"] == 10.0  # 11.0 - 1.0
    assert m.additional_metrics["topology_edges_count"] == 1
    assert m.additional_metrics["telegram_error_rate"] > 0.0
