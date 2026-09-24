"""
Adversarial Empirical Stress Test Suite for Feature 29: Transport Dependency Analyzer.

Target Module: services/analysis-python/src/engines/transport_dependency.py
Author: m3_d4_challenger_2
Standard: AGENTS.md Cardinal Axiom 2, engine-authoring.md, sap-evidence.md

Test Dimensions:
1. High-Volume Transport Requests (500+ TRs, 5,000+ objects) & Memory Boundedness.
2. Complex Collision Topologies (Transitive multi-transport chains, customizing vs workbench table collisions).
3. Overtaking Risk with Conflicting Release Timestamps & Sequence Inversion.
4. Corrupt CSV/JSON Headers, Malformed E070/E071/E071K Lines, Invalid Inputs.
5. Deterministic Topological Ordering (Permutation stability & Cycle resolution).
6. Cryptographic SHA-256 Evidence Integrity & Epistemic Confidence Compliance.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import json
import random
import re
import sys
import time
import tracemalloc
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

# Ensure services/analysis-python is on sys.path
for p in Path(__file__).resolve().parents:
    cand = p / "services" / "analysis-python"
    if cand.is_dir() and str(cand) not in sys.path:
        sys.path.insert(0, str(cand))
        break

from src.engines.transport_dependency import (
    TransportDependencyEngine,
    CTSNormalizedData,
    E070Record,
    E071Record,
    E071KRecord,
    CallReference,
    _format_timestamp,
    _locate_line_in_text,
    _normalize_obj_string,
)
from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
    TrustLevel,
)
from src.models.request import AnalysisRequest, ArtifactReference
from src.models.response import AnalysisResponse


DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_PROJECT_ID = "00000000-0000-0000-0000-000000000002"

class TestHighVolumeScaleAndMemory:
    """Stress tests verifying execution time, algorithmic complexity, and memory boundedness under 500+ TRs."""

    def test_scale_600_transports_6000_objects_performance(self):
        """Stress test with 600 TRs and 6,000 objects, verifying execution completes < 3.0s and memory < 50MB."""
        tr_objs: Dict[str, List[str]] = {}
        # 600 transports, 10 unique objects each = 6,000 base objects
        for i in range(1, 601):
            tr_id = f"DEVK9{i:05d}"
            tr_objs[tr_id] = [f"CLAS ZCL_SCALE_{i:04d}_{j:02d}" for j in range(10)]

        # Inject 100 collision objects across groups of 3 transports (300 collision points)
        for c in range(1, 101):
            coll_obj = f"TABL ZCOLLISION_TABLE_{c:03d}"
            tr_objs[f"DEVK9{c:05d}"].append(coll_obj)
            tr_objs[f"DEVK9{c + 100:05d}"].append(coll_obj)
            tr_objs[f"DEVK9{c + 200:05d}"].append(coll_obj)

        total_input_objects = sum(len(objs) for objs in tr_objs.values())
        assert total_input_objects == 6300

        tracemalloc.start()
        start_time = time.perf_counter()

        result = TransportDependencyEngine.evaluate(transport_objects=tr_objs)

        elapsed = time.perf_counter() - start_time
        curr_mem, peak_mem = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        peak_mb = peak_mem / (1024 * 1024)

        # Assert performance & memory bounds
        assert elapsed < 3.0, f"Execution exceeded 3.0s threshold: took {elapsed:.3f}s"
        assert peak_mb < 50.0, f"Memory footprint exceeded 50MB threshold: peak was {peak_mb:.2f}MB"

        # Assert structural correctness
        assert result["status"] == "COMPLETED"
        assert result["total_transports"] == 600
        assert result["total_objects"] == 6300
        assert result["collisions_count"] == 100
        assert len(result["recommended_import_sequence"]) == 600
        # Check no duplicates in recommended sequence
        assert len(set(result["recommended_import_sequence"])) == 600

    def test_scale_with_dense_prerequisite_graph(self):
        """Stress test with 500 transports forming a multi-layered dependency graph."""
        tr_objs: Dict[str, List[str]] = {}
        for i in range(1, 501):
            tr_objs[f"DEVK9{i:05d}"] = [f"PROG ZPRG_{i:04d}"]

        # 400 call reference dependency edges: DEVK9{i} depends on DEVK9{i-1}
        call_refs: List[Dict[str, Any]] = []
        for i in range(2, 402):
            call_refs.append({
                "caller_tr": f"DEVK9{i:05d}",
                "caller_object": f"PROG ZPRG_{i:04d}",
                "callee_tr": f"DEVK9{i-1:05d}",
                "callee_object": f"PROG ZPRG_{i-1:04d}",
                "reference_type": "CALL_TRANSACTION",
            })

        t0 = time.perf_counter()
        result = TransportDependencyEngine.evaluate(
            transport_objects=tr_objs,
            call_references=call_refs,
        )
        elapsed = time.perf_counter() - t0

        assert elapsed < 2.0, f"Dense graph evaluation took too long: {elapsed:.3f}s"
        assert result["total_transports"] == 500
        seq = result["recommended_import_sequence"]
        assert len(seq) == 500

        # Verify topological property: for each edge (callee -> caller), callee must precede caller
        pos_map = {tr: idx for idx, tr in enumerate(seq)}
        for ref in call_refs:
            assert pos_map[ref["callee_tr"]] < pos_map[ref["caller_tr"]], (
                f"Topological order violated: {ref['callee_tr']} (pos {pos_map[ref['callee_tr']]}) "
                f"must precede {ref['caller_tr']} (pos {pos_map[ref['caller_tr']]})"
            )

    @pytest.mark.asyncio
    async def test_scale_async_analyze_with_json_payload(self):
        """Stress test full asynchronous analyze() platform pipeline with 200 TRs and 1,000 objects in JSON."""
        transports_dict = {}
        for i in range(1, 201):
            transports_dict[f"DEVK9{i:05d}"] = [f"CLAS ZCL_MOD_{i}_{j}" for j in range(5)]

        # Add 20 shared objects
        for c in range(1, 21):
            obj = f"FUGR ZFUGR_CORE_{c}"
            transports_dict["DEVK900001"].append(obj)
            transports_dict["DEVK900002"].append(obj)

        payload_json = json.dumps({"transports": transports_dict})

        engine = TransportDependencyEngine()
        req = AnalysisRequest(
            job_id="scale-test-uuid-001",
            tenant_id=DEFAULT_TENANT_ID,
            project_id=DEFAULT_PROJECT_ID,
            engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            target_release="S4H_2023",
            raw_content=payload_json,
        )

        t0 = time.perf_counter()
        resp: AnalysisResponse = await engine.analyze(req)
        elapsed = time.perf_counter() - t0

        assert elapsed < 5.0, f"Async analyze() took {elapsed:.3f}s"
        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.metrics.additional_metrics["total_transports"] == 200
        assert resp.metrics.additional_metrics["collisions_count"] == 20
        assert len(resp.findings) >= 20


# ==============================================================================
# 2. Complex Collision Topologies Tests
# ==============================================================================

class TestComplexCollisionTopologies:
    """Stress tests verifying multi-transport overlapping collision chains and workbench vs customizing tables."""

    def test_transitive_overlapping_collision_chain(self):
        """TR1 & TR2 share A; TR2 & TR3 share B; TR3 & TR4 share C; TR1, TR3, TR5 share X."""
        tr_objects = {
            "DEVK900001": ["CLAS ZCL_A", "TABL ZTAB_MULTI"],
            "DEVK900002": ["CLAS ZCL_A", "CLAS ZCL_B"],
            "DEVK900003": ["CLAS ZCL_B", "CLAS ZCL_C", "TABL ZTAB_MULTI"],
            "DEVK900004": ["CLAS ZCL_C", "CLAS ZCL_D"],
            "DEVK900005": ["CLAS ZCL_D", "TABL ZTAB_MULTI"],
        }

        res = TransportDependencyEngine.evaluate(transport_objects=tr_objects)
        assert res["collisions_count"] == 5

        collision_findings = [f for f in res["findings"] if f["code"] == "TR_OBJECT_COLLISION"]
        assert len(collision_findings) == 5

        findings_by_obj = {f["object"]: f for f in collision_findings}
        assert "CLAS ZCL_A" in findings_by_obj
        assert findings_by_obj["CLAS ZCL_A"]["conflictingTransports"] == ["DEVK900001", "DEVK900002"]

        assert "CLAS ZCL_B" in findings_by_obj
        assert findings_by_obj["CLAS ZCL_B"]["conflictingTransports"] == ["DEVK900002", "DEVK900003"]

        assert "CLAS ZCL_C" in findings_by_obj
        assert findings_by_obj["CLAS ZCL_C"]["conflictingTransports"] == ["DEVK900003", "DEVK900004"]

        assert "CLAS ZCL_D" in findings_by_obj
        assert findings_by_obj["CLAS ZCL_D"]["conflictingTransports"] == ["DEVK900004", "DEVK900005"]

        assert "TABL ZTAB_MULTI" in findings_by_obj
        assert findings_by_obj["TABL ZTAB_MULTI"]["conflictingTransports"] == ["DEVK900001", "DEVK900003", "DEVK900005"]

    def test_duplicate_entries_same_transport_no_self_collision(self):
        """Verifies duplicate E071 entries in the SAME transport do NOT report false positive collisions."""
        tr_objects = {
            "DEVK900010": [
                "CLAS ZCL_DUP",
                "CLAS ZCL_DUP",
                "CLAS ZCL_DUP",
                "TABL ZTAB_SINGLE",
            ],
            "DEVK900020": [
                "PROG ZPRG_OTHER",
            ],
        }

        res = TransportDependencyEngine.evaluate(transport_objects=tr_objects)
        assert res["collisions_count"] == 0
        collision_findings = [f for f in res["findings"] if f["code"] == "TR_OBJECT_COLLISION"]
        assert len(collision_findings) == 0

    def test_customizing_ahead_of_structure_inversion_triggers_blocker(self):
        """Customizing transport with table keys planned BEFORE workbench transport with table structure."""
        transport_objects = {
            "DEVK900100": ["TABL ZCUSTOM_PARAM_TAB"],
        }
        table_keys = [
            {"trkorr": "DEVK900200", "tablename": "ZCUSTOM_PARAM_TAB", "tabkey": "100*"},
        ]
        # Inverted sequence: Customizing before Workbench
        planned_seq = ["DEVK900200", "DEVK900100"]

        res = TransportDependencyEngine.evaluate(
            transport_objects=transport_objects,
            table_keys=table_keys,
            planned_sequence=planned_seq,
        )

        assert res["customizing_ahead_count"] == 1
        finding = next(f for f in res["findings"] if f["code"] == "TR_CUSTOMIZING_AHEAD_OF_STRUCTURE")
        assert finding["severity"] == "BLOCKER"
        assert finding["confidence"] == "VERIFIED"
        assert finding["confidence_score"] == 1.0
        assert "ZCUSTOM_PARAM_TAB" in finding["object"]

        # Recommended sequence MUST correct the order: workbench before customizing
        rec_seq = res["recommended_import_sequence"]
        assert rec_seq.index("DEVK900100") < rec_seq.index("DEVK900200")

    def test_customizing_after_structure_correct_order_no_finding(self):
        """Workbench transport planned BEFORE customizing transport -> zero violations."""
        transport_objects = {
            "DEVK900100": ["TABL ZCUSTOM_PARAM_TAB"],
        }
        table_keys = [
            {"trkorr": "DEVK900200", "tablename": "ZCUSTOM_PARAM_TAB", "tabkey": "100*"},
        ]
        # Correct sequence: Workbench first, then Customizing
        planned_seq = ["DEVK900100", "DEVK900200"]

        res = TransportDependencyEngine.evaluate(
            transport_objects=transport_objects,
            table_keys=table_keys,
            planned_sequence=planned_seq,
        )

        assert res["customizing_ahead_count"] == 0
        cust_findings = [f for f in res["findings"] if f["code"] == "TR_CUSTOMIZING_AHEAD_OF_STRUCTURE"]
        assert len(cust_findings) == 0

    def test_customizing_table_same_transport_no_violation(self):
        """Both TABL definition and E071K table keys are co-located in the same transport."""
        transport_objects = {
            "DEVK900500": ["TABL ZSELF_CONTAINED_TAB"],
        }
        table_keys = [
            {"trkorr": "DEVK900500", "tablename": "ZSELF_CONTAINED_TAB", "tabkey": "100*"},
        ]

        res = TransportDependencyEngine.evaluate(
            transport_objects=transport_objects,
            table_keys=table_keys,
        )

        assert res["customizing_ahead_count"] == 0
        cust_findings = [f for f in res["findings"] if f["code"] == "TR_CUSTOMIZING_AHEAD_OF_STRUCTURE"]
        assert len(cust_findings) == 0

    def test_customizing_missing_workbench_in_planned_sequence(self):
        """Workbench TR exists in repository but was omitted from planned_sequence."""
        transport_objects = {
            "DEVK900100": ["TABL ZPARAM_TAB"],
        }
        table_keys = [
            {"trkorr": "DEVK900200", "tablename": "ZPARAM_TAB", "tabkey": "100*"},
        ]
        # Only customizing TR is scheduled for import
        planned_seq = ["DEVK900200"]

        res = TransportDependencyEngine.evaluate(
            transport_objects=transport_objects,
            table_keys=table_keys,
            planned_sequence=planned_seq,
        )

        assert res["customizing_ahead_count"] == 1
        finding = next(f for f in res["findings"] if f["code"] == "TR_CUSTOMIZING_AHEAD_OF_STRUCTURE")
        assert finding["severity"] == "BLOCKER"


# ==============================================================================
# 3. Overtaking Risk & Release Timestamps Tests
# ==============================================================================

class TestOvertakingRiskAndTimestamps:
    """Stress tests verifying overtaker downgrade detection across release timestamps and import order."""

    def test_overtaking_inverted_timestamps_triggers_blocker(self):
        """Older transport planned AFTER newer transport -> TR_OVERTAKER_DOWNGRADE_RISK."""
        transport_objects = {
            "DEVK900010": ["PROG ZPAYROLL_CALC"],  # Older
            "DEVK900020": ["PROG ZPAYROLL_CALC"],  # Newer
        }
        metadata = {
            "DEVK900010": {"as4date": "20260901", "as4time": "100000"},  # 2026-09-01 10:00:00
            "DEVK900020": {"as4date": "20260915", "as4time": "163000"},  # 2026-09-15 16:30:00
        }
        # Inverted sequence: Newer imported first, then older overwrites newer
        planned_seq = ["DEVK900020", "DEVK900010"]

        res = TransportDependencyEngine.evaluate(
            transport_objects=transport_objects,
            transport_metadata=metadata,
            planned_sequence=planned_seq,
        )

        assert res["overtaker_risks_count"] == 1
        finding = next(f for f in res["findings"] if f["code"] == "TR_OVERTAKER_DOWNGRADE_RISK")
        assert finding["severity"] == "BLOCKER"
        assert finding["confidence"] == "RULE_DERIVED"
        assert finding["confidence_score"] == 0.85
        assert finding["technicalDetails"]["older_transport"] == "DEVK900010"
        assert finding["technicalDetails"]["newer_transport"] == "DEVK900020"

        # Topological sort should enforce chronological order (older before newer)
        rec_seq = res["recommended_import_sequence"]
        assert rec_seq.index("DEVK900010") < rec_seq.index("DEVK900020")

    def test_overtaking_correct_chronological_order_no_violation(self):
        """Older transport planned BEFORE newer transport -> no downgrade finding."""
        transport_objects = {
            "DEVK900010": ["PROG ZPAYROLL_CALC"],
            "DEVK900020": ["PROG ZPAYROLL_CALC"],
        }
        metadata = {
            "DEVK900010": {"as4date": "20260901", "as4time": "100000"},
            "DEVK900020": {"as4date": "20260915", "as4time": "163000"},
        }
        # Forward sequence: older first, then newer
        planned_seq = ["DEVK900010", "DEVK900020"]

        res = TransportDependencyEngine.evaluate(
            transport_objects=transport_objects,
            transport_metadata=metadata,
            planned_sequence=planned_seq,
        )

        assert res["overtaker_risks_count"] == 0
        overtaker_findings = [f for f in res["findings"] if f["code"] == "TR_OVERTAKER_DOWNGRADE_RISK"]
        assert len(overtaker_findings) == 0

    def test_overtaking_multi_tier_downgrade_chain(self):
        """TR1 (T1) < TR2 (T2) < TR3 (T3). Inverted planned sequence [TR3, TR1, TR2]."""
        transport_objects = {
            "DEVK900001": ["CLAS ZCL_VERSIONED"],
            "DEVK900002": ["CLAS ZCL_VERSIONED"],
            "DEVK900003": ["CLAS ZCL_VERSIONED"],
        }
        metadata = {
            "DEVK900001": {"timestamp": "20260901000000"},
            "DEVK900002": {"timestamp": "20260905000000"},
            "DEVK900003": {"timestamp": "20260910000000"},
        }
        planned_seq = ["DEVK900003", "DEVK900001", "DEVK900002"]

        res = TransportDependencyEngine.evaluate(
            transport_objects=transport_objects,
            transport_metadata=metadata,
            planned_sequence=planned_seq,
        )

        # TR1 after TR3 is violation; TR2 after TR3 is violation
        assert res["overtaker_risks_count"] >= 2
        rec_seq = res["recommended_import_sequence"]
        assert rec_seq == ["DEVK900001", "DEVK900002", "DEVK900003"]

    def test_overtaking_identical_timestamps_fallback_to_naming(self):
        """Two transports with identical timestamps modifying the same object."""
        transport_objects = {
            "DEVK900010": ["FUGR ZFUGR_TEST"],
            "DEVK900020": ["FUGR ZFUGR_TEST"],
        }
        metadata = {
            "DEVK900010": {"as4date": "20260920", "as4time": "120000"},
            "DEVK900020": {"as4date": "20260920", "as4time": "120000"},
        }
        planned_seq = ["DEVK900020", "DEVK900010"]

        res = TransportDependencyEngine.evaluate(
            transport_objects=transport_objects,
            transport_metadata=metadata,
            planned_sequence=planned_seq,
        )

        # Fallback to TR number ordering: DEVK900010 < DEVK900020
        assert res["overtaker_risks_count"] == 1
        finding = next(f for f in res["findings"] if f["code"] == "TR_OVERTAKER_DOWNGRADE_RISK")
        assert finding["technicalDetails"]["older_transport"] == "DEVK900010"
        assert finding["technicalDetails"]["newer_transport"] == "DEVK900020"

    def test_overtaking_missing_timestamps_naming_convention(self):
        """Transports without any timestamp metadata fallback to alphanumeric TR sequence."""
        transport_objects = {
            "DEVK900101": ["VIEW ZVIEW_CUSTOMER"],
            "DEVK900105": ["VIEW ZVIEW_CUSTOMER"],
        }
        planned_seq = ["DEVK900105", "DEVK900101"]

        res = TransportDependencyEngine.evaluate(
            transport_objects=transport_objects,
            planned_sequence=planned_seq,
        )

        assert res["overtaker_risks_count"] == 1
        finding = next(f for f in res["findings"] if f["code"] == "TR_OVERTAKER_DOWNGRADE_RISK")
        assert finding["technicalDetails"]["older_transport"] == "DEVK900101"
        assert finding["technicalDetails"]["newer_transport"] == "DEVK900105"

    def test_timestamp_formatter_robustness(self):
        """Stress-test _format_timestamp helper with unusual strings."""
        assert _format_timestamp("2026-09-24", "09:03:00") == "20260924090300"
        assert _format_timestamp("20260924", "0903") == "20260924090300"
        assert _format_timestamp(None, None) == "00000000000000"
        assert _format_timestamp("", "") == "00000000000000"
        assert _format_timestamp("bad-date", "bad-time") == "00000000000000"


# ==============================================================================
# 4. Corrupt CSV/JSON Headers & Malformed Inputs Tests
# ==============================================================================

class TestCorruptAndMalformedInputs:
    """Stress tests verifying engine resilience against corrupt CSV/JSON/XML and dirty lines."""

    def test_corrupt_csv_headers_graceful_handling(self):
        """CSV with unknown or garbled headers does not raise uncaught exception."""
        corrupt_csv = (
            "UNKNOWN_COL_A,UNKNOWN_COL_B,UNKNOWN_COL_C\n"
            "FOO,BAR,BAZ\n"
            "123,456,789\n"
        )
        data = CTSNormalizedData()
        engine = TransportDependencyEngine()
        engine._parse_csv_content(corrupt_csv, data)
        # Should parse without exception, registering rows under fallback column mapping
        res = TransportDependencyEngine._run_deterministic_rules(data)
        assert res["status"] == "COMPLETED"

    def test_csv_malformed_lines_and_ragged_rows(self):
        """CSV with empty lines, trailing commas, single-element lines, and special characters."""
        ragged_csv = (
            "TRKORR,OBJECT,OBJ_NAME\n"
            "\n"
            "DEVK900001,CLAS,ZCL_GOOD\n"
            ",,\n"
            "DEVK900002\n"  # Missing columns
            "   \n"
            "DEVK900003,TABL,ZTAB_ONE,EXTRA_COL_1,EXTRA_COL_2\n"
            ";;;;\n"
            "DEVK900004,PROG,ZPRG_SPECIAL_!@#$%^&*()\n"
        )
        data = CTSNormalizedData()
        engine = TransportDependencyEngine()
        engine._parse_csv_content(ragged_csv, data)

        assert "DEVK900001" in data.objects_by_tr
        assert "DEVK900003" in data.objects_by_tr
        assert "DEVK900004" in data.objects_by_tr

        res = TransportDependencyEngine._run_deterministic_rules(data)
        assert res["status"] == "COMPLETED"

    def test_csv_semicolon_delimited_e070_e071_e071k_mix(self):
        """Semicolon delimited CSV containing a mix of E070, E071, and E071K lines."""
        semi_csv = (
            "TRKORR;RECORD_TYPE;OBJECT;OBJ_NAME;AS4DATE;AS4TIME\n"
            "DEVK900010;E070;;;20260901;120000\n"
            "DEVK900010;E071;TABL;ZCONFIG_TAB;;\n"
            "DEVK900020;E070;;;20260905;150000\n"
            "DEVK900020;E071K;TABU;ZCONFIG_TAB;;\n"
        )
        data = CTSNormalizedData()
        engine = TransportDependencyEngine()
        engine._parse_csv_content(semi_csv, data)

        assert "DEVK900010" in data.headers
        assert "DEVK900020" in data.headers
        assert "DEVK900010" in data.objects_by_tr
        assert "DEVK900020" in data.keys_by_tr

    @pytest.mark.asyncio
    async def test_malformed_json_syntax_in_request(self):
        """Truncated or invalid JSON syntax in AnalysisRequest fails closed safely."""
        bad_json = '{"transports": {"DEVK900001": ["CLAS ZCL_A"], "DEVK900002": [unclosed'
        req = AnalysisRequest(
            job_id="malformed-json-test",
            tenant_id=DEFAULT_TENANT_ID,
            project_id=DEFAULT_PROJECT_ID,
            engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_content=bad_json,
        )
        engine = TransportDependencyEngine()
        # Must not raise uncaught JSONDecodeError
        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED
        assert resp.findings == []

    @pytest.mark.asyncio
    async def test_malformed_xml_syntax_in_request(self):
        """Unclosed or broken XML tags in AnalysisRequest fail closed safely."""
        bad_xml = '<CTS><E070><RECORD TRKORR="DEVK900001">'  # Unclosed XML
        req = AnalysisRequest(
            job_id="malformed-xml-test",
            tenant_id=DEFAULT_TENANT_ID,
            project_id=DEFAULT_PROJECT_ID,
            engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_content=bad_xml,
        )
        engine = TransportDependencyEngine()
        resp = await engine.analyze(req)
        assert resp.status == AnalysisStatus.COMPLETED

    def test_corrupt_non_dict_elements_in_json_lists(self):
        """JSON with unexpected scalar types inside E070/E071 arrays."""
        dirty_json = {
            "e070": [None, 12345, "just-a-string", [], {"trkorr": "DEVK900010"}],
            "e071": [False, {}, {"trkorr": "DEVK900010", "object": "CLAS", "obj_name": "ZCL_VALID"}],
            "e071k": [None, {"trkorr": "DEVK900020", "tablename": "ZTAB_VALID"}],
            "call_references": [123, "invalid", {"caller_object": "ZCL_VALID", "callee_object": "ZTAB_VALID"}],
        }
        data = CTSNormalizedData()
        engine = TransportDependencyEngine()
        engine._parse_json_content(dirty_json, data, "")

        assert "DEVK900010" in data.headers
        assert len(data.objects_by_tr["DEVK900010"]) == 1
        assert len(data.keys_by_tr["DEVK900020"]) == 1
        assert len(data.call_references) == 1

    def test_empty_and_whitespace_inputs(self):
        """Completely blank or whitespace-only inputs produce 0 findings and 0 transports."""
        for empty_val in ("", "   ", "\n\n\t  \n"):
            req = AnalysisRequest(
                job_id="empty-test",
                tenant_id=DEFAULT_TENANT_ID,
                project_id=DEFAULT_PROJECT_ID,
                engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
                raw_content=empty_val,
            )
            engine = TransportDependencyEngine()
            data = engine._parse_inputs(req)
            res = TransportDependencyEngine._run_deterministic_rules(data)
            assert res["total_transports"] == 0
            assert res["total_objects"] == 0
            assert res["findings"] == []


# ==============================================================================
# 5. Deterministic Topological Ordering & Cycle Resolution Tests
# ==============================================================================

class TestTopologicalOrderingAndCycles:
    """Stress tests verifying pure determinism under random key permutations and cycle resolution."""

    def test_topological_sort_deterministic_under_permutations(self):
        """Topological sequencing must produce the exact identical order across 30 shuffled permutations."""
        base_objects = {
            "DEVK900010": ["CLAS ZCL_BASE_A"],
            "DEVK900020": ["CLAS ZCL_BASE_B"],
            "DEVK900030": ["CLAS ZCL_CORE_A"],
            "DEVK900040": ["CLAS ZCL_CORE_B"],
            "DEVK900050": ["CLAS ZCL_FEATURE_A"],
            "DEVK900060": ["CLAS ZCL_FEATURE_B"],
            "DEVK900070": ["CLAS ZCL_UI_A"],
        }
        call_refs = [
            {"caller_tr": "DEVK900030", "caller_object": "ZCL_CORE_A", "callee_tr": "DEVK900010", "callee_object": "ZCL_BASE_A"},
            {"caller_tr": "DEVK900040", "caller_object": "ZCL_CORE_B", "callee_tr": "DEVK900020", "callee_object": "ZCL_BASE_B"},
            {"caller_tr": "DEVK900050", "caller_object": "ZCL_FEATURE_A", "callee_tr": "DEVK900030", "callee_object": "ZCL_CORE_A"},
            {"caller_tr": "DEVK900060", "caller_object": "ZCL_FEATURE_B", "callee_tr": "DEVK900040", "callee_object": "ZCL_CORE_B"},
            {"caller_tr": "DEVK900070", "caller_object": "ZCL_UI_A", "callee_tr": "DEVK900050", "callee_object": "ZCL_FEATURE_A"},
            {"caller_tr": "DEVK900070", "caller_object": "ZCL_UI_A", "callee_tr": "DEVK900060", "callee_object": "ZCL_FEATURE_B"},
        ]

        # Run reference baseline
        ref_res = TransportDependencyEngine.evaluate(
            transport_objects=base_objects,
            call_references=call_refs,
        )
        baseline_sequence = ref_res["recommended_import_sequence"]
        assert len(baseline_sequence) == 7

        # 30 iterations with randomized dictionary keys and shuffled call references
        for trial in range(30):
            shuffled_keys = list(base_objects.keys())
            random.shuffle(shuffled_keys)
            shuffled_objs = {k: list(base_objects[k]) for k in shuffled_keys}

            shuffled_refs = list(call_refs)
            random.shuffle(shuffled_refs)

            res = TransportDependencyEngine.evaluate(
                transport_objects=shuffled_objs,
                call_references=shuffled_refs,
            )
            assert res["recommended_import_sequence"] == baseline_sequence, (
                f"Non-deterministic topological ordering on trial {trial}: "
                f"{res['recommended_import_sequence']} != {baseline_sequence}"
            )

    def test_circular_dependency_3_node_cycle_resolution(self):
        """Direct 3-node cycle: TR_A -> TR_B -> TR_C -> TR_A."""
        tr_objects = {
            "DEVK900001": ["CLAS ZCL_A"],
            "DEVK900002": ["CLAS ZCL_B"],
            "DEVK900003": ["CLAS ZCL_C"],
        }
        call_refs = [
            {"caller_tr": "DEVK900002", "caller_object": "ZCL_B", "callee_tr": "DEVK900001", "callee_object": "ZCL_A"},
            {"caller_tr": "DEVK900003", "caller_object": "ZCL_C", "callee_tr": "DEVK900002", "callee_object": "ZCL_B"},
            {"caller_tr": "DEVK900001", "caller_object": "ZCL_A", "callee_tr": "DEVK900003", "callee_object": "ZCL_C"},
        ]

        res = TransportDependencyEngine.evaluate(
            transport_objects=tr_objects,
            call_references=call_refs,
        )

        cycle_findings = [f for f in res["findings"] if f["code"] == "TR_CIRCULAR_DEPENDENCY_DETECTED"]
        assert len(cycle_findings) >= 1
        finding = cycle_findings[0]
        assert finding["severity"] == "BLOCKER"
        assert finding["confidence"] == "VERIFIED"
        assert finding["confidence_score"] == 1.0

        # Engine must not hang, and recommended sequence must contain all 3 transports
        seq = res["recommended_import_sequence"]
        assert len(seq) == 3
        assert set(seq) == {"DEVK900001", "DEVK900002", "DEVK900003"}

    def test_circular_dependency_2_node_mutual(self):
        """Mutual 2-node cycle: TR1 -> TR2 and TR2 -> TR1."""
        tr_objects = {
            "DEVK900010": ["CLAS ZCL_PING"],
            "DEVK900020": ["CLAS ZCL_PONG"],
        }
        call_refs = [
            {"caller_tr": "DEVK900020", "caller_object": "ZCL_PONG", "callee_tr": "DEVK900010", "callee_object": "ZCL_PING"},
            {"caller_tr": "DEVK900010", "caller_object": "ZCL_PING", "callee_tr": "DEVK900020", "callee_object": "ZCL_PONG"},
        ]

        res = TransportDependencyEngine.evaluate(
            transport_objects=tr_objects,
            call_references=call_refs,
        )

        assert any(f["code"] == "TR_CIRCULAR_DEPENDENCY_DETECTED" for f in res["findings"])
        seq = res["recommended_import_sequence"]
        assert set(seq) == {"DEVK900010", "DEVK900020"}

    def test_complex_diamond_dag_sequence(self):
        """Diamond DAG: ROOT -> (LEFT, RIGHT) -> SINK."""
        tr_objects = {
            "DEVK900001": ["CLAS ZCL_ROOT"],
            "DEVK900002": ["CLAS ZCL_LEFT"],
            "DEVK900003": ["CLAS ZCL_RIGHT"],
            "DEVK900004": ["CLAS ZCL_SINK"],
        }
        call_refs = [
            {"caller_tr": "DEVK900002", "caller_object": "ZCL_LEFT", "callee_tr": "DEVK900001", "callee_object": "ZCL_ROOT"},
            {"caller_tr": "DEVK900003", "caller_object": "ZCL_RIGHT", "callee_tr": "DEVK900001", "callee_object": "ZCL_ROOT"},
            {"caller_tr": "DEVK900004", "caller_object": "ZCL_SINK", "callee_tr": "DEVK900002", "callee_object": "ZCL_LEFT"},
            {"caller_tr": "DEVK900004", "caller_object": "ZCL_SINK", "callee_tr": "DEVK900003", "callee_object": "ZCL_RIGHT"},
        ]

        res = TransportDependencyEngine.evaluate(
            transport_objects=tr_objects,
            call_references=call_refs,
        )

        seq = res["recommended_import_sequence"]
        # ROOT must be at position 0, SINK at position 3
        assert seq[0] == "DEVK900001"
        assert seq[3] == "DEVK900004"
        # Lexicographical tie-breaking selects DEVK900002 before DEVK900003
        assert seq == ["DEVK900001", "DEVK900002", "DEVK900003", "DEVK900004"]

    def test_disconnected_clusters_included_in_sequence(self):
        """Disconnected independent transports must all be present in recommendedImportSequence."""
        tr_objects = {
            "DEVK900010": ["CLAS ZCL_A1"],
            "DEVK900011": ["CLAS ZCL_A2"],
            "DEVK900050": ["CLAS ZCL_ISLAND_1"],
            "DEVK900060": ["CLAS ZCL_ISLAND_2"],
        }
        call_refs = [
            {"caller_tr": "DEVK900011", "caller_object": "ZCL_A2", "callee_tr": "DEVK900010", "callee_object": "ZCL_A1"},
        ]

        res = TransportDependencyEngine.evaluate(
            transport_objects=tr_objects,
            call_references=call_refs,
        )

        seq = res["recommended_import_sequence"]
        assert len(seq) == 4
        assert set(seq) == {"DEVK900010", "DEVK900011", "DEVK900050", "DEVK900060"}
        assert seq.index("DEVK900010") < seq.index("DEVK900011")


# ==============================================================================
# 6. Cryptographic Evidence Integrity & Platform Invariants Tests
# ==============================================================================

class TestEvidenceIntegrityAndPlatformInvariants:
    """Stress tests verifying SHA-256 evidence integrity, finding taxonomy, and epistemic confidence."""

    @pytest.mark.asyncio
    async def test_evidence_sha256_cryptographic_integrity(self):
        """Verifies every finding generated has valid, non-empty 64-char lowercase SHA-256 evidence."""
        payload = json.dumps({
            "transports": {
                "DEVK900010": ["CLAS ZCL_COLLIDE", "TABL ZTAB_STRUCT"],
                "DEVK900020": ["CLAS ZCL_COLLIDE"],
            },
            "table_keys": [
                {"trkorr": "DEVK900030", "tablename": "ZTAB_STRUCT", "tabkey": "*"},
            ],
            "call_references": [
                {"caller_tr": "DEVK900020", "caller_object": "ZCL_COLLIDE", "callee_tr": "DEVK900099", "callee_object": "ZCL_MISSING"},
            ],
            "planned_sequence": ["DEVK900030", "DEVK900020", "DEVK900010"],
        })

        req = AnalysisRequest(
            job_id="evidence-integrity-check-001",
            tenant_id=DEFAULT_TENANT_ID,
            project_id=DEFAULT_PROJECT_ID,
            engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            target_release="S4H_2023",
            raw_content=payload,
        )

        engine = TransportDependencyEngine()
        resp: AnalysisResponse = await engine.analyze(req)

        assert resp.status == AnalysisStatus.COMPLETED
        assert len(resp.findings) > 0

        sha256_pattern = re.compile(r"^[0-9a-f]{64}$")

        for f in resp.findings:
            # Rule ID taxonomy
            assert f.rule_id.startswith("TR_")
            assert f.severity in (Severity.BLOCKER, Severity.CRITICAL, Severity.MAJOR, Severity.MINOR, Severity.INFO)
            assert f.confidence in (ConfidenceClass.VERIFIED, ConfidenceClass.RULE_DERIVED, ConfidenceClass.INFERRED, ConfidenceClass.UNKNOWN)

            # Evidence assertion
            assert len(f.evidence) >= 1, f"Finding {f.rule_id} missing evidence"
            for ev in f.evidence:
                assert ev.sha256 is not None
                assert len(ev.sha256) == 64
                assert sha256_pattern.match(ev.sha256), f"Invalid SHA-256 hash: {ev.sha256}"
                assert ev.line_number >= 1
                assert ev.column_number >= 1

    @pytest.mark.asyncio
    async def test_epistemic_confidence_scoring_rules(self):
        """Checks epistemic confidence scores conform to Cardinal Axiom 2 requirements."""
        payload = json.dumps({
            "transports": {
                "DEVK900010": ["CLAS ZCL_SHARED"],
                "DEVK900020": ["CLAS ZCL_SHARED"],
            },
        })

        req = AnalysisRequest(
            job_id="confidence-scoring-check",
            tenant_id=DEFAULT_TENANT_ID,
            project_id=DEFAULT_PROJECT_ID,
            engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_content=payload,
        )

        engine = TransportDependencyEngine()
        resp = await engine.analyze(req)

        collision_finding = next(f for f in resp.findings if f.rule_id == "TR_OBJECT_COLLISION")
        # Direct object collision is mathematically verified
        assert collision_finding.confidence == ConfidenceClass.VERIFIED
        assert collision_finding.confidence_score == 1.0

    @pytest.mark.asyncio
    async def test_platform_metrics_telemetry_correctness(self):
        """Verifies AnalysisResponse metrics are non-negative, accurate, and complete."""
        payload = json.dumps({
            "transports": {
                "DEVK900001": ["CLAS ZCL_M1"],
                "DEVK900002": ["CLAS ZCL_M2"],
            },
        })
        req = AnalysisRequest(
            job_id="telemetry-test",
            tenant_id=DEFAULT_TENANT_ID,
            project_id=DEFAULT_PROJECT_ID,
            engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            raw_content=payload,
        )
        engine = TransportDependencyEngine()
        resp = await engine.analyze(req)

        assert resp.metrics.execution_time_ms >= 0
        assert resp.metrics.rules_evaluated == 5
        assert resp.metrics.artifacts_scanned == 1
        add_m = resp.metrics.additional_metrics
        assert add_m["total_transports"] == 2
        assert add_m["total_objects"] == 2
        assert add_m["collisions_count"] == 0
        assert add_m["engine"] == "transport_dependency_analyzer"

    @pytest.mark.asyncio
    async def test_csv_artifact_async_analyze_with_evidence_verification(self):
        """Verifies async analyze() parses CSV directly, linking lines and computing SHA-256 evidence."""
        csv_payload = (
            "TRKORR,OBJECT,OBJ_NAME\n"
            "DEVK900010,CLAS,ZCL_SHARED_SERVICE\n"
            "DEVK900020,CLAS,ZCL_SHARED_SERVICE\n"
            "DEVK900010,TABL,ZCONFIG_TABLE\n"
        )
        req = AnalysisRequest(
            job_id="csv-analyze-evidence-test",
            tenant_id=DEFAULT_TENANT_ID,
            project_id=DEFAULT_PROJECT_ID,
            engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
            artifact_type=ArtifactType.CSV,
            artifact_s3_key="tenants/t1/projects/p1/transports.csv",
            raw_content=csv_payload,
        )
        engine = TransportDependencyEngine()
        resp = await engine.analyze(req)

        assert resp.status == AnalysisStatus.COMPLETED
        collision = next(f for f in resp.findings if f.rule_id == "TR_OBJECT_COLLISION")
        assert collision.confidence == ConfidenceClass.VERIFIED
        assert len(collision.evidence) >= 1
        ev = collision.evidence[0]
        assert ev.artifact_path == "tenants/t1/projects/p1/transports.csv"
        assert len(ev.sha256) == 64
        assert ev.line_number >= 1

    def test_massive_50_node_circular_dependency_resolution(self):
        """Stress-test cycle detection and resolution on a large 50-node circular ring graph."""
        tr_objs = {f"DEVK9000{i:02d}": [f"CLAS ZCL_RING_{i:02d}"] for i in range(1, 51)}
        call_refs = []
        for i in range(1, 50):
            call_refs.append({
                "caller_tr": f"DEVK9000{i+1:02d}",
                "caller_object": f"ZCL_RING_{i+1:02d}",
                "callee_tr": f"DEVK9000{i:02d}",
                "callee_object": f"ZCL_RING_{i:02d}",
            })
        # Close the cycle: 1 depends on 50
        call_refs.append({
            "caller_tr": "DEVK900001",
            "caller_object": "ZCL_RING_01",
            "callee_tr": "DEVK900050",
            "callee_object": "ZCL_RING_50",
        })

        t0 = time.perf_counter()
        res = TransportDependencyEngine.evaluate(
            transport_objects=tr_objs,
            call_references=call_refs,
        )
        elapsed = time.perf_counter() - t0

        assert elapsed < 1.0, f"50-node cycle detection took too long: {elapsed:.3f}s"
        assert any(f["code"] == "TR_CIRCULAR_DEPENDENCY_DETECTED" for f in res["findings"])
        seq = res["recommended_import_sequence"]
        assert len(seq) == 50
        assert len(set(seq)) == 50

    def test_invalid_and_messy_tr_identifiers_normalization(self):
        """Verifies whitespace, lowercase, and formatting tolerance in TR identifiers."""
        tr_objs = {
            "  devk900010  ": ["  clas  zcl_normalized  "],
            "DEVK900010": ["CLAS ZCL_NORMALIZED"],
            "DEVK900020": [" clas zcl_normalized "],
        }
        res = TransportDependencyEngine.evaluate(transport_objects=tr_objs)
        # Should normalize to 2 distinct TRs: DEVK900010 and DEVK900020
        assert res["total_transports"] == 2
        # And detect 1 collision on CLAS ZCL_NORMALIZED
        assert res["collisions_count"] == 1
        coll = res["findings"][0]
        assert coll["conflictingTransports"] == ["DEVK900010", "DEVK900020"]

    def test_fully_integrated_complex_cts_payload(self):
        """Integrated stress test with collisions, customizing inversion, overtaker downgrade, and calls simultaneously."""
        cts_json = {
            "e070": [
                {"trkorr": "DEVK900001", "trfunction": "K", "trstatus": "R", "as4date": "20260901", "as4time": "100000"},
                {"trkorr": "DEVK900002", "trfunction": "K", "trstatus": "R", "as4date": "20260910", "as4time": "120000"},
                {"trkorr": "DEVK900003", "trfunction": "W", "trstatus": "R", "as4date": "20260912", "as4time": "080000"},
            ],
            "e071": [
                {"trkorr": "DEVK900001", "pgmid": "R3TR", "object": "TABL", "obj_name": "ZFIN_CONFIG_TAB"},
                {"trkorr": "DEVK900001", "pgmid": "R3TR", "object": "CLAS", "obj_name": "ZCL_FIN_CORE"},
                {"trkorr": "DEVK900002", "pgmid": "R3TR", "object": "CLAS", "obj_name": "ZCL_FIN_CORE"},
            ],
            "e071k": [
                {"trkorr": "DEVK900003", "tablename": "ZFIN_CONFIG_TAB", "tabkey": "001*"},
            ],
            "call_references": [
                {"caller_tr": "DEVK900002", "caller_object": "ZCL_FIN_CORE", "callee_tr": "DEVK900001", "callee_object": "TABL ZFIN_CONFIG_TAB"},
            ],
            # Planned sequence has customizing ahead of structure and newer ahead of older:
            "planned_sequence": ["DEVK900003", "DEVK900002", "DEVK900001"],
        }

        data = CTSNormalizedData()
        engine = TransportDependencyEngine()
        engine._parse_json_content(cts_json, data, json.dumps(cts_json))
        res = TransportDependencyEngine._run_deterministic_rules(data)

        # 1. Collision on ZCL_FIN_CORE
        assert res["collisions_count"] == 1
        # 2. Customizing ahead of structure
        assert res["customizing_ahead_count"] == 1
        # 3. Overtaker downgrade (DEVK900001 planned after DEVK900002)
        assert res["overtaker_risks_count"] == 1
        # 4. Recommended sequence resolves to: DEVK900001 first, then DEVK900002, then DEVK900003
        rec_seq = res["recommended_import_sequence"]
        assert rec_seq.index("DEVK900001") < rec_seq.index("DEVK900002")
        assert rec_seq.index("DEVK900001") < rec_seq.index("DEVK900003")
