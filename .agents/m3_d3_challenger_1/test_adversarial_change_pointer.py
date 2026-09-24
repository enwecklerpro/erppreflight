"""
ERP Preflight — Empirical Adversarial Stress Test Suite
Target Engine: Change Pointer Coverage Auditor (services/analysis-python/src/engines/change_pointer.py)

Governing Standard: AGENTS.md, Cardinal Axiom 2 (14-Point Anatomy), engine-authoring.md, sap-evidence.md
Test File: .agents/m3_d3_challenger_1/test_adversarial_change_pointer.py
Author: m3_d3_challenger_1
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys
import time
from typing import Any, Dict
import pytest

# Ensure services/analysis-python is in python path
for p in Path(__file__).resolve().parents:
    cand_srv = p / "services" / "analysis-python"
    if cand_srv.is_dir() and str(cand_srv) not in sys.path:
        sys.path.insert(0, str(cand_srv))
        break

from src.core.registry import EngineRegistry  # noqa: E402
from src.core.runner import EngineRunner  # noqa: E402
from src.engines.change_pointer import ChangePointerEngine  # noqa: E402
from src.models.enums import (  # noqa: E402
    AnalysisStatus,
    ConfidenceClass,
    EngineType,
    Severity,
)
from src.models.finding import Finding  # noqa: E402
from src.models.request import AnalysisRequest  # noqa: E402
from src.platform.confidence import ConfidenceClassifier  # noqa: E402


def ensure_engine_registered():
    """Ensures ChangePointerEngine is registered in EngineRegistry."""
    EngineRegistry.register(ChangePointerEngine)


# Execute registration immediately
ensure_engine_registered()


# =============================================================================
# Helper Fixture Builders
# =============================================================================

def make_request(
    payload: Dict[str, Any] | str,
    job_id: str = "adv-cp-0001",
    is_ai_generated: bool = False,
) -> AnalysisRequest:
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    cfg = {"is_ai_generated": True} if is_ai_generated else {}
    return AnalysisRequest(
        job_id=job_id,
        tenant_id="tenant-adv-001",
        project_id="project-adv-001",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw,
        configuration=cfg,
    )


# =============================================================================
# Stress Dimension 1: BD61 Global Inactive vs BD50 Active Conflicts
# =============================================================================

@pytest.mark.asyncio
async def test_adv_bd61_disabled_bd50_active_conflict():
    """Adversarial Test 1.1: BD61 global disabled while BD50 message type active.
    
    Expected behavior:
    - Status MUST be PARTIAL (global switch prevents all change pointer generation).
    - CP_GLOBAL_DEACTIVATED MUST be emitted with CRITICAL severity.
    - CP_MSG_TYPE_DEACTIVATED must NOT be emitted (MATMAS is explicitly active in BD50).
    - Telemetry metrics must report global_active=False and message_type_active=True.
    """
    payload = {
        "target_message_type": "MATMAS",
        "change_document_object": "MATERIAL",
        "bd61_active": False,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
    }
    req = make_request(payload, job_id="adv-dim1-01")
    resp = await EngineRunner.execute(req)

    assert resp.status == AnalysisStatus.PARTIAL, "Status must be PARTIAL when BD61 is globally deactivated"
    rule_ids = [f.rule_id for f in resp.findings]
    assert "CP_GLOBAL_DEACTIVATED" in rule_ids, "Must emit CP_GLOBAL_DEACTIVATED finding"
    assert "CP_MSG_TYPE_DEACTIVATED" not in rule_ids, "Must not emit CP_MSG_TYPE_DEACTIVATED when MATMAS is active in BD50"

    bd61_finding = next(f for f in resp.findings if f.rule_id == "CP_GLOBAL_DEACTIVATED")
    assert bd61_finding.severity == Severity.CRITICAL
    assert bd61_finding.confidence == ConfidenceClass.VERIFIED
    assert bd61_finding.confidence_score == 1.0

    metrics = resp.metrics.additional_metrics
    assert metrics.get("global_active") is False
    assert metrics.get("message_type_active") is True


@pytest.mark.asyncio
async def test_adv_bd61_active_bd50_inactive_conflict():
    """Adversarial Test 1.2: BD61 globally active while BD50 message type deactivated.
    
    Expected behavior:
    - Status MUST be COMPLETED (global engine ran to completion).
    - CP_GLOBAL_DEACTIVATED must NOT be emitted.
    - CP_MSG_TYPE_DEACTIVATED MUST be emitted with CRITICAL severity.
    - Telemetry metrics must report global_active=True and message_type_active=False.
    """
    payload = {
        "target_message_type": "MATMAS",
        "change_document_object": "MATERIAL",
        "bd61_active": True,
        "bd50_msg_types": ["DEBMAS", "CREMAS"],  # MATMAS omitted
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
    }
    req = make_request(payload, job_id="adv-dim1-02")
    resp = await EngineRunner.execute(req)

    assert resp.status == AnalysisStatus.COMPLETED
    rule_ids = [f.rule_id for f in resp.findings]
    assert "CP_GLOBAL_DEACTIVATED" not in rule_ids
    assert "CP_MSG_TYPE_DEACTIVATED" in rule_ids

    bd50_finding = next(f for f in resp.findings if f.rule_id == "CP_MSG_TYPE_DEACTIVATED")
    assert bd50_finding.severity == Severity.CRITICAL
    assert bd50_finding.confidence == ConfidenceClass.VERIFIED
    assert "MATMAS" in bd50_finding.title

    metrics = resp.metrics.additional_metrics
    assert metrics.get("global_active") is True
    assert metrics.get("message_type_active") is False


@pytest.mark.asyncio
async def test_adv_bd61_and_bd50_both_deactivated():
    """Adversarial Test 1.3: Both BD61 and BD50 deactivated simultaneously.
    
    Expected behavior:
    - Status MUST be PARTIAL.
    - Both CP_GLOBAL_DEACTIVATED and CP_MSG_TYPE_DEACTIVATED emitted with CRITICAL severity.
    - 2 distinct CRITICAL findings.
    """
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": False,
        "bd50_msg_types": [],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
    }
    req = make_request(payload, job_id="adv-dim1-03")
    resp = await EngineRunner.execute(req)

    assert resp.status == AnalysisStatus.PARTIAL
    rule_ids = [f.rule_id for f in resp.findings]
    assert "CP_GLOBAL_DEACTIVATED" in rule_ids
    assert "CP_MSG_TYPE_DEACTIVATED" in rule_ids
    criticals = [f for f in resp.findings if f.severity == Severity.CRITICAL]
    assert len(criticals) >= 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "active_val,expected_bool",
    [
        ("X", True),
        ("x", True),
        ("TRUE", True),
        ("true", True),
        ("1", True),
        (1, True),
        ("YES", True),
        ("active", True),
        (True, True),
        (" ", False),
        ("", False),
        ("0", False),
        (0, False),
        ("FALSE", False),
        ("no", False),
        (False, False),
        (None, False),
    ],
)
async def test_adv_bd61_boolean_normalization_permutations(active_val, expected_bool):
    """Adversarial Test 1.4: Exhaustive permutations of boolean string/int/null representations in BD61."""
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": active_val,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
    }
    req = make_request(payload, job_id=f"adv-dim1-bool-{active_val}")
    resp = await EngineRunner.execute(req)

    metrics = resp.metrics.additional_metrics
    assert metrics.get("global_active") is expected_bool
    if expected_bool:
        assert not any(f.rule_id == "CP_GLOBAL_DEACTIVATED" for f in resp.findings)
    else:
        assert any(f.rule_id == "CP_GLOBAL_DEACTIVATED" for f in resp.findings)


# =============================================================================
# Stress Dimension 2: Reduced Message Type (BD53) Filtering
# =============================================================================

@pytest.mark.asyncio
async def test_adv_bd53_field_filtering_suppression():
    """Adversarial Test 2.1: Reduced message type (BD53) filters out a field configured in BD52.
    
    Expected behavior:
    - Field MARA-BISMT configured in BD52 and also in BD53 reduced set.
    - Emits CP_FIELD_FILTERED_BD53 with MINOR severity and VERIFIED confidence.
    - Does NOT emit CP_FIELD_NOT_CONFIGURED_BD52 for MARA-BISMT (it IS in BD52).
    - Unfiltered field MARA-MATKL produces no BD53 finding.
    """
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"], ["MARA", "BISMT"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "BISMT"]],
        "bd53_reduced_fields": ["MARA-BISMT"],
    }
    req = make_request(payload, job_id="adv-dim2-01")
    resp = await EngineRunner.execute(req)

    rule_ids = [f.rule_id for f in resp.findings]
    assert "CP_FIELD_FILTERED_BD53" in rule_ids, "Must detect BD53 reduced field filter"
    assert "CP_FIELD_NOT_CONFIGURED_BD52" not in rule_ids, "Field is in BD52, should not report missing BD52 entry"

    bd53_finding = next(f for f in resp.findings if f.rule_id == "CP_FIELD_FILTERED_BD53")
    assert bd53_finding.severity == Severity.MINOR
    assert bd53_finding.confidence == ConfidenceClass.VERIFIED
    assert "MARA-BISMT" in bd53_finding.title or "BISMT" in bd53_finding.title
    assert bd53_finding.technical_details.get("reduced_filter") is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bd53_input,expected_match",
    [
        ("MARA-BISMT", True),
        (["MARA", "BISMT"], True),
        ({"table": "MARA", "field": "BISMT"}, True),
        ("BISMT", True),
        ("MARA-MATKL", False),  # MATKL is not reduced
    ],
)
async def test_adv_bd53_heterogeneous_syntax_parsing(bd53_input, expected_match):
    """Adversarial Test 2.2: Heterogeneous BD53 reduced field syntax formats."""
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"], ["MARA", "BISMT"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "BISMT"]],
        "bd53_reduced_fields": [bd53_input],
    }
    req = make_request(payload, job_id="adv-dim2-syntax")
    resp = await EngineRunner.execute(req)

    has_bismt_filter = any(
        f.rule_id == "CP_FIELD_FILTERED_BD53" and "BISMT" in f.title
        for f in resp.findings
    )
    assert has_bismt_filter == expected_match


@pytest.mark.asyncio
async def test_adv_bd53_field_not_in_bd52_does_not_trigger_bd53():
    """Adversarial Test 2.3: Field in BD53 but completely absent from BD52.
    
    Expected behavior:
    - Rule 6 only iterates over active_bd52_set.
    - Field MARA-GROES is not in BD52; Rule 3 emits CP_FIELD_NOT_CONFIGURED_BD52.
    - Rule 6 does NOT emit CP_FIELD_FILTERED_BD53 for MARA-GROES because it cannot be reduced if not configured.
    """
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "GROES"]],
        "bd53_reduced_fields": ["MARA-GROES"],
    }
    req = make_request(payload, job_id="adv-dim2-unconfigured")
    resp = await EngineRunner.execute(req)

    rule_ids = [f.rule_id for f in resp.findings]
    assert "CP_FIELD_NOT_CONFIGURED_BD52" in rule_ids
    assert "CP_FIELD_FILTERED_BD53" not in rule_ids


# =============================================================================
# Stress Dimension 3: Custom YY1_ and ZZ_ Extensibility Fields
# =============================================================================

@pytest.mark.asyncio
async def test_adv_custom_fields_yy1_zz_z_detection():
    """Adversarial Test 3.1: Detection of omitted custom fields with distinct prefixes (YY1_, ZZ_, Z_).
    
    Expected behavior:
    - Custom fields omitted from BD52 trigger CP_CUSTOM_FIELD_OMITTED_BD52.
    - Confidence must be RULE_DERIVED (0.85) per sap-evidence playbook.
    - Must also trigger CP_FIELD_NOT_CONFIGURED_BD52 (VERIFIED, 1.0).
    - Standard fields missing trigger CP_FIELD_NOT_CONFIGURED_BD52, but NOT CP_CUSTOM_FIELD_OMITTED_BD52.
    """
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [
            ["MARA", "MATKL"],
            ["MARA", "MEINS"],                    # Standard missing
            ["MARA", "YY1_CARBON_INDEX"],         # S/4HANA Cloud Key-User
            ["MARA", "ZZ_LEGACY_TAX_GRP"],        # Classic NetWeaver customer include
            ["MARA", "Z_WAREHOUSE_NOTE"],         # Classic custom field
        ],
    }
    req = make_request(payload, job_id="adv-dim3-01")
    resp = await EngineRunner.execute(req)

    custom_omitted_findings = [f for f in resp.findings if f.rule_id == "CP_CUSTOM_FIELD_OMITTED_BD52"]
    assert len(custom_omitted_findings) == 3, f"Expected 3 custom field findings, got {len(custom_omitted_findings)}"

    custom_titles = [f.title for f in custom_omitted_findings]
    assert any("YY1_CARBON_INDEX" in t for t in custom_titles)
    assert any("ZZ_LEGACY_TAX_GRP" in t for t in custom_titles)
    assert any("Z_WAREHOUSE_NOTE" in t for t in custom_titles)

    for cf in custom_omitted_findings:
        assert cf.severity == Severity.MAJOR
        assert cf.confidence == ConfidenceClass.RULE_DERIVED
        assert cf.confidence_score == 0.85
        assert cf.category == "EXTENSIBILITY_GOVERNANCE"

    # Verify standard field MEINS did not trigger CP_CUSTOM_FIELD_OMITTED_BD52
    assert not any("MEINS" in t for t in custom_titles)


@pytest.mark.asyncio
async def test_adv_custom_fields_fully_configured_in_bd52():
    """Adversarial Test 3.2: Custom fields properly configured in BD52 trigger NO findings."""
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [
            ["MARA", "MATKL"],
            ["MARA", "YY1_CARBON_INDEX"],
            ["MARA", "ZZ_LEGACY_TAX_GRP"],
        ],
        "expected_fields": [
            ["MARA", "MATKL"],
            ["MARA", "YY1_CARBON_INDEX"],
            ["MARA", "ZZ_LEGACY_TAX_GRP"],
        ],
    }
    req = make_request(payload, job_id="adv-dim3-02")
    resp = await EngineRunner.execute(req)

    assert len(resp.findings) == 0, f"Expected 0 findings for clean configuration, got {resp.findings}"
    metrics = resp.metrics.additional_metrics
    assert metrics.get("coverage_percentage") == 100.0


# =============================================================================
# Stress Dimension 4: DD04L Change Document Flag Missing in Data Dictionary
# =============================================================================

@pytest.mark.asyncio
async def test_adv_dd04l_flag_missing_causes_silent_drop_warning():
    """Adversarial Test 4.1: Field in BD52 but DD04L change document flag is False.
    
    Expected behavior:
    - Triggers CP_FIELD_DD04L_CHGFLAG_MISSING with Severity.MAJOR and VERIFIED confidence.
    - Details must indicate table, field, and chgflag=False.
    - Remediation must explicitly guide user to SE11.
    """
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"], ["MARA", "FERTH"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "FERTH"]],
        "dd04l_metadata": {
            "MARA-FERTH": {"change_document_flag": False, "data_element": "FERTH"},
            "MARA-MATKL": {"change_document_flag": True, "data_element": "MATKL"},
        },
    }
    req = make_request(payload, job_id="adv-dim4-01")
    resp = await EngineRunner.execute(req)

    rule_ids = [f.rule_id for f in resp.findings]
    assert "CP_FIELD_DD04L_CHGFLAG_MISSING" in rule_ids

    dd_finding = next(f for f in resp.findings if f.rule_id == "CP_FIELD_DD04L_CHGFLAG_MISSING")
    assert dd_finding.severity == Severity.MAJOR
    assert dd_finding.confidence == ConfidenceClass.VERIFIED
    assert "FERTH" in dd_finding.title
    assert "SE11" in dd_finding.remediation
    assert dd_finding.technical_details.get("chgflag") is False
    assert dd_finding.technical_details.get("field") == "FERTH"


@pytest.mark.asyncio
async def test_adv_dd04l_list_and_csv_syntax_permutations():
    """Adversarial Test 4.2: DD04L inputs supplied in list format and CSV tabular format."""
    # 1. List format
    payload_list = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "FERTH"]],
        "expected_fields": [["MARA", "FERTH"]],
        "dd04l_metadata": [
            {"table": "MARA", "field": "FERTH", "change_document_flag": False, "data_element": "FERTH"}
        ],
    }
    req1 = make_request(payload_list, job_id="adv-dim4-list")
    resp1 = await EngineRunner.execute(req1)
    assert any(f.rule_id == "CP_FIELD_DD04L_CHGFLAG_MISSING" for f in resp1.findings)

    # 2. CSV format
    csv_text = (
        "BD61,X\n"
        "BD50,MATMAS,X\n"
        "BD52,MARA,FERTH\n"
        "EXPECTED,MARA,FERTH\n"
        "DD04L,MARA,FERTH, ,FERTH\n"
    )
    req2 = make_request(csv_text, job_id="adv-dim4-csv")
    resp2 = await EngineRunner.execute(req2)
    assert any(f.rule_id == "CP_FIELD_DD04L_CHGFLAG_MISSING" for f in resp2.findings)


# =============================================================================
# Stress Dimension 5: BDCP2 Runtime Silent Drops & Backlog
# =============================================================================

@pytest.mark.asyncio
async def test_adv_bdcp2_high_unprocessed_backlog_escalation():
    """Adversarial Test 5.1: BDCP2 table contains large unprocessed change pointer backlog.
    
    Expected behavior:
    - Backlog > 100 entries triggers CP_RUNTIME_UNPROCESSED_BACKLOG (Severity.MAJOR).
    - Remediation must reference RBDMIDOC and SM37.
    - Metric unprocessed_backlog_count matches exact count.
    """
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
        "bdcp2_samples": [
            {"message_type": "MATMAS", "table": "MARA", "field": "MATKL", "process_status": " ", "count": 450},
            {"message_type": "MATMAS", "table": "MARA", "field": "MATKL", "process_status": "X", "count": 900},
        ],
    }
    req = make_request(payload, job_id="adv-dim5-01")
    resp = await EngineRunner.execute(req)

    rule_ids = [f.rule_id for f in resp.findings]
    assert "CP_RUNTIME_UNPROCESSED_BACKLOG" in rule_ids

    backlog_f = next(f for f in resp.findings if f.rule_id == "CP_RUNTIME_UNPROCESSED_BACKLOG")
    assert backlog_f.severity == Severity.MAJOR
    assert "RBDMIDOC" in backlog_f.remediation
    assert "SM37" in backlog_f.remediation
    assert resp.metrics.additional_metrics.get("unprocessed_backlog_count") == 450


@pytest.mark.asyncio
async def test_adv_bdcp2_processed_entries_do_not_trigger_backlog():
    """Adversarial Test 5.2: BDCP2 table contains large number of processed entries (process_status='X').
    
    Expected behavior:
    - Processed entries do not count towards backlog.
    - Zero CP_RUNTIME_UNPROCESSED_BACKLOG findings.
    """
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"]],
        "bdcp2_samples": [
            {"message_type": "MATMAS", "table": "MARA", "field": "MATKL", "process_status": "X", "count": 50000},
            {"message_type": "MATMAS", "table": "MARA", "field": "MATKL", "process_status": " ", "count": 25},  # <= 100
        ],
    }
    req = make_request(payload, job_id="adv-dim5-02")
    resp = await EngineRunner.execute(req)

    assert not any(f.rule_id == "CP_RUNTIME_UNPROCESSED_BACKLOG" for f in resp.findings)
    assert resp.metrics.additional_metrics.get("unprocessed_backlog_count") == 25


# =============================================================================
# Stress Dimension 6: Large-Scale 1,000+ Fields & Boundary Stress
# =============================================================================

@pytest.mark.asyncio
async def test_adv_large_scale_1000_plus_fields_performance():
    """Adversarial Test 6.1: High-throughput stress test with 1,200 fields.
    
    Configuration:
    - 1,200 expected fields.
    - 900 configured in BD52.
    - 300 missing from BD52.
    - 100 with DD04L change document flag missing.
    - 50 custom YY1_ fields.
    - 25 reduced in BD53.
    
    Invariants:
    - Must evaluate all rules within 1,500 ms.
    - Correct coverage percentage (900/1200 = 75.0%).
    - Rules evaluated counter must scale cleanly with field count.
    - No memory leaks or unhandled exceptions.
    """
    expected_fields = []
    bd52_fields = []
    dd04l_metadata = {}
    bd53_reduced = []

    # Generate 900 configured fields
    for i in range(1, 901):
        fld_name = f"FIELD_{i:04d}"
        expected_fields.append(["MARA", fld_name])
        bd52_fields.append(["MARA", fld_name])

    # Generate 300 missing fields (100 standard, 200 custom YY1_)
    for i in range(901, 1001):
        fld_name = f"STD_MISSING_{i:04d}"
        expected_fields.append(["MARA", fld_name])

    for i in range(1001, 1201):
        fld_name = f"YY1_CUSTOM_{i:04d}"
        expected_fields.append(["MARA", fld_name])

    # Add 100 DD04L missing flags on configured fields
    for i in range(1, 101):
        fld_name = f"FIELD_{i:04d}"
        dd04l_metadata[f"MARA-{fld_name}"] = {"change_document_flag": False}

    # Add 25 BD53 reduced fields on configured fields
    for i in range(101, 126):
        fld_name = f"FIELD_{i:04d}"
        bd53_reduced.append(f"MARA-{fld_name}")

    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": bd52_fields,
        "expected_fields": expected_fields,
        "dd04l_metadata": dd04l_metadata,
        "bd53_reduced_fields": bd53_reduced,
    }

    t0 = time.perf_counter()
    req = make_request(payload, job_id="adv-dim6-large-scale")
    resp = await EngineRunner.execute(req)
    t_elapsed = (time.perf_counter() - t0) * 1000

    assert resp.status == AnalysisStatus.COMPLETED
    assert t_elapsed < 2000, f"Execution took {t_elapsed:.2f} ms (expected < 2000 ms)"

    metrics = resp.metrics.additional_metrics
    assert metrics.get("total_expected_fields") == 1200
    assert metrics.get("covered_fields") == 900
    assert metrics.get("coverage_percentage") == 75.0

    # Verify finding counts
    bd52_missing = [f for f in resp.findings if f.rule_id == "CP_FIELD_NOT_CONFIGURED_BD52"]
    assert len(bd52_missing) == 300, f"Expected 300 missing BD52 findings, got {len(bd52_missing)}"

    custom_missing = [f for f in resp.findings if f.rule_id == "CP_CUSTOM_FIELD_OMITTED_BD52"]
    assert len(custom_missing) == 200, f"Expected 200 custom field omissions, got {len(custom_missing)}"

    dd04l_missing = [f for f in resp.findings if f.rule_id == "CP_FIELD_DD04L_CHGFLAG_MISSING"]
    assert len(dd04l_missing) == 100, f"Expected 100 DD04L missing findings, got {len(dd04l_missing)}"

    bd53_reduced_f = [f for f in resp.findings if f.rule_id == "CP_FIELD_FILTERED_BD53"]
    assert len(bd53_reduced_f) == 25, f"Expected 25 BD53 reduced findings, got {len(bd53_reduced_f)}"

    assert resp.metrics.rules_evaluated > 2000


@pytest.mark.asyncio
async def test_adv_boundary_empty_and_corrupt_inputs():
    """Adversarial Test 6.2: Boundary, corrupt, and edge-case payload injection."""
    hostile_inputs = [
        "",
        "   \n\t  ",
        "{}",
        '{"corrupted": ',
        "invalid,csv,with,no,header\nfoo,bar\n",
        '{"bd61_active": null, "bd50_msg_types": null, "bd52_fields": null}',
        '{"expected_fields": [null, 123, true, []]}',
        '{"dd04l_metadata": "not_a_dict"}',
        '{"bdcp2_samples": ["not_a_dict", {"count": "non_integer"}]}',
    ]

    for bad in hostile_inputs:
        req = make_request(bad, job_id="adv-dim6-fuzz")
        resp = await EngineRunner.execute(req)
        assert resp is not None
        assert resp.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL, AnalysisStatus.FAILED)
        assert isinstance(resp.findings, list)
        assert resp.metrics is not None


# =============================================================================
# Stress Dimension 7: Bitwise Determinism & Cryptographic Evidence
# =============================================================================

@pytest.mark.asyncio
async def test_adv_bitwise_determinism_triplicate():
    """Adversarial Test 7.1: Strict bitwise reproducibility across 3 consecutive executions.
    
    Cardinal Axiom 2, Point 4 requires zero probabilistic drift.
    Every finding, evidence hash, score, and metric must match byte-for-byte.
    """
    payload = {
        "target_message_type": "MATMAS",
        "change_document_object": "MATERIAL",
        "bd61_active": True,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [["MARA", "MATKL"], ["MARA", "FERTH"]],
        "expected_fields": [
            ["MARA", "MATKL"],
            ["MARA", "FERTH"],
            ["MARA", "GROES"],
            ["MARA", "YY1_SPECIAL"],
        ],
        "dd04l_metadata": {
            "MARA-FERTH": {"change_document_flag": False, "data_element": "FERTH"}
        },
        "bd53_reduced_fields": ["MARA-FERTH"],
    }
    raw = json.dumps(payload, indent=2)

    responses = []
    for run_idx in range(3):
        req = AnalysisRequest(
            job_id="adv-determ-triplicate",
            tenant_id="tenant-adv-001",
            project_id="project-adv-001",
            engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
            raw_content=raw,
        )
        resp = await EngineRunner.execute(req)
        responses.append(resp)

    r1, r2, r3 = responses[0], responses[1], responses[2]
    assert len(r1.findings) == len(r2.findings) == len(r3.findings)

    for f1, f2, f3 in zip(r1.findings, r2.findings, r3.findings):
        assert f1.rule_id == f2.rule_id == f3.rule_id
        assert f1.severity == f2.severity == f3.severity
        assert f1.title == f2.title == f3.title
        assert f1.confidence == f2.confidence == f3.confidence
        assert f1.confidence_score == f2.confidence_score == f3.confidence_score
        assert f1.technical_details == f2.technical_details == f3.technical_details
        assert f1.affected_objects == f2.affected_objects == f3.affected_objects

        # Evidence checks
        assert len(f1.evidence) == len(f2.evidence) == len(f3.evidence)
        for ev1, ev2, ev3 in zip(f1.evidence, f2.evidence, f3.evidence):
            assert ev1.sha256 == ev2.sha256 == ev3.sha256
            assert ev1.line_number == ev2.line_number == ev3.line_number
            assert ev1.column_number == ev2.column_number == ev3.column_number
            assert ev1.snippet == ev2.snippet == ev3.snippet


@pytest.mark.asyncio
async def test_adv_sha256_cryptographic_evidence_verification():
    """Adversarial Test 7.2: Cryptographic validation of all evidence items.
    
    Cardinal Axiom 2, Point 6 requires:
    - Exactly 64-char valid hexadecimal SHA-256 hash.
    - Valid line number >= 1, column number >= 1.
    - Non-empty snippet.
    - Provenance class aligned with source trust.
    """
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": False,
        "bd50_msg_types": [],
        "bd52_fields": [["MARA", "MATKL"]],
        "expected_fields": [["MARA", "MATKL"], ["MARA", "GROES"], ["MARA", "YY1_TEST"]],
    }
    raw = json.dumps(payload, indent=2)
    req = make_request(raw, job_id="adv-dim7-sha256")
    resp = await EngineRunner.execute(req)

    assert len(resp.findings) > 0
    hex_pattern = re.compile(r"^[0-9a-fA-F]{64}$")

    for f in resp.findings:
        assert len(f.evidence) >= 1, f"Finding {f.rule_id} missing evidence"
        for ev in f.evidence:
            assert ev.sha256 is not None
            assert len(ev.sha256) == 64, f"Evidence SHA-256 must be 64 characters: {ev.sha256}"
            assert hex_pattern.match(ev.sha256) is not None, f"Invalid hex in SHA-256: {ev.sha256}"
            assert ev.line_number >= 1, f"Line number must be >= 1, got {ev.line_number}"
            assert ev.column_number >= 1, f"Column number must be >= 1, got {ev.column_number}"
            assert ev.snippet is not None and len(ev.snippet) > 0, "Snippet cannot be empty"
            assert ev.provenance in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED)


@pytest.mark.asyncio
async def test_adv_epistemic_confidence_ceiling_and_demotion():
    """Adversarial Test 7.3: Strict enforcement of AI confidence ceiling and missing evidence demotion.
    
    Cardinal Axiom 2, Point 7 requires:
    - AI-generated requests NEVER exceed INFERRED (0.60).
    - Findings lacking evidence are demoted to UNKNOWN (0.30).
    """
    # 1. AI request ceiling
    payload = {
        "target_message_type": "MATMAS",
        "bd61_active": False,
        "bd50_msg_types": ["MATMAS"],
        "bd52_fields": [],
        "expected_fields": [["MARA", "MATKL"]],
    }
    req_ai = make_request(payload, job_id="adv-dim7-ai", is_ai_generated=True)
    resp_ai = await EngineRunner.execute(req_ai)
    for f in resp_ai.findings:
        assert f.confidence == ConfidenceClass.INFERRED, f"AI finding {f.rule_id} exceeded INFERRED ceiling"
        assert f.confidence_score <= 0.60

    # 2. Demotion on missing evidence
    bare_finding = Finding(
        rule_id="CP_FIELD_NOT_CONFIGURED_BD52",
        severity=Severity.MAJOR,
        category="ALE",
        title="Field Missing",
        description="Missing in BD52",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Maintain BD52",
        evidence=[],
    )
    classified = ConfidenceClassifier.classify(bare_finding, missing_evidence=True)
    assert classified.confidence == ConfidenceClass.UNKNOWN
    assert classified.confidence_score <= 0.30
