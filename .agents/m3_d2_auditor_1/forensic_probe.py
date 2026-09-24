import asyncio
import hashlib
import sys
from pathlib import Path

# Add services/analysis-python to sys.path
sys.path.insert(0, r"H:/erppreflight/services/analysis-python")

from src.core.runner import EngineRunner
import src.engines
from src.models.request import AnalysisRequest
from src.models.finding import Finding
from src.platform.confidence import ConfidenceClassifier
from src.models.enums import EngineType, ArtifactType, Severity, ConfidenceClass

async def run_forensic_checks():
    print("=== FORENSIC EMPIRICAL VERIFICATION ===")

    # Test 1: SPRO line number & hash verification on synthetic input
    spro_csv = (
        "ActivityID,Description\n"
        "SIMG_CFMENUOLSDVOFA,Billing Types\n"
        "UNKNOWN_IMG_123,Fake Activity\n"
    )
    req1 = AnalysisRequest(
        job_id="test-1",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.SPRO2CLOUD,
        raw_content=spro_csv,
        artifact_type=ArtifactType.CSV
    )
    res1 = await EngineRunner.execute(req1)
    assert len(res1.findings) == 2, f"Expected 2 findings, got {len(res1.findings)}"
    f1, f2 = res1.findings[0], res1.findings[1]
    assert f1.rule_id == "SPRO_MAPPING_EXACT", f"f1.rule_id={f1.rule_id}"
    assert f1.evidence[0].line_number == 2, f"f1 line={f1.evidence[0].line_number}"
    assert f1.evidence[0].sha256 == hashlib.sha256(f1.evidence[0].snippet.encode()).hexdigest()
    assert f2.rule_id == "SPRO_MAPPING_NEEDS_REVIEW", f"f2.rule_id={f2.rule_id}"
    assert f2.evidence[0].line_number == 3, f"f2 line={f2.evidence[0].line_number}"
    assert f2.confidence == ConfidenceClass.UNKNOWN
    assert f2.confidence_score == 0.30
    print("Test 1 (SPRO2Cloud dynamic line tracking and SHA-256): PASS")

    # Test 2: ECC2Cloud usage-weighted sorting
    ecc_csv = (
        "TCode,ExecutionCount\n"
        "SE38,10\n"
        "SM30,1000000\n"
    )
    req2 = AnalysisRequest(
        job_id="test-2",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
        raw_content=ecc_csv,
        artifact_type=ArtifactType.CSV
    )
    res2 = await EngineRunner.execute(req2)
    assert len(res2.findings) == 2, f"Expected 2 findings, got {len(res2.findings)}"
    # SM30 has 1,000,000 executions -> must be sorted first!
    assert res2.findings[0].affected_objects == ["SM30"], f"Expected SM30 first, got {res2.findings[0].affected_objects}"
    assert res2.findings[1].affected_objects == ["SE38"]
    print("Test 2 (ECC2Cloud usage-weighted dynamic ranking): PASS")

    # Test 3: Gap Radar dynamic regex on novel requirement
    req3 = AnalysisRequest(
        job_id="test-3",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.SAP_GAP_RADAR,
        raw_content='{"requirement": "Custom Pricing Procedure determination in Sales Orders via BAdI_PRICING_COMPLETE"}',
        artifact_type=ArtifactType.JSON
    )
    res3 = await EngineRunner.execute(req3)
    assert len(res3.findings) == 1
    assert res3.findings[0].rule_id == "GAP_RADAR_SUPPORTED_DEVELOPER_EXTENSIBILITY"
    assert res3.findings[0].technical_details["tier"] == 7
    assert res3.findings[0].evidence[0].sha256 == hashlib.sha256(res3.findings[0].evidence[0].snippet.encode()).hexdigest()
    print("Test 3 (Gap Radar dynamic BAdI tier resolution): PASS")

    # Test 4: Clean Core line coordinate and calculation verification
    code_lines = ["* Comment", "DATA: lv_ok TYPE c."] * 20 # 40 lines
    code_lines.append("SELECT * FROM BKPF INTO TABLE @DATA(lt_bkpf).") # Line 41
    code_lines.append("CALL 'SYSTEM' ID 'COMMAND' FIELD lv_cmd.") # Line 42
    abap_src = "\n".join(code_lines)
    req4 = AnalysisRequest(
        job_id="test-4",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
        raw_content=abap_src,
        artifact_type=ArtifactType.ABAP
    )
    res4 = await EngineRunner.execute(req4)
    assert len(res4.findings) == 2, f"Expected 2 violations, got {len(res4.findings)}"
    find_bkpf = next(f for f in res4.findings if f.rule_id == "CLEAN_CORE_DIRECT_DB_ACCESS")
    find_sys = next(f for f in res4.findings if f.rule_id == "CLEAN_CORE_OBSOLETE_SYNTAX")
    assert find_bkpf.evidence[0].line_number == 41, f"Expected line 41, got {find_bkpf.evidence[0].line_number}"
    assert find_sys.evidence[0].line_number == 42, f"Expected line 42, got {find_sys.evidence[0].line_number}"
    assert find_sys.severity == Severity.BLOCKER
    assert find_bkpf.evidence[0].sha256 == hashlib.sha256(find_bkpf.evidence[0].snippet.encode()).hexdigest()
    print("Test 4 (Clean Core exact line coordinate and SHA-256): PASS")

    # Test 5: Missing evidence demotion verification
    f_missing_ev = Finding(
        rule_id="TEST_NO_EV",
        severity=Severity.MAJOR,
        category="TEST",
        title="No Evidence Finding",
        description="Test missing evidence demotion",
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        remediation="Test",
        evidence=[],
    )
    classified_f = ConfidenceClassifier.classify(f_missing_ev)
    assert classified_f.confidence == ConfidenceClass.UNKNOWN
    assert classified_f.confidence_score == 0.30
    print("Test 5 (ConfidenceClassifier demotes missing evidence to UNKNOWN 0.30): PASS")

    # Test 6: Gap Radar empty input boundary
    req_empty = AnalysisRequest(
        job_id="adv-1",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.SAP_GAP_RADAR,
        raw_content="",
        artifact_type=ArtifactType.TXT,
    )
    res_empty = await EngineRunner.execute(req_empty)
    assert res_empty.status.value == "COMPLETED"
    assert res_empty.findings[0].rule_id == "GAP_RADAR_UNKNOWN_REQUIREMENT"
    print("Test 6 (Gap Radar empty input boundary): PASS")

    # Test 7: Clean Core pure comments
    req_comments = AnalysisRequest(
        job_id="adv-2",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
        raw_content='* Comment 1\n* Comment 2\n" Comment 3\n',
        artifact_type=ArtifactType.ABAP,
    )
    res_comments = await EngineRunner.execute(req_comments)
    assert res_comments.status.value == "COMPLETED"
    assert len(res_comments.findings) == 0
    assert res_comments.metrics.additional_metrics["compliance_percentage"] == 100.0
    print("Test 7 (Clean Core pure comments): PASS")

    # Test 8: ECC2Cloud negative and zero executions
    req_neg = AnalysisRequest(
        job_id="adv-3",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
        raw_content="TCode,ExecutionCount\nVA01,-50\nME21N,0\n",
        artifact_type=ArtifactType.CSV,
    )
    res_neg = await EngineRunner.execute(req_neg)
    assert res_neg.status.value == "COMPLETED"
    assert len(res_neg.findings) == 2
    print("Test 8 (ECC2Cloud negative/zero executions): PASS")

    # Test 9: Bitwise Reproducibility Stress Check (Determinism)
    req_det1 = AnalysisRequest(
        job_id="det-1",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
        raw_content="SELECT * FROM mara INTO TABLE lt_mara.\nCALL 'SYSTEM' ID 'COMMAND' FIELD lv_cmd.\n",
        artifact_type=ArtifactType.ABAP,
    )
    req_det2 = AnalysisRequest(
        job_id="det-2",
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
        raw_content="SELECT * FROM mara INTO TABLE lt_mara.\nCALL 'SYSTEM' ID 'COMMAND' FIELD lv_cmd.\n",
        artifact_type=ArtifactType.ABAP,
    )
    res_det1 = await EngineRunner.execute(req_det1)
    res_det2 = await EngineRunner.execute(req_det2)
    assert len(res_det1.findings) == len(res_det2.findings)
    for f_a, f_b in zip(res_det1.findings, res_det2.findings):
        assert f_a.rule_id == f_b.rule_id
        assert f_a.severity == f_b.severity
        assert f_a.confidence == f_b.confidence
        assert f_a.evidence[0].sha256 == f_b.evidence[0].sha256
        assert f_a.evidence[0].line_number == f_b.evidence[0].line_number
    print("Test 9 (Bitwise Reproducibility & Pure Determinism): PASS")

    print("\n>>> ALL 5 FORENSIC EMPIRICAL PROBES PASSED! <<<")

if __name__ == "__main__":
    asyncio.run(run_forensic_checks())
