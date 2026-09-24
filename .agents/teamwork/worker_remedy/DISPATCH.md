## 2026-09-24T21:56:06Z

You are Worker Remedy (teamwork_preview_worker).
Your working directory is H:/erppreflight/.agents/teamwork/worker_remedy.
You MUST read the original user request at H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md before starting.
Also review H:/erppreflight/AGENTS.md, H:/erppreflight/.agents/teamwork/orchestrator_1/PROJECT.md, and H:/erppreflight/.agents/teamwork/orchestrator_1/GATE_STATUS.md.

CRITICAL INPUTS - Read the verified handoff blueprints from the 3 remediation explorers:
1. Item 1: ClamAV scanner detection order in H:/erppreflight/.agents/teamwork/explorer_remedy_1/handoff.md
2. Item 2 & 3: JWT Cookie decoder try/catch & URL resolution hardening in H:/erppreflight/.agents/teamwork/explorer_remedy_2/handoff.md
3. Item 4: Playwright E2E spec refactoring for genuine Next.js app testing in H:/erppreflight/.agents/teamwork/explorer_remedy_3/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE SCOPE:
- apps/api/src/modules/ingestion/clamav.scanner.ts
- apps/api/src/modules/auth/strategies/jwt.strategy.ts
- apps/web/src/lib/api/custom-instance.ts
- playwright.config.ts
- tests/e2e/preflight-pipeline.spec.ts

TASKS:
1. Apply Item 1 in `apps/api/src/modules/ingestion/clamav.scanner.ts`:
   - Check `trimmed.includes('FOUND')` FIRST.
   - Require clean files to match `stream: OK` or end with `OK` without `FOUND`, `ERROR`, or `NOT OK`.
   - Fail closed when `!this.isMockMode` on any unrecognized response or error.
2. Apply Item 2 in `apps/api/src/modules/auth/strategies/jwt.strategy.ts`:
   - Wrap `decodeURIComponent(match[1])` in `try { return decodeURIComponent(match[1]); } catch { return null; }`.
3. Apply Item 3 in `apps/web/src/lib/api/custom-instance.ts`:
   - Implement the hardened `resolveApiUrl()` from `explorer_remedy_2/handoff.md` handling whitespace trimming, slash normalization, query string preservation, and deduplication of `/api/v1`.
4. Apply Item 4 in `playwright.config.ts` and `tests/e2e/preflight-pipeline.spec.ts`:
   - Add `webServer` config to `playwright.config.ts` (`pnpm --filter @erppreflight/web dev` on port 3000).
   - In `tests/e2e/preflight-pipeline.spec.ts`: eliminate all inline HTML mocking; serve genuine Next.js pages; intercept only `**/api/v1/**` when offline; verify natural Set-Cookie header; assert line 23 for `<Table name="Channel">`; expand finding row to mount `FindingDetailRow` and verify SHA-256 evidence.

VERIFICATION:
Execute and verify:
- `pnpm --filter @erppreflight/api test` (must pass 100%, including `empirical_challenger1_stress.spec.ts` and `ingestion_security.spec.ts`)
- `pnpm --filter @erppreflight/web test` (must pass 100%, including `empirical_url_resolution_stress.test.ts` and `url-resolution.test.ts`)
- `pytest services/analysis-python/tests -v` (must pass 100%, 501 tests)
- `pnpm run test:e2e` (must pass 100% against real Next.js application)
- `pnpm run typecheck` (0 errors across all 12 packages)
- `pnpm run lint` (0 errors)
- `node scripts/check-no-production-facades.mjs` (0 violations)

Document all changes, test commands, and exact outputs in `H:/erppreflight/.agents/teamwork/worker_remedy/handoff.md`.
Send completion message to parent when done.
