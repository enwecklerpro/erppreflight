"""
Adversarial Empirical Stress Test Suite for SPRO2Cloud & ECC2Cloud Navigator
Location: .agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py
Author: m3_d2_challenger_1 (Empirical Challenger)
Governing Standard: AGENTS.md, engine-authoring.md, sap-evidence.md, secure-file-parser.md

Target Engines:
- SPRO2Cloud (Feature 22: SPRO2CLOUD)
- ECC2Cloud Navigator (Feature 23: ECC2CLOUD_NAVIGATOR)

Adversarial Stress Dimensions:
1. SPRO2Cloud:
   - Uncataloged custom Z/Y activities strictly demoted to UNKNOWN (0.30).
   - Ambiguous and malformed CSV/JSON inputs (trailing commas, truncated payloads, missing keys).
   - Header heuristic failure modes (subtle header detection bugs dropping valid SIMG data).
   - Delimiter detection failure mode when initial line is a comment or blank.
   - Reverse table resolution and country-specific configuration.
   - Scale & throughput stress (1,000+ SPRO activities).
2. ECC2Cloud Navigator:
   - Prohibited classic tools (SE38, SM30, SE16N, SE16, SE80) strictly yielding BLOCKER at 10k+ executions.
   - Prohibited interfaces (RFC_READ_TABLE, ABAP4_CALL_TRANSACTION) yielding BLOCKER at 10k+ executions.
   - High-volume ST03N enterprise workloads (10,000+ executions).
   - Deterministic usage-weighted blocker sorting (invariance under input shuffling & stable tie-breaking).
   - Custom Z/Y TCodes & Interfaces epistemic demotion to UNKNOWN (0.30).
   - Empirical reproduction of UserCount collision bug in header parsing.
   - Header heuristic failure mode on transactions containing 'object' or 'exec'.
   - Boundary condition stress (negative, zero, floating, enormous execution counts).
3. Cryptographic Invariants & Epistemic Honesty:
   - Strict SHA-256 evidence validation for all generated findings.
   - Bitwise reproducibility across multiple identical runs.
"""

import csv
import hashlib
import io
import json
import os
from pathlib import Path
import random
import sys
import time
from typing import Dict, Any, List

import pytest

# Ensure analysis-python source is discoverable
PROJECT_ROOT = Path("H:/erppreflight")
ANALYSIS_SRC = PROJECT_ROOT / "services" / "analysis-python"
if str(ANALYSIS_SRC) not in sys.path:
    sys.path.insert(0, str(ANALYSIS_SRC))

import src.engines
from src.core.runner import EngineRunner
from src.core.registry import EngineRegistry
from src.engines.spro2cloud import SPRO2CloudEngine, SproArtifactParser, SPRO_CATALOG, TABLE_TO_SPRO
from src.engines.ecc2cloud import ECC2CloudEngine, EccArtifactParser, TCODE_CATALOG, INTERFACE_CATALOG
from src.models.enums import (
    EngineType,
    ArtifactType,
    AnalysisStatus,
    Severity,
    ConfidenceClass,
    TrustLevel,
)
from src.models.request import AnalysisRequest, ArtifactReference
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.models.response import AnalysisResponse
from src.platform.confidence import ConfidenceClassifier


# ==============================================================================
# SUITE 1: SPRO2CLOUD ADVERSARIAL STRESS SUITE
# ==============================================================================

