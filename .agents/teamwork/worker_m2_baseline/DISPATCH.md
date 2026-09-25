## 2026-09-25T03:20:00Z
You are worker_m2_baseline, an implementation subagent.
Your working directory is: H:/erppreflight/.agents/teamwork/worker_m2_baseline
Original request file: H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md
Project plan: H:/erppreflight/.agents/teamwork/orchestrator_2/PROJECT.md
Survey report: H:/erppreflight/.agents/teamwork/survey_explorer_2/survey_r2_report.md
Survey handoff: H:/erppreflight/.agents/teamwork/survey_explorer_2/handoff.md
Engineering skills to follow:
- H:/erppreflight/.agents/skills/data-table-and-large-list.md
- H:/erppreflight/.agents/skills/multi-tenant-security.md

Your task is to implement Milestone M2: Digital Project Baselines & Configuration Drift Engine (R2):
1. Exclusively Owned Files:
   - packages/schemas/src/project.ts (or drift/baseline schemas)
   - apps/api/src/modules/projects/projects.service.ts
   - apps/api/src/modules/projects/projects.controller.ts
   - apps/api/src/modules/analyses/analyses.service.ts
   - apps/web/src/lib/api-client.ts
   - apps/web/src/app/projects/[id]/page.tsx
   - apps/web/src/components/findings/finding-columns.tsx

2. Key Deliverables:
   - apps/api/src/modules/projects/projects.service.ts:
     - In setBaseline: Validate analysis.status === 'COMPLETED'. Reject pending/running/failed analyses with BadRequestException.
     - In getDrift: Replace collision-prone ${rule_id}:${title} with finding.fingerprint (SHA-256) and multi-occurrence bucket matching. Correctly categorize findings into KNOWN_BASELINE_RISK, NEWLY_INTRODUCED_RISK, and RESOLVED_RISK.
     - Compute scoreDelta dynamically using the canonical Clean Core Index penalty calculation (100 - min(100, blockers * 15 + criticals * 8 + majors * 3)).
   - apps/api/src/modules/analyses/analyses.service.ts:
     - In findAll and findById: select is_baseline and return isBaseline: Boolean(row.is_baseline).
   - apps/web/src/lib/api-client.ts:
     - Add setProjectBaseline and fetchProjectDrift functions.
   - apps/web/src/app/projects/[id]/page.tsx:
     - In Overview tab: Add Baseline & Configuration Drift KPI card (active baseline date, Clean Core score delta, new risks count, resolved risks count).
     - In Run History tab: Display ACTIVE BASELINE badge on the baseline analysis row; add "Set as Baseline" button for completed non-baseline analyses.
   - apps/web/src/components/findings/finding-columns.tsx:
     - Add drift classification column and badges (KNOWN_BASELINE_RISK, NEWLY_INTRODUCED_RISK, RESOLVED_RISK) with non-color indicators (icons + text).
     - Add faceted filter for drift classification in findings table.
   - Verify: Run unit tests and typecheck.
