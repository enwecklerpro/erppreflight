"""Verification unit tests for proposed Custom Field Flow Doctor and Extension Impact Guard engines.
"""

import json
import pytest
import sys
from pathlib import Path

# Add repo root to path
repo_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.models.request import AnalysisRequest
from src.models.enums import EngineType, Severity, ConfidenceClass, AnalysisStatus
from proposed_custom_field_flow import CustomFieldFlowEngine
from proposed_extension_impact import ExtensionImpactEngine


@pytest.mark.asyncio
async def test_custom_field_flow_po_to_gl_fixture():
    """Tests standard PO to GL flow triggering required BAdI finding."""
    fixture_path = repo_root / "tests" / "e2e" / "fixtures" / "custom_fields" / "custom_field_flow_po_to_gl.json"
    content = fixture_path.read_text(encoding="utf-8")

    engine = CustomFieldFlowEngine()
    req = AnalysisRequest(
        job_id="test-job-cfd-1",
        tenant_id="tenant-1",
        project_id="proj-1",
        engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
        target_release="S4HC_2408",
        raw_content=content,
    )
    resp = await engine.analyze(req)
    assert resp.status == AnalysisStatus.COMPLETED
    assert resp.engine_type == EngineType.CUSTOM_FIELD_FLOW_DOCTOR

    # In this fixture, hop 2 is MM_SUPPLIER_INVOICE_ITEM -> FI_JOURNAL_ENTRY_ITEM without active BAdI
    rule_ids = [f.rule_id for f in resp.findings]
    assert "FIELD_BADI_REQUIRED_NOT_FOUND" in rule_ids

    badi_finding = next(f for f in resp.findings if f.rule_id == "FIELD_BADI_REQUIRED_NOT_FOUND")
    assert badi_finding.severity == Severity.MAJOR
    assert badi_finding.confidence == ConfidenceClass.VERIFIED
    assert len(badi_finding.evidence) >= 1
    assert badi_finding.evidence[0].sha256 != ""
    assert badi_finding.evidence[0].line_number is not None


@pytest.mark.asyncio
async def test_custom_field_truncation_fixture():
    """Tests truncation defect where source length 50 exceeds target length 20."""
    fixture_path = repo_root / "tests" / "e2e" / "fixtures" / "custom_fields" / "custom_field_truncation.json"
    content = fixture_path.read_text(encoding="utf-8")

    engine = CustomFieldFlowEngine()
    req = AnalysisRequest(
        job_id="test-job-cfd-2",
        tenant_id="tenant-1",
        project_id="proj-1",
        engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
        target_release="S4HC_2408",
        raw_content=content,
    )
    resp = await engine.analyze(req)
    assert resp.status == AnalysisStatus.COMPLETED

    rule_ids = [f.rule_id for f in resp.findings]
    assert "FIELD_TYPE_MISMATCH" in rule_ids
    f = next(f for f in resp.findings if f.rule_id == "FIELD_TYPE_MISMATCH")
    assert f.severity == Severity.MAJOR
    assert "50" in f.description and "20" in f.description


@pytest.mark.asyncio
async def test_custom_field_missing_target_context():
    """Tests error when target context definition is missing."""
    payload = {
        "field_name": "YY1_TEST_FIELD",
        "hops": [["MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"]],
        "field_definitions": {
            "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 20}
            # Notice MM_SUPPLIER_INVOICE_ITEM is omitted
        },
    }
    engine = CustomFieldFlowEngine()
    req = AnalysisRequest(
        job_id="test-job-cfd-3",
        tenant_id="tenant-1",
        project_id="proj-1",
        engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
        raw_content=json.dumps(payload),
    )
    resp = await engine.analyze(req)
    rule_ids = [f.rule_id for f in resp.findings]
    assert "FIELD_MISSING_TARGET_CONTEXT" in rule_ids
    assert resp.metrics.additional_metrics["blocked_hops"] >= 1


