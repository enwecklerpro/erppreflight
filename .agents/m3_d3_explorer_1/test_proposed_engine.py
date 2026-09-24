"""
Pytest Test Suite for Proposed Change Pointer Coverage Auditor Engine.

Validates:
1. 100% compliance with Cardinal Axiom 2.
2. Canonical Severity enums (BLOCKER, CRITICAL, MAJOR, MINOR, INFO).
3. Cryptographic Evidence chains with line coordinates and SHA-256 hashes.
4. Epistemic Confidence classification (VERIFIED, RULE_DERIVED, UNKNOWN).
5. All 7 domain rules:
   - BD61 global activation (CP_GLOBAL_DEACTIVATED)
   - BD50 message type activation (CP_MSG_TYPE_DEACTIVATED)
   - BD52 field linkages (CP_FIELD_NOT_CONFIGURED_BD52)
   - DD04L change document flag (CP_FIELD_DD04L_CHGFLAG_MISSING)
   - Custom field omission (CP_CUSTOM_FIELD_OMITTED_BD52)
   - Reduced message type filtering (CP_FIELD_FILTERED_BD53)
   - BDCP2 runtime backlog (CP_RUNTIME_UNPROCESSED_BACKLOG)
6. E2E fixtures compatibility (cp_valid.json, cp_missing_groes.json, cp_global_disabled.json).
7. Tabular CSV input format and multi-artifact requests.
8. Property-based and fuzz resilience (malformed inputs, boundary values).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
import pytest

# Ensure analysis-python and agent working directory are in python path
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
ANALYSIS_PYTHON_DIR = ROOT_DIR / "services" / "analysis-python"
CURRENT_AGENT_DIR = Path(__file__).resolve().parent

if str(ANALYSIS_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(ANALYSIS_PYTHON_DIR))
if str(CURRENT_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_AGENT_DIR))

from proposed_change_pointer import ChangePointerEngine
from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
)
from src.models.request import AnalysisRequest, ArtifactReference
from tests.e2e.evaluators import ChangePointerAuditorEvaluator


@pytest.fixture
def engine() -> ChangePointerEngine:
    return ChangePointerEngine()


# ==============================================================================
# 1. E2E Fixtures & Backward Compatibility Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_valid_configuration_100_percent_coverage(engine: ChangePointerEngine):
    fixture_path = ROOT_DIR / "tests" / "e2e" / "fixtures" / "change_pointer" / "cp_valid.json"
    raw_content = fixture_path.read_text(encoding="utf-8")

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000001",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )

    resp = await engine.analyze(req)

    assert resp.status == AnalysisStatus.COMPLETED
    assert len(resp.findings) == 0
    assert resp.metrics.additional_metrics["coverage_percentage"] == 100.0
    assert resp.metrics.additional_metrics["coveragePercentage"] == 100.0
    assert resp.metrics.additional_metrics["global_active"] is True
    assert resp.metrics.additional_metrics["message_type_active"] is True


@pytest.mark.asyncio
async def test_global_bd61_deactivated_critical_finding(engine: ChangePointerEngine):
    fixture_path = ROOT_DIR / "tests" / "e2e" / "fixtures" / "change_pointer" / "cp_global_disabled.json"
    raw_content = fixture_path.read_text(encoding="utf-8")

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000002",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )

    resp = await engine.analyze(req)

    assert resp.status == AnalysisStatus.PARTIAL
    assert any(f.rule_id == "CP_GLOBAL_DEACTIVATED" for f in resp.findings)
    global_finding = next(f for f in resp.findings if f.rule_id == "CP_GLOBAL_DEACTIVATED")
    assert global_finding.severity == Severity.CRITICAL
    assert global_finding.confidence == ConfidenceClass.VERIFIED
    assert len(global_finding.evidence) == 1
    assert global_finding.evidence[0].line_number >= 1
    assert global_finding.evidence[0].sha256 != ""


@pytest.mark.asyncio
async def test_missing_trigger_field_groes_flagged(engine: ChangePointerEngine):
    fixture_path = ROOT_DIR / "tests" / "e2e" / "fixtures" / "change_pointer" / "cp_missing_groes.json"
    raw_content = fixture_path.read_text(encoding="utf-8")

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000003",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_content,
    )

    resp = await engine.analyze(req)

    assert resp.status == AnalysisStatus.COMPLETED
    assert resp.metrics.additional_metrics["coverage_percentage"] == 66.7
    groes_findings = [f for f in resp.findings if f.rule_id == "CP_FIELD_NOT_CONFIGURED_BD52"]
    assert len(groes_findings) == 1
    f = groes_findings[0]
    assert f.technical_details["field"] == "GROES"
    assert f.technical_details["table"] == "MARA"
    assert f.severity == Severity.MAJOR
    assert f.confidence == ConfidenceClass.VERIFIED


# ==============================================================================
# 2. Domain Rule Coverage & Edge Cases
# ==============================================================================

@pytest.mark.asyncio
async def test_message_type_deactivated_bd50(engine: ChangePointerEngine):
    payload = {
        "bd61_active": True,
        "bd50_msg_types": ["DEBMAS"],  # Target MATMAS is not active
        "target_message_type": "MATMAS",
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
    }

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000004",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=json.dumps(payload, indent=2),
    )

    resp = await engine.analyze(req)
    assert any(f.rule_id == "CP_MSG_TYPE_DEACTIVATED" for f in resp.findings)
    f = next(f for f in resp.findings if f.rule_id == "CP_MSG_TYPE_DEACTIVATED")
    assert f.severity == Severity.CRITICAL
    assert "MATMAS" in f.title


@pytest.mark.asyncio
async def test_dd04l_change_document_flag_missing(engine: ChangePointerEngine):
    payload = {
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"], ["MARA", "GROES"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "GROES"]],
        "dd04l_metadata": {
            "MARA-MATKL": {"change_document_flag": True},
            "MARA-GROES": {"change_document_flag": False, "data_element": "GROES"},
        },
    }

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000005",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=json.dumps(payload, indent=2),
    )

    resp = await engine.analyze(req)
    dd04l_findings = [f for f in resp.findings if f.rule_id == "CP_FIELD_DD04L_CHGFLAG_MISSING"]
    assert len(dd04l_findings) == 1
    f = dd04l_findings[0]
    assert f.severity == Severity.MAJOR
    assert "MARA-GROES" in f.title
    assert f.technical_details["data_element"] == "GROES"


@pytest.mark.asyncio
async def test_custom_field_omitted_from_bd52(engine: ChangePointerEngine):
    payload = {
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "YY1_SPECIAL_ATTR_PRD"]],
    }

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000006",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=json.dumps(payload, indent=2),
    )

    resp = await engine.analyze(req)
    custom_findings = [f for f in resp.findings if f.rule_id == "CP_CUSTOM_FIELD_OMITTED_BD52"]
    assert len(custom_findings) == 1
    f = custom_findings[0]
    assert f.severity == Severity.MAJOR
    assert f.confidence == ConfidenceClass.RULE_DERIVED
    assert "YY1_SPECIAL_ATTR_PRD" in f.title


@pytest.mark.asyncio
async def test_reduced_message_type_filtered_bd53(engine: ChangePointerEngine):
    payload = {
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"], ["MARA", "BISMT"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "BISMT"]],
        "bd53_reduced_fields": ["MARA-BISMT"],
    }

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000007",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=json.dumps(payload, indent=2),
    )

    resp = await engine.analyze(req)
    bd53_findings = [f for f in resp.findings if f.rule_id == "CP_FIELD_FILTERED_BD53"]
    assert len(bd53_findings) == 1
    f = bd53_findings[0]
    assert f.severity == Severity.MINOR
    assert "MARA-BISMT" in f.title


@pytest.mark.asyncio
async def test_runtime_unprocessed_backlog_bdcp2(engine: ChangePointerEngine):
    payload = {
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
        "bdcp2_samples": [
            {"table": "MARA", "field": "MATKL", "process_status": " ", "count": 250},
            {"table": "MARA", "field": "MATKL", "process_status": "X", "count": 500},
        ],
    }

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000008",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=json.dumps(payload, indent=2),
    )

    resp = await engine.analyze(req)
    backlog_findings = [f for f in resp.findings if f.rule_id == "CP_RUNTIME_UNPROCESSED_BACKLOG"]
    assert len(backlog_findings) == 1
    f = backlog_findings[0]
    assert f.severity == Severity.MAJOR
    assert f.technical_details["unprocessed_count"] == 250


# ==============================================================================
# 3. Tabular CSV & Multi-Artifact Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_csv_format_parsing(engine: ChangePointerEngine):
    csv_content = (
        "BD61,X\n"
        "BD50,MATMAS,X\n"
        "BD52,MATMAS,MATERIAL,MARA,MATKL\n"
        "BD52,MATMAS,MATERIAL,MARA,GROES\n"
        "EXPECTED,MARA,MATKL\n"
        "EXPECTED,MARA,GROES\n"
        "DD04L,MARA,MATKL,X\n"
        "DD04L,MARA,GROES, \n"  # missing chgflag
    )

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000009",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=csv_content,
        artifact_type=ArtifactType.CSV,
    )

    resp = await engine.analyze(req)
    assert resp.status == AnalysisStatus.COMPLETED
    assert resp.metrics.additional_metrics["coverage_percentage"] == 100.0
    assert any(f.rule_id == "CP_FIELD_DD04L_CHGFLAG_MISSING" for f in resp.findings)


@pytest.mark.asyncio
async def test_multi_artifact_request_flow(engine: ChangePointerEngine):
    art = ArtifactReference(
        file_name="bd52_config.json",
        artifact_type=ArtifactType.JSON,
        raw_content=json.dumps({
            "bd61_active": True,
            "bd50_msg_types": ["MATMAS"],
            "bd52_fields": [["MARA", "MATKL"]],
            "expected_fields": [["MARA", "MATKL"], ["MARA", "GROES"]],
        }),
    )

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000010",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        artifacts=[art],
    )

    resp = await engine.analyze(req)
    assert resp.status == AnalysisStatus.COMPLETED
    assert resp.metrics.additional_metrics["coverage_percentage"] == 50.0


# ==============================================================================
# 4. Property & Resilience Testing (Fuzzing / Empty / Boundary)
# ==============================================================================

@pytest.mark.asyncio
async def test_empty_expected_fields_portfolio(engine: ChangePointerEngine):
    payload = {
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [],
        "expected_fields": [],
    }

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000011",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=json.dumps(payload),
    )

    resp = await engine.analyze(req)
    assert resp.metrics.additional_metrics["coverage_percentage"] == 100.0
    assert len(resp.findings) == 0


@pytest.mark.asyncio
async def test_corrupted_json_graceful_fallback(engine: ChangePointerEngine):
    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000012",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content="{ corrupt_json: [invalid, ",
        configuration={"bd61_active": True, "bd52_fields": [], "expected_fields": []},
    )

    resp = await engine.analyze(req)
    assert resp.status == AnalysisStatus.COMPLETED
    assert resp.metrics.additional_metrics["coverage_percentage"] == 100.0


# ==============================================================================
# 5. Direct Evaluator Cross-Validation
# ==============================================================================

def test_evaluator_parity_with_e2e_harness():
    res = ChangePointerAuditorEvaluator.evaluate(
        bd61_active=True,
        bd50_msg_types={"MATMAS"},
        bd52_fields=[("MARA", "MATKL")],
        expected_fields=[("MARA", "MATKL"), ("MARA", "GROES"), ("MARA", "MEINS"), ("MARA", "BRGEW")],
    )
    assert res["coverage_percentage"] == 25.0
    assert len(res["findings"]) == 3
