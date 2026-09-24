"""Empirical Stress Tests and Adversarial Probes for Domain 5 Engines.
Auditor: m3_d5_auditor_1
"""

import asyncio
import json
import sys
from pathlib import Path

# Add analysis-python to path
sys.path.insert(0, str(Path("H:/erppreflight/services/analysis-python").resolve()))

import src.engines
from src.core.registry import EngineRegistry
from src.models.enums import EngineType, AnalysisStatus, Severity, ConfidenceClass
from src.models.request import AnalysisRequest

async def run_stress_probes():
    print("--- Starting Empirical Stress Probes ---")

    # 1. DecommissionAuditEngine Stress
    decom_engine = EngineRegistry.get(EngineType.SAFE_DECOMMISSION_PREFLIGHT)
    print("Testing DecommissionAuditEngine...")

    # Probe 1A: Extreme values & bounds
    huge_jobs = [
        {"job_name": f"JOB_{i}", "exec_user": "BATCH_ADMIN", "status": "R", "periodic": True}
        for i in range(500)
    ]
    huge_rfcs = [
        {"destination": f"RFC_{i}", "username": "BATCH_ADMIN", "target_host": "host.corp"}
        for i in range(200)
    ]
    req_1a = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000001",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.SAFE_DECOMMISSION_PREFLIGHT,
        raw_content=json.dumps({
            "target_user": "BATCH_ADMIN",
            "jobs": huge_jobs,
            "rfc_destinations": huge_rfcs,
            "grace_period_days": 90
        })
    )
    resp_1a = await decom_engine.analyze(req_1a)
    score_1a = resp_1a.metrics.additional_metrics.get("decommissionRiskScore")
    assert 0.0 <= score_1a <= 10.0, f"Decom risk score {score_1a} exceeds [0, 10]!"
    assert score_1a == 8.5, f"Expected exactly 8.5 (jobs 4.0 + rfc 4.5), got {score_1a}"
    print(f"  [PASS] Decom score mathematically verified: {score_1a} (jobs 4.0 + rfc 4.5)")

    # Probe 1B: Capped at 10.0 with work items
    req_1b = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000001",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.SAFE_DECOMMISSION_PREFLIGHT,
        raw_content=json.dumps({
            "target_user": "BATCH_ADMIN",
            "jobs": huge_jobs,
            "rfc_destinations": huge_rfcs,
            "work_items": [{"wi_id": f"WI_{i}", "assigned_agent": "BATCH_ADMIN", "status": "READY"} for i in range(10)],
            "grace_period_days": 90
        })
    )
    resp_1b = await decom_engine.analyze(req_1b)
    score_1b = resp_1b.metrics.additional_metrics.get("decommissionRiskScore")
    assert score_1b == 10.0, f"Expected capped 10.0, got {score_1b}"
    print(f"  [PASS] Decom score successfully capped at 10.0: {score_1b}")

    # Probe 1C: Deterministic Bitwise Reproducibility
    resp_1c = await decom_engine.analyze(req_1a)
    assert len(resp_1a.findings) == len(resp_1c.findings), "Non-deterministic findings count!"
    for f1, f2 in zip(resp_1a.findings, resp_1c.findings):
        assert f1.rule_id == f2.rule_id
        assert f1.severity == f2.severity
        assert f1.evidence[0].sha256 == f2.evidence[0].sha256
    print("  [PASS] Decom 100% deterministic bitwise reproducibility verified.")

    # 2. Fiori403Engine Stress
    fiori_engine = EngineRegistry.get(EngineType.FIORI_403_ROOT_CAUSE_DOCTOR)
    print("Testing Fiori403Engine...")

    # Probe 2A: Compound multi-layer failure (CSRF + ICF inactive + SU53 missing)
    req_2a = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000002",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.FIORI_403_ROOT_CAUSE_DOCTOR,
        raw_content=json.dumps({
            "http_response": {
                "status_code": 403,
                "method": "POST",
                "url": "/sap/opu/odata/sap/API_SALES_ORDER_SRV/$batch",
                "headers": {"x-csrf-token": "Required", "sap-error-code": "CSRF_TOKEN_VALIDATION_FAILED"},
                "body": "CSRF token validation failed"
            },
            "icf_services": [
                {"service_path": "/sap/opu/odata/sap/API_SALES_ORDER_SRV", "is_active": False}
            ],
            "su53_traces": [
                {"auth_object": "S_SERVICE", "return_code": 4, "field_values": {"SRV_NAME": "API_SALES_ORDER_SRV"}}
            ]
        })
    )
    resp_2a = await fiori_engine.analyze(req_2a)
    rule_ids_2a = {f.rule_id for f in resp_2a.findings}
    assert "FIORI_CSRF_TOKEN_INVALID" in rule_ids_2a
    assert "FIORI_ICF_INACTIVE" in rule_ids_2a
    assert "FIORI_AUTH_OBJECT_MISSING" in rule_ids_2a
    print("  [PASS] Fiori engine successfully isolated multi-layer cascading failures.")

    # Probe 2B: Fallback unlogged proxy / missing telemetry
    req_2b = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000003",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.FIORI_403_ROOT_CAUSE_DOCTOR,
        raw_content=json.dumps({
            "http_response": {
                "status_code": 403,
                "method": "GET",
                "url": "/sap/bc/ui5_ui5/ui2/ushell/shells/abap/FioriLaunchpad.html",
                "headers": {},
                "body": "<html>403 Forbidden - Proxy error</html>"
            }
        })
    )
    resp_2b = await fiori_engine.analyze(req_2b)
    assert any(f.rule_id == "FIORI_403_INSUFFICIENT_TELEMETRY" for f in resp_2b.findings)
    demoted_f = next(f for f in resp_2b.findings if f.rule_id == "FIORI_403_INSUFFICIENT_TELEMETRY")
    assert demoted_f.confidence == ConfidenceClass.UNKNOWN
    assert demoted_f.confidence_score == 0.30
    print("  [PASS] Fiori engine correctly demoted missing telemetry to UNKNOWN (0.30).")

    # 3. WorkflowDeadlockEngine Stress
    wf_engine = EngineRegistry.get(EngineType.WORKFLOW_STUCK_EXPLAINER)
    print("Testing WorkflowDeadlockEngine...")

    # Probe 3A: Deadlock detection with multiple waiting items
    req_3a = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000004",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.WORKFLOW_STUCK_EXPLAINER,
        raw_content=json.dumps({
            "swwwihead": [
                {"wi_id": "0000100001", "wi_type": "W", "wi_stat": "WAITING"},
                {"wi_id": "0000100002", "wi_type": "W", "wi_stat": "WAITING"}
            ]
        })
    )
    resp_3a = await wf_engine.analyze(req_3a)
    assert any(f.rule_id == "WF_DEADLOCK_DETECTED" for f in resp_3a.findings)
    print("  [PASS] Workflow deadlock across parallel waiting steps detected.")

    # 4. IAMCostEngine Stress
    iam_engine = EngineRegistry.get(EngineType.IAM_COST_OPTIMIZER)
    print("Testing IAMCostEngine...")

    # Probe 4A: All apps are Advanced -> No counterfactual escalation
    req_4a = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000005",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.IAM_COST_OPTIMIZER,
        raw_content=json.dumps({
            "roles": [
                {"role_name": "Z_ALL_ADVANCED", "catalogs": ["CAT_ADV"], "assigned_users": ["USER1", "USER2"]}
            ],
            "catalogs": [
                {"catalog_id": "CAT_ADV", "apps": ["FB01", "FB08", "FB50", "MIGO", "MIRO"]}
            ]
        })
    )
    resp_4a = await iam_engine.analyze(req_4a)
    escalation_findings = [f for f in resp_4a.findings if f.rule_id == "IAM_LICENSE_TIER_INFLATION_DRIVER"]
    assert len(escalation_findings) == 0, "Should not report single app escalation when ALL apps are Advanced!"
    print("  [PASS] IAM engine correctly recognizes authentic Advanced role composition.")

    # 5. AccountDeterminationEngine Stress
    acct_engine = EngineRegistry.get(EngineType.ACCOUNT_DETERMINATION_PREFLIGHT)
    print("Testing AccountDeterminationEngine...")

    # Probe 5A: Account blocked at Company Code level vs Chart of Accounts level
    req_5a = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000006",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.ACCOUNT_DETERMINATION_PREFLIGHT,
        raw_content=json.dumps({
            "chart_of_accounts": "CA01",
            "company_code": "1000",
            "obyc_rules": [
                {"chart_of_accounts": "CA01", "transaction_key": "BSX", "valuation_class": "3000", "gl_account": "140000"}
            ],
            "ska1_accounts": [
                {"chart_of_accounts": "CA01", "gl_account": "140000", "xsperr": False}
            ],
            "skb1_accounts": [
                {"company_code": "1000", "gl_account": "140000", "xsperr": True}
            ]
        })
    )
    resp_5a = await acct_engine.analyze(req_5a)
    assert any(f.rule_id == "ACCT_DET_ACCOUNT_BLOCKED_POSTING" for f in resp_5a.findings)
    block_f = next(f for f in resp_5a.findings if f.rule_id == "ACCT_DET_ACCOUNT_BLOCKED_POSTING")
    assert block_f.technical_details["blockLevel"] == "COMPANY_CODE"
    print("  [PASS] Account determination accurately isolates Company Code posting block.")

    # 6. SystemRefreshEngine Stress
    refresh_engine = EngineRegistry.get(EngineType.SYSTEM_REFRESH_DELTA_GUARD)
    print("Testing SystemRefreshEngine...")

    # Probe 6A: Clean isolation vs hazardous RFC destinations
    req_6a = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000007",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.SYSTEM_REFRESH_DELTA_GUARD,
        raw_content=json.dumps({
            "policy": {"target_sid": "QAS", "production_sids": ["PRD"]},
            "post_refresh": {
                "sid": "QAS",
                "client": "100",
                "rfc_destinations": [
                    {"destination": "PRD_RFC", "target_host": "sap-prd-app01.corp", "sysid": "PRD"},
                    {"destination": "DUMMY_RFC", "target_host": "qa-mock.corp", "sysid": "QAS"}
                ],
                "scot": {"smtp_active": True, "routing_domain": "*"},
                "logical_systems": [
                    {"client": "100", "logical_system": "PRDCLNT100", "bdls_executed": False}
                ],
                "jobs": [
                    {"job_name": "SAP_F110_PAYMENT_RUN", "status": "S"}
                ]
            }
        })
    )
    resp_6a = await refresh_engine.analyze(req_6a)
    rule_ids_6a = {f.rule_id for f in resp_6a.findings}
    assert "REFRESH_RFC_TARGETS_PRODUCTION" in rule_ids_6a
    assert "REFRESH_SCOT_OUTBOUND_ACTIVE" in rule_ids_6a
    assert "REFRESH_LOGICAL_SYSTEM_UNADJUSTED" in rule_ids_6a
    assert "REFRESH_CRITICAL_JOB_SCHEDULED" in rule_ids_6a
    score_6a = resp_6a.metrics.additional_metrics.get("isolationRiskScore")
    assert score_6a == 10.0, f"Expected max capped isolation score 10.0, got {score_6a}"
    print(f"  [PASS] System refresh isolation hazards correctly aggregated, score: {score_6a}")

    print("--- All Empirical Stress Probes PASSED Successfully! ---")

if __name__ == "__main__":
    asyncio.run(run_stress_probes())