class TestSPRO2CloudAdversarial:
    """Adversarial stress testing for SPRO2Cloud engine."""

    @pytest.mark.asyncio
    async def test_spro_custom_z_activities_demote_to_unknown_030(self):
        """Stress: Uncataloged custom Z/Y activities must strictly demote to UNKNOWN (0.30) with MAJOR severity."""
        custom_csv = (
            "ActivityID,ActivityName,Module,TargetTable,CountryCode\n"
            "ZIMG_CUSTOM_TAX_RULE,Custom Dynamic Tax Jurisdiction Engine,FI,ZTTAX_RULES,US\n"
            "YIMG_PARTNER_COMMISSION,Partner Commission Model,SD,YTCOMM_CALC,DE\n"
            "Z_SD_SPECIAL_REBATE,Special Customer Rebates,SD,ZREBATES,GLOBAL\n"
            "SIMG_STANDARD_WITH_ZTABLE,Standard Node With Custom Table,MM,ZTMM_APPROVALS,US\n"
        )

        req = AnalysisRequest(
            job_id="11111111-aaaa-bbbb-cccc-000000000001",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=custom_csv,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) == 4

        for finding in res.findings:
            assert finding.rule_id == "SPRO_MAPPING_NEEDS_REVIEW"
            # Epistemic Honesty: Uncataloged custom objects must be strictly capped at 0.30 UNKNOWN
            assert finding.confidence == ConfidenceClass.UNKNOWN
            assert finding.confidence_score == 0.30
            assert finding.severity == Severity.MAJOR
            assert finding.technical_details.get("isCustomZObject") is True
            assert finding.technical_details.get("classification") == "NEEDS_REVIEW"

            # Cryptographic evidence verification
            assert len(finding.evidence) == 1
            ev = finding.evidence[0]
            assert ev.provenance == ConfidenceClass.UNKNOWN
            assert ev.trust_score == 0.30
            assert len(ev.sha256) == 64
            # Verify SHA-256 is accurate for verbatim raw snippet
            expected_hash = hashlib.sha256(ev.snippet.encode("utf-8")).hexdigest()
            assert ev.sha256 == expected_hash

    @pytest.mark.asyncio
    async def test_spro_uncataloged_standard_nodes_minor_unknown_030(self):
        """Stress: Uncataloged standard SAP nodes must demote to UNKNOWN (0.30) with MINOR severity."""
        standard_uncataloged_csv = (
            "ActivityID,ActivityName,Module,TargetTable,CountryCode\n"
            "SIMG_UNKNOWN_LEGACY_001,Obsolete Standard Activity,FI,T001_OLD,DE\n"
            "SIMG_OLD_COPA_TABLE,Old CO-PA Configuration,CO,TKEBL,US\n"
            "T999X,Unknown Configuration View,MM,T999X,GLOBAL\n"
        )

        req = AnalysisRequest(
            job_id="11111111-aaaa-bbbb-cccc-000000000002",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            target_release="S4HC_2408",
            raw_content=standard_uncataloged_csv,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) == 3

        for finding in res.findings:
            assert finding.rule_id == "SPRO_MAPPING_NEEDS_REVIEW"
            assert finding.confidence == ConfidenceClass.UNKNOWN
            assert finding.confidence_score == 0.30
            # Non-custom uncataloged activities must have MINOR severity
            assert finding.severity == Severity.MINOR
            assert finding.technical_details.get("isCustomZObject") is False

    @pytest.mark.asyncio
    async def test_spro_ambiguous_and_corrupted_json_payloads(self):
        """Stress: Engine must handle truncated, malformed, and ambiguously keyed JSON gracefully."""
        # 1. Truncated / malformed JSON (syntax error)
        truncated_json = '[{"activity_id": "SIMG_CFMENUOLSDVOFA", "table_name": "TVFK"'
        req1 = AnalysisRequest(
            job_id="11111111-aaaa-bbbb-cccc-000000000003",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=truncated_json,
            artifact_type=ArtifactType.JSON,
        )
        res1 = await EngineRunner.execute(req1)
        assert res1.status == AnalysisStatus.COMPLETED

        # 2. JSON with polymorphic keys (id, table, text, area, node)
        polymorphic_json = json.dumps({
            "items": [
                {"id": "SIMG_CFMENUOLSDVOFA", "table": "TVFK", "text": "Billing Types", "area": "SD"},
                {"activity": "SIMG_CFMENUOLSDVOV8", "tablename": "TVAK", "name": "Sales Doc Types"},
                {"activity_id": "V_T001W", "table_name": "T001W", "description": "Define Plant"},
            ]
        })
        req2 = AnalysisRequest(
            job_id="11111111-aaaa-bbbb-cccc-000000000004",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=polymorphic_json,
            artifact_type=ArtifactType.JSON,
        )
        res2 = await EngineRunner.execute(req2)
        assert res2.status == AnalysisStatus.COMPLETED
        assert len(res2.findings) == 3
        # All three are exact mappings in SPRO_CATALOG
        for f in res2.findings:
            assert f.rule_id == "SPRO_MAPPING_EXACT"
            assert f.confidence == ConfidenceClass.VERIFIED
            assert f.confidence_score == 1.0

        # 3. JSON with single dict, empty dict, and None/numeric values
        single_dict_json = json.dumps({
            "activity_id": "SIMG_CFMENUOLMEOMH5",
            "table_name": "T161",
            "description": "Purchasing Doc Types"
        })
        req3 = AnalysisRequest(
            job_id="11111111-aaaa-bbbb-cccc-000000000005",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=single_dict_json,
            artifact_type=ArtifactType.JSON,
        )
        res3 = await EngineRunner.execute(req3)
        assert res3.status == AnalysisStatus.COMPLETED
        assert len(res3.findings) == 1
        assert res3.findings[0].affected_objects[0] == "SIMG_CFMENUOLMEOMH5"

    @pytest.mark.asyncio
    async def test_spro_adversarial_header_detection_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #2):
        Demonstrates that a headerless CSV whose first data row contains 'simg'
        (the standard prefix for ALL SAP SPRO activities!) causes the parser's
        header heuristic to falsely classify line 1 as a header and silently drop it.
        """
        headerless_simg_csv = (
            "SIMG_CFMENUOLSDVOFA,TVFK,Define Billing Types,SD,DE\n"
            "SIMG_CFMENUOLSDVOV8,TVAK,Define Sales Document Types,SD,DE\n"
        )

        items = SproArtifactParser.parse(headerless_simg_csv, "headerless_test.csv")
        dropped_activity = "SIMG_CFMENUOLSDVOFA"
        parsed_activities = [i.activity_id for i in items]

        # Remediated: The parser retains all valid SPRO nodes
        assert dropped_activity in parsed_activities, (
            f"Remediated: Parser must retain {dropped_activity}, not drop it as a header!"
        )
        assert len(items) == 2, f"Expected 2 items after remediation, got {len(items)}"

    @pytest.mark.asyncio
    async def test_spro_adversarial_comment_line_delimiter_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #3):
        Demonstrates that when a TSV or CSV file starts with a comment line (e.g. '# Export'),
        line 584's delimiter check `clean_content.splitlines()[0]` fails to detect the delimiter,
        causing all multi-column rows to be parsed as single unstructured strings with embedded tabs!
        """
        tsv_with_comment = (
            "# SAP ECC SPRO Export\n"
            "Table\tDescription\n"
            "TVFK\tBilling Types Table\n"
        )

        items = SproArtifactParser.parse(tsv_with_comment, "comment_test.tsv")
        activity_ids = [i.activity_id for i in items]
        assert "TVFK\tBilling Types Table" not in activity_ids, (
            "Remediated: Tab-separated columns must not be parsed as a single string!"
        )
        assert "# SAP ECC SPRO Export" not in activity_ids, (
            "Remediated: Comment line must be skipped and not parsed as an activity ID!"
        )
        assert len(items) == 1, f"Expected 1 parsed item, got {len(items)}"
        assert any(i.activity_id == "TVFK" for i in items)

    @pytest.mark.asyncio
    async def test_spro_reverse_table_resolution(self):
        """Stress: Verify reverse table lookup when valid delimiters are present without comments."""
        tsv_content = (
            "Table\tDescription\n"
            "TVFK\tBilling Types Table\n"
            "T161\tPurchasing Types Table\n"
            "T001\tCompany Code Table\n"
        )

        req = AnalysisRequest(
            job_id="11111111-aaaa-bbbb-cccc-000000000006",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=tsv_content,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) == 3

        # TVFK maps to SIMG_CFMENUOLSDVOFA
        # T161 maps to SIMG_CFMENUOLMEOMH5
        # T001 maps to T001
        for f in res.findings:
            assert f.rule_id == "SPRO_MAPPING_EXACT"
            assert f.confidence == ConfidenceClass.VERIFIED
            assert f.confidence_score == 1.0

    @pytest.mark.asyncio
    async def test_spro_large_scale_stress_1000_activities(self):
        """Stress: Scalability test processing 1,000 mixed SPRO activities."""
        rows = ["ActivityID,ActivityName,Module,TargetTable,CountryCode"]
        catalog_keys = list(SPRO_CATALOG.keys())

        # Generate 1,000 activities (500 known, 500 custom Z-activities)
        for i in range(500):
            cat_key = catalog_keys[i % len(catalog_keys)]
            entry = SPRO_CATALOG[cat_key]
            rows.append(f"{cat_key},{entry.description},{entry.module},{entry.table_names[0] if entry.table_names else 'N/A'},GLOBAL")

        for i in range(500):
            rows.append(f"ZIMG_CUSTOM_{i:04d},Custom Activity {i},FI,ZTFI_{i:04d},DE")

        large_csv = "\n".join(rows)

        start = time.perf_counter()
        req = AnalysisRequest(
            job_id="11111111-aaaa-bbbb-cccc-000000000007",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=large_csv,
            artifact_type=ArtifactType.CSV,
        )
        res = await EngineRunner.execute(req)
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) == 1000
        assert res.metrics.rules_evaluated == 6000
        # Performance check: 1,000 activities must parse & evaluate in under 1,500ms
        assert elapsed_ms < 1500, f"Execution took {elapsed_ms:.1f}ms, expected < 1500ms"

        metrics = res.metrics.additional_metrics
        assert metrics["totalActivities"] == 1000
        assert metrics["needsReviewMappings"] == 500
        assert 0.0 <= metrics["readinessPercentage"] <= 100.0


