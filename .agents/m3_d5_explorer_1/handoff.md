# Domain 5 Handoff Report: Safe Decommission & System Refresh Engines

> **Agent**: `m3_d5_explorer_1` (Teamwork Explorer — Domain 5 Operations)  
> **Working Directory**: `H:/erppreflight/.agents/m3_d5_explorer_1`  
> **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`  
> **Target Scope**: Feature 30 (`Safe Decommission & Archiving Readiness Engine`) & Feature 35 (`System Refresh & Data Masking Sanity Guard`)  
> **Handoff Type**: Hard (Task Complete)

---

## 1. Observation

1. **Existing Engine Stubs in Production Repository**:
   - Inspected `services/analysis-python/src/engines/safe_decommission.py` (lines 1–24):
     ```python
     @register_engine
     class SafeDecommissionEngine(BaseEngine):
         engine_type = EngineType.SAFE_DECOMMISSION_PREFLIGHT
         ...
         async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
             return AnalysisResponse(..., findings=[], metrics=AnalysisMetrics(rules_evaluated=12, artifacts_scanned=1))
     ```
   - Inspected `services/analysis-python/src/engines/system_refresh.py` (lines 1–24):
     ```python
     @register_engine
     class SystemRefreshEngine(BaseEngine):
         engine_type = EngineType.SYSTEM_REFRESH_DELTA_GUARD
         ...
         async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
             return AnalysisResponse(..., findings=[], metrics=AnalysisMetrics(rules_evaluated=17, artifacts_scanned=1))
     ```
   - Both engines were non-functional placeholders returning empty findings lists without artifact parsing or rule evaluation, violating Cardinal Axiom 2.

2. **Authoritative Specification Requirements**:
   - `H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md` Section 13 (lines 965–1020) and Section 18 (lines 1320–1385):
     - Safe Decommission requires multi-artifact parsing for user master (`USR02`), background jobs (`TBTCO/TBTCP`), RFC destinations (`RFCDES`), workflows (`SWWWIHEAD`), and audit logs (`SM20/ST03N`).
     - Required finding codes: `DECOM_SCHEDULED_JOB_DEPENDENCY`, `DECOM_ACTIVE_RFC_DEPENDENCY`, `DECOM_WORKFLOW_AGENT_DEPENDENCY`.
     - System Refresh requires pre-refresh vs post-refresh differential comparison for RFC destinations, SCOT email routing, logical systems (`BD54/T000`), background jobs (`TBTCO`), and spool printers (`SPAD`).
     - Required finding codes: `REFRESH_RFC_TARGETS_PRODUCTION`, `REFRESH_SCOT_OUTBOUND_ACTIVE`, `REFRESH_LOGICAL_SYSTEM_UNADJUSTED`.

3. **Peer Agent Division of Labor**:
   - `H:/erppreflight/.agents/m3_d5_explorer_2/DISPATCH.md`: Assigned Feature 31 (`fiori_auth_guard.py`) and Feature 32 (`workflow_deadlock.py`).
   - `H:/erppreflight/.agents/m3_d5_explorer_3/DISPATCH.md`: Assigned Feature 33 (`iam_cost_guard.py`), Feature 34 (`account_determination.py`), fixture generation (`generate_domain5_fixtures.py`), and test harness (`proposed_test_domain5_engines.py`).
   - `m3_d5_explorer_1` (this agent): Owns the foundational architecture blueprint for Features 30 & 35, and the production engine implementations in `proposed_decommission_audit.py` and `proposed_system_refresh_guard.py`.

4. **Execution Environment & Python Launcher**:
   - Monorepo `package.json` line 13: `"test:python": "py -m pytest services/analysis-python/tests -v"`.
   - Python launcher command `py` is active on Windows.

---

## 2. Logic Chain

1. **Step 1: Architectural Blueprinting**  
   - Based on Observation 1 and 2, authored `domain5_decom_refresh_blueprint.md` in `H:/erppreflight/.agents/m3_d5_explorer_1/`.
   - Mapped all 14 points of Cardinal Axiom 2 for both Feature 30 and Feature 35.
   - Designed mathematical scoring algorithms for Decommission Risk Score ($S_{\text{decom}} \in [0.0, 10.0]$) and Isolation Risk Score ($S_{\text{iso}} \in [0.0, 10.0]$).
   - Formulated automated Reassignment Action Checklists and Post-Refresh Remediation Runbooks mapping directly to standard SAP transaction codes (`SM36/SM37`, `SM59`, `SWIA/SBWP`, `SU01`, `BDLS`, `SCOT`, `BTCTRNS1`, `SPAD`).

2. **Step 2: Safe Decommission Engine Implementation (`proposed_decommission_audit.py`)**  
   - Created `DecommissionAuditEngine` implementing `EngineType.SAFE_DECOMMISSION_PREFLIGHT`.
   - Implemented multi-format parsing for:
     - `USR02`: User master record, user types (`A`, `B`, `C`, `S`, `X`), lock status (`UFLAG`), last logon (`TRDAT`).
     - `TBTCO`: Background job headers, execution users (`AUTHNAME`), schedulers (`SDLUNAME`), status (`P`, `S`, `R`, `Y`), periodic flags.
     - `RFCDES`: RFC destinations, destination types, logon user credentials, target hosts.
     - `SWWWIHEAD`: Pending workflow work items (`READY`, `SELECTED`, `STARTED`), assigned agents, actual agents.
     - `SM20 / ST03N`: Audit logs, transaction executions, failed authentication attempts.
   - Evaluated 7 deterministic rules:
     - `DECOM_USER_NOT_FOUND` (CRITICAL)
     - `DECOM_SCHEDULED_JOB_DEPENDENCY` (CRITICAL / BLOCKER)
     - `DECOM_ACTIVE_RFC_DEPENDENCY` (CRITICAL)
     - `DECOM_WORKFLOW_AGENT_DEPENDENCY` (MAJOR / CRITICAL)
     - `DECOM_RECENT_ACTIVITY_DETECTED` (MAJOR)
     - `DECOM_LOCKED_USER_CALL_FLOOD` (CRITICAL)
     - `DECOM_SAFE_FOR_ARCHIVING` (INFO)
   - Bounded Decommission Risk Score (0.0 to 10.0) based on weighted active dependencies.
   - Integrated deterministic line/column locator `_locate_line_in_text()` and bound cryptographic `EvidenceEngine.create_evidence()` items with SHA-256 digests.
   - Passed all findings through `ConfidenceClassifier.classify()`.

3. **Step 3: System Refresh & Data Masking Sanity Guard Implementation (`proposed_system_refresh_guard.py`)**  
   - Created `SystemRefreshEngine` implementing `EngineType.SYSTEM_REFRESH_DELTA_GUARD`.
   - Implemented differential analysis comparing pre-refresh baseline vs post-refresh target snapshot across:
     - `RFCDES`: RFC destinations pointing to production hostnames/IPs or production SIDs.
     - `SCOT`: Active outbound SMTP routing without central test redirection or test domain restrictions.
     - `BD54 / T000`: Unconverted client logical system names or incomplete `BDLS` execution.
     - `TBTCO`: Sensitive production batch jobs (`*F110*`, `*PAYMENT*`, `*BILLING*`, `*EDI*`, `*IDOC*`, `*BANK*`) left active post-refresh.
     - `SPAD`: Physical production network printers remaining configured in test spoolers.
   - Evaluated 7 deterministic rules:
     - `REFRESH_INPUT_SID_MISMATCH` (BLOCKER)
     - `REFRESH_RFC_TARGETS_PRODUCTION` (CRITICAL)
     - `REFRESH_SCOT_OUTBOUND_ACTIVE` (CRITICAL)
     - `REFRESH_LOGICAL_SYSTEM_UNADJUSTED` (CRITICAL)
     - `REFRESH_CRITICAL_JOB_SCHEDULED` (CRITICAL)
     - `REFRESH_PRODUCTION_PRINTER_ACTIVE` (MAJOR)
     - `REFRESH_ISOLATION_VERIFIED` (INFO)
   - Bounded Isolation Risk Score (0.0 to 10.0) and compiled post-refresh remediation runbook (`BDLS`, `SM59`, `SCOT`, `BTCTRNS1`, `SPAD`).

4. **Step 4: Empirical Validation & Boundary Hardening**  
   - Executed verification suite via `py`:
     - Positive test cases verified: clean safe decommission outputs `DECOM_SAFE_FOR_ARCHIVING` with risk score 0.0; clean isolated QA refresh outputs `REFRESH_ISOLATION_VERIFIED` with isolation score 0.0.
     - Negative test cases verified: job/RFC dependencies trigger `DECOM_SCHEDULED_JOB_DEPENDENCY` and `DECOM_ACTIVE_RFC_DEPENDENCY` with risk score 10.0; production targets trigger `REFRESH_RFC_TARGETS_PRODUCTION` and `REFRESH_SCOT_OUTBOUND_ACTIVE` with risk score 10.0.
     - Edge cases verified: missing target user in USR02 triggers `DECOM_USER_NOT_FOUND` and suppresses false `DECOM_SAFE_FOR_ARCHIVING`; SID mismatch triggers `REFRESH_INPUT_SID_MISMATCH` with severity BLOCKER.

---

## 3. Caveats

1. **Production Tree Integration**: In accordance with explorer read-only constraints, code was authored in `H:/erppreflight/.agents/m3_d5_explorer_1/` rather than overwriting `services/analysis-python/src/engines/` directly. Peer agents (`m3_d5_explorer_3`, challengers, and the Domain 5 implementation worker) can seamlessly import or copy `proposed_decommission_audit.py` and `proposed_system_refresh_guard.py`.
2. **Multi-Client Isolation in Monorepo Backend**: Both engines inspect single-client or multi-client snapshots as provided in the analysis payload. Cross-tenant PostgreSQL row-level security (RLS) remains the responsibility of `apps/api` via `@erppreflight/tenancy`.
3. **External Cloud Connector Destinations**: RFC HTTP destinations (`Type H/G`) referencing external cloud URLs (e.g., SAP BTP, Concur, Ariba) require regex patterns in `production_host_patterns` to identify production cloud tenant URLs.

---

## 4. Conclusion

Features 30 and 35 have been thoroughly designed, drafted, and verified to production standards:
- `domain5_decom_refresh_blueprint.md` provides an authoritative, complete architectural specification.
- `proposed_decommission_audit.py` replaces the empty stub in `services/analysis-python/src/engines/safe_decommission.py` with an audit-grade, multi-artifact evaluation engine computing Decommission Risk Scores and generating Reassignment Action Checklists.
- `proposed_system_refresh_guard.py` replaces the empty stub in `services/analysis-python/src/engines/system_refresh.py` with a differential landscape isolation guard preventing production target leakage, customer email spamming, and logical system corruption.
- Both engines pass 100% of positive, negative, and edge-case test validations and are ready for integration into the Domain 5 test harness and production codebase.

---

## 5. Verification Method

To independently verify the deliverables, execute the following commands from `H:/erppreflight`:

### 1. Test Importability
```bash
py -c "import sys; sys.path.insert(0, 'services/analysis-python'); sys.path.insert(0, '.agents/m3_d5_explorer_1'); import proposed_decommission_audit as pda; import proposed_system_refresh_guard as psr; print('Engines imported successfully!')"
```

### 2. Execute Automated Functional & Edge-Case Verification Suite
```bash
py -c "import asyncio, json, sys
sys.path.insert(0, 'services/analysis-python')
sys.path.insert(0, '.agents/m3_d5_explorer_1')
import proposed_decommission_audit as pda
import proposed_system_refresh_guard as psr
from src.models.request import AnalysisRequest
from src.models.enums import EngineType

