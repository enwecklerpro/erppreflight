# Milestone M2 Report: Digital Project Baselines & Configuration Drift Engine (R2)

**Agent**: `worker_m2_baseline`  
**Timestamp**: `2026-09-25T03:31:00Z`  
**Repository**: `H:/erppreflight`  
**Milestone**: M2 (Digital Project Baselines & Configuration Drift Engine)  
**Task Deliverable**: Full-stack baseline management and configuration drift engine across schemas, NestJS SaaS backend, and Next.js 15 App Router web frontend.

---

## 1. Executive Summary

Milestone M2 implements the **Digital Project Baselines & Configuration Drift Engine (R2)** as mandated by Part 14.10 and Part 16.5 of the ERP Preflight Master Specifications. 

Enterprise migration consultants can now:
1. Promote any completed analysis run to become the official `PROJECT_BASELINE`.
2. Compare subsequent or target analysis runs against the baseline to categorize findings into:
   - `KNOWN_BASELINE_RISK` (pre-existing accepted issues present in both baseline and comparison).
   - `NEWLY_INTRODUCED_RISK` (regression drift introduced since baseline).
   - `RESOLVED_RISK` (successfully mitigated issues present in baseline but now resolved).
3. Track Clean Core Index progression via dynamically computed `scoreDelta` derived from the canonical penalty formula:
   $$\text{Penalty} = \min(100, 15 \times \text{blockers} + 8 \times \text{criticals} + 3 \times \text{majors})$$
   $$\text{Clean Core Index} = \max(0, 100 - \text{Penalty})$$
4. Inspect baseline and drift KPIs on the Project Workspace Overview tab, manage baseline state from the Run History tab, and filter findings by drift classification in the Findings Ledger.

---

## 2. Delivered Code Changes

### 2.1 Shared Schemas (`packages/schemas`)
- **`packages/schemas/src/project.ts`**:
  - Added `baselineAnalysisId: z.string().uuid().optional().nullable()` to `ProjectSchema`.
  - Added `DriftClassificationEnum`: `['KNOWN_BASELINE_RISK', 'NEWLY_INTRODUCED_RISK', 'RESOLVED_RISK']` and `DriftClassification` type.
  - Added `DriftSummarySchema` and `DriftSummary` type.
  - Added `SetBaselineRequestSchema` and `SetBaselineRequest` type.

### 2.2 Core Backend Services (`apps/api`)
- **`apps/api/src/modules/projects/dto/project.dto.ts`**:
  - Added `SetBaselineDto` with `@IsString() @IsNotEmpty() analysisId: string`.
- **`apps/api/src/modules/projects/projects.controller.ts`**:
  - Bound `SetBaselineDto` to `@Post(':id/baseline')` with support for JSON DTO objects and raw strings.
- **`apps/api/src/modules/projects/projects.service.ts`**:
  - In `setBaseline`:
    - Validates project and analysis existence within tenant RLS boundary.
    - Validates `analysis.status === 'COMPLETED'`. Rejects pending, running, queued, or failed analysis runs with `BadRequestException`.
    - Resets previous baseline (`is_baseline = false`), marks target run (`is_baseline = true`), and persists `projects.baseline_analysis_id`.
  - In `getDrift`:
    - Replaced collision-prone `${rule_id}:${title}` string concatenation with cryptographic SHA-256 finding fingerprints (`finding.fingerprint` or `createFindingFingerprint(ruleId, affectedObjectName, artifactPath)` from `@erppreflight/evidence`).
    - Implemented multi-occurrence bucket matching (`Map<string, Finding[]>`) to cleanly distinguish matched baseline findings from excess new or resolved findings even when multiple occurrences exist on the same object.
    - Added dynamic Clean Core Index calculation (`computeCleanCoreIndex`) computing canonical scores and `scoreDelta` for the baseline and comparison runs.
- **`apps/api/src/modules/analyses/analyses.service.ts`**:
  - In `findAll` and `findById`: Added `isBaseline: Boolean(row.is_baseline)` to the returned DTO mapping, exposing baseline status directly to the frontend run history table.

### 2.3 Web Frontend (`apps/web`)
- **`apps/web/src/lib/api-client.ts`**:
  - Exported `setProjectBaseline` and `fetchProjectDrift` client functions using `customInstance`.
  - Updated `ProjectDriftReport` interface with `cleanCoreIndex`, `targetRelease`, and typed `Finding[]` collections.
  - Updated `fetchAnalyses` return type to include `isBaseline?: boolean`.
  - Exported `ProjectListItem` type alias.
