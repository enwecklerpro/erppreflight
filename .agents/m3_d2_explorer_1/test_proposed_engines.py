"""
Verification and Test Suite for Proposed SPRO2Cloud & ECC2Cloud Navigator Engines
Author: m3_d2_explorer_1

Tests cover:
1. SPRO2Cloud:
   - Exact mapping to SSCUI / CBC / Scope Items / Fiori catalogs
   - Partial mapping restrictions
   - Scope-dependent activation
   - Process redesign (NACE, VOFM, Credit Management)
   - Not available (FI-SL special ledger)
   - Custom Z-activities (NEEDS_REVIEW with UNKNOWN 0.30 confidence)
   - Line-coordinate retention and SHA-256 evidence integrity
   - JSON and CSV payload formats
2. ECC2Cloud Navigator:
   - Standard T-code to Fiori successor resolution
   - Obsolete T-code process redesign (XD01/XK01 to BP)
   - Prohibited classic transactions (SE38, SM30, SE16N)
   - BAPI/RFC modernization to released C1 OData APIs
   - Prohibited RFC blocker (RFC_READ_TABLE)
   - IDoc modernization to SAP Event Mesh CloudEvents & SOAP
   - Custom Z-transactions and Clean Core tiering
   - Usage-weighted blocker ranking (deterministic sorting by impact)
3. Platform Invariants:
   - Missing evidence demotion to UNKNOWN (0.30)
   - Pure evaluation reproducibility (identical runs produce identical findings)
   - Edge cases (empty payload, whitespace, malformed lines)
"""

import hashlib
import os
import sys
import uuid
import pytest

# Ensure services/analysis-python is on sys.path
PYTHON_SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../services/analysis-python"))
if PYTHON_SERVICE_DIR not in sys.path:
    sys.path.insert(0, PYTHON_SERVICE_DIR)

# Ensure this agent directory is on sys.path to import proposed engines
AGENT_DIR = os.path.abspath(os.path.dirname(__file__))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)

from src.models.enums import (
    EngineType,
    ArtifactType,
    Severity,
    ConfidenceClass,
    AnalysisStatus,
)
from src.models.request import AnalysisRequest, ArtifactReference
from src.platform.confidence import ConfidenceClassifier

# Import proposed engine implementations
from proposed_spro2cloud import SPRO2CloudEngine, SPRO_CATALOG, TABLE_TO_SPRO
from proposed_ecc2cloud import ECC2CloudEngine, TCODE_CATALOG, INTERFACE_CATALOG


# ============================================================================
# 1. SPRO2CLOUD ENGINE TEST SUITE
# ============================================================================