async def verify():
    # 1. Decommission negative test
    e1 = pda.DecommissionAuditEngine()
    r1 = await e1.analyze(AnalysisRequest(
        job_id='v-1', tenant_id='t-1', project_id='p-1',
        engine_type=EngineType.SAFE_DECOMMISSION_PREFLIGHT,
        raw_content=json.dumps({
            'target_user': 'BATCH_ADMIN',
            'usr02': [{'bname': 'BATCH_ADMIN', 'user_type': 'B', 'lock_status': 0, 'last_logon_date': '2026-09-20'}],
            'tbtco': [{'job_name': 'SAP_BILLING_DAILY', 'exec_user': 'BATCH_ADMIN', 'status': 'P', 'periodic': True}],
            'rfcdes': [{'destination': 'RFC_CRM_SYNC', 'username': 'BATCH_ADMIN', 'target_host': 'crm.corp'}],
            'swwwihead': [{'wi_id': '1001', 'assigned_agent': 'BATCH_ADMIN', 'status': 'READY'}],
        })
    ))
    rule_ids1 = [f.rule_id for f in r1.findings]
    assert 'DECOM_SCHEDULED_JOB_DEPENDENCY' in rule_ids1
    assert 'DECOM_ACTIVE_RFC_DEPENDENCY' in rule_ids1
    assert 'DECOM_WORKFLOW_AGENT_DEPENDENCY' in rule_ids1
    assert 'DECOM_RECENT_ACTIVITY_DETECTED' in rule_ids1
    assert r1.metrics.additional_metrics['decommissionRiskScore'] == 10.0

    # 2. Decommission positive test
    r2 = await e1.analyze(AnalysisRequest(
        job_id='v-2', tenant_id='t-1', project_id='p-1',
        engine_type=EngineType.SAFE_DECOMMISSION_PREFLIGHT,
        raw_content=json.dumps({
            'target_user': 'OLD_USER',
            'usr02': [{'bname': 'OLD_USER', 'user_type': 'A', 'lock_status': 0, 'last_logon_date': '2025-01-01'}],
        })
    ))
    assert [f.rule_id for f in r2.findings] == ['DECOM_SAFE_FOR_ARCHIVING']

    # 3. System Refresh negative test
    e2 = psr.SystemRefreshEngine()
    r3 = await e2.analyze(AnalysisRequest(
        job_id='v-3', tenant_id='t-1', project_id='p-1',
        engine_type=EngineType.SYSTEM_REFRESH_DELTA_GUARD,
        raw_content=json.dumps({
            'isolation_policy': {'target_sid': 'QAS', 'target_client': '100'},
            'post_refresh': {
                'sid': 'QAS', 'client': '100',
                'rfc_destinations': [{'destination': 'BANK_GW', 'target_host': 'prod-bank.acme.corp'}],
                'scot': {'smtp_active': True, 'routing_domain': '*'},
                'logical_systems': [{'client': '100', 'logical_system': 'PRDCLNT100', 'bdls_executed': False}],
                'jobs': [{'job_name': 'SAP_F110_AUTO_PAY', 'status': 'S'}]
            }
        })
    ))
    rule_ids3 = [f.rule_id for f in r3.findings]
    assert 'REFRESH_RFC_TARGETS_PRODUCTION' in rule_ids3
    assert 'REFRESH_SCOT_OUTBOUND_ACTIVE' in rule_ids3
    assert 'REFRESH_LOGICAL_SYSTEM_UNADJUSTED' in rule_ids3
    assert 'REFRESH_CRITICAL_JOB_SCHEDULED' in rule_ids3

    # 4. System Refresh positive test
    r4 = await e2.analyze(AnalysisRequest(
        job_id='v-4', tenant_id='t-1', project_id='p-1',
        engine_type=EngineType.SYSTEM_REFRESH_DELTA_GUARD,
        raw_content=json.dumps({
            'isolation_policy': {'target_sid': 'QAS', 'target_client': '100'},
            'post_refresh': {
                'sid': 'QAS', 'client': '100',
                'rfc_destinations': [{'destination': 'BANK_GW', 'target_host': 'qa-bank.acme.corp'}],
                'scot': {'smtp_active': True, 'redirect_all_to': 'qa-catchall@test.corp'},
                'logical_systems': [{'client': '100', 'logical_system': 'QASCLNT100', 'bdls_executed': True}],
            }
        })
    ))
    assert [f.rule_id for f in r4.findings] == ['REFRESH_ISOLATION_VERIFIED']

    print('VERIFICATION PASSED: All 4 engine assertions verified successfully.')

asyncio.run(verify())
"
```

### 3. Invalidation Conditions
The conclusion would be invalidated if:
1. `DecommissionAuditEngine` fails to flag an active recurring background job or active RFC destination when `target_user` is specified.
2. `SystemRefreshEngine` fails to detect an RFC destination pointing to a production hostname (`*prd*` or `*prod*`) or permits un-redirected active SMTP routing in a non-prod system.
3. Cryptographic evidence hashes emitted by either engine fail SHA-256 verification against the source payload snippet.
4. Any engine introduces non-deterministic random seed drift or unhandled exceptions on malformed input bytes.
