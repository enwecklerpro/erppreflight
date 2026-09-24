"""Forensic Auditor Independent Dynamic Probes for Domain 3 Engines.

Audits:
- Change Pointer Coverage Auditor (change_pointer.py)
- API Change Guard (api_change.py)

Tests for:
1. Absence of hardcoded values, facade logic, or test mirroring.
2. Exact cryptographic SHA-256 evidence integrity & line/column accuracy.
3. Epistemic confidence classification and demotion invariants.
4. Edge cases, mutations, and randomized/arbitrary payloads.
"""

import asyncio
import hashlib
import json
import sys
from pathlib import Path

# Add services/analysis-python to path
services_dir = Path("H:/erppreflight/services/analysis-python")
if str(services_dir) not in sys.path:
    sys.path.insert(0, str(services_dir))

from src.engines.api_change import ApiChangeEngine, ClientIntegration
from src.engines.change_pointer import ChangePointerEngine
from src.models.enums import (
    AnalysisStatus,
    ConfidenceClass,
    EngineType,
    Severity,
)
from src.models.request import AnalysisRequest
from src.platform.confidence import ConfidenceClassifier


async def run_all_probes():
    results = {}
    print("=== STARTING FORENSIC PROBES ===")

    # -------------------------------------------------------------------------
    # PROBE 1: Change Pointer Engine with Arbitrary Random Inputs
    # -------------------------------------------------------------------------
    print("\n--- Probe 1: Change Pointer Engine Arbitrary Payloads ---")
    cp_engine = ChangePointerEngine()

    custom_cfg = {
        "message_type": "ZTEST_MSG",
        "target_message_type": "ZTEST_MSG",
        "change_document_object": "ZOBJ",
        "bd61_active": True,
        "bd50_msg_types": ["ZTEST_MSG"],
        "bd52_fields": [["ZTBL", "FIELD_A"], ["ZTBL", "FIELD_B"]],
        "expected_fields": [
            ["ZTBL", "FIELD_A"],
            ["ZTBL", "FIELD_B"],
            ["ZTBL", "FIELD_C"],
            ["ZTBL", "YY1_CUSTOM_EXT"],
            ["ZTBL", "ZZ_ANOTHER_EXT"],
        ],
        "dd04l_metadata": {
            "ZTBL-FIELD_A": {"change_document_flag": False, "data_element": "ZDE_A"}
        },
        "bdcp2_samples": [
            {"table": "ZTBL", "field": "FIELD_A", "process_status": " ", "count": 150}
        ],
        "bd53_reduced_fields": ["ZTBL-FIELD_B"],
    }
    raw_cp_json = json.dumps(custom_cfg, indent=2)
    req_cp = AnalysisRequest(
        job_id="00000000-aaaa-bbbb-cccc-000000000001",
        tenant_id="00000000-aaaa-bbbb-cccc-000000000002",
        project_id="00000000-aaaa-bbbb-cccc-000000000003",
        engine_type=EngineType.CHANGE_POINTER_COVERAGE_AUDITOR,
        raw_content=raw_cp_json,
    )
    resp_cp = await cp_engine.analyze(req_cp)

    expected_rules = {
        "CP_FIELD_NOT_CONFIGURED_BD52",
        "CP_FIELD_DD04L_CHGFLAG_MISSING",
        "CP_CUSTOM_FIELD_OMITTED_BD52",
        "CP_FIELD_FILTERED_BD53",
        "CP_RUNTIME_UNPROCESSED_BACKLOG",
    }
    found_rules = {f.rule_id for f in resp_cp.findings}
    print(f"CP Findings triggered: {found_rules}")
    assert expected_rules.issubset(found_rules), f"Missing rules: {expected_rules - found_rules}"

    # Verify coverage percentage: 2 covered out of 5 expected = 40.0%
    assert resp_cp.metrics.additional_metrics["coveragePercentage"] == 40.0, (
        f"Coverage mismatch: {resp_cp.metrics.additional_metrics['coveragePercentage']}"
    )

    # Verify evidence SHA-256 for CP
    expected_sha_cp = hashlib.sha256(raw_cp_json.encode("utf-8")).hexdigest()
    for f in resp_cp.findings:
        for ev in f.evidence:
            assert ev.sha256 == expected_sha_cp, f"SHA mismatch: {ev.sha256} vs {expected_sha_cp}"
            assert ev.line_number >= 1
            assert ev.column_number >= 1
    print("Probe 1 PASS: Change Pointer correctly computed arbitrary inputs and evidence.")

    # -------------------------------------------------------------------------
    # PROBE 2: API Change Guard with Arbitrary OpenAPI Specs & Type Mutations
    # -------------------------------------------------------------------------
    print("\n--- Probe 2: API Change Guard Arbitrary Mutations ---")
    api_engine = ApiChangeEngine()

    base_spec = {
        "openapi": "3.0.0",
        "paths": {
            "/api/v1/customers": {
                "get": {
                    "parameters": [
                        {"name": "status", "in": "query", "required": False, "schema": {"type": "string"}},
                        {"name": "count", "in": "query", "schema": {"type": "integer"}},
                        {"name": "ratio", "in": "query", "schema": {"type": "number"}},
                    ]
                },
                "delete": {},
            }
        },
        "components": {
            "schemas": {
                "Customer": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "maxLength": 50},
                        "legacyCode": {"type": "string"},
                        "tier": {"type": "string", "enum": ["GOLD", "SILVER", "BRONZE"]},
                        "score": {"type": "number"},
                    },
                }
            }
        },
    }

    cand_spec = {
        "openapi": "3.0.0",
        "paths": {
            "/api/v1/customers": {
                "get": {
                    "parameters": [
                        # status made required
                        {"name": "status", "in": "query", "required": True, "schema": {"type": "string"}},
                        # count mutated integer -> boolean
                        {"name": "count", "in": "query", "schema": {"type": "boolean"}},
                        # ratio mutated number -> string
                        {"name": "ratio", "in": "query", "schema": {"type": "string"}},
                        # new required param added
                        {"name": "mandatoryFlag", "in": "query", "required": True, "schema": {"type": "string"}},
                    ]
                }
                # delete removed!
            }
        },
        "components": {
            "schemas": {
                "Customer": {
                    "type": "object",
                    "properties": {
                        # id maxLength decreased 50 -> 20
                        "id": {"type": "string", "maxLength": 20},
                        # legacyCode removed!
                        # tier enum restricted: BRONZE removed
                        "tier": {"type": "string", "enum": ["GOLD", "SILVER"]},
                        # score type changed number -> string
                        "score": {"type": "string"},
                        # new mandatory property added
                        "newMandatory": {"type": "string", "nullable": False},
                    },
                }
            }
        },
    }

    integrations = [
        {
            "integration_id": "CLIENT_PORTAL",
            "consumed_endpoints": ["/api/v1/customers"],
            "consumed_operations": {"/api/v1/customers": ["DELETE"]},
            "consumed_fields": {"Customer": ["legacyCode"]},
        },
        {
            "integration_id": "READ_ONLY_SYNC",
            "consumed_endpoints": ["/api/v1/customers"],
            "consumed_operations": {"/api/v1/customers": ["GET"]},
            "consumed_fields": {"Customer": ["id"]},
        },
    ]

    base_str = json.dumps(base_spec, indent=2)
    cand_str = json.dumps(cand_spec, indent=2)
    base_sha = hashlib.sha256(base_str.encode("utf-8")).hexdigest()
    cand_sha = hashlib.sha256(cand_str.encode("utf-8")).hexdigest()

    req_api = AnalysisRequest(
        job_id="00000000-aaaa-bbbb-cccc-000000000010",
        tenant_id="00000000-aaaa-bbbb-cccc-000000000002",
        project_id="00000000-aaaa-bbbb-cccc-000000000003",
        engine_type=EngineType.API_CHANGE_GUARD,
        configuration={
            "baseline": base_spec,
            "candidate": cand_spec,
            "integrations": integrations,
        },
    )
    resp_api = await api_engine.analyze(req_api)
    print(f"API Change Findings count: {len(resp_api.findings)}")
    rule_ids = [f.rule_id for f in resp_api.findings]
    print(f"Triggered rule IDs: {rule_ids}")

    # Verify each expected breaking rule was triggered
    assert "API_BREAKING_OPERATION_REMOVED" in rule_ids
    assert "API_BREAKING_FIELD_REMOVED" in rule_ids
    assert "API_BREAKING_TYPE_CHANGED" in rule_ids
    assert "API_BREAKING_MAX_LENGTH_DECREASED" in rule_ids
    assert "API_BREAKING_REQUIRED_PARAM_ADDED" in rule_ids
    assert "API_BREAKING_REQUIRED_PROPERTY_ADDED" in rule_ids
    assert "API_BREAKING_ENUM_RESTRICTED" in rule_ids

    # Verify consumer impact cross-referencing
    op_removed = next(f for f in resp_api.findings if f.rule_id == "API_BREAKING_OPERATION_REMOVED")
    assert "CLIENT_PORTAL" in op_removed.technical_details["affectedIntegrations"]
    assert "READ_ONLY_SYNC" not in op_removed.technical_details["affectedIntegrations"]  # Fix 8 check
    assert op_removed.severity == Severity.BLOCKER

    # Verify evidence SHA256 integrity: baseline vs candidate
    for f in resp_api.findings:
        for ev in f.evidence:
            assert ev.sha256 in (base_sha, cand_sha), f"Unexpected SHA: {ev.sha256}"
            assert ev.line_number >= 1
            assert ev.column_number >= 1
            assert len(ev.snippet) > 0
    print("Probe 2 PASS: API Change Guard correctly diffed arbitrary schemas with full evidence integrity.")

    # -------------------------------------------------------------------------
    # PROBE 3: Epistemic Invariants & Demotions
    # -------------------------------------------------------------------------
    print("\n--- Probe 3: Epistemic Invariants & Demotions ---")
    # A. Test LLM ceiling when is_ai_generated is true
    for f in resp_api.findings:
        classified_ai = ConfidenceClassifier.classify(f, is_ai_generated=True)
        assert classified_ai.confidence == ConfidenceClass.INFERRED
        assert classified_ai.confidence_score <= 0.60

    # B. Test demotion on missing evidence
    for f in resp_api.findings:
        classified_missing = ConfidenceClassifier.classify(f, missing_evidence=True)
        assert classified_missing.confidence == ConfidenceClass.UNKNOWN
        assert classified_missing.confidence_score <= 0.30

    # C. Test demotion when evidence list is empty
    for f in resp_api.findings:
        f_no_ev = f.model_copy(update={"evidence": []})
        classified_no_ev = ConfidenceClassifier.classify(f_no_ev)
        assert classified_no_ev.confidence == ConfidenceClass.UNKNOWN
        assert classified_no_ev.confidence_score <= 0.30

    print("Probe 3 PASS: Epistemic confidence invariants and demotions verified.")

    # -------------------------------------------------------------------------
    # PROBE 4: Diagnostic Inputs (Syntax error, candidate missing, baseline missing)
    # -------------------------------------------------------------------------
    print("\n--- Probe 4: Diagnostic Inputs ---")
    req_no_cand = AnalysisRequest(
        job_id="00000000-aaaa-bbbb-cccc-000000000020",
        tenant_id="00000000-aaaa-bbbb-cccc-000000000002",
        project_id="00000000-aaaa-bbbb-cccc-000000000003",
        engine_type=EngineType.API_CHANGE_GUARD,
        configuration={"baseline": {"openapi": "3.0.0"}},
    )
    resp_no_cand = await api_engine.analyze(req_no_cand)
    assert resp_no_cand.status == AnalysisStatus.FAILED
    assert resp_no_cand.findings[0].rule_id == "API_CANDIDATE_MISSING"

    req_syntax_err = AnalysisRequest(
        job_id="00000000-aaaa-bbbb-cccc-000000000021",
        tenant_id="00000000-aaaa-bbbb-cccc-000000000002",
        project_id="00000000-aaaa-bbbb-cccc-000000000003",
        engine_type=EngineType.API_CHANGE_GUARD,
        configuration={"baseline": "not json or xml", "candidate": "not json or xml"},
    )
    resp_syntax_err = await api_engine.analyze(req_syntax_err)
    assert resp_syntax_err.status == AnalysisStatus.FAILED
    assert resp_syntax_err.findings[0].rule_id == "API_SPEC_SYNTAX_ERROR"
    print("Probe 4 PASS: Diagnostics handled cleanly.")

    print("\n=== ALL FORENSIC PROBES PASSED 100% ===")


if __name__ == "__main__":
    asyncio.run(run_all_probes())
