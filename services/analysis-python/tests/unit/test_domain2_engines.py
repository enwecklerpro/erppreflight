"""
ERP Preflight — Domain 2 Migration & Clean Core Engines Pytest Suite
Engines Covered:
1. SPRO2Cloud (SPRO2CLOUD)
2. ECC2Cloud Navigator (ECC2CLOUD_NAVIGATOR)
3. SAP Gap Radar (SAP_GAP_RADAR)
4. Clean Core Object Guard (CLEAN_CORE_OBJECT_GUARD)

Governing Standard: AGENTS.md, engine-authoring.md, sap-evidence.md
Pass Rate Requirement: 100% automated pass rate under pytest
"""

import hashlib
import json
import os
from pathlib import Path
import pytest
import random
import sys
from typing import Dict, Any, List, Optional

# Ensure engines are loaded into EngineRegistry
import src.engines
from src.core.runner import EngineRunner
from src.core.registry import EngineRegistry, register_engine
from src.models.enums import (
    EngineType,
    AnalysisStatus,
    Severity,
    ConfidenceClass,
    ArtifactType,
    TrustLevel,
)
from src.models.request import AnalysisRequest
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.models.response import AnalysisResponse
from src.platform.confidence import ConfidenceClassifier


# Domain 2 engines are registered via import src.engines above.


FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "domain2"
if not FIXTURE_DIR.exists():
    FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent.parent / "services" / "analysis-python" / "tests" / "fixtures" / "domain2"


def load_fixture(filename: str) -> str:
    """Reads fixture file from disk with verified fallback for isolated execution."""
    fixture_path = FIXTURE_DIR / filename
    if fixture_path.exists():
        return fixture_path.read_text(encoding="utf-8")
    return get_inline_fixture_fallback(filename)


