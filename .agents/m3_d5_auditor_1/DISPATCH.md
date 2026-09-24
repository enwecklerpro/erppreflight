# Dispatch Assignment: m3_d5_auditor_1

- **Agent**: `m3_d5_auditor_1`
- **Archetype**: `teamwork_preview_auditor`
- **Role**: Domain 5 Forensic Integrity Auditor
- **Working Directory**: `H:/erppreflight/.agents/m3_d5_auditor_1`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`
- **Timestamp**: 2026-09-24T12:35:00+02:00

## Objective
Execute an exhaustive forensic integrity audit of all 6 Domain 5 Operations & Runtime Preflight Engines:
- Feature 30: `decommission_audit.py`
- Feature 31: `fiori_auth_guard.py`
- Feature 32: `workflow_deadlock.py`
- Feature 33: `iam_cost_guard.py`
- Feature 34: `account_determination.py`
- Feature 35: `system_refresh_guard.py`
and the test suite `services/analysis-python/tests/unit/test_domain5_engines.py`.

## Authoritative Inputs
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/m3_d5_worker_implementation/handoff.md`

## Forensic Audit Protocol
1. Anti-Cheat & Authenticity Inspection:
   - Check for hardcoded findings, simulated logic, dummy shortcuts, or test result mirroring.
   - Verify that all algorithms (decision-tree diagnosis, cyclic wait graph analysis, license tier calculations, G/L posting key validation, and configuration diffing) are genuine, working code.
2. 14-Point Engine Anatomy Verification (Cardinal Axiom 2):
   - Canonical engine metadata & registration in `EngineRegistry`
   - Strict Pydantic input schemas
   - Deterministic parser & pure rule evaluation
   - Standard finding taxonomy
   - Cryptographic line-coordinate SHA-256 evidence generation
   - Epistemic confidence classification (VERIFIED 1.0, RULE_DERIVED 0.85, INFERRED 0.60, UNKNOWN 0.30)
   - Zero test skips, zero xfails, zero disabled lints
3. Dynamic Probes & Monorepo Health:
   ```powershell
   $env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH
   py -3.13 -m ruff check services/analysis-python/src/engines/decommission_audit.py services/analysis-python/src/engines/fiori_auth_guard.py services/analysis-python/src/engines/workflow_deadlock.py services/analysis-python/src/engines/iam_cost_guard.py services/analysis-python/src/engines/account_determination.py services/analysis-python/src/engines/system_refresh_guard.py
   py -3.13 -m pytest services/analysis-python/tests/unit/test_domain5_engines.py -v
   py -3.13 -m pytest services/analysis-python/tests -q
   pnpm test
   pnpm run build
   pnpm run typecheck
   ```
4. Conclude with explicit binary verdict (`CLEAN` or `INTEGRITY VIOLATION`) in `handoff.md`.
5. Maintain `progress.md` with timestamps.
6. When done, call `send_message` to parent (`b18c0539-d6d7-4a41-968f-58324775ab38`).
