# Dispatch Assignment: m3_d5_challenger_1

- **Agent**: `m3_d5_challenger_1`
- **Archetype**: `teamwork_preview_challenger`
- **Role**: Domain 5 Operations & Runtime Challenger
- **Working Directory**: `H:/erppreflight/.agents/m3_d5_challenger_1`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`
- **Timestamp**: 2026-09-24T12:35:00+02:00

## Objective
Author and execute an adversarial empirical stress test harness in `.agents/m3_d5_challenger_1/test_adversarial_domain5.py` to rigorously challenge all 6 Domain 5 Operations & Runtime Preflight Engines:
1. Feature 30: `DecommissionAuditEngine`
2. Feature 31: `Fiori403Engine`
3. Feature 32: `WorkflowStuckEngine`
4. Feature 33: `IAMCostEngine`
5. Feature 34: `AccountDeterminationEngine`
6. Feature 35: `SystemRefreshEngine`

## Authoritative Inputs
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/m3_d5_worker_implementation/handoff.md`
- `services/analysis-python/src/engines/decommission_audit.py`
- `services/analysis-python/src/engines/fiori_auth_guard.py`
- `services/analysis-python/src/engines/workflow_deadlock.py`
- `services/analysis-python/src/engines/iam_cost_guard.py`
- `services/analysis-python/src/engines/account_determination.py`
- `services/analysis-python/src/engines/system_refresh_guard.py`
- `services/analysis-python/tests/unit/test_domain5_engines.py`

## Adversarial Challenge Vectors
1. Multi-artifact corruption: truncated CSVs, missing headers, empty payloads, malformed JSON, and unexpected delimiters.
2. Boundary stress:
   - Safe Decommission: extreme risk score calculations (all active vs all inactive), 10,000+ user records.
   - Fiori 403: complex decision-tree edge cases, overlapping authorization error traces, missing SICF nodes.
   - Workflow Deadlock: complex cyclic wait graphs, multi-agent deadlock loops, corrupt container dumps.
   - IAM Cost Guard: dense role-catalog bipartite graphs, overlapping license tier escalation, circular composite roles.
   - Account Determination: combinatorial chart-of-accounts matrices, missing G/L accounts, inactive posting keys.
   - System Refresh Guard: subtle RFC destination mutations, mixed case logical system IDs, partial masking patterns.
3. Cryptographic evidence verification: SHA-256 validity across all emitted findings, line/column veracity.
4. Epistemic confidence invariants: missing evidence demotion to UNKNOWN (0.30), AI ceiling (0.60).

## Execution Commands
```powershell
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH
py -3.13 -m pytest .agents/m3_d5_challenger_1/test_adversarial_domain5.py -v
py -3.13 -m pytest services/analysis-python/tests/unit/test_domain5_engines.py -v
py -3.13 -m pytest services/analysis-python/tests -q
```
Conclude with explicit binary verdict (`APPROVE` or `REQUEST_CHANGES`) in `handoff.md`.
Maintain `progress.md` with timestamps.
When done, call `send_message` to parent (`b18c0539-d6d7-4a41-968f-58324775ab38`).
