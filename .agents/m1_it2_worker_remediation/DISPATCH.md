## 2026-09-24T01:57:38Z
You are m1_it2_worker_remediation, working in directory H:/erppreflight/.agents/m1_it2_worker_remediation.

MANDATORY: Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md before starting work.
Also read:
- H:/erppreflight/.agents/orchestrator_main/PROJECT.md
- H:/erppreflight/.agents/orchestrator_main/GATE_STATUS.md
- H:/erppreflight/.agents/m1_it2_explorer_1/rls_fix_plan.md
- H:/erppreflight/.agents/m1_it2_explorer_2/confidence_fix_plan.md
- H:/erppreflight/.agents/m1_it2_explorer_3/schema_alignment_plan.md
- H:/erppreflight/.agents/m1_it2_explorer_2/proposed_confidence.py
- H:/erppreflight/.agents/m1_it2_explorer_2/proposed_runner.py
- H:/erppreflight/.agents/m1_it2_explorer_2/proposed_finding.py
- H:/erppreflight/.agents/m1_it2_explorer_2/proposed_test_confidence.py
- H:/erppreflight/.agents/m1_it2_explorer_2/proposed_test_runner.py

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write Ownership:
You own and must implement changes in:
- `packages/database/src/client.ts` and `apps/api/src/modules/database/database.service.ts`
- `apps/api/test/tenant_isolation.spec.ts` (and update existing api tests)
- `services/analysis-python/src/platform/confidence.py`
- `services/analysis-python/src/core/runner.py`
- `services/analysis-python/src/models/finding.py`
- `services/analysis-python/tests/test_confidence.py`
- `services/analysis-python/tests/test_runner.py`
- `packages/schemas/src/` (jobs.ts, findings.ts, evidence.ts)
- `apps/api/src/modules/jobs/jobs.service.ts`

NOTE on environment: In PowerShell, prepend C:\Users\SKAF\AppData\Roaming\npm to $env:PATH when running pnpm.

Execution Steps:
1. Implement RLS Transaction Scoping per `rls_fix_plan.md`:
   - In `packages/database/src/client.ts` and `apps/api/src/modules/database/database.service.ts`, implement `withTenantTransaction(tenantId, callback)` ensuring `BEGIN`, `SET LOCAL app.current_tenant_id = $1`, execution, `COMMIT`, safe rollback, and client release.
   - Update `query()` to safely wrap queries with tenant context inside a transaction or dedicated checkout.
   - Add/update `apps/api/test/tenant_isolation.spec.ts` to empirically verify tenant isolation across concurrent requests.
2. Implement Epistemic Confidence Invariant Fixes per `confidence_fix_plan.md`:
   - Apply `proposed_confidence.py`, `proposed_runner.py`, `proposed_finding.py`, `proposed_test_confidence.py`, and `proposed_test_runner.py` to `services/analysis-python`.
   - Verify missing evidence demotes unconditionally to `UNKNOWN (0.30)`, AI outputs are capped at `INFERRED (0.60)`, and `EngineRunner.execute` propagates AI flags.
3. Implement Wire Schema Alignment per `schema_alignment_plan.md`:
   - In `@erppreflight/schemas`, support dual camelCase / snake_case parsing and wire serialization.
   - In NestJS `jobs.service.ts`, use canonical `toWireJobRequest()` for communicating with the Python analysis service.
4. Run Verifications:
   - In PowerShell: prepend C:\Users\SKAF\AppData\Roaming\npm to $env:PATH
   - `pnpm run build` (must pass cleanly with 0 TypeScript errors)
   - `pnpm test` (all Vitest tests including tenant isolation and contracts must pass)
   - `py -m pytest services/analysis-python/tests -v` (all unit and adversarial tests must pass)
   - `py -3.12 -m pytest tests/e2e/` (verify E2E test suite remains 100% passing)

Document all commands, code changes, and test results in H:/erppreflight/.agents/m1_it2_worker_remediation/handoff.md.
Maintain progress.md with timestamps.
When done, call send_message to parent (conversation ID: b18c0539-d6d7-4a41-968f-58324775ab38).