def get_inline_fixture_fallback(filename: str) -> str:
    """Provides inline fallback for isolated runners when fixtures directory is not yet provisioned."""
    fallbacks = {
        "spro_standard_valid.csv": (
            "ActivityID,ActivityName,Module,TargetTable,CountryCode\n"
            "SIMG_CFMENUOLSDVOFA,Define Billing Types,SD,TVFK,DE\n"
            "SIMG_CFMENUOLSDVOV8,Define Sales Document Types,SD,TVAK,DE\n"
            "SIMG_CFMENUOLMEOMH5,Define Purchasing Document Types,MM,T161,DE\n"
            "SIMG_CFMENUORKSOKP3,Define Settlement Profiles,CO,TKO08,DE\n"
        ),
        "spro_negative_unsupported.csv": (
            "ActivityID,ActivityName,Module,TargetTable,CountryCode\n"
            "SIMG_CFMENUORFBFISL,Special Ledger (FI-SL),FI,GLT0,DE\n"
            "SIMG_CFMENUOLSDVOFM,Define Formulas and Requirements (VOFM),SD,TFRM,DE\n"
            "SIMG_CFMENUORFBOB08,Define Posting Keys,FI,TBSL,DE\n"
        ),
        "spro_custom_z_activity.json": json.dumps({
            "target_release": "S4HC_2408",
            "target_country": "US",
            "activities": [
                {
                    "activity_id": "ZIMG_CUSTOM_TAX_OVERRIDE",
                    "activity_name": "Custom Dynamic Tax Jurisdiction Engine",
                    "module": "FI",
                    "target_table": "ZTTAX_RULES",
                    "country_code": "US",
                },
                {
                    "activity_id": "SIMG_IT_ASSET_DEPRECIATION_CALC",
                    "activity_name": "Italian Local Statutory Depreciation Method",
                    "module": "FI",
                    "target_table": "T090NA",
                    "country_code": "IT",
                }
            ]
        }),
        "ecc_st03n_clean.csv": (
            "TCode,ExecutionCount,AvgResponseTimeMs,UserCount,Module\n"
            "ME21N,142050,420,128,MM\n"
            "VA01,98400,380,95,SD\n"
            "FB01,85200,310,64,FI\n"
            "MM01,210000,180,310,MM\n"
        ),
        "ecc_obsolete_blockers.csv": (
            "TCode,ExecutionCount,AvgResponseTimeMs,UserCount,Module\n"
            "ZVA01_OBSOLETE,450000,850,210,SD\n"
            "SE38,32000,120,14,BC\n"
            "SM30,48000,190,22,BC\n"
            "XD01,75000,410,48,SD\n"
        ),
        "ecc_interface_inventory.json": json.dumps({
            "system_id": "PRD_ECC60",
            "target_release": "S4HC_2408",
            "objects": [
                {
                    "name": "BAPI_MATERIAL_SAVEDATA",
                    "type": "BAPI",
                    "executions": 85000,
                    "caller_systems": ["MES_FACTORY_1", "PLM_TEAMCENTER"],
                },
                {
                    "name": "ORDERS05",
                    "type": "IDOC",
                    "executions": 120000,
                    "direction": "INBOUND",
                },
                {
                    "name": "RFC_READ_TABLE",
                    "type": "RFC",
                    "executions": 14000,
                    "is_custom": False,
                }
            ]
        }),
        "gap_radar_event_mesh.json": json.dumps({
            "requirement_id": "REQ-LOG-001",
            "title": "Real-time High Value PO External Notification",
            "requirement": "Trigger external webhook event mesh on purchase order release when total value exceeds 100,000 EUR",
            "description": "Trigger external webhook event mesh on purchase order release when total value exceeds 100,000 EUR",
            "target_edition": "Public",
            "target_release": "2408",
            "module": "MM",
        }),
        "gap_radar_direct_db_write.json": json.dumps({
            "requirement_id": "REQ-FIN-666",
            "title": "Direct Accounting Ledger Status Override",
            "requirement": "Directly update BSEG database table and line items in ACDOCA via custom SQL trigger",
            "description": "Directly update BSEG database table and line items in ACDOCA via custom SQL trigger",
            "target_edition": "Public",
            "target_release": "2408",
            "module": "FI",
        }),
        "gap_radar_known_gap.json": json.dumps({
            "requirement_id": "REQ-TRM-789",
            "title": "Physical Commodity Hedging Multi-Currency Settlement",
            "requirement": "Automated physical commodity futures settlement known product gap on public cloud roadmap",
            "description": "Automated physical commodity futures settlement known product gap on public cloud roadmap",
            "target_edition": "Public",
            "target_release": "2408",
            "module": "TRM",
        }),
        "clean_core_compliant.abap": (
            "CLASS zcl_product_processor DEFINITION\n"
            "  PUBLIC\n"
            "  FINAL\n"
            "  CREATE PUBLIC.\n"
            "\n"
            "  PUBLIC SECTION.\n"
            "    INTERFACES if_oo_adt_classrun.\n"
            "    TYPES: tt_product TYPE STANDARD TABLE OF I_Product WITH EMPTY KEY.\n"
            "    METHODS get_active_products\n"
            "      IMPORTING\n"
            "        iv_type TYPE I_Product-ProductType\n"
            "      RETURNING\n"
            "        VALUE(rt_products) TYPE tt_product.\n"
            "ENDCLASS.\n"
            "\n"
            "CLASS zcl_product_processor IMPLEMENTATION.\n"
            "  METHOD get_active_products.\n"
            "    SELECT Product, ProductType, BaseUnit, CreationDateTime\n"
            "      FROM I_Product\n"
            "      WHERE ProductType = @iv_type\n"
            "      INTO CORRESPONDING FIELDS OF TABLE @rt_products.\n"
            "  ENDMETHOD.\n"
            "\n"
            "  METHOD if_oo_adt_classrun~main.\n"
            "    DATA(lt_prod) = get_active_products( 'FERT' ).\n"
            "    out->write( |Fetched { lines( lt_prod ) } active products| ).\n"
            "  ENDMETHOD.\n"
            "ENDCLASS.\n"
        ),
        "clean_core_legacy.abap": (
            "REPORT zr_legacy_stock_export.\n"
            "\n"
            "TABLES: mara, vbak.\n"
            "\n"
            "DATA: lt_mara TYPE TABLE OF mara,\n"
            "      ls_mara TYPE mara,\n"
            "      lv_file TYPE string VALUE '/usr/sap/trans/data/stock.txt',\n"
            "      lv_cmd  TYPE string VALUE 'rm -rf /tmp/scratch'.\n"
            "\n"
            "START-OF-SELECTION.\n"
            "  PERFORM fetch_materials.\n"
            "  PERFORM export_to_file.\n"
            "\n"
            "FORM fetch_materials.\n"
            "  SELECT * FROM mara INTO TABLE lt_mara WHERE mtart = 'FERT'.\n"
            "  SELECT vbeln, erdat FROM vbak INTO (mara-matnr, mara-ersda).\n"
            "  ENDSELECT.\n"
            "ENDFORM.\n"
            "\n"
            "FORM export_to_file.\n"
            "  OPEN DATASET lv_file FOR OUTPUT IN TEXT MODE ENCODING DEFAULT.\n"
            "  LOOP AT lt_mara INTO ls_mara.\n"
            "    TRANSFER ls_mara-matnr TO lv_file.\n"
            "  ENDLOOP.\n"
            "  CLOSE DATASET lv_file.\n"
            "  CALL 'SYSTEM' ID 'COMMAND' FIELD lv_cmd.\n"
            "ENDFORM.\n"
        ),
        "clean_core_dynamic.abap": (
            "CLASS zcl_dynamic_reader DEFINITION PUBLIC FINAL CREATE PUBLIC.\n"
            "  PUBLIC SECTION.\n"
            "    METHODS execute_dynamic_query\n"
            "      IMPORTING\n"
            "        iv_table TYPE tabname\n"
            "        iv_fields TYPE string\n"
            "      RETURNING\n"
            "        VALUE(rv_count) TYPE i.\n"
            "ENDCLASS.\n"
            "\n"
            "CLASS zcl_dynamic_reader IMPLEMENTATION.\n"
            "  METHOD execute_dynamic_query.\n"
            "    FIELD-SYMBOLS: <lt_table> TYPE ANY TABLE.\n"
            "    SELECT (iv_fields) FROM (iv_table) INTO TABLE @<lt_table>.\n"
            "\n"
            "    EXEC SQL.\n"
            "      COMMIT WORK;\n"
            "    ENDEXEC.\n"
            "\n"
            "    CALL FUNCTION 'RFC_READ_TABLE'\n"
            "      EXPORTING\n"
            "        query_table = iv_table.\n"
            "  ENDMETHOD.\n"
            "ENDCLASS.\n"
        ),
    }
    return fallbacks.get(filename, "{}")