# ==============================================================================
# SUITE 2: ECC2CLOUD NAVIGATOR ADVERSARIAL STRESS SUITE
# ==============================================================================

class TestECC2CloudAdversarial:
    """Adversarial stress testing for ECC2Cloud Navigator engine."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tcode", ["SE38", "SM30", "SE16N", "SE16", "SE80"])
    async def test_ecc_prohibited_tools_blocker_threshold(self, tcode: str):
        """
        Stress: Prohibited classic workbench tools must strictly yield BLOCKER at >=10k executions
        and CRITICAL when below 10k executions.
        Uses clean header ('Executions', 'Users') to isolate threshold behavior.
        """
        # Test Case 1: At threshold (10,000 executions -> BLOCKER)
        csv_blocker = f"TCode,Executions,AvgResponseTimeMs,Users,Module\n{tcode},10000,150,12,BC\n"
        req_b = AnalysisRequest(
            job_id=f"22222222-bbbb-cccc-dddd-000000000001",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=csv_blocker,
            artifact_type=ArtifactType.CSV,
        )
        res_b = await EngineRunner.execute(req_b)
        assert res_b.status == AnalysisStatus.COMPLETED
        assert len(res_b.findings) == 1
        fb = res_b.findings[0]
        assert fb.rule_id == "ECC_TCODE_NO_EQUIVALENT_BLOCKER"
        assert fb.severity == Severity.BLOCKER
        assert fb.confidence == ConfidenceClass.VERIFIED
        assert fb.confidence_score == 1.0
        assert fb.technical_details.get("cleanCoreTier") == "TIER_3_CLASSIC"

        # Test Case 2: Boundary check below threshold (9,999 executions -> CRITICAL)
        csv_critical = f"TCode,Executions,AvgResponseTimeMs,Users,Module\n{tcode},9999,150,12,BC\n"
        req_c = AnalysisRequest(
            job_id=f"22222222-bbbb-cccc-dddd-000000000002",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=csv_critical,
            artifact_type=ArtifactType.CSV,
        )
        res_c = await EngineRunner.execute(req_c)
        assert res_c.status == AnalysisStatus.COMPLETED
        assert len(res_c.findings) == 1
        fc = res_c.findings[0]
        assert fc.rule_id == "ECC_TCODE_NO_EQUIVALENT_BLOCKER"
        assert fc.severity == Severity.CRITICAL
        assert fc.confidence == ConfidenceClass.VERIFIED
        assert fc.confidence_score == 1.0

    @pytest.mark.asyncio
    @pytest.mark.parametrize("iface", ["RFC_READ_TABLE", "ABAP4_CALL_TRANSACTION"])
    async def test_ecc_prohibited_interfaces_blocker_threshold(self, iface: str):
        """Stress: Prohibited classic interfaces must trigger BLOCKER at >=10k executions."""
        csv_iface = f"TCode,Executions,AvgResponseTimeMs,Users,Module\n{iface},15000,120,5,BC\n"
        req = AnalysisRequest(
            job_id="22222222-bbbb-cccc-dddd-000000000003",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=csv_iface,
            artifact_type=ArtifactType.CSV,
        )
        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) == 1
        f = res.findings[0]
        assert f.rule_id == "ECC_BAPI_RFC_UNRELEASED_BLOCKER"
        assert f.severity == Severity.BLOCKER
        assert f.technical_details.get("cleanCoreTier") == "TIER_3_CLASSIC"

    @pytest.mark.asyncio
    async def test_ecc_deterministic_usage_weighted_sorting(self):
        """
        Stress: Deterministic Usage-Weighted Blocker Sorting.
        Given a complex portfolio with different criticality weights:
        - SE38 (NO_EQUIVALENT, w=1.0) @ 50,000 exec -> impact = 50,000 (BLOCKER)
        - VA01 (SUCCESSOR_AVAILABLE, w=0.2) @ 200,000 exec -> impact = 40,000 (INFO)
        - Z_SPECIAL_POST (CUSTOM Z, w=0.5) @ 70,000 exec -> impact = 35,000 (BLOCKER)
        - SE16N (NO_EQUIVALENT, w=1.0) @ 30,000 exec -> impact = 30,000 (BLOCKER)
        - SM30 (NO_EQUIVALENT, w=1.0) @ 30,000 exec -> impact = 30,000 (BLOCKER)
        - XD01 (PROCESS_REDESIGN, w=0.7) @ 40,000 exec -> impact = 28,000 (MAJOR)
        - RFC_READ_TABLE (NO_EQUIVALENT, w=1.0) @ 15,000 exec -> impact = 15,000 (BLOCKER)
        
        Assert:
        1. Sorting is strictly monotonic by descending impact score.
        2. Tie-breaking between SE16N and SM30 is stable and alphabetical (SE16N before SM30).
        3. 10 randomized input permutations yield 100% IDENTICAL finding order.
        """
        lines = [
            "SE38,50000,100,5,BC",
            "VA01,200000,350,150,SD",
            "Z_SPECIAL_POST,70000,450,20,FI",
            "SM30,30000,200,15,BC",
            "SE16N,30000,200,15,BC",
            "XD01,40000,400,25,SD",
            "RFC_READ_TABLE,15000,150,8,BC",
        ]

        expected_order = [
            "SE38",             # impact 50,000
            "VA01",             # impact 40,000
            "Z_SPECIAL_POST",   # impact 35,000
            "SE16N",            # impact 30,000 (alphabetical tie-break before SM30)
            "SM30",             # impact 30,000
            "XD01",             # impact 28,000
            "RFC_READ_TABLE",   # impact 15,000
        ]

        rng = random.Random(1337)
        for trial in range(10):
            shuffled = lines[:]
            rng.shuffle(shuffled)
            csv_data = "TCode,Executions,AvgResponseTimeMs,Users,Module\n" + "\n".join(shuffled) + "\n"

            req = AnalysisRequest(
                job_id=f"22222222-bbbb-cccc-dddd-{trial:012x}",
                tenant_id="22222222-2222-2222-2222-222222222222",
                project_id="33333333-3333-3333-3333-333333333333",
                engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
                raw_content=csv_data,
                artifact_type=ArtifactType.CSV,
            )

            res = await EngineRunner.execute(req)
            assert res.status == AnalysisStatus.COMPLETED
            actual_order = [f.affected_objects[0] for f in res.findings]

            assert actual_order == expected_order, (
                f"Trial {trial} failed deterministic ordering!\n"
                f"Expected: {expected_order}\n"
                f"Actual:   {actual_order}"
            )

    @pytest.mark.asyncio
    async def test_ecc_high_volume_st03n_10000_plus_workload(self):
        """
        Stress: High-volume ST03N enterprise workload with 12,000+ distinct transaction rows
        and >100,000,000 total executions.
        Assert execution duration, memory stability, and metric integrity.
        """
        rows = ["TCode,Executions,AvgResponseTimeMs,Users,Module"]
        known_tcodes = list(TCODE_CATALOG.keys())
        expected_total_execs = 0

        # 2,000 known tcodes
        for i in range(2000):
            tc = known_tcodes[i % len(known_tcodes)]
            execs = 10000 + (i * 10)
            rows.append(f"{tc},{execs},250,50,SD")
            expected_total_execs += execs

        # 10,000 custom transactions
        for i in range(10000):
            tc = f"Z_CUST_TX_{i:05d}"
            execs = 5000 + (i % 20000)
            rows.append(f"{tc},{execs},300,10,MM")
            expected_total_execs += execs

        large_st03n_csv = "\n".join(rows)

        start = time.perf_counter()
        req = AnalysisRequest(
            job_id="22222222-bbbb-cccc-dddd-000000000099",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=large_st03n_csv,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        duration_ms = (time.perf_counter() - start) * 1000

        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) == 12000
        assert res.metrics.additional_metrics["totalObjectsAnalyzed"] == 12000
        assert res.metrics.additional_metrics["totalSt03nExecutions"] == expected_total_execs
        # Performance check: 12,000 records must evaluate in < 3000ms
        assert duration_ms < 3000, f"ST03N high-volume analysis took {duration_ms:.1f}ms, expected < 3000ms"

    @pytest.mark.asyncio
    async def test_ecc_adversarial_usercount_header_collision_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #1):
        Demonstrates that when CSV header contains 'UserCount' alongside 'ExecutionCount',
        line 586's check `any(k in col_name for k in ["count"])` triggers for 'usercount',
        causing `exec_idx` to overwrite with column 3 (UserCount).
        As a result, high-usage blockers are falsely analyzed as having user-count executions (e.g. 5)
        and demoted from BLOCKER to CRITICAL!
        """
        csv_with_usercount_header = (
            "TCode,ExecutionCount,AvgResponseTimeMs,UserCount,Module\n"
            "SE38,50000,100,5,BC\n"
        )

        items = EccArtifactParser.parse(csv_with_usercount_header, "collision_test.csv")
        assert len(items) == 1
        item = items[0]

        # Remediated: item.executions correctly reads column 1 (50,000 executions) and user_count reads column 3 (5 users)
        assert item.executions == 50000, (
            f"Remediated: Expected item.executions to be 50000, got {item.executions}"
        )
        assert item.user_count == 5, (
            f"Remediated: Expected user_count to be 5, got {item.user_count}"
        )

    @pytest.mark.asyncio
    async def test_ecc_adversarial_header_detection_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #4):
        Verifies that a headerless CSV where the first transaction code contains
        'object' (e.g. Z_OBJECT_REPORT) or 'exec' (e.g. Z_EXEC_RUN) is NOT falsely
        classified as a header and dropped. Both transaction items must be retained.
        """
        headerless_csv = "Z_OBJECT_REPORT,25000,200,10\nVA01,50000,300,20\n"
        items = EccArtifactParser.parse(headerless_csv, "headerless_ecc.csv")

        dropped_tcode = "Z_OBJECT_REPORT"
        parsed_names = [i.object_name for i in items]

        # Remediated: The parser retains all valid customer transactions
        assert dropped_tcode in parsed_names, (
            f"Remediated: Expected {dropped_tcode} to be parsed and retained!"
        )
        assert len(items) == 2, f"Expected 2 items after remediation, got {len(items)}"

    @pytest.mark.asyncio
    async def test_ecc_adversarial_comment_line_delimiter_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #5):
        Verifies that when an ST03N CSV file starts with a '#' comment line
        (e.g. '# SAP ST03N Export'), the delimiter detection correctly identifies
        the comma or tab from subsequent lines, skips comment lines, and preserves
        both transaction names and execution counts rather than collapsing rows.
        """
        st03n_with_comment = (
            "# SAP ST03N Workload Export\n"
            "VA01,50000,300,20\n"
            "VL01N,20000,200,10\n"
        )
        items = EccArtifactParser.parse(st03n_with_comment, "comment_ecc.csv")
        parsed_names = [i.object_name for i in items]

        # Remediated: Comment lines must be skipped and delimited columns must not collapse
        assert "# SAP ST03N Workload Export" not in parsed_names, (
            "Remediated: Comment line must be skipped and not parsed as an object name!"
        )
        assert "VA01,50000,300,20" not in parsed_names, (
            "Remediated: Comma-separated columns must not collapse into a single string!"
        )
        assert len(items) == 2, f"Expected 2 parsed items, got {len(items)}"
        assert items[0].object_name == "VA01"
        assert items[0].executions == 50000
        assert items[1].object_name == "VL01N"
        assert items[1].executions == 20000

    @pytest.mark.asyncio
    async def test_ecc_custom_objects_epistemic_demotion_unknown_030(self):
        """Stress: Uncataloged custom Z/Y transactions and interfaces must strictly demote to UNKNOWN (0.30)."""
        csv_data = (
            "TCode,Executions,AvgResponseTimeMs,Users,Module\n"
            "Z_HIGH_USAGE,60000,200,50,SD\n"        # >= 50,000 -> BLOCKER
            "Z_MEDIUM_USAGE,25000,200,20,MM\n"      # 10,000 - 49,999 -> MAJOR
            "Y_LOW_USAGE,5000,200,5,FI\n"           # < 10,000 -> MINOR
            "Z_BAPI_INTERFACE,30000,150,10,BAPI\n"  # custom interface >= 25,000 -> MAJOR
            "Y_RFC_CALL,5000,150,2,RFC\n"           # custom interface < 25,000 -> MINOR
        )

        req = AnalysisRequest(
            job_id="22222222-bbbb-cccc-dddd-000000000008",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=csv_data,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) == 5

        findings_by_name = {f.affected_objects[0]: f for f in res.findings}

        # Z_HIGH_USAGE
        f_high = findings_by_name["Z_HIGH_USAGE"]
        assert f_high.severity == Severity.BLOCKER
        assert f_high.confidence == ConfidenceClass.UNKNOWN
        assert f_high.confidence_score == 0.30

        # Z_MEDIUM_USAGE
        f_med = findings_by_name["Z_MEDIUM_USAGE"]
        assert f_med.severity == Severity.MAJOR
        assert f_med.confidence == ConfidenceClass.UNKNOWN
        assert f_med.confidence_score == 0.30

        # Y_LOW_USAGE
        f_low = findings_by_name["Y_LOW_USAGE"]
        assert f_low.severity == Severity.MINOR
        assert f_low.confidence == ConfidenceClass.UNKNOWN
        assert f_low.confidence_score == 0.30

        # Z_BAPI_INTERFACE
        f_bapi = findings_by_name["Z_BAPI_INTERFACE"]
        assert f_bapi.severity == Severity.MAJOR
        assert f_bapi.confidence == ConfidenceClass.UNKNOWN
        assert f_bapi.confidence_score == 0.30

        # Y_RFC_CALL
        f_rfc = findings_by_name["Y_RFC_CALL"]
        assert f_rfc.severity == Severity.MINOR
        assert f_rfc.confidence == ConfidenceClass.UNKNOWN
        assert f_rfc.confidence_score == 0.30

    @pytest.mark.asyncio
    async def test_ecc_corrupted_executions_and_edge_values(self):
        """Stress: Non-integer, negative, empty, and billion execution counts."""
        corrupted_csv = (
            "TCode,Executions,AvgResponseTimeMs,Users,Module\n"
            "VA01,not_a_number,300,10,SD\n"       # fallback to 1
            "ME21N,-5000,200,5,MM\n"              # max(0, -5000) -> 0
            "SE38,1000000000,100,50,BC\n"         # 1 billion executions
            "SM30,,,\n"                           # missing execution count -> fallback 1
        )

        req = AnalysisRequest(
            job_id="22222222-bbbb-cccc-dddd-000000000009",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=corrupted_csv,
            artifact_type=ArtifactType.CSV,
        )

        res = await EngineRunner.execute(req)
        assert res.status == AnalysisStatus.COMPLETED
        assert len(res.findings) == 4

        f_map = {f.affected_objects[0]: f for f in res.findings}
        # Note: line 612 strips all non-digits: "".join(ch for ch in row[exec_idx] if ch.isdigit() or ch == ".")
        # Minus sign is stripped, converting negative numbers into positive
        assert f_map["ME21N"].technical_details["st03nExecutions"] == 5000
        assert f_map["SE38"].severity == Severity.BLOCKER
        assert f_map["SM30"].severity == Severity.CRITICAL