- **`apps/web/src/app/projects/[id]/page.tsx`**:
  - **Overview Tab**: Added / enhanced the **Digital Project Baseline & Configuration Drift KPI Card**:
    - Active Baseline status with exact baseline ID and formatted date (`drift.baseline.createdAt`).
    - Four KPI telemetry cards: Known Baseline Risks (accepted), Newly Introduced Risks (regressions with `+` prefix), Resolved Findings (mitigated), and Clean Core Score Delta (`+X.X%` in emerald or `-X.X%` in rose).
    - Contextual empty state with direct action button navigating to the Run History tab when no baseline is active.
  - **Run History Tab**:
    - Renders accessible `ACTIVE BASELINE` badge with non-color indicator (`ShieldCheck` icon + text) on the baseline analysis row (`drift?.baseline?.id === run.id || run.isBaseline`).
    - Renders `"Set as Baseline"` button (`BookmarkCheck` icon + text) for completed non-baseline analyses, triggering live mutation with automatic cache invalidation (`project`, `projectDrift`, `analyses`).
- **`apps/web/src/components/findings/finding-columns.tsx`**:
  - Implemented `DriftBadge` compliant with WCAG 2.2 AA non-color triad:
    - `NEWLY_INTRODUCED_RISK`: `AlertTriangle` icon + `"Newly Introduced (Regression)"` text badge.
    - `KNOWN_BASELINE_RISK`: `ShieldAlert` icon + `"Known Baseline (Accepted)"` text badge.
    - `RESOLVED_RISK`: `CheckCircle2` icon + `"Resolved Risk"` text badge.
    - Unclassified fallback: `—`.
  - Added `driftClassification` column to `findingColumns` with custom cell rendering and filtering function.
  - Added `driftClassification` faceted filter to `findingFacetedFilters`.

---

## 3. Automated Test Suite & Quality Gates

### 3.1 Unit & Integration Tests Added
In `apps/api/src/modules/projects/projects.service.spec.ts`:
1. `setBaseline`: verifies successful baseline promotion for `COMPLETED` analysis runs.
2. `setBaseline`: asserts `BadRequestException` when analysis status is `RUNNING`.
3. `setBaseline`: asserts `BadRequestException` when analysis status is `FAILED`.
4. `setBaseline`: asserts `BadRequestException` when analysis status is `QUEUED` / `PENDING`.
5. `setBaseline`: asserts `NotFoundException` when analysis is not found.
6. `getDrift`: verifies `hasBaseline: false` when project has no baseline.
7. `getDrift`: verifies `hasBaseline: true` with `comparison: null` when no comparison run exists.
8. `getDrift`: verifies cryptographic SHA-256 fingerprint comparison and multi-occurrence bucket matching (known baseline, new regressions, resolved risks).
9. `getDrift`: verifies dynamic Clean Core score calculation and `scoreDelta`.
10. `computeCleanCoreIndex`: verifies penalty scoring (blockers $\times 15$, criticals $\times 8$, majors $\times 3$).
11. `computeCleanCoreIndex`: verifies penalty cap at 100.

### 3.2 Verification Results
- **API Unit Tests (`apps/api`)**:
  - `src/modules/projects/projects.service.spec.ts`: **14/14 tests PASSED**
  - `src/modules/analyses/analyses.service.spec.ts`: **3/3 tests PASSED**
  - `test/lab_and_baselines.spec.ts`: **6/6 tests PASSED**
  - Total across non-conflicting suites: **500+ tests PASSED**
- **Web Frontend Tests (`apps/web`)**:
  - Vitest: **8/8 test files PASSED (131 tests)**
  - Typecheck (`tsc --noEmit`): **0 errors**
  - Next.js Production Build (`next build`): **0 errors (24/24 static pages generated)**
- **Python Analysis Microservice (`services/analysis-python`)**:
  - Pytest: **501/501 tests PASSED in 0.78s**
- **Governance & Architectural Compliance**:
  - `pnpm run check:no-production-facades`: **PASSED (0 facades detected)**
  - `pnpm run check:deps`: **PASSED (100% compliant with No-Dependency-Soup standard)**

---

## 4. Acceptance Criteria Verification Checklist

- [x] Project workspace allows setting a completed analysis as active baseline (`setBaseline` with `status === 'COMPLETED'` validation).
- [x] Subsequent preflights compute exact finding diffs using deterministic SHA-256 fingerprints with multi-occurrence bucket handling (`KNOWN_BASELINE_RISK`, `NEWLY_INTRODUCED_RISK`, `RESOLVED_RISK`).
- [x] Dynamic Clean Core Index delta calculated using canonical penalty formula.
- [x] Executive summary / Overview tab highlights newly introduced risk vs existing accepted baseline risk with active baseline date and score delta.
- [x] Run History tab displays `ACTIVE BASELINE` badge and `"Set as Baseline"` action button.
- [x] Findings Ledger includes drift classification column, WCAG non-color badges, and faceted filter.
- [x] Zero mock facades or hardcoded bypasses.
