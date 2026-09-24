"""
ERP Preflight — Milestone 3 Domain 1 Empirical Re-Challenge Suite (Iteration 2)
Agent: m3_d1_it2_challenger_1

Deep adversarial verification of the 5 remediated defects:
1. Plain text .txt SAPscript no longer crashes XML DOM indexing (returns AnalysisStatus.COMPLETED).
2. ABAP driver calls, SAPscript comments, continuations, and ADDRESS routines in raw_content are extracted and audited.
3. %PAGE / %WINDOW / %TEXT regex correctly matches across word/tag/whitespace boundaries.
4. SAPscript rule_id taxonomy is strictly FORM_LEGACY_SAPSCRIPT_DETECTED.
5. opd_guard.py condition_subsumes correctly handles mathematical numerical interval and point subsumption.
"""

import json
import pytest
from typing import Dict, Any

from src.engines.opd_guard import OPDGuardEngine
from src.engines.form_doctor import FormDoctorEngine
from src.core.runner import EngineRunner
from src.models.request import AnalysisRequest, ArtifactReference
from src.models.enums import EngineType, ArtifactType, AnalysisStatus, Severity, ConfidenceClass


class TestEmpiricalRechallengeIntervalSubsumption:
    """Deep adversarial stress testing of numerical interval subsumption in OPD Guard."""

    def test_interval_subsumption_standard_and_subranges(self):
        """Interval [1000..5000] subsumes proper sub-intervals and boundary sub-intervals."""
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[2000..3000]") is True
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[1000..5000]") is True
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[1000..2000]") is True
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[4000..5000]") is True

        # Non-subsumed intervals
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[500..3000]") is False
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[2000..6000]") is False
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[500..6000]") is False
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[6000..7000]") is False

    def test_interval_subsumption_floating_point(self):
        """Floating point intervals [10.5..99.5] subsume sub-intervals and decimal points."""
        assert OPDGuardEngine.condition_subsumes("[10.5..99.5]", "[20.0..50.5]") is True
        assert OPDGuardEngine.condition_subsumes("[10.5..99.5]", "55.75") is True
        assert OPDGuardEngine.condition_subsumes("[10.5..99.5]", "10.5") is True
        assert OPDGuardEngine.condition_subsumes("[10.5..99.5]", "99.5") is True
        assert OPDGuardEngine.condition_subsumes("[10.5..99.5]", "10.4") is False
        assert OPDGuardEngine.condition_subsumes("[10.5..99.5]", "99.6") is False

    def test_interval_subsumption_inverted_bounds(self):
        """Inverted bounds [5000..1000] are normalized and correctly subsume [2000..3000]."""
        assert OPDGuardEngine.condition_subsumes("[5000..1000]", "[2000..3000]") is True
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "[3000..2000]") is True
        assert OPDGuardEngine.condition_subsumes("[5000..1000]", "[3000..2000]") is True
        assert OPDGuardEngine.condition_subsumes("[5000..1000]", "2500") is True

    def test_interval_subsumption_discrete_and_comma_sets(self):
        """Interval subsumes discrete numbers and comma-separated lists of numbers."""
        assert OPDGuardEngine.condition_subsumes("[100..500]", "250") is True
        assert OPDGuardEngine.condition_subsumes("[100..500]", "100") is True
        assert OPDGuardEngine.condition_subsumes("[100..500]", "500") is True
        assert OPDGuardEngine.condition_subsumes("[100..500]", "99") is False
        assert OPDGuardEngine.condition_subsumes("[100..500]", "501") is False

        # Comma sets where all elements are in range
        assert OPDGuardEngine.condition_subsumes("[100..500]", "150, 250, 350, 450") is True
        assert OPDGuardEngine.condition_subsumes("[100..500]", "100, 500") is True

        # Comma set where at least one element is outside range
        assert OPDGuardEngine.condition_subsumes("[100..500]", "150, 550") is False
        assert OPDGuardEngine.condition_subsumes("[100..500]", "50, 250") is False

    def test_interval_subsumption_syntax_resilience(self):
        """Interval subsumption handles whitespace variants and unbracketed syntax."""
        assert OPDGuardEngine.condition_subsumes("1000..5000", "2000..3000") is True
        assert OPDGuardEngine.condition_subsumes("[ 1000 .. 5000 ]", "[ 2000 .. 3000 ]") is True
        assert OPDGuardEngine.condition_subsumes("[ 1000 .. 5000 ]", " 2500 ") is True

        # Non-numeric strings against interval do not crash and return False
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "ABC") is False
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "") is False
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", None) is False

        # Wildcard does not get subsumed by a range
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "*") is False
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "ALL") is False

        # Range without brackets
        assert OPDGuardEngine.condition_subsumes("1000..5000", "[2000..3000]") is True
        assert OPDGuardEngine.condition_subsumes("[1000..5000]", "2000..3000") is True

        # Negative number handling
        assert OPDGuardEngine.condition_subsumes("[100..500]", "-50") is False

    @pytest.mark.asyncio
    async def test_opd_full_analysis_with_interval_shadowing(self):
        """Full end-to-end OPD Guard analysis where interval conditions trigger OPD_UNREACHABLE_RULE."""
        csv_data = (
            "COND_DOCTYPE,COND_AMOUNT,RESULT\n"
            "INV,[1000..5000],ACT_BROAD\n"
            "INV,[2000..3000],ACT_SHADOWED_INTERVAL\n"
            "INV,2500,ACT_SHADOWED_POINT\n"
            "INV,[500..3000],ACT_NOT_SHADOWED_LEFT\n"
            "INV,[4000..6000],ACT_NOT_SHADOWED_RIGHT\n"
            "INV,5000,ACT_SHADOWED_BOUNDARY\n"
        )
        req = AnalysisRequest(
            job_id="99999999-1111-2222-3333-444444444441",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.OPD_GUARD,
            raw_content=csv_data,
            artifact_type=ArtifactType.CSV,
            configuration={
                "default_step": "Output Type",
                "scenario": {"DOCTYPE": "INV", "AMOUNT": "1500"},
            },
        )
        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        shadow_findings = [f for f in res.findings if f.rule_id == "OPD_UNREACHABLE_RULE"]
        shadowed_rows = [f.technical_details.get("shadowedRowIndex") for f in shadow_findings]

        # Row indices (1-indexed in CSV data lines 2-7):
        # Row 0 (line 2): [1000..5000]
        # Row 1 (line 3, idx 2): [2000..3000] -> shadowed by row 0
        # Row 2 (line 4, idx 3): 2500 -> shadowed by row 0
        # Row 3 (line 5, idx 4): [500..3000] -> NOT shadowed
        # Row 4 (line 6, idx 5): [4000..6000] -> NOT shadowed
        # Row 5 (line 7, idx 6): 5000 -> shadowed by row 0
        assert 2 in shadowed_rows
        assert 3 in shadowed_rows
        assert 6 in shadowed_rows
        assert 4 not in shadowed_rows
        assert 5 not in shadowed_rows
        assert len(shadow_findings) == 3