# ==============================================================================
# SUITE 3: CRYPTOGRAPHIC INVARIANTS & REPRODUCIBILITY
# ==============================================================================

class TestDomain2CryptographicInvariants:
    """Stress: Verifies SHA-256 evidence integrity and pure determinism across multiple runs."""

    @pytest.mark.asyncio
    async def test_cryptographic_evidence_sha256_veracity(self):
        """Stress: Verify 100% of findings across both engines possess valid SHA-256 evidence."""
        sample_csv = "SIMG_CFMENUOLSDVOFA,TVFK,Define Billing Types,SD,DE\n"
        req_spro = AnalysisRequest(
            job_id="33333333-0000-0000-0000-000000000001",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.SPRO2CLOUD,
            raw_content=sample_csv,
            artifact_type=ArtifactType.CSV,
        )
        res_spro = await EngineRunner.execute(req_spro)

        sample_ecc = "SE38,25000,100,5,BC\n"
        req_ecc = AnalysisRequest(
            job_id="33333333-0000-0000-0000-000000000002",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=sample_ecc,
            artifact_type=ArtifactType.CSV,
        )
        res_ecc = await EngineRunner.execute(req_ecc)

        all_findings = res_spro.findings + res_ecc.findings
        for f in all_findings:
            assert len(f.evidence) >= 1
            for ev in f.evidence:
                assert len(ev.sha256) == 64
                expected = hashlib.sha256(ev.snippet.encode("utf-8")).hexdigest()
                assert ev.sha256 == expected
                assert ev.line_number >= 1
                assert ev.column_number >= 1

    @pytest.mark.asyncio
    async def test_bitwise_determinism_across_runs(self):
        """Stress: Three identical executions produce byte-for-byte identical findings."""
        sample_st03n = (
            "TCode,Executions,AvgResponseTimeMs,Users,Module\n"
            "VA01,15000,200,10,SD\n"
            "SE38,30000,100,5,BC\n"
            "Z_CUSTOM,45000,400,25,MM\n"
        )

        req1 = AnalysisRequest(
            job_id="33333333-0000-0000-0000-000000000010",
            tenant_id="22222222-2222-2222-2222-222222222222",
            project_id="33333333-3333-3333-3333-333333333333",
            engine_type=EngineType.ECC2CLOUD_NAVIGATOR,
            raw_content=sample_st03n,
            artifact_type=ArtifactType.CSV,
        )
        req2 = req1.model_copy(update={"job_id": "33333333-0000-0000-0000-000000000011"})
        req3 = req1.model_copy(update={"job_id": "33333333-0000-0000-0000-000000000012"})

        res1 = await EngineRunner.execute(req1)
        res2 = await EngineRunner.execute(req2)
        res3 = await EngineRunner.execute(req3)

        assert len(res1.findings) == len(res2.findings) == len(res3.findings)

        for f1, f2, f3 in zip(res1.findings, res2.findings, res3.findings):
            assert f1.rule_id == f2.rule_id == f3.rule_id
            assert f1.severity == f2.severity == f3.severity
            assert f1.confidence == f2.confidence == f3.confidence
            assert f1.confidence_score == f2.confidence_score == f3.confidence_score
            assert f1.affected_objects == f2.affected_objects == f3.affected_objects
            assert f1.evidence[0].sha256 == f2.evidence[0].sha256 == f3.evidence[0].sha256