@pytest.mark.asyncio
async def test_custom_field_architecturally_blocked_jump():
    """Tests error when attempting direct PO to Journal Entry propagation."""
    payload = {
        "field_name": "YY1_DIRECT_JUMP",
        "hops": [["MM_PURCHASE_ORDER_ITEM", "FI_JOURNAL_ENTRY_ITEM"]],
        "field_definitions": {
            "MM_PURCHASE_ORDER_ITEM": {"type": "CHAR", "length": 20},
            "FI_JOURNAL_ENTRY_ITEM": {"type": "CHAR", "length": 20},
        },
    }
    engine = CustomFieldFlowEngine()
    req = AnalysisRequest(
        job_id="test-job-cfd-4",
        tenant_id="tenant-1",
        project_id="proj-1",
        engine_type=EngineType.CUSTOM_FIELD_FLOW_DOCTOR,
        raw_content=json.dumps(payload),
    )
    resp = await engine.analyze(req)
    rule_ids = [f.rule_id for f in resp.findings]
    assert "FIELD_PROPAGATION_BLOCKED" in rule_ids


@pytest.mark.asyncio
async def test_extension_impact_graph_fixture():
    """Tests existing fixture with active consumers blocking deletion."""
    fixture_path = repo_root / "tests" / "e2e" / "fixtures" / "extension_impact" / "extension_graph.json"
    content = fixture_path.read_text(encoding="utf-8")

    engine = ExtensionImpactEngine()
    req = AnalysisRequest(
        job_id="test-job-ext-1",
        tenant_id="tenant-1",
        project_id="proj-1",
        engine_type=EngineType.EXTENSION_IMPACT_GUARD,
        target_release="S4HC_2408",
        raw_content=content,
        configuration={"target_object": "YY1_PROJECT_CODE", "action": "DELETE"},
    )
    resp = await engine.analyze(req)
    assert resp.status == AnalysisStatus.COMPLETED

    rule_ids = [f.rule_id for f in resp.findings]
    assert "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS" in rule_ids

    f = next(f for f in resp.findings if f.rule_id == "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS")
    assert f.severity == Severity.CRITICAL
    assert resp.metrics.additional_metrics["safe_to_delete"] is False
    assert resp.metrics.additional_metrics["direct_consumers_count"] == 2
    assert resp.metrics.additional_metrics["transitive_consumers_count"] == 3
    assert resp.metrics.additional_metrics["blast_radius_score"] > 0


@pytest.mark.asyncio
async def test_extension_impact_safe_to_delete_isolated_node():
    """Tests isolated extension object with 0 consumers producing safe verdict."""
    payload = {
        "target_object": "YY1_UNUSED_FIELD",
        "action": "DELETE",
        "graph": {
            "YY1_UNUSED_FIELD": [],
            "CDS_OTHER": ["API_OTHER"],
        },
    }
    engine = ExtensionImpactEngine()
    req = AnalysisRequest(
        job_id="test-job-ext-2",
        tenant_id="tenant-1",
        project_id="proj-1",
        engine_type=EngineType.EXTENSION_IMPACT_GUARD,
        raw_content=json.dumps(payload),
    )
    resp = await engine.analyze(req)
    rule_ids = [f.rule_id for f in resp.findings]
    assert "EXT_SAFE_TO_DELETE" in rule_ids
    assert resp.metrics.additional_metrics["safe_to_delete"] is True


@pytest.mark.asyncio
async def test_extension_impact_cyclic_dependency():
    """Tests cyclic dependency detection."""
    payload = {
        "target_object": "CDS_VIEW_A",
        "action": "DELETE",
        "graph": {
            "CDS_VIEW_A": ["CDS_VIEW_B"],
            "CDS_VIEW_B": ["CDS_VIEW_C"],
            "CDS_VIEW_C": ["CDS_VIEW_A"],
        },
    }
    engine = ExtensionImpactEngine()
    req = AnalysisRequest(
        job_id="test-job-ext-3",
        tenant_id="tenant-1",
        project_id="proj-1",
        engine_type=EngineType.EXTENSION_IMPACT_GUARD,
        raw_content=json.dumps(payload),
    )
    resp = await engine.analyze(req)
    rule_ids = [f.rule_id for f in resp.findings]
    assert "EXT_CYCLIC_DEPENDENCY_DETECTED" in rule_ids
    cycle_finding = next(f for f in resp.findings if f.rule_id == "EXT_CYCLIC_DEPENDENCY_DETECTED")
    assert cycle_finding.severity == Severity.BLOCKER
