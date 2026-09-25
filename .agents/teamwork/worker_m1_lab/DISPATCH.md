## 2026-09-25T03:19:53Z

You are worker_m1_lab, an implementation subagent.
Your working directory is: H:/erppreflight/.agents/teamwork/worker_m1_lab
Original request file: H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md
Project plan: H:/erppreflight/.agents/teamwork/orchestrator_2/PROJECT.md
Survey report: H:/erppreflight/.agents/teamwork/survey_explorer_1/survey_r1_report.md
Survey handoff: H:/erppreflight/.agents/teamwork/survey_explorer_1/handoff.md
Engineering skills to follow:
- H:/erppreflight/.agents/skills/frontend-design-system.md
- H:/erppreflight/.agents/skills/engine-authoring.md

Your task is to implement Milestone M1: Scenario & Regression Test Lab (R1):
1. Exclusively Owned Files:
   - packages/schemas/src/lab.ts
   - packages/schemas/src/index.ts
   - apps/api/src/modules/lab/lab.controller.ts
   - apps/api/src/modules/lab/lab.service.ts
   - apps/api/src/modules/lab/lab.module.ts
   - apps/web/src/app/projects/[id]/lab/page.tsx
   - apps/web/src/app/projects/[id]/layout.tsx (or navigation link to Lab)

2. Key Deliverables:
   - packages/schemas/src/lab.ts: Define Zod domain contracts for OPD, FORM, MFS, CHANGE_POINTER domains, synthetic generation, live run execution, and regression assertion ledger. Export in packages/schemas/src/index.ts.
   - apps/api/src/modules/lab/lab.controller.ts: Add project-scoped routing (@Controller(['lab', 'projects/:id/lab'])) supporting POST /api/v1/projects/:id/lab/generate and POST /api/v1/projects/:id/lab/run.
   - apps/api/src/modules/lab/lab.service.ts: Eliminate the in-memory string-matching facade! Replace with real live execution that dispatches requests to services/analysis-python (POST /api/v1/analyze) using ANALYSIS_SERVICE_URL. Generate realistic synthetic fixture templates matching actual engine expectations (opd_guard, form_doctor, mfs_blackbox, change_pointer). Compare actual findings vs expected findings to build regression assertion ledger (ruleId, ruleName, expected, actual, passed, severity, message). Persist to synthetic_scenarios table in PostgreSQL.
   - apps/web/src/app/projects/[id]/lab/page.tsx: Implement the full interactive Test Lab UI with domain selector, fixture generator, live preflight trigger, pass/fail regression assertion ledger, loading skeletons, error states, and non-color severity indicators (SeverityBadge). Ensure compliance with Cardinal Axiom 1.
   - Verify: Run unit tests and typecheck.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write your report to H:/erppreflight/.agents/teamwork/worker_m1_lab/m1_report.md
and handoff to H:/erppreflight/.agents/teamwork/worker_m1_lab/handoff.md.
Send a message when complete.