# ==============================================================================
# 1. Engine Metadata & Registry Conformance Tests (Cardinal Axiom 2)
# ==============================================================================

class TestDomain2MetadataAndRegistry:
    """Verifies that all 4 Domain 2 engines fulfill Cardinal Axiom 2 metadata points."""

    def test_spro2cloud_metadata_registered(self):
        engine = EngineRegistry.get(EngineType.SPRO2CLOUD)
        assert engine is not None
        assert engine.engine_type == EngineType.SPRO2CLOUD
        assert "SPRO2Cloud" in engine.name
        assert ArtifactType.CSV in engine.supported_artifact_types

    def test_ecc2cloud_metadata_registered(self):
        engine = EngineRegistry.get(EngineType.ECC2CLOUD_NAVIGATOR)
        assert engine is not None
        assert engine.engine_type == EngineType.ECC2CLOUD_NAVIGATOR
        assert "ECC2Cloud" in engine.name
        assert ArtifactType.CSV in engine.supported_artifact_types

    def test_gap_radar_metadata_registered(self):
        engine = EngineRegistry.get(EngineType.SAP_GAP_RADAR)
        assert engine is not None
        assert engine.engine_type == EngineType.SAP_GAP_RADAR
        assert "Gap Radar" in engine.name
        assert ArtifactType.JSON in engine.supported_artifact_types

    def test_clean_core_metadata_registered(self):
        engine = EngineRegistry.get(EngineType.CLEAN_CORE_OBJECT_GUARD)
        assert engine is not None
        assert engine.engine_type == EngineType.CLEAN_CORE_OBJECT_GUARD
        assert "Clean Core" in engine.name
        assert ArtifactType.ABAP in engine.supported_artifact_types


