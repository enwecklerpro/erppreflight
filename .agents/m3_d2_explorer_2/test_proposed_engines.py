"""Automated verification test suite for proposed SAP Gap Radar and Clean Core Object Guard engines.
Validates Cardinal Axiom 2 compliance, 12-tier hierarchy, AST parsing, evidence hashing,
confidence classification, and E2E test harness compatibility.
"""

import json
import pytest
import sys
from pathlib import Path

# Add project roots to path
repo_root = Path(__file__).resolve().parents[2]
agent_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(repo_root / "services" / "analysis-python"))
sys.path.insert(0, str(agent_dir))

from src.models.request import AnalysisRequest
from src.models.enums import EngineType, Severity, ConfidenceClass, AnalysisStatus
from src.platform.confidence import ConfidenceClassifier
from proposed_gap_radar import GapRadarEngine, ResolutionTier
from proposed_clean_core import CleanCoreEngine


# ==============================================================================
# Suite 1: SAP Gap Radar Tests
# ==============================================================================

class TestSAPGapRadar:
    """Verifies the 12-tier clean core resolution hierarchy and feasibility scoring."""

    def test_standard_tier_1_resolution(self):
        res = GapRadarEngine.evaluate("Standard purchase order processing in procurement", "2023")
        assert res["resolution_tier"] == 1
        assert res["verdict"] == "SUPPORTED_STANDARD"
        assert res["feasibility_score"] == 1.00
        assert res["status"] == "COMPLETED"
        assert any(f["code"] == "GAP_RADAR_SUPPORTED_STANDARD" for f in res["findings"])

    def test_configuration_tier_2_resolution(self):
        res = GapRadarEngine.evaluate("Configure payment terms via SSCUI in CBC", "S4HC_2408")
        assert res["resolution_tier"] == 2
        assert res["verdict"] == "SUPPORTED_CONFIGURATION"
        assert res["feasibility_score"] == 0.98

    def test_key_user_tier_3_resolution(self):
        res = GapRadarEngine.evaluate("Add custom field YY1_PROMO_CODE to Purchase Order Item", "2023")
        assert res["resolution_tier"] == 3
        assert res["verdict"] == "SUPPORTED_KEY_USER"
        assert res["feasibility_score"] == 0.95

    def test_developer_extensibility_tier_4_resolution(self):
        res = GapRadarEngine.evaluate("Build custom RAP business object in ABAP Cloud", "2023")
        assert res["resolution_tier"] == 4
        assert res["verdict"] == "SUPPORTED_DEVELOPER_EXTENSIBILITY"
        assert res["feasibility_score"] == 0.90

    def test_released_cds_tier_5_resolution(self):
        res = GapRadarEngine.evaluate("Query released CDS view I_Product with Contract C1", "2023")
        assert res["resolution_tier"] == 5
        assert res["verdict"] == "SUPPORTED_RELEASED_CDS"
        assert res["feasibility_score"] == 0.95

    def test_released_api_tier_6_resolution(self):
        res = GapRadarEngine.evaluate("Integrate with released API API_BUSINESS_PARTNER via OData", "2023")
        assert res["resolution_tier"] == 6
        assert res["verdict"] == "SUPPORTED_RELEASED_API"
        assert res["feasibility_score"] == 0.95

    def test_badi_tier_7_resolution(self):
        res = GapRadarEngine.evaluate("Implement custom pricing logic via BAdI", "2023")
        assert res["resolution_tier"] == 7
        assert res["verdict"] == "SUPPORTED_DEVELOPER_EXTENSIBILITY"
        assert res["feasibility_score"] == 0.90

    def test_event_mesh_tier_8_resolution(self):
        res = GapRadarEngine.evaluate("Trigger external webhook via cloud events on goods receipt", "2023")
        assert res["resolution_tier"] == 8
        assert res["verdict"] == "SUPPORTED_BUSINESS_EVENT"
        assert res["feasibility_score"] == 0.90

    def test_side_by_side_tier_9_resolution(self):
        res = GapRadarEngine.evaluate("Deploy external portal on SAP BTP using CAP framework", "2023")
        assert res["resolution_tier"] == 9
        assert res["verdict"] == "SUPPORTED_SIDE_BY_SIDE"
        assert res["feasibility_score"] == 0.85

    def test_workaround_tier_10_resolution(self):
        res = GapRadarEngine.evaluate("Batch job emulation supported workaround with staging table", "2023")
        assert res["resolution_tier"] == 10
        assert res["verdict"] == "SUPPORTED_WORKAROUND"
        assert res["feasibility_score"] == 0.70

    def test_direct_db_write_blocked_tier_11(self):
        res = GapRadarEngine.evaluate("Direct DB write into table BSEG without standard BAPI", "2023")
        assert res["resolution_tier"] == 11
        assert res["verdict"] == "BLOCKED_CLEAN_CORE_VIOLATION"
        assert res["feasibility_score"] == 0.00
        assert any(f["severity"] == "CRITICAL" for f in res["findings"])

    def test_unknown_requirement_tier_12(self):
        res = GapRadarEngine.evaluate("Uncataloged bespoke proprietary subsystem integration", "2023")
        assert res["resolution_tier"] == 12
        assert res["verdict"] == "UNKNOWN_REQUIREMENT"
        assert res["feasibility_score"] == 0.40

    @pytest.mark.asyncio
    async def test_gap_radar_async_analyze_with_json_payload(self):
        payload = {
            "requirements": [
                {"requirement": "Trigger external webhook via cloud events on goods receipt"},
                {"requirement": "Direct DB write into table BSEG without standard BAPI"},
                {"requirement": "Standard purchase order creation in procurement"},
            ]
        }
        engine = GapRadarEngine()
        req = AnalysisRequest(
            job_id="test-job-gap-1",
            tenant_id="tenant-123",
            project_id="proj-456",
            engine_type=EngineType.SAP_GAP_RADAR,
            target_release="S4HC_2408",
            raw_content=json.dumps(payload),
        )
        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.engine_type == EngineType.SAP_GAP_RADAR
        assert len(resp.findings) == 3

        # Check metrics
        assert resp.metrics.additional_metrics["total_requirements"] == 3
        assert resp.metrics.additional_metrics["resolution_tier"] == 8  # First requirement was Tier 8
        assert resp.metrics.additional_metrics["feasibility_score"] == pytest.approx(0.63, 0.05)

        # Check evidence attached and hashed
        for f in resp.findings:
            assert len(f.evidence) == 1
            assert len(f.evidence[0].sha256) == 64
            assert f.evidence[0].line_number is not None