class TestEmpiricalRechallengeFormDoctorDefects:
    """Adversarial stress testing of FormDoctor defect remediations."""

    @pytest.mark.asyncio
    async def test_plain_text_sapscript_no_xml_crash(self):
        """Defect 1 Re-Challenge: Plain text SAPscript (.txt) must return status=COMPLETED."""
        sapscript_payload = (
            "/: DEFINE &MY_VAR& = 'VALUE'\n"
            "/: SET COUNTRY 'DE'\n"
            "/: NEW-PAGE\n"
            "/* Comment line\n"
        )
        req = AnalysisRequest(
            job_id="99999999-1111-2222-3333-444444444442",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            artifact_type=ArtifactType.TXT,
            artifacts=[
                ArtifactReference(file_name="legacy_sapscript.txt", artifact_type=ArtifactType.TXT, raw_content=sapscript_payload)
            ],
            target_release="S4HC_2502",
        )
        res = await FormDoctorEngine().analyze(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert res.error_message is None
        assert len(res.findings) >= 1

    @pytest.mark.asyncio
    async def test_plain_text_arbitrary_notes_no_crash(self):
        """Defect 1 Edge Case: Arbitrary non-XML non-SAPscript text (.txt) must complete cleanly with 0 findings."""
        notes = "This is a simple text note without any XML tags or legacy forms.\nAuthor: Consultant."
        req = AnalysisRequest(
            job_id="99999999-1111-2222-3333-444444444447",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content=notes,
            artifact_type=ArtifactType.TXT,
            target_release="S4HC_2502",
        )
        res = await FormDoctorEngine().analyze(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert res.error_message is None
        assert len(res.findings) == 0

    @pytest.mark.asyncio
    async def test_raw_content_abap_driver_and_legacy_markers_detected(self):
        """Defect 2 Re-Challenge: ABAP driver calls and SAPscript markers in raw_content are extracted and audited."""
        # 1. ABAP driver call
        req_abap = AnalysisRequest(
            job_id="99999999-1111-2222-3333-444444444443",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content="REPORT Z_DRIVER.\nCALL FUNCTION 'SSF_FUNCTION_MODULE_NAME' EXPORTING form_name = 'Z_SF'.",
            artifact_type=ArtifactType.TXT,
            target_release="S4HC_2502",
        )
        res_abap = await FormDoctorEngine().analyze(req_abap)
        assert res_abap.status == AnalysisStatus.COMPLETED
        assert any(f.rule_id == "FORM_LEGACY_SMARTFORM_DETECTED" for f in res_abap.findings)

        # 2. SAPscript comment in raw_content
        req_comment = AnalysisRequest(
            job_id="99999999-1111-2222-3333-444444444444",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content="/* SAPscript form documentation comment\nLine 2 content",
            artifact_type=ArtifactType.TXT,
            target_release="S4HC_2502",
        )
        res_comment = await FormDoctorEngine().analyze(req_comment)
        assert res_comment.status == AnalysisStatus.COMPLETED
        assert any(f.rule_id == "FORM_LEGACY_SAPSCRIPT_DETECTED" for f in res_comment.findings)

        # 3. SAPscript continuation line (/=) in raw_content
        req_cont = AnalysisRequest(
            job_id="99999999-1111-2222-3333-444444444445",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content="/= CONTINUATION LINE TEXT",
            artifact_type=ArtifactType.TXT,
            target_release="S4HC_2502",
        )
        res_cont = await FormDoctorEngine().analyze(req_cont)
        assert res_cont.status == AnalysisStatus.COMPLETED
        assert any(f.rule_id == "FORM_LEGACY_SAPSCRIPT_DETECTED" for f in res_cont.findings)

        # 4. SAPscript ADDRESS ... ENDADDRESS in raw_content
        req_addr = AnalysisRequest(
            job_id="99999999-1111-2222-3333-444444444446",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.FORM_DOCTOR,
            raw_content="ADDRESS\n  TITLE 'Mr'\nENDADDRESS",
            artifact_type=ArtifactType.TXT,
            target_release="S4HC_2502",
        )
        res_addr = await FormDoctorEngine().analyze(req_addr)
        assert res_addr.status == AnalysisStatus.COMPLETED
        assert any(f.rule_id == "FORM_LEGACY_SAPSCRIPT_DETECTED" for f in res_addr.findings)

    def test_percent_page_window_text_boundary_matching(self):
        """Defect 3 Re-Challenge: %PAGE, %WINDOW, %TEXT match at start-of-string, whitespace, and XML tags."""
        pattern = FormDoctorEngine.SMARTFORM_PATTERNS[4][0]

        # Start of string
        assert pattern.search("%PAGE") is not None
        assert pattern.search("%WINDOW") is not None
        assert pattern.search("%TEXT") is not None

        # Preceded by whitespace
        assert pattern.search(" %PAGE 1") is not None
        assert pattern.search("\n%WINDOW MAIN") is not None
        assert pattern.search("\t%TEXT 01") is not None

        # Preceded by XML tags
        assert pattern.search("<element>%PAGE</element>") is not None
        assert pattern.search("<window>%WINDOW</window>") is not None
        assert pattern.search("<text>%TEXT</text>") is not None

        # Case insensitivity
        assert pattern.search(" %page ") is not None
        assert pattern.search(" %window ") is not None
        assert pattern.search(" %text ") is not None

    def test_sapscript_rule_id_taxonomy_compliance(self):
        """Defect 4 Re-Challenge: SAPscript detection strictly uses FORM_LEGACY_SAPSCRIPT_DETECTED."""
        engine = FormDoctorEngine()
        findings = engine._audit_legacy_forms("/: DEFINE &VAR& = '1'", "", "test_script.txt", "S4HC_2502")
        assert len(findings) == 1
        finding = findings[0]
        assert finding.rule_id == "FORM_LEGACY_SAPSCRIPT_DETECTED"
        assert finding.title == "Legacy SAPscript Form Detected (Clean Core Tier 3 Violation)"
        assert finding.technical_details["cleanCoreTier"] == "TIER_3_PROHIBITED"
        assert finding.severity == Severity.BLOCKER  # Cloud target
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert finding.confidence_score == 1.0

        # On-Premise severity scaling check
        findings_onprem = engine._audit_legacy_forms("/: DEFINE &VAR& = '1'", "", "test_script.txt", "S4H_2023")
        assert len(findings_onprem) == 1
        assert findings_onprem[0].severity == Severity.CRITICAL  # On-premise target
        assert findings_onprem[0].rule_id == "FORM_LEGACY_SAPSCRIPT_DETECTED"