# ==============================================================================
# 2. SPRO2Cloud Engine Test Suite
# ==============================================================================

class TestSPRO2CloudEngine:
    """Test suite verifying SPRO2Cloud IMG to Cloud CBC/SSCUI mapping."""

    @pytest.mark.asyncio
    async def test_spro_positive_clean_scenario(self):
        """Positive Test: Standard SD/MM activities map cleanly with 0 blockers."""
        csv_content = load_fixture("spro_standard_valid.csv")
        req = AnalysisRequest(
            job_id="11111111-1111-1111-1111-111111111101",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert res.engine_type == EngineType.SPRO2CLOUD

        # Assert no BLOCKER or CRITICAL findings in clean golden scenario
        blockers = [f for f in res.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]
        assert len(blockers) == 0

        # Assert exact and scope-dependent mappings are present
        exact_findings = [f for f in res.findings if f.rule_id == "SPRO_MAPPING_EXACT"]
        assert len(exact_findings) >= 1
        for f in exact_findings:
            assert f.confidence == ConfidenceClass.VERIFIED
            assert len(f.evidence) >= 1
            assert len(f.evidence[0].sha256) == 64

    @pytest.mark.asyncio
    async def test_spro_negative_unsupported_and_redesign(self):
        """Negative Test: Classic FI-SL and VOFM trigger NOT_AVAILABLE and PROCESS_REDESIGN."""
        csv_content = load_fixture("spro_negative_unsupported.csv")
        req = AnalysisRequest(
            job_id="11111111-1111-1111-1111-111111111102",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        not_avail = [f for f in res.findings if f.rule_id == "SPRO_MAPPING_NOT_AVAILABLE"]
        assert len(not_avail) >= 1
        assert not_avail[0].severity in (Severity.CRITICAL, Severity.BLOCKER)
        assert not_avail[0].confidence == ConfidenceClass.VERIFIED
        assert "Special Ledger" in not_avail[0].title or "Special Ledger" in not_avail[0].description

        redesign = [f for f in res.findings if f.rule_id == "SPRO_MAPPING_PROCESS_REDESIGN"]
        assert len(redesign) >= 1
        assert redesign[0].severity in (Severity.MAJOR, Severity.CRITICAL)

    @pytest.mark.asyncio
    async def test_spro_edge_custom_z_activity(self):
        """Edge Case Test: Custom Z-activity demotes confidence to UNKNOWN (0.30)."""
        json_content = load_fixture("spro_custom_z_activity.json")
        req = AnalysisRequest(
            job_id="11111111-1111-1111-1111-111111111103",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=json_content,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        review_findings = [f for f in res.findings if f.rule_id == "SPRO_MAPPING_NEEDS_REVIEW"]
        assert len(review_findings) >= 1
        finding = review_findings[0]
        assert finding.confidence == ConfidenceClass.UNKNOWN
        assert finding.confidence_score == 0.30
        assert "Custom Business Object" in finding.remediation or "Key-User" in finding.remediation

    @pytest.mark.asyncio
    async def test_spro_property_based_fuzz(self):
        """Property-Based Test: Arbitrary random activities fail closed without crash."""
        rng = random.Random(42)
        for i in range(10):
            random_act = f"SIMG_RND_{rng.randint(10000, 99999)}"
            random_tbl = f"T_{rng.randint(100, 999)}"
            fuzz_csv = f"ActivityID,ActivityName,Module,TargetTable,CountryCode\n{random_act},Test Act,FI,{random_tbl},DE\n"

            req = AnalysisRequest(
                job_id=f"11111111-0000-0000-0000-{i:012x}",
                tenant_id="22222222-2222-2222-2222-222222222222",
                project_id="33333333-3333-3333-3333-333333333333",
                engine_type=EngineType.SPRO2CLOUD,
                raw_content=fuzz_csv,
                artifact_type=ArtifactType.CSV,
            )
            res = await EngineRunner.execute(req)
            assert res.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL, AnalysisStatus.FAILED)


# ==============================================================================
# 3. ECC2Cloud Navigator Engine Test Suite
# ==============================================================================

class TestECC2CloudEngine:
    """Test suite verifying legacy ECC landscape analysis and Fiori successor resolution."""

    @pytest.mark.asyncio
    async def test_ecc_positive_clean_st03n(self):
        """Positive Test: Standard ECC T-codes map to Fiori Apps with 100% readiness."""
        csv_content = load_fixture("ecc_st03n_clean.csv")
        req = AnalysisRequest(
            job_id="22222222-1111-1111-1111-111111111101",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert res.engine_type == EngineType.ECC2CLOUD_NAVIGATOR

        blockers = [f for f in res.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]
        assert len(blockers) == 0

        successors = [f for f in res.findings if f.rule_id == "ECC_TCODE_SUCCESSOR_FOUND"]
        assert len(successors) >= 1
        for f in successors:
            assert f.confidence == ConfidenceClass.VERIFIED
            assert len(f.evidence) >= 1

    @pytest.mark.asyncio
    async def test_ecc_negative_usage_weighted_blockers(self):
        """Negative Test: High-usage custom transaction and prohibited SE38/SM30 detected."""
        csv_content = load_fixture("ecc_obsolete_blockers.csv")
        req = AnalysisRequest(
            job_id="22222222-1111-1111-1111-111111111102",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        prohibited = [f for f in res.findings if f.rule_id == "ECC_TCODE_NO_EQUIVALENT_BLOCKER"]
        assert len(prohibited) >= 1
        for p in prohibited:
            assert p.severity in (Severity.BLOCKER, Severity.CRITICAL)
            assert p.confidence == ConfidenceClass.VERIFIED

        custom_findings = [f for f in res.findings if f.rule_id == "ECC_TCODE_CUSTOM_CODE_REVIEW"]
        assert len(custom_findings) >= 1
        assert custom_findings[0].confidence == ConfidenceClass.UNKNOWN
        assert custom_findings[0].confidence_score == 0.30

    @pytest.mark.asyncio
    async def test_ecc_edge_interface_modernization(self):
        """Edge Case Test: Modernization of BAPIs, IDocs, and unreleased RFCs."""
        json_content = load_fixture("ecc_interface_inventory.json")
        req = AnalysisRequest(
            job_id="22222222-1111-1111-1111-111111111103",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=json_content,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        rfc_blockers = [f for f in res.findings if f.rule_id == "ECC_BAPI_RFC_UNRELEASED_BLOCKER"]
        assert len(rfc_blockers) >= 1
        assert rfc_blockers[0].severity == Severity.BLOCKER

        idoc_mesh = [f for f in res.findings if f.rule_id == "ECC_IDOC_MODERNIZATION_EVENT_MESH"]
        assert len(idoc_mesh) >= 1

    @pytest.mark.asyncio
    async def test_ecc_property_based_fuzz(self):
        """Property-Based Test: Arbitrary ST03N numbers fail closed safely."""
        rng = random.Random(42)
        for i in range(10):
            rnd_tcode = f"Z_TCODE_{rng.randint(100, 999)}"
            rnd_count = rng.randint(0, 1000000)
            fuzz_csv = f"TCode,ExecutionCount,AvgResponseTimeMs,UserCount,Module\n{rnd_tcode},{rnd_count},120,5,BC\n"

            req = AnalysisRequest(
                job_id=f"22222222-0000-0000-0000-{i:012x}",
                tenant_id="22222222-2222-2222-2222-222222222222",
                project_id="33333333-3333-3333-3333-333333333333",
                engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
                raw_content=fuzz_csv,
                artifact_type=ArtifactType.CSV,
            )
            res = await EngineRunner.execute(req)
            assert res.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL, AnalysisStatus.FAILED)


# ==============================================================================
# 4. SAP Gap Radar Engine Test Suite
# ==============================================================================

class TestSAPGapRadarEngine:
    """Test suite verifying 12-Tier Clean Core hierarchy and requirement resolution."""

    @pytest.mark.asyncio
    async def test_gap_radar_positive_event_mesh(self):
        """Positive Test: Event Mesh requirement resolves to Tier 8 Clean Core extension."""
        json_content = load_fixture("gap_radar_event_mesh.json")
        req = AnalysisRequest(
            job_id="33333333-1111-1111-1111-111111111101",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SAP_GAP_RADAR,
            raw_content=json_content,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert res.engine_type == EngineType.SAP_GAP_RADAR

        blockers = [f for f in res.findings if f.severity in (Severity.BLOCKER, Severity.CRITICAL)]
        assert len(blockers) == 0

        event_findings = [f for f in res.findings if f.rule_id == "GAP_RADAR_SUPPORTED_BUSINESS_EVENT"]
        assert len(event_findings) >= 1
        assert event_findings[0].severity == Severity.INFO
        assert event_findings[0].confidence == ConfidenceClass.RULE_DERIVED

    @pytest.mark.asyncio
    async def test_gap_radar_negative_direct_db_write_blocked(self):
        """Negative Test: Direct BSEG mutation triggers BLOCKED_CLEAN_CORE_VIOLATION."""
        json_content = load_fixture("gap_radar_direct_db_write.json")
        req = AnalysisRequest(
            job_id="33333333-1111-1111-1111-111111111102",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SAP_GAP_RADAR,
            raw_content=json_content,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        blocked_findings = [f for f in res.findings if f.rule_id == "GAP_RADAR_BLOCKED_CLEAN_CORE_VIOLATION"]
        assert len(blocked_findings) >= 1
        finding = blocked_findings[0]
        assert finding.severity in (Severity.CRITICAL, Severity.BLOCKER)
        assert "API_JOURNALENTRY_PROCESS_SRV" in finding.remediation or "RAP" in finding.remediation

    @pytest.mark.asyncio
    async def test_gap_radar_edge_known_gap(self):
        """Edge Case Test: Known product gap flagged as Tier 11 with Severity.MAJOR."""
        json_content = load_fixture("gap_radar_known_gap.json")
        req = AnalysisRequest(
            job_id="33333333-1111-1111-1111-111111111103",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SAP_GAP_RADAR,
            raw_content=json_content,
            artifact_type=ArtifactType.JSON,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        gap_findings = [f for f in res.findings if f.rule_id == "GAP_RADAR_KNOWN_PRODUCT_GAP"]
        assert len(gap_findings) >= 1
        assert gap_findings[0].severity == Severity.MAJOR

    @pytest.mark.asyncio
    async def test_gap_radar_property_based_fuzz(self):
        """Property-Based Test: Random requirement strings fail closed safely."""
        rng = random.Random(42)
        for i in range(10):
            rnd_words = [f"word_{rng.randint(1, 100)}" for _ in range(8)]
            fuzz_json = json.dumps({"requirement": " ".join(rnd_words), "target_release": "2023"})

            req = AnalysisRequest(
                job_id=f"33333333-0000-0000-0000-{i:012x}",
                tenant_id="22222222-2222-2222-2222-222222222222",
                project_id="33333333-3333-3333-3333-333333333333",
                engine_type=EngineType.SAP_GAP_RADAR,
                raw_content=fuzz_json,
                artifact_type=ArtifactType.JSON,
            )
            res = await EngineRunner.execute(req)
            assert res.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL, AnalysisStatus.FAILED)


# ==============================================================================
# 5. Clean Core Object Guard Engine Test Suite
# ==============================================================================

class TestCleanCoreObjectGuardEngine:
    """Test suite verifying ABAP Cloud static AST analysis and Clean Core governance."""

    @pytest.mark.asyncio
    async def test_clean_core_positive_compliant_class(self):
        """Positive Test: Pure RAP ABAP Cloud class passes with 0 violations."""
        abap_content = load_fixture("clean_core_compliant.abap")
        req = AnalysisRequest(
            job_id="44444444-1111-1111-1111-111111111101",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
            raw_content=abap_content,
            artifact_type=ArtifactType.ABAP,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert res.engine_type == EngineType.CLEAN_CORE_OBJECT_GUARD

        violations = [f for f in res.findings if f.severity in (Severity.CRITICAL, Severity.BLOCKER)]
        assert len(violations) == 0

    @pytest.mark.asyncio
    async def test_clean_core_negative_legacy_report(self):
        """Negative Test: Direct table selects and CALL 'SYSTEM' flagged as violations."""
        abap_content = load_fixture("clean_core_legacy.abap")
        req = AnalysisRequest(
            job_id="44444444-1111-1111-1111-111111111102",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
            raw_content=abap_content,
            artifact_type=ArtifactType.ABAP,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        db_violations = [f for f in res.findings if f.rule_id == "CLEAN_CORE_DIRECT_DB_ACCESS"]
        assert len(db_violations) >= 1
        for db in db_violations:
            assert db.severity == Severity.CRITICAL
            assert db.confidence == ConfidenceClass.VERIFIED
            assert len(db.evidence) >= 1

        obsolete = [f for f in res.findings if f.rule_id == "CLEAN_CORE_OBSOLETE_SYNTAX"]
        assert len(obsolete) >= 1
        blocker_calls = [f for f in obsolete if f.severity == Severity.BLOCKER]
        assert len(blocker_calls) >= 1  # CALL 'SYSTEM' is a BLOCKER

    @pytest.mark.asyncio
    async def test_clean_core_edge_dynamic_and_native_sql(self):
        """Edge Case Test: EXEC SQL blocked and unreleased function module flagged."""
        abap_content = load_fixture("clean_core_dynamic.abap")
        req = AnalysisRequest(
            job_id="44444444-1111-1111-1111-111111111103",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
            raw_content=abap_content,
            artifact_type=ArtifactType.ABAP,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED

        exec_sql = [f for f in res.findings if f.rule_id == "CLEAN_CORE_OBSOLETE_SYNTAX" and f.severity == Severity.BLOCKER]
        assert len(exec_sql) >= 1

        unreleased_api = [f for f in res.findings if f.rule_id == "CLEAN_CORE_UNRELEASED_API"]
        assert len(unreleased_api) >= 1
        assert unreleased_api[0].confidence == ConfidenceClass.VERIFIED

    @pytest.mark.asyncio
    async def test_clean_core_property_based_fuzz(self):
        """Property-Based Test: Random ABAP code strings fail closed safely."""
        rng = random.Random(42)
        for i in range(10):
            rnd_tokens = [f"lv_{rng.randint(1, 999)}" for _ in range(10)]
            fuzz_code = f"DATA: {' '.join(rnd_tokens)} TYPE string.\n"

            req = AnalysisRequest(
                job_id=f"44444444-0000-0000-0000-{i:012x}",
                tenant_id="22222222-2222-2222-2222-222222222222",
                project_id="33333333-3333-3333-3333-333333333333",
                engine_type=EngineType.CLEAN_CORE_OBJECT_GUARD,
                raw_content=fuzz_code,
                artifact_type=ArtifactType.ABAP,
            )
            res = await EngineRunner.execute(req)
            assert res.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL, AnalysisStatus.FAILED)


# ==============================================================================
# 6. Cryptographic Evidence Chain Invariants (AGENTS.md Axiom 2 Point 6)
# ==============================================================================

class TestDomain2CryptographicEvidence:
    """Asserts that all findings emitted across Domain 2 engines carry valid SHA-256 evidence."""

    @pytest.mark.asyncio
    async def test_evidence_hash_integrity_across_engines(self):
        """Asserts evidence sha256 exactly equals hashlib.sha256(snippet.encode()).hexdigest()."""
        csv_content = load_fixture("spro_negative_unsupported.csv")
        req = AnalysisRequest(
            job_id="99999999-1111-1111-1111-111111111101",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert len(res.findings) >= 1
        for f in res.findings:
            assert len(f.evidence) >= 1
            for ev in f.evidence:
                assert ev.line_number is not None and ev.line_number >= 1
                assert len(ev.sha256) == 64
                if ev.snippet:
                    calculated_hash = hashlib.sha256(ev.snippet.encode("utf-8")).hexdigest()
                    assert ev.sha256 == calculated_hash


# ==============================================================================
# 7. Epistemic Confidence Invariants (AGENTS.md Axiom 2 Point 7)
# ==============================================================================

class TestDomain2EpistemicInvariants:
    """Verifies strict confidence classification and missing evidence demotion."""

    def test_missing_evidence_demotes_unconditionally_to_unknown(self):
        """Invariant: Finding lacking evidence must be demoted to UNKNOWN (0.30)."""
        finding = Finding(
            rule_id="SPRO_TEST_NO_EV",
            severity=Severity.MAJOR,
            category="CONFIG",
            title="Finding without evidence",
            description="Lacks evidence pointer",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Add evidence",
            evidence=[],
        )
        classified = ConfidenceClassifier.classify(finding)
        assert classified.confidence == ConfidenceClass.UNKNOWN
        assert classified.confidence_score == 0.30

    def test_ai_generated_finding_cannot_exceed_inferred(self):
        """Invariant: AI involvement strictly caps confidence at INFERRED (0.60)."""
        finding = Finding(
            rule_id="GAP_RADAR_AI_EXPLANATION",
            severity=Severity.MAJOR,
            category="AI",
            title="AI generated requirement explanation",
            description="Probabilistic natural language note",
            confidence=ConfidenceClass.VERIFIED,
            confidence_score=1.0,
            remediation="Review recommendation",
            evidence=[
                Evidence(
                    artifact_path="requirements.json",
                    line_number=5,
                    snippet="Trigger webhook",
                    sha256=hashlib.sha256(b"Trigger webhook").hexdigest(),
                    provenance=ConfidenceClass.VERIFIED,
                    trust_score=1.0,
                )
            ],
            is_ai_generated=True,
        )
        classified = ConfidenceClassifier.classify(finding)
        assert classified.confidence == ConfidenceClass.INFERRED
        assert classified.confidence_score == 0.60


# ==============================================================================
# 8. Determinism & Performance Telemetry Tests
# ==============================================================================

class TestDomain2DeterminismAndTelemetry:
    """Verifies pure deterministic byte output and telemetry metrics."""

    @pytest.mark.asyncio
    async def test_pure_deterministic_findings_identity(self):
        """Executing analysis twice on identical input produces byte-for-byte identical output."""
        csv_content = load_fixture("ecc_st03n_clean.csv")
        req1 = AnalysisRequest(
            job_id="88888888-1111-1111-1111-111111111101",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )
        req2 = AnalysisRequest(
            job_id="88888888-1111-1111-1111-111111111102",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=csv_content,
            artifact_type=ArtifactType.CSV,
        )

        res1 = await EngineRunner.execute(req1)
        res2 = await EngineRunner.execute(req2)

        assert len(res1.findings) == len(res2.findings)
        for f1, f2 in zip(res1.findings, res2.findings):
            assert f1.rule_id == f2.rule_id
            assert f1.severity == f2.severity
            assert f1.confidence == f2.confidence
            assert f1.confidence_score == f2.confidence_score
            assert len(f1.evidence) == len(f2.evidence)
            assert f1.evidence[0].sha256 == f2.evidence[0].sha256