# ==============================================================================
# Suite 2: Clean Core Object Guard Tests
# ==============================================================================

class TestCleanCoreObjectGuard:
    """Verifies static AST analysis of ABAP code for classic tables and obsolete statements."""

    def test_compliant_abap_passes_100_percent(self):
        fixture_path = repo_root / "tests" / "e2e" / "fixtures" / "clean_core" / "clean_core_compliant.abap"
        code = fixture_path.read_text(encoding="utf-8")
        res = CleanCoreEngine.evaluate(code)
        assert res["compliance_percentage"] == 100.0
        assert len(res["findings"]) == 0
        assert res["clean_statements"] > 0
        assert res["violations_count"] == 0

    def test_legacy_fixture_detects_multiple_violations(self):
        fixture_path = repo_root / "tests" / "e2e" / "fixtures" / "clean_core" / "clean_core_legacy.abap"
        code = fixture_path.read_text(encoding="utf-8")
        res = CleanCoreEngine.evaluate(code)
        assert res["compliance_percentage"] < 50.0
        assert res["violations_count"] >= 4

        # Verify direct MARA access
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" and f["table"] == "MARA" for f in res["findings"])
        # Verify obsolete syntax: TABLES, PERFORM, CALL 'SYSTEM'
        assert any(f["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX" and f["statement"] == "TABLES" for f in res["findings"])
        assert any(f["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX" and f["statement"] == "PERFORM" for f in res["findings"])
        assert any(f["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX" and f["statement"] == "CALL 'SYSTEM'" for f in res["findings"])

    def test_direct_mara_access_flagged(self):
        code = "SELECT * FROM mara INTO TABLE @lt_mara."
        res = CleanCoreEngine.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" and f["table"] == "MARA" for f in res["findings"])
        finding = next(f for f in res["findings"] if f.get("table") == "MARA")
        assert finding["successor"] == "I_Product"

    def test_direct_vbak_access_flagged(self):
        code = "UPDATE vbak SET netwr = 100 WHERE vbeln = '1000'."
        res = CleanCoreEngine.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" and f["table"] == "VBAK" for f in res["findings"])
        finding = next(f for f in res["findings"] if f.get("table") == "VBAK")
        assert finding["successor"] == "I_SalesOrder"

    def test_direct_bkpf_access_flagged(self):
        code = "SELECT belnr, gjahr FROM bkpf INTO TABLE @DATA(lt_headers)."
        res = CleanCoreEngine.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_DIRECT_DB_ACCESS" and f["table"] == "BKPF" for f in res["findings"])
        finding = next(f for f in res["findings"] if f.get("table") == "BKPF")
        assert finding["successor"] == "I_JournalEntry"

    def test_obsolete_perform_syntax_flagged(self):
        code = "PERFORM calculate_tax."
        res = CleanCoreEngine.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX" and f["statement"] == "PERFORM" for f in res["findings"])

    def test_obsolete_tables_statement_flagged(self):
        code = "TABLES: mara, vbak."
        res = CleanCoreEngine.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX" and f["statement"] == "TABLES" for f in res["findings"])

    def test_open_dataset_filesystem_access_flagged(self):
        code = "OPEN DATASET lv_file FOR OUTPUT IN TEXT MODE ENCODING UTF-8."
        res = CleanCoreEngine.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_OBSOLETE_SYNTAX" and f["statement"] == "OPEN DATASET" for f in res["findings"])

    def test_unreleased_api_call_flagged(self):
        code = "CALL FUNCTION 'BAPI_SALESORDER_CREATEFROMDAT2' EXPORTING order_header_in = ls_header."
        res = CleanCoreEngine.evaluate(code)
        assert any(f["code"] == "CLEAN_CORE_UNRELEASED_API" and f["function_module"] == "BAPI_SALESORDER_CREATEFROMDAT2" for f in res["findings"])
        finding = next(f for f in res["findings"] if f.get("function_module") == "BAPI_SALESORDER_CREATEFROMDAT2")
        assert "I_SalesOrderTP" in finding["successor"]

    @pytest.mark.asyncio
    async def test_clean_core_async_analyze(self):
        code = """
        REPORT ztest_order.
        TABLES: vbak.
        SELECT * FROM vbak INTO TABLE @DATA(lt_orders).
        PERFORM check_credit.
        FORM check_credit.
          CALL 'SYSTEM' ID 'COMMAND' FIELD 'whoami'.
        ENDFORM.
        """
        engine = CleanCoreEngine()
        req = AnalysisRequest(
            job_id="test-job-cc-1",
            tenant_id="tenant-123",
            project_id="proj-456",
            engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
            target_release="S4H_2023",
            raw_content=code,
        )
        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.engine_type == EngineType.CLEAN_CORE_OBJECT_GUARD
        assert len(resp.findings) >= 4
        assert resp.metrics.additional_metrics["compliance_percentage"] < 50.0

        for f in resp.findings:
            assert f.severity in (Severity.CRITICAL, Severity.BLOCKER, Severity.MAJOR)
            assert f.confidence == ConfidenceClass.VERIFIED
            assert len(f.evidence) == 1
            assert len(f.evidence[0].sha256) == 64
            assert f.evidence[0].line_number is not None


# ==============================================================================
# Suite 3: Cardinal Axiom 2 & Invariant Tests
# ==============================================================================

class TestCardinalAxiom2Invariants:
    """Verifies deterministic reproduction, missing evidence demotion, and AI boundary ceilings."""

    @pytest.mark.asyncio
    async def test_deterministic_reproducibility(self):
        """Two identical calls must produce byte-for-byte identical findings (Cardinal Axiom 2.4)."""
        engine = GapRadarEngine()
        req1 = AnalysisRequest(
            job_id="deterministic-job",
            tenant_id="tenant-abc",
            project_id="proj-abc",
            engine_type=EngineType.SAP_GAP_RADAR,
            raw_content="Trigger external webhook via cloud events on goods receipt",
        )
        req2 = AnalysisRequest(
            job_id="deterministic-job",
            tenant_id="tenant-abc",
            project_id="proj-abc",
            engine_type=EngineType.SAP_GAP_RADAR,
            raw_content="Trigger external webhook via cloud events on goods receipt",
        )
        resp1 = await engine.analyze(req1)
        resp2 = await engine.analyze(req2)

        dump1 = [f.model_dump(exclude={"id"}) for f in resp1.findings]
        dump2 = [f.model_dump(exclude={"id"}) for f in resp2.findings]
        assert dump1 == dump2

    def test_missing_evidence_demotes_to_unknown(self):
        """PROJECT.md line 30: Findings lacking evidence must demote to UNKNOWN (0.30)."""
        code = "SELECT * FROM mara INTO TABLE @lt_mara."
        res = CleanCoreEngine.evaluate(code)
        raw_f = res["findings"][0]

        from src.models.finding import Finding
        f = Finding(
            rule_id=raw_f["code"],
            severity=Severity.CRITICAL,
            category="CLEAN_CORE",
            title="Test Finding",
            description="Testing missing evidence",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Fix it",
            evidence=[],  # Missing evidence!
        )
        classified = ConfidenceClassifier.classify(f)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score == 0.30

    def test_ai_generated_demotes_to_inferred_ceiling(self):
        """PROJECT.md line 30: Findings derived with AI involvement can NEVER exceed INFERRED (0.60)."""
        from src.models.finding import Finding
        from src.models.evidence import Evidence

        ev = Evidence(
            artifact_path="test.abap",
            line_number=1,
            snippet="SELECT * FROM mara.",
            sha256="abc123def456",
            provenance=ConfidenceClass.VERIFIED,
        )
        f = Finding(
            rule_id="CLEAN_CORE_DIRECT_DB_ACCESS",
            severity=Severity.CRITICAL,
            category="CLEAN_CORE",
            title="AI Inferred Finding",
            description="AI assisted detection",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Fix it",
            evidence=[ev],
            is_ai_generated=True,
        )
        classified = ConfidenceClassifier.classify(f)
        assert classified.confidence == ConfidenceClass.INFERRED
        assert classified.confidence_score <= 0.60
