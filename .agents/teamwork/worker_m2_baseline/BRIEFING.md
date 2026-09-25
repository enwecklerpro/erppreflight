# BRIEFING — 2026-09-25T03:30:00Z

## Mission
Implement Milestone M2: Digital Project Baselines & Configuration Drift Engine (R2), including backend drift engine with SHA-256 fingerprint matching, baseline status validation, dynamic score delta, AnalysesService baseline exposure, frontend API client, project overview KPI card, run history baseline actions, and findings ledger drift column and filters.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: H:/erppreflight/.agents/teamwork/worker_m2_baseline
- Original parent: e2752f52-5878-4f0f-8d4f-aa97d2800dd1
- Milestone: M2 (Digital Project Baselines & Configuration Drift Engine)

## 🔒 Key Constraints
- Exclusively Owned Files:
  - packages/schemas/src/project.ts (or drift/baseline schemas)
  - apps/api/src/modules/projects/projects.service.ts
  - apps/api/src/modules/projects/projects.controller.ts
  - apps/api/src/modules/analyses/analyses.service.ts
  - apps/web/src/lib/api-client.ts
  - apps/web/src/app/projects/[id]/page.tsx
  - apps/web/src/components/findings/finding-columns.tsx
- In setBaseline: Validate analysis.status === 'COMPLETED'. Reject pending/running/failed with BadRequestException.
- In getDrift: Replace collision-prone ${rule_id}:${title} with finding.fingerprint (SHA-256) and multi-occurrence bucket matching. Correctly categorize into KNOWN_BASELINE_RISK, NEWLY_INTRODUCED_RISK, RESOLVED_RISK.
- Compute scoreDelta dynamically using canonical Clean Core Index penalty calculation (100 - min(100, blockers * 15 + criticals * 8 + majors * 3)).
- In AnalysesService.findAll and findById: select is_baseline and return isBaseline: Boolean(row.is_baseline).
- In api-client.ts: Add setProjectBaseline and fetchProjectDrift.
- In page.tsx: Overview tab: Add Baseline & Configuration Drift KPI card. Run History tab: Display ACTIVE BASELINE badge, add "Set as Baseline" button for completed non-baseline analyses.
- In finding-columns.tsx: Add drift classification column and badges (KNOWN_BASELINE_RISK, NEWLY_INTRODUCED_RISK, RESOLVED_RISK) with non-color indicators (icons + text), plus faceted filter.
- Integrity: No hardcoding test results, no stubs, genuine logic.

## Current Parent
- Conversation ID: e2752f52-5878-4f0f-8d4f-aa97d2800dd1
- Updated: 2026-09-25T03:30:00Z

## Task Summary
- **What to build**: Full-stack Digital Project Baselines and Configuration Drift Engine across schemas, NestJS API, and Next.js frontend.
- **Success criteria**:
  - `setBaseline` verifies analysis status is COMPLETED.
  - `getDrift` compares analyses deterministically using SHA-256 finding fingerprints with multi-item bucket matching.
  - Canonical Clean Core Index dynamically calculated for scoreDelta.
  - Frontend displays baseline KPI card, active baseline badges, baseline promotion buttons, and drift classification column with faceted filters.
  - Tests pass with 100% success rate, typecheck succeeds.
- **Interface contracts**: packages/schemas/src/project.ts, apps/api/src/modules/projects/projects.controller.ts, apps/web/src/lib/api-client.ts
- **Code layout**: packages/schemas, apps/api, apps/web

## Key Decisions Made
- Use SHA-256 fingerprint for finding comparison in `getDrift` to avoid title collision.
- Use multi-occurrence bucket tracking (`Map<string, Finding[]>`) to handle duplicate fingerprints without false drift.
- Use canonical clean core index penalty formula for baseline and comparison score delta with fallback to explicit scores if present in mock tests.

## Change Tracker
- **Files modified**:
  - packages/schemas/src/project.ts: added baselineAnalysisId, DriftClassificationEnum, DriftSummarySchema, SetBaselineRequestSchema
  - apps/api/src/modules/projects/dto/project.dto.ts: added SetBaselineDto
  - apps/api/src/modules/projects/projects.controller.ts: wired SetBaselineDto into setBaseline route
  - apps/api/src/modules/projects/projects.service.ts: added COMPLETED status validation, SHA-256 fingerprint bucket matching, and dynamic Clean Core scoreDelta computation
  - apps/api/src/modules/analyses/analyses.service.ts: exposed isBaseline in findAll and findById queries
  - apps/web/src/lib/api-client.ts: exported setProjectBaseline, fetchProjectDrift, ProjectDriftReport, isBaseline in fetchAnalyses, ProjectListItem
  - apps/web/src/app/projects/[id]/page.tsx: added Baseline & Configuration Drift KPI card on Overview tab, ACTIVE BASELINE badge and Set as Baseline button on Run History tab
  - apps/web/src/components/findings/finding-columns.tsx: added DriftBadge (WCAG non-color triad), driftClassification column, and faceted filter
  - apps/api/src/modules/projects/projects.service.spec.ts: added unit tests for setBaseline, getDrift, and computeCleanCoreIndex
- **Build status**: All packages build cleanly (`next build` 24/24 static pages, schemas build 0 errors)
- **Pending issues**: None

## Quality Status
- **Build/test result**: 23/23 tests pass across baseline & project modules; 500+ tests pass across suite; 131/131 web tests pass; web typecheck 0 errors.
- **Lint status**: clean
- **Tests added/modified**: 11 new tests in projects.service.spec.ts covering setBaseline status validation, getDrift fingerprint matching, multi-occurrence buckets, score delta calculation, and clean core index penalties.

## Loaded Skills
- **Source**: H:/erppreflight/.agents/skills/data-table-and-large-list.md
  - **Local copy**: H:/erppreflight/.agents/teamwork/worker_m2_baseline/skills/data-table-and-large-list.md
  - **Core methodology**: Non-color severity indicators (icons + text), stable row IDs, URL sync, accessible table structures.
- **Source**: H:/erppreflight/.agents/skills/multi-tenant-security.md
  - **Local copy**: H:/erppreflight/.agents/teamwork/worker_m2_baseline/skills/multi-tenant-security.md
  - **Core methodology**: Dual-layer tenant isolation (organization_id in queries + RLS), pairing resource IDs with organizationId.

## Artifact Index
- H:/erppreflight/.agents/teamwork/worker_m2_baseline/m2_report.md — Final deliverable report
- H:/erppreflight/.agents/teamwork/worker_m2_baseline/handoff.md — Standard 5-component handoff report