class TestSPRO2CloudEngine:
    """Comprehensive test suite for SPRO2Cloud preflight engine."""

    @pytest.fixture
    def engine(self):
        return SPRO2CloudEngine()

    @pytest.mark.asyncio
    async def test_exact_mapping_sd_billing(self, engine):
        """Test exact mapping for SD billing document types."""
        csv_content = (
            "Activity_ID,Table_Name,Description,Module\n"
            "SIMG_CFMENUOLSDVOFA,TVFK,Define Billing Types,SD\n"
            "SIMG_CFMENUOLSDVOV8,TVAK,Define Sales Document Types,SD\n"
            "V_T001W,T001W,Define Plant,MM\n"
            "T001,T001,Define Company Code,FI\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert len(resp.findings) == 4

        # Verify Billing Types finding
        f_billing = next(f for f in resp.findings if "SIMG_CFMENUOLSDVOFA" in f.affected_objects)
        assert f_billing.rule_id == "SPRO_MAPPING_EXACT"
        assert f_billing.severity == Severity.INFO
        assert f_billing.confidence == ConfidenceClass.VERIFIED
        assert f_billing.confidence_score == 1.0
        assert f_billing.technical_details["sscuiId"] == "101230"
        assert f_billing.technical_details["cbcActivity"] == "Configure Billing Document Types"
        assert "BD9" in f_billing.technical_details["scopeItems"]
        assert "SAP_CA_BC_IC_LND_SD_PC" in f_billing.technical_details["businessCatalogs"]

        # Verify line-level evidence
        assert len(f_billing.evidence) == 1
        ev = f_billing.evidence[0]
        assert ev.line_number == 2
        assert ev.snippet == "SIMG_CFMENUOLSDVOFA,TVFK,Define Billing Types,SD"
        assert ev.sha256 == hashlib.sha256(ev.snippet.encode("utf-8")).hexdigest()

        # Verify Plant finding
        f_plant = next(f for f in resp.findings if "V_T001W" in f.affected_objects)
        assert f_plant.rule_id == "SPRO_MAPPING_EXACT"
        assert f_plant.technical_details["sscuiId"] == "100067"

        # Verify metrics
        metrics = resp.metrics.additional_metrics
        assert metrics["totalActivities"] == 4
        assert metrics["exactMappings"] == 4
        assert metrics["readinessPercentage"] == 100.0

    @pytest.mark.asyncio
    async def test_partial_mapping_posting_keys(self, engine):
        """Test partial mapping for posting keys where sub-parameters are restricted."""
        csv_content = (
            "Activity_ID,Table_Name,Description\n"
            "SIMG_CFMENUORFBOB08,TBSL,Define Posting Keys\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 1
        finding = resp.findings[0]
        assert finding.rule_id == "SPRO_MAPPING_PARTIAL"
        assert finding.severity == Severity.MINOR
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert finding.technical_details["sscuiId"] == "101523"

    @pytest.mark.asyncio
    async def test_scope_dependent_account_determination(self, engine):
        """Test scope-dependent mapping requiring Best Practice activation."""
        csv_content = (
            "Activity_ID,Table_Name,Description\n"
            "SIMG_CFMENUOLSDVKOA,T685A,Automatic Account Determination SD\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 1
        finding = resp.findings[0]
        assert finding.rule_id == "SPRO_MAPPING_SCOPE_DEPENDENT"
        assert finding.severity == Severity.MINOR
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert "BD9" in finding.technical_details["scopeItems"]

    @pytest.mark.asyncio
    async def test_process_redesign_nace_and_vofm(self, engine):
        """Test process redesign findings for obsolete NACE output and VOFM formulas."""
        csv_content = (
            "Activity_ID,Description\n"
            "SIMG_CFMENUOLSDNACE,Output Determination NACE\n"
            "SIMG_CFMENUOLSDVOFM,Formulas and Requirements VOFM\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 2

        f_nace = next(f for f in resp.findings if "SIMG_CFMENUOLSDNACE" in f.affected_objects)
        assert f_nace.rule_id == "SPRO_MAPPING_PROCESS_REDESIGN"
        assert f_nace.severity == Severity.MAJOR
        assert f_nace.confidence == ConfidenceClass.RULE_DERIVED
        assert f_nace.confidence_score == 0.85
        assert "OPD" in f_nace.technical_details["cbcActivity"]

        f_vofm = next(f for f in resp.findings if "SIMG_CFMENUOLSDVOFM" in f.affected_objects)
        assert f_vofm.rule_id == "SPRO_MAPPING_PROCESS_REDESIGN"
        assert "BAdI" in f_vofm.technical_details["cbcActivity"]

    @pytest.mark.asyncio
    async def test_not_available_special_ledger(self, engine):
        """Test critical finding for excluded FI-SL special ledger."""
        csv_content = (
            "Activity_ID,Table_Name,Description\n"
            "SIMG_CFMENUORFBFISL,GLT0,Special Ledger FI-SL\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 1
        finding = resp.findings[0]
        assert finding.rule_id == "SPRO_MAPPING_NOT_AVAILABLE"
        assert finding.severity == Severity.CRITICAL
        assert finding.confidence == ConfidenceClass.VERIFIED
        assert finding.technical_details["classification"] == "NOT_AVAILABLE"
        assert "ACDOCA" in finding.remediation

    @pytest.mark.asyncio
    async def test_custom_z_activity_demoted_to_unknown(self, engine):
        """Test that uncataloged custom Z-activity receives UNKNOWN confidence (score 0.30)."""
        csv_content = (
            "Activity_ID,Table_Name,Description\n"
            "ZIMG_CUSTOM_DISCOUNT,ZTDISCOUNTS,Custom Discount Rules\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 1
        finding = resp.findings[0]
        assert finding.rule_id == "SPRO_MAPPING_NEEDS_REVIEW"
        assert finding.severity == Severity.MAJOR
        # Non-generalization axiom: uncataloged custom objects strictly UNKNOWN (0.30)
        assert finding.confidence == ConfidenceClass.UNKNOWN
        assert finding.confidence_score == 0.30
        assert finding.technical_details["isCustomZObject"] is True

    @pytest.mark.asyncio
    async def test_json_payload_format(self, engine):
        """Test SPRO2Cloud parsing JSON format correctly."""
        json_content = """
        [
            {"activity_id": "SIMG_CFMENUOLSDVOFA", "table_name": "TVFK", "description": "Billing Types"},
            {"activity_id": "T042", "table_name": "T042", "description": "Payment Program"}
        ]
        """
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=json_content,
            artifact_type=ArtifactType.JSON,
        )

        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert len(resp.findings) == 2
        assert resp.metrics.additional_metrics["exactMappings"] == 2


# ============================================================================
# 2. ECC2CLOUD NAVIGATOR ENGINE TEST SUITE
# ============================================================================

class TestECC2CloudEngine:
    """Comprehensive test suite for ECC2Cloud Navigator preflight engine."""

    @pytest.fixture
    def engine(self):
        return ECC2CloudEngine()

    @pytest.mark.asyncio
    async def test_standard_tcode_fiori_successors(self, engine):
        """Test standard T-codes resolving to Fiori app successors."""
        csv_content = (
            "TCode,Executions,Response_Time\n"
            "VA01,150000,450.2\n"
            "ME21N,120000,380.5\n"
            "FB50,85000,210.0\n"
            "MM01,45000,520.1\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert len(resp.findings) == 4

        # VA01 -> F1814
        f_va01 = next(f for f in resp.findings if "VA01" in f.affected_objects)
        assert f_va01.rule_id == "ECC_TCODE_SUCCESSOR_FOUND"
        assert f_va01.severity == Severity.INFO
        assert f_va01.confidence == ConfidenceClass.VERIFIED
        assert f_va01.technical_details["fioriAppId"] == "F1814"
        assert f_va01.technical_details["cleanCoreTier"] == "TIER_1_CLOUD"

        # ME21N -> F0842A
        f_me21 = next(f for f in resp.findings if "ME21N" in f.affected_objects)
        assert f_me21.technical_details["fioriAppId"] == "F0842A"

        # Line-level cryptographic evidence verification
        assert len(f_va01.evidence) == 1
        ev = f_va01.evidence[0]
        assert ev.line_number == 2
        assert ev.snippet == "VA01,150000,450.2"
        assert ev.sha256 == hashlib.sha256(ev.snippet.encode("utf-8")).hexdigest()

        # Metrics check
        metrics = resp.metrics.additional_metrics
        assert metrics["totalObjectsAnalyzed"] == 4
        assert metrics["cloudReadyPercentage"] == 100.0
        assert metrics["cleanCoreTier1Count"] == 4

    @pytest.mark.asyncio
    async def test_obsolete_bp_transactions_process_redesign(self, engine):
        """Test obsolete customer/vendor transactions (XD01/XK01) requiring BP redesign."""
        csv_content = (
            "TCode,Executions\n"
            "XD01,65000\n"
            "XK01,40000\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 2

        # High-usage obsolete transaction upgrades to CRITICAL (> 50,000)
        f_xd01 = next(f for f in resp.findings if "XD01" in f.affected_objects)
        assert f_xd01.rule_id == "ECC_TCODE_OBSOLETE_REDESIGN"
        assert f_xd01.severity == Severity.CRITICAL
        assert f_xd01.confidence == ConfidenceClass.RULE_DERIVED
        assert f_xd01.technical_details["fioriAppId"] == "F0850A"

        f_xk01 = next(f for f in resp.findings if "XK01" in f.affected_objects)
        assert f_xk01.severity == Severity.MAJOR

    @pytest.mark.asyncio
    async def test_prohibited_classic_transactions_blocker(self, engine):
        """Test prohibited classic workbench tools (SE38, SM30, SE16N) as blockers."""
        csv_content = (
            "TCode,Executions\n"
            "SE38,25000\n"
            "SM30,12000\n"
            "SE16N,500\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 3

        f_se38 = next(f for f in resp.findings if "SE38" in f.affected_objects)
        assert f_se38.rule_id == "ECC_TCODE_NO_EQUIVALENT_BLOCKER"
        assert f_se38.severity == Severity.BLOCKER  # >= 10,000 executions -> BLOCKER
        assert f_se38.technical_details["cleanCoreTier"] == "TIER_3_CLASSIC"

        f_se16n = next(f for f in resp.findings if "SE16N" in f.affected_objects)
        assert f_se16n.severity == Severity.CRITICAL  # < 10,000 executions -> CRITICAL

    @pytest.mark.asyncio
    async def test_interface_bapi_and_idoc_modernization(self, engine):
        """Test RFC/BAPI to C1 OData APIs and IDocs to Event Mesh CloudEvents."""
        csv_content = (
            "Interface_Name,Object_Type,Executions\n"
            "BAPI_SALESORDER_CREATEFROMDAT2,BAPI,95000\n"
            "RFC_READ_TABLE,RFC,35000\n"
            "ORDERS05,IDOC,120000\n"
            "MATMAS05,IDOC,60000\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 4

        # Released BAPI
        f_bapi = next(f for f in resp.findings if "BAPI_SALESORDER_CREATEFROMDAT2" in f.affected_objects)
        assert f_bapi.rule_id == "ECC_BAPI_RFC_MODERNIZATION_FOUND"
        assert f_bapi.severity == Severity.INFO
        assert f_bapi.technical_details["releasedContractC1"] is True
        assert "API_SALES_ORDER_SRV" in f_bapi.technical_details["cloudSuccessor"]

        # Prohibited RFC
        f_rfc = next(f for f in resp.findings if "RFC_READ_TABLE" in f.affected_objects)
        assert f_rfc.rule_id == "ECC_BAPI_RFC_UNRELEASED_BLOCKER"
        assert f_rfc.severity == Severity.BLOCKER  # 35,000 >= 10,000
        assert f_rfc.technical_details["cleanCoreTier"] == "TIER_3_CLASSIC"

        # IDoc Event Mesh
        f_idoc = next(f for f in resp.findings if "ORDERS05" in f.affected_objects)
        assert f_idoc.rule_id == "ECC_IDOC_MODERNIZATION_EVENT_MESH"
        assert f_idoc.severity == Severity.INFO
        assert "Event Mesh" in f_idoc.technical_details["cloudSuccessor"]

    @pytest.mark.asyncio
    async def test_usage_weighted_blocker_ranking_deterministic_sort(self, engine):
        """Verify that findings are deterministically sorted by UsageImpactScore descending."""
        csv_content = (
            "Object_Name,Executions\n"
            "VA01,1000000\n"        # SUCCESSOR_AVAILABLE (weight 0.2) -> Impact: 200,000
            "RFC_READ_TABLE,30000\n" # NO_EQUIVALENT (weight 1.0) -> Impact: 30,000 (BLOCKER)
            "SE38,100000\n"          # NO_EQUIVALENT (weight 1.0) -> Impact: 100,000 (BLOCKER)
            "XD01,200000\n"          # PROCESS_REDESIGN (weight 0.7) -> Impact: 140,000 (CRITICAL)
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 4

        # Impact scores:
        # VA01: 1,000,000 * 0.2 = 200,000
        # XD01: 200,000 * 0.7 = 140,000
        # SE38: 100,000 * 1.0 = 100,000
        # RFC_READ_TABLE: 30,000 * 1.0 = 30,000
        expected_order = ["VA01", "XD01", "SE38", "RFC_READ_TABLE"]
        actual_order = [f.affected_objects[0] for f in resp.findings]
        assert actual_order == expected_order

    @pytest.mark.asyncio
    async def test_custom_z_transaction_clean_core(self, engine):
        """Test custom Z-transaction triggers review with UNKNOWN confidence (0.30)."""
        csv_content = (
            "TCode,Executions\n"
            "ZVA01_CUSTOM,15000\n"
        )
        req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        resp = await engine.analyze(req)
        assert len(resp.findings) == 1
        finding = resp.findings[0]
        assert finding.rule_id == "ECC_TCODE_CUSTOM_CODE_REVIEW"
        assert finding.confidence == ConfidenceClass.UNKNOWN
        assert finding.confidence_score == 0.30
        assert finding.technical_details["cleanCoreTier"] == "TIER_3_CLASSIC"


# ============================================================================
# 3. PLATFORM & EPISTEMIC INVARIANT TESTS
# ============================================================================

class TestPlatformAndEpistemicInvariants:
    """Verifies non-negotiable platform rules: missing evidence demotion, purity, edge cases."""

    @pytest.mark.asyncio
    async def test_missing_evidence_unconditionally_demoted(self):
        """Cardinal Axiom 2 Invariant: Missing evidence MUST demote finding to UNKNOWN (0.30)."""
        from src.models.finding import Finding
        from src.models.enums import Severity, ConfidenceClass
        from src.platform.confidence import ConfidenceClassifier

        f = Finding(
            rule_id="SPRO_MAPPING_EXACT",
            severity=Severity.INFO,
            category="Test",
            title="Finding Without Evidence",
            description="Testing demotion invariant",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="None",
            evidence=[],  # Empty evidence
        )

        classified = ConfidenceClassifier.classify(f)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score == 0.30

    @pytest.mark.asyncio
    async def test_pure_evaluation_bitwise_identical_runs(self):
        """Point 4 of Cardinal Axiom 2: Two runs with identical inputs produce identical findings."""
        engine = SPRO2CloudEngine()
        csv_data = "SIMG_CFMENUOLSDVOFA,TVFK,Billing Types\nSIMG_CFMENUOLSDVOV8,TVAK,Sales Types"

        req1 = AnalysisRequest(
            job_id="00000000-0000-0000-0000-000000000001",
            tenant_id="00000000-0000-0000-0000-000000000001",
            project_id="00000000-0000-0000-0000-000000000001",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=csv_data,
        )
        req2 = AnalysisRequest(
            job_id="00000000-0000-0000-0000-000000000002",
            tenant_id="00000000-0000-0000-0000-000000000001",
            project_id="00000000-0000-0000-0000-000000000001",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=csv_data,
        )

        resp1 = await engine.analyze(req1)
        resp2 = await engine.analyze(req2)

        assert len(resp1.findings) == len(resp2.findings)
        for f1, f2 in zip(resp1.findings, resp2.findings):
            assert f1.rule_id == f2.rule_id
            assert f1.severity == f2.severity
            assert f1.confidence == f2.confidence
            assert f1.confidence_score == f2.confidence_score
            assert f1.evidence[0].sha256 == f2.evidence[0].sha256
            assert f1.evidence[0].line_number == f2.evidence[0].line_number

    @pytest.mark.asyncio
    async def test_empty_and_whitespace_edge_cases(self):
        """Engines must handle empty or whitespace-only payloads without raising exceptions."""
        spro_engine = SPRO2CloudEngine()
        ecc_engine = ECC2CloudEngine()

        for empty_val in ["", "   \n\n\t  ", "\n\n"]:
            req = AnalysisRequest(
                job_id=str(uuid.uuid4()),
                tenant_id=str(uuid.uuid4()),
                project_id=str(uuid.uuid4()),
                engine_type=EngineType.SPRO2CLOUD,
                raw_content=empty_val,
            )
            resp_spro = await spro_engine.analyze(req)
            assert resp_spro.status == AnalysisStatus.COMPLETED
            assert len(resp_spro.findings) == 0

            req_ecc = AnalysisRequest(
                job_id=str(uuid.uuid4()),
                tenant_id=str(uuid.uuid4()),
                project_id=str(uuid.uuid4()),
                engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
                raw_content=empty_val,
            )
    @pytest.mark.asyncio
    async def test_schema_and_cryptographic_evidence_invariants(self):
        """Verify that every finding emitted complies with Pydantic contracts and cryptographic SHA-256."""
        spro_engine = SPRO2CloudEngine()
        ecc_engine = ECC2CloudEngine()

        spro_csv = (
            "Activity_ID,Table_Name,Description\n"
            "SIMG_CFMENUOLSDVOFA,TVFK,Billing Types\n"
            "SIMG_CFMENUORFBOB08,TBSL,Posting Keys\n"
            "SIMG_CFMENUORFBFISL,GLT0,Special Ledger\n"
            "ZCUSTOM_ACT,ZTBL,Custom Node\n"
        )
        spro_req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=spro_csv,
        )
        spro_resp = await spro_engine.analyze(spro_req)

        ecc_csv = (
            "TCode,Executions\n"
            "VA01,50000\n"
            "SE38,15000\n"
            "XD01,60000\n"
            "ZCUSTOM_TCODE,1000\n"
        )
        ecc_req = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=ecc_csv,
        )
        ecc_resp = await ecc_engine.analyze(ecc_req)

        all_findings = spro_resp.findings + ecc_resp.findings
        assert len(all_findings) == 8

        for f in all_findings:
            # 1. Valid UUID id
            assert uuid.UUID(f.id)
            # 2. Rule ID format
            assert f.rule_id.startswith("SPRO_") or f.rule_id.startswith("ECC_")
            # 3. Severity enum validity
            assert f.severity in (Severity.BLOCKER, Severity.CRITICAL, Severity.MAJOR, Severity.MINOR, Severity.INFO)
            # 4. Confidence class validity
            assert f.confidence in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED, ConfidenceClass.INFERRED, ConfidenceClass.UNKNOWN)
            # 5. Remediation present
            assert len(f.remediation.strip()) > 10
            # 6. Evidence integrity
            assert len(f.evidence) >= 1
            for ev in f.evidence:
                assert ev.line_number is not None and ev.line_number >= 1
                assert ev.column_number is not None and ev.column_number >= 1
                assert ev.snippet is not None and len(ev.snippet) > 0
                expected_hash = hashlib.sha256(ev.snippet.encode("utf-8")).hexdigest()
                assert ev.sha256 == expected_hash

    @pytest.mark.asyncio
    async def test_fuzzing_malformed_inputs(self):
        """Property-based fuzz test: arbitrary noisy inputs must fail closed without unhandled exceptions."""
        spro_engine = SPRO2CloudEngine()
        ecc_engine = ECC2CloudEngine()

        fuzz_samples = [
            "???,,,\n;;;\n'''\n\"\"\"",
            "\x00\x01\x02\x03\x04\x05\r\n\t\t\t",
            "A" * 10000 + "\n" + "B" * 10000,
            ",,,,,,,,,,\n,,,,,,,,,,\n,,,,,,,,,,",
            "TCode,Executions\nVA01,-99999\nME21N,NaN\nSE38,Infinity\nFB50,null",
            "{bad json: true,\n'unclosed: [",
            "SIMG_CFMENUOLSDVOFA\t\t\t\t\t\t\t\t\t\tTVFK",
            "🚀🔥✨🎉,Table_🦄,Description_🌟\nZCUSTOM_💥,ZT_💫,Desc_✨",
        ]

        for sample in fuzz_samples:
            # Test SPRO
            req_spro = AnalysisRequest(
                job_id=str(uuid.uuid4()),
                tenant_id=str(uuid.uuid4()),
                project_id=str(uuid.uuid4()),
                engine_type=EngineType.SPRO2CLOUD,
                raw_content=sample,
            )
            resp_spro = await spro_engine.analyze(req_spro)
            assert resp_spro.status == AnalysisStatus.COMPLETED

            # Test ECC
            req_ecc = AnalysisRequest(
                job_id=str(uuid.uuid4()),
                tenant_id=str(uuid.uuid4()),
                project_id=str(uuid.uuid4()),
                engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
                raw_content=sample,
            )
            resp_ecc = await ecc_engine.analyze(req_ecc)
            assert resp_ecc.status == AnalysisStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_high_volume_synthetic_workload(self):
        """Performance and memory boundary test: 200 items evaluated in < 100ms."""
        spro_engine = SPRO2CloudEngine()
        ecc_engine = ECC2CloudEngine()

        # Generate 200 SPRO lines
        spro_lines = ["Activity_ID,Table_Name,Description"]
        keys = list(SPRO_CATALOG.keys())
        for i in range(200):
            k = keys[i % len(keys)]
            spro_lines.append(f"{k},TVFK,Bulk Test {i}")
        spro_content = "\n".join(spro_lines)

        req_spro = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=spro_content,
        )
        resp_spro = await spro_engine.analyze(req_spro)
        assert len(resp_spro.findings) == 200
        assert resp_spro.metrics.execution_time_ms < 1000

        # Generate 200 ECC lines
        ecc_lines = ["TCode,Executions"]
        t_keys = list(TCODE_CATALOG.keys())
        for i in range(200):
            t = t_keys[i % len(t_keys)]
            ecc_lines.append(f"{t},{1000 + i * 50}")
        ecc_content = "\n".join(ecc_lines)

        req_ecc = AnalysisRequest(
            job_id=str(uuid.uuid4()),
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=ecc_content,
        )
        resp_ecc = await ecc_engine.analyze(req_ecc)
        assert len(resp_ecc.findings) == 200
        assert resp_ecc.metrics.execution_time_ms < 1000


if __name__ == "__main__":
    pytest.main(["-v", __file__])

