# Progress: Milestone M1 (worker_m1_lab)

Last visited: 2026-09-25T05:32:00Z
Status: COMPLETED

## Steps
- [x] Step 1: Initialize DISPATCH.md and workspace
- [x] Step 2: Establish BRIEFING.md and local copies of skills
- [x] Step 3: Implement domain contracts in `packages/schemas/src/lab.ts` and export in `packages/schemas/src/index.ts`
- [x] Step 4: Refactor and enhance `apps/api/src/modules/lab/` (lab.module.ts, lab.controller.ts, lab.service.ts, DTOs):
  - Added project-scoped routing `@Controller(['lab', 'projects/:id/lab'])`
  - Replaced in-memory string-matching facade with genuine live Python microservice dispatch (`POST /api/v1/analyze`) using `ANALYSIS_SERVICE_URL`
  - Generated realistic synthetic fixture templates matching actual engine expectations (`OPD_GUARD`, `FORM_DOCTOR`, `MFS_BLACKBOX`, `CHANGE_POINTER_COVERAGE_AUDITOR`)
  - Constructed comprehensive regression assertion ledger comparing expected vs actual findings with SHA-256 evidence
  - Persisted scenarios and run results to `synthetic_scenarios` PostgreSQL table with tenant RLS isolation
- [x] Step 5: Implement interactive frontend test workbench in `apps/web/src/app/projects/[id]/lab/page.tsx`
  - Full domain switcher for OPD, FORM, MFS, CHANGE_POINTER
  - Interactive payload editor with dirty-state tracking, copy, and reset
  - Non-color SeverityBadge and ConfidenceBadge integration (Cardinal Axiom 1 compliant)
  - Regression assertion ledger table with pass/fail status, verdict, metrics, and expandable evidence drawer
  - Preflight findings inspector with cryptographic SHA-256 and line coordinates
  - Saved scenarios drawer
- [x] Step 6: Verify with unit tests, typecheck, lint, and anti-facade checks
  - `pnpm --filter @erppreflight/api test src/modules/lab/`: 10 passed (100%)
  - `pnpm --filter @erppreflight/api test test/lab_and_baselines.spec.ts`: 6 passed (100%)
  - `pnpm run typecheck`: 12/12 packages passed (100%)
  - `pnpm run build`: 7/7 build targets passed (100%)
  - `pnpm run check:no-production-facades`: PASSED (100%)
  - `pnpm run check:deps`: PASSED (100%)
  - `py -m pytest services/analysis-python/tests -q`: 501 passed (100%)
- [x] Step 7: Write m1_report.md and handoff.md, notify orchestrator
