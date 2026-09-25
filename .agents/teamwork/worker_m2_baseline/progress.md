# Progress Log — worker_m2_baseline

Last visited: 2026-09-25T03:30:30Z

## Status
- [x] Initialized DISPATCH.md, BRIEFING.md, and local skill references
- [x] Inspect existing files and tests
- [x] Update packages/schemas (project.ts with baselineAnalysisId and Drift schemas)
- [x] Update apps/api backend:
  - [x] projects.dto.ts (SetBaselineDto)
  - [x] projects.controller.ts (SetBaselineDto mounted on @Post(':id/baseline'))
  - [x] projects.service.ts (status validation, SHA-256 fingerprint matching, multi-occurrence buckets, dynamic Clean Core scoreDelta)
  - [x] analyses.service.ts (isBaseline selected and returned in findAll and findById)
- [x] Update apps/web frontend:
  - [x] api-client.ts (setProjectBaseline, fetchProjectDrift, ProjectDriftReport, isBaseline in fetchAnalyses, ProjectListItem)
  - [x] page.tsx (Overview KPI card with baseline date & drift stats, Run History ACTIVE BASELINE badge and Set as Baseline button)
  - [x] finding-columns.tsx (DriftBadge non-color indicator, driftClassification column, drift faceted filter)
- [x] Add comprehensive unit tests in projects.service.spec.ts (14/14 tests pass)
- [x] Verify:
  - [x] apps/web vitest: 8/8 test files passed (131 tests)
  - [x] apps/web typecheck: 0 errors
  - [x] apps/web build (`next build`): 0 errors, 24/24 static pages
  - [x] Python pytest suite: 501/501 tests pass
  - [x] anti-facade gate: 100% pass
  - [x] no-dependency-soup check: 100% pass
- [ ] Generate m2_report.md and handoff.md
- [ ] Notify parent orchestrator
