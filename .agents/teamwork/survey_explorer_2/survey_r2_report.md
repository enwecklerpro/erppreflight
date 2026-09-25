# Architectural Survey & Investigation Report: Requirement R2
## Digital Project Baselines & Configuration Drift Engine

**Agent**: `survey_explorer_2`  
**Timestamp**: `2026-09-25T03:17:30Z`  
**Target Repository**: `H:/erppreflight`  
**Requirement Reference**: `H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md` (Section `## 2026-09-25T03:10:02Z`, Requirement R2)

---

## 1. Executive Summary

Requirement R2 mandates **Digital Project Baselines & Configuration Drift Engine**, enabling consultants and enterprise teams to:
1. Mark any completed analysis run as the official `PROJECT_BASELINE`.
2. Compare subsequent analysis runs against the baseline to deterministically categorize findings into:
   - `KNOWN_BASELINE_RISK` (pre-existing accepted issues present in baseline and still present).
   - `NEWLY_INTRODUCED_RISK` (regression drift introduced since baseline).
   - `RESOLVED_RISK` (successfully mitigated issues present in baseline but now absent).
3. Visualize before/after drift metrics and score deltas in the project overview and findings ledger.

### Key Investigation Discoveries:
1. **Database Schema**: A migration `packages/database/migrations/006_baselines_and_lab.sql` already created columns `analyses.is_baseline BOOLEAN NOT NULL DEFAULT false` and `projects.baseline_analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL`. However, `@erppreflight/schemas` does not reflect `baselineAnalysisId` in `ProjectSchema` or `isBaseline` in `AnalysisSchema`.
2. **Current Backend Logic**: `ProjectsService.setBaseline()` and `ProjectsService.getDrift()` already exist in `apps/api/src/modules/projects/projects.service.ts` and are mounted in `projects.controller.ts` (`POST :id/baseline`, `GET :id/drift`).
3. **Critical Defect in Drift Matching**: The current matching algorithm in `projects.service.ts` uses `const key = `${f.rule_id || f.ruleId}:${f.title}`;`. This causes catastrophic collision where multiple violations of the same rule (e.g. 5 missing OPD determination steps across 5 output types) overwrite each other in the `Map`, destroying finding granularity. The correct identity must use the cryptographic `findings.fingerprint` (SHA-256 of `ruleId:affectedObjectName:artifactPath`).
4. **Clean Core Score Delta Bug**: `projects.service.ts` attempts to calculate `scoreDelta` by subtracting `baselineAnalysis.clean_core_score`, but `clean_core_score` does NOT exist as a column on `analyses` table, always evaluating to `0 - 0 = 0`. The Clean Core Index must be computed dynamically using the canonical formula from `findings.service.ts`.
5. **Missing Invalidation & Analysis Visibility**: `AnalysesService.findAll` and `findById` do NOT return `isBaseline: row.is_baseline`, so the frontend has no way to know which analysis in the history list is the active baseline without making additional requests.
6. **Frontend Absence**: The web frontend (`apps/web`) has zero integration for baselines or drift. There are no API client functions, no TanStack query keys, no baseline badge in run history, no "Set as Baseline" action, no drift KPI cards on overview, and no drift classification column or filter in the findings ledger.

---

## 2. Deep Dive: Database Schemas & Persistence Models

### 2.1 Existing Database Schema (PostgreSQL)

Located in `packages/database/migrations/006_baselines_and_lab.sql`:
```sql
-- 1. Extend analyses with is_baseline flag
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN NOT NULL DEFAULT false;

-- 2. Extend projects with baseline_analysis_id reference
ALTER TABLE projects ADD COLUMN IF NOT EXISTS baseline_analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL;
```

Related tables in `packages/database/migrations/001_initial_schema.sql`:
- **`projects`**:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `organization_id UUID NOT NULL REFERENCES organizations(id)`
  - `name VARCHAR(255) NOT NULL`
  - `target_release VARCHAR(50) NOT NULL DEFAULT 'S4H_2023'`
  - `baseline_analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL` *(added by migration 006)*
- **`analyses`**:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `organization_id UUID NOT NULL REFERENCES organizations(id)`
  - `project_id UUID NOT NULL REFERENCES projects(id)`
  - `status VARCHAR(50) NOT NULL DEFAULT 'QUEUED'` ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL')
  - `is_baseline BOOLEAN NOT NULL DEFAULT false` *(added by migration 006)*
  - `engine_types JSONB NOT NULL DEFAULT '[]'`
  - `completed_at TIMESTAMPTZ`
- **`findings`**:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `organization_id UUID NOT NULL`
  - `project_id UUID NOT NULL`
  - `analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE`
  - `engine VARCHAR(100) NOT NULL`
  - `rule_id VARCHAR(100) NOT NULL`
  - `severity VARCHAR(50) NOT NULL`
  - `category VARCHAR(100) NOT NULL`
  - `title VARCHAR(500) NOT NULL`
  - `description TEXT NOT NULL`
  - `confidence_class VARCHAR(50) NOT NULL`
  - `confidence_score NUMERIC(4,3) NOT NULL DEFAULT 1.000`
  - `remediation TEXT`
  - `affected_objects JSONB NOT NULL DEFAULT '[]'`
  - `technical_details JSONB NOT NULL DEFAULT '{}'`
  - `fingerprint VARCHAR(64) NOT NULL` *(cryptographic SHA-256 fingerprint)*
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

### 2.2 Schema Gaps in `@erppreflight/schemas`

In `packages/schemas/src/project.ts`:
- `ProjectSchema` lacks `baselineAnalysisId`:
```typescript
// CURRENT (packages/schemas/src/project.ts):
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  targetRelease: TargetReleaseEnum.default('S4H_2023'),
  environments: z.array(EnvironmentTierEnum).default(['DEV']),
  createdBy: z.string().uuid().optional().nullable(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

// REQUIRED:
export const ProjectSchema = z.object({
  // ...
  baselineAnalysisId: z.string().uuid().optional().nullable(),
  // ...
});
```

In `packages/schemas/src/analysis.ts`:
- No response schema exposes `isBaseline: boolean`.

Missing Domain Schema:
- Neither `packages/schemas/src/finding.ts` nor a new drift schema defines `DriftClassificationEnum`:
```typescript
export const DriftClassificationEnum = z.enum([
  'KNOWN_BASELINE_RISK',
  'NEWLY_INTRODUCED_RISK',
  'RESOLVED_RISK',
]);
export type DriftClassification = z.infer<typeof DriftClassificationEnum>;
```

---

## 3. Finding Identity & Comparison Logic (Drift Engine)

### 3.1 Flaws in the Current Comparison Logic

In `apps/api/src/modules/projects/projects.service.ts` (lines 190–200):
```typescript
// CURRENT CODE:
const baselineMap = new Map<string, any>();
baselineFindings.forEach((f: any) => {
  const key = `${f.rule_id || f.ruleId}:${f.title}`;
  baselineMap.set(key, f);
});

const comparisonMap = new Map<string, any>();
comparisonFindings.forEach((f: any) => {
  const key = `${f.rule_id || f.ruleId}:${f.title}`;
  comparisonMap.set(key, f);
});
```

#### Why this is fundamentally broken:
1. **Map Key Collision**: If an analysis produces 10 findings for rule `OPD_DETERMINATION_STEP_MISSING`, all with the generic title `"Determination step missing in Output Parameter Determination"`, `baselineMap.set(key, f)` will overwrite previous findings. The map contains only 1 entry instead of 10!
2. **Loss of SAP Object and Artifact Identity**: A finding on SAP Form `MM_PURCHASE_ORDER` will match and collide with a finding on SAP Form `SD_BILLING_INVOICE`. If one is fixed and the other remains, the drift engine will fail to identify which one changed.
3. **Ignores Cryptographic Evidence**: ERP Preflight Cardinal Axiom 2 mandates pure rule evaluation and cryptographic evidence chains. Every finding is already required to have a deterministic `fingerprint`.

### 3.2 Canonical Finding Identity: Cryptographic Fingerprint

`packages/evidence/src/hashing.ts` already provides the canonical identity generator:
```typescript
export function createFindingFingerprint(
  ruleId: string,
  affectedObjectName: string,
  artifactPath: string
): string {
  return calculateSha256(`${ruleId.trim()}:${affectedObjectName.trim()}:${artifactPath.trim()}`);
}
```

In `apps/api/src/modules/jobs/analysis.processor.ts` (lines 172–175), every finding inserted into the database already has this 64-character SHA-256 fingerprint:
```typescript
const firstObjName = f.affectedObjects[0]?.name || 'GLOBAL';
const firstArtifact = f.evidence[0]?.artifactPath || 'UNKNOWN_SOURCE';
const fingerprint =
  f.fingerprint ||
  createFindingFingerprint(f.ruleId, firstObjName, firstArtifact);
```

#### Deterministic Drift Key Rule:
```typescript
function getFindingKey(f: any): string {
  if (f.fingerprint && typeof f.fingerprint === 'string' && f.fingerprint.trim().length > 0) {
    return f.fingerprint.trim();
  }
  const ruleId = f.rule_id || f.ruleId || 'UNKNOWN_RULE';
  const objName =
    (Array.isArray(f.affected_objects) && f.affected_objects[0]?.name) ||
    (Array.isArray(f.affectedObjects) && f.affectedObjects[0]?.name) ||
    (typeof f.affected_objects?.[0] === 'string' ? f.affected_objects[0] : null) ||
    'GLOBAL';
  const artifactPath =
    (Array.isArray(f.evidence) && f.evidence[0]?.artifact_path) ||
    (Array.isArray(f.evidence) && f.evidence[0]?.artifactPath) ||
    'UNKNOWN_SOURCE';

  return createFindingFingerprint(ruleId, objName, artifactPath);
}
```

#### Multi-Occurrence Handling:
What if multiple findings in the same analysis have the exact same fingerprint (e.g. multiple distinct violations within the same file for the same object)?
A Map of arrays (`Map<string, Finding[]>`) should be used:
```typescript
const baselineMap = new Map<string, any[]>();
for (const f of baselineFindings) {
  const key = getFindingKey(f);
  if (!baselineMap.has(key)) baselineMap.set(key, []);
  baselineMap.get(key)!.push(f);
}

const comparisonMap = new Map<string, any[]>();
for (const f of comparisonFindings) {
  const key = getFindingKey(f);
  if (!comparisonMap.has(key)) comparisonMap.set(key, []);
  comparisonMap.get(key)!.push(f);
}
```
For each key:
- If `compList.length > 0` and `baseList.length > 0`:
  - `min(compList.length, baseList.length)` items are classified as `KNOWN_BASELINE_RISK`.
  - If `compList.length > baseList.length`, the extra items are `NEWLY_INTRODUCED_RISK`.
  - If `baseList.length > compList.length`, the unconsumed baseline items are `RESOLVED_RISK`.
- If key is only in `comparisonMap`: all items are `NEWLY_INTRODUCED_RISK`.
- If key is only in `baselineMap`: all items are `RESOLVED_RISK`.

### 3.3 Clean Core Score Delta Calculation

In `projects.service.ts` line 248:
```typescript
// CURRENT BUG:
scoreDelta: Number((comparisonAnalysis.clean_core_score || 0) - (baselineAnalysis.clean_core_score || 0))
```
Because `clean_core_score` does not exist on `analyses`, this always returns `0`.

The canonical Clean Core Index formula (from `apps/api/src/modules/findings/findings.service.ts:199-200`):
```typescript
export function computeCleanCoreIndex(findings: any[]): number {
  if (!findings || findings.length === 0) return 100;

  let blockers = 0;
  let criticals = 0;
  let majors = 0;

  for (const f of findings) {
    const sev = (f.severity || '').toUpperCase();
    if (sev === 'BLOCKER') blockers++;
    else if (sev === 'CRITICAL') criticals++;
    else if (sev === 'MAJOR') majors++;
  }

  const penalty = Math.min(100, blockers * 15 + criticals * 8 + majors * 3);
  return Math.max(0, Math.round((100 - penalty) * 10) / 10);
}
```
Then in `getDrift()`:
```typescript
const baselineScore = computeCleanCoreIndex(baselineFindings);
const comparisonScore = computeCleanCoreIndex(comparisonFindings);
const scoreDelta = Math.round((comparisonScore - baselineScore) * 10) / 10;
```
If comparison has fewer defects, `scoreDelta` is positive (e.g. `+15.0%`), indicating Clean Core quality improvement. If regressions were introduced, `scoreDelta` is negative (e.g. `-23.0%`).

---

## 4. API Endpoints & Request/Response Contracts

### 4.1 Current Endpoints

In `apps/api/src/modules/projects/projects.controller.ts`:
- **`POST /api/v1/projects/:id/baseline`**:
  ```typescript
  @Post(':id/baseline')
  async setBaseline(
    @CurrentTenant() tenantId: string,
    @Param('id') projectId: string,
    @Body('analysisId') analysisId: string
  )
  ```
- **`GET /api/v1/projects/:id/drift`**:
  ```typescript
  @Get(':id/drift')
  async getDrift(
    @CurrentTenant() tenantId: string,
    @Param('id') projectId: string,
    @Query('targetAnalysisId') targetAnalysisId?: string
  )
  ```

### 4.2 Gaps and Required Fixes

1. **Validation of Analysis Status**:
   - `ProjectsService.setBaseline()` must assert that `analysis.status === 'COMPLETED'`. If an analysis is `RUNNING` or `FAILED`, it should throw `BadRequestException('Only COMPLETED analysis runs can be marked as the official project baseline.')`.
2. **DTO Validation**:
   - Introduce `SetBaselineDto` with `@IsUUID() @IsNotEmpty() analysisId: string`.
3. **Analyses Service Enhancement**:
   - In `apps/api/src/modules/analyses/analyses.service.ts`:
     - Update `findAll`: include `isBaseline: Boolean(row.is_baseline)` in the returned mapping.
     - Update `findById`: include `isBaseline: Boolean(row.is_baseline)` in the returned mapping.
4. **Dedicated Baseline Endpoint**:
   - Add `GET /api/v1/projects/:id/baseline`:
     Returns the current baseline analysis details, findings count, clean core index, and baseline timestamp.
5. **Clear/Unset Baseline Endpoint**:
   - Add `DELETE /api/v1/projects/:id/baseline`:
     Unsets `projects.baseline_analysis_id` and sets `analyses.is_baseline = false` for that project.
6. **Consistent JSON Mapping**:
   - Format `baseline` and `comparison` objects in `getDrift` with camelCase fields (`createdAt`, `totalFindings`, `cleanCoreIndex`, `targetRelease`).
   - Format findings with full finding fields (including `evidence`, `affectedObjects`, `fingerprint`, and `driftClassification`).

---

## 5. Web Frontend Integration (`apps/web`)

### 5.1 Architecture & Playbook Compliance
Under `AGENTS.md` and `frontend-design-system.md`:
- **Cardinal Axiom 1**: Real TanStack Query state, Zod runtime schema validation, error boundaries, loading skeletons, accessible non-color severity indicators, responsive layout.
- **No Duplicate Libraries**: Use Lucide icons, Tailwind CSS, TanStack Query, and Base UI / custom components.

### 5.2 Required Changes in `apps/web/src/lib/`

1. **API Client (`apps/web/src/lib/api-client.ts`)**:
   Add functions:
   ```typescript
   export interface DriftSummary {
     knownBaselineRisks: number;
     newlyIntroducedRisks: number;
     resolvedRisks: number;
     scoreDelta: number;
   }

   export interface DriftAnalysisInfo {
     id: string;
     name?: string;
     createdAt: string;
     totalFindings: number;
     cleanCoreIndex: number;
     targetRelease?: string;
   }

   export interface DriftReport {
     hasBaseline: boolean;
     message?: string;
     baseline: DriftAnalysisInfo | null;
     comparison: DriftAnalysisInfo | null;
     driftSummary: DriftSummary;
     findings: {
       knownBaseline: Finding[];
       newlyIntroduced: Finding[];
       resolved: Finding[];
     };
   }

   export async function setProjectBaseline(projectId: string, analysisId: string): Promise<{ success: boolean; baselineAnalysisId: string }> {
     return customInstance(`/projects/${projectId}/baseline`, {
       method: 'POST',
       body: JSON.stringify({ analysisId }),
     });
   }

   export async function fetchProjectDrift(projectId: string, targetAnalysisId?: string): Promise<DriftReport> {
     const qs = targetAnalysisId ? `?targetAnalysisId=${targetAnalysisId}` : '';
     return customInstance<DriftReport>(`/projects/${projectId}/drift${qs}`);
   }
   ```

2. **Query Keys (`apps/web/src/lib/query/query-keys.ts`)**:
   Add to `queryKeys.projects`:
   ```typescript
   baseline: (projectId: string) => [...queryKeys.projects.detail(projectId), 'baseline'] as const,
   drift: (projectId: string, targetAnalysisId?: string) =>
     [...queryKeys.projects.detail(projectId), 'drift', targetAnalysisId ?? 'latest'] as const,
   ```

### 5.3 UI Integration in `apps/web/src/app/projects/[id]/page.tsx`

1. **Overview Tab**:
   Add a **Baseline & Drift Summary Card**:
   - If `hasBaseline === false`:
     - Show an empty state card with `GitCompare` icon.
     - Text: *"No Baseline Configured. Promote a completed preflight analysis to track configuration drift and regression risks."*
     - Button: *"Select Active Baseline"* (switches active tab to `history` or opens selector).
   - If `hasBaseline === true`:
     - Display **Baseline Run Reference**: ID (`run.id.slice(0, 8)`), date, and Baseline Clean Core Index.
     - Display **Configuration Drift Metrics**:
       - **Newly Introduced Risks**: Badge in Amber/Rose with `AlertTriangle` icon (`+N Regressions`).
       - **Resolved Risks**: Badge in Emerald with `CheckCircle2` icon (`-M Mitigated`).
       - **Persistent Baseline Risks**: Badge in Blue/Slate (`K Accepted`).
       - **Clean Core Score Delta**: Trend indicator (`+5.2%` green or `-12.0%` red).
     - Link to full Findings Ledger with drift filter pre-selected.

2. **Run History Tab**:
   In the `analyses.map((run) => ...)` list:
   - If `run.id === project.baselineAnalysisId` or `run.isBaseline`:
     - Render an accessible badge:
       ```tsx
       <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
         <ShieldCheck className="h-3 w-3" />
         ACTIVE BASELINE
       </span>
       ```
   - For other runs where `run.status === 'COMPLETED'`:
     - Render a button:
       ```tsx
       <button
         onClick={() => setBaselineMutation.mutate(run.id)}
         disabled={setBaselineMutation.isPending}
         className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded border border-border bg-card hover:bg-muted text-foreground transition-colors"
         title="Promote this run to official project baseline"
       >
         <GitCompare className="h-3 w-3 text-primary" />
         Set as Baseline
       </button>
       ```
     - Add button: *"View Drift"* which queries `/projects/:id/drift?targetAnalysisId=${run.id}`.

### 5.4 UI Integration in Findings Ledger (`/projects/[id]/findings`)

1. **Drift Classification Badge Component** (`drift-badge.tsx`):
   Follows Non-Color Triad Rule:
   - `NEWLY_INTRODUCED_RISK`:
     - Icon: `AlertTriangle`
     - Text: `NEW REGRESSION`
     - Classes: `bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/80 dark:text-rose-200 dark:border-rose-800`
   - `KNOWN_BASELINE_RISK`:
     - Icon: `ShieldAlert`
     - Text: `ACCEPTED BASELINE`
     - Classes: `bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700`
   - `RESOLVED_RISK`:
     - Icon: `CheckCircle2`
     - Text: `RESOLVED`
     - Classes: `bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-200 dark:border-emerald-800`

2. **Column & Facet Integration** (`finding-columns.tsx`):
   - Add `driftClassification` to `findingColumns`:
     ```tsx
     {
       accessorKey: 'driftClassification',
       id: 'driftClassification',
       header: 'Drift Status',
       cell: ({ row }) => {
         const drift = row.original.driftClassification;
         if (!drift) return <span className="text-muted-foreground text-xs">—</span>;
         return <DriftBadge classification={drift} size="sm" />;
       },
       size: 160,
     }
     ```
   - Add `Drift Status` to `findingFacetedFilters`:
     - Options: `Newly Introduced Risk (Regression)`, `Known Baseline Risk (Accepted)`, `Resolved Risk`.

---

## 6. Gap Analysis Matrix

| Requirement Component | Current Status | Defect / Gap | Recommended Fix |
|---|---|---|---|
| **DB Column: `is_baseline`** | Exists in DB (migration 006) | Not in `analysis.ts` schema, not returned by `AnalysesService.findAll` | Add `isBaseline` to `AnalysesService` queries & schema |
| **DB Column: `baseline_analysis_id`** | Exists in DB (migration 006) | Not in `packages/schemas/src/project.ts` `ProjectSchema` | Add `baselineAnalysisId: z.string().uuid().optional().nullable()` |
| **`POST /projects/:id/baseline`** | Exists in controller/service | Allows setting incomplete/failed analyses; no DTO validation | Require `status === 'COMPLETED'`; use `SetBaselineDto` |
| **Finding Identity in Drift** | Uses `${rule_id}:${title}` | Collapses duplicate findings with identical titles; ignores SAP object/artifact | Use `f.fingerprint` (SHA-256) with multi-item bucket matching |
| **Clean Core `scoreDelta`** | Tries to read non-existent `clean_core_score` | Always evaluates to `0 - 0 = 0` | Compute Clean Core Index dynamically using canonical penalty formula |
| **Frontend: Overview Drift Card** | Missing | No visual representation of baseline or drift | Implement Baseline & Drift KPI Card in overview tab |
| **Frontend: Run History Promotion** | Missing | Cannot set baseline from UI; no active baseline indicator | Add `ACTIVE BASELINE` badge and `Set as Baseline` button in history tab |
| **Frontend: Findings Drift Column** | Missing | Cannot filter or inspect drift classification in ledger | Add `DriftBadge`, `driftClassification` column, and faceted filter |
| **Client & Query Keys** | Missing | No API functions or query keys for baseline/drift | Add `fetchProjectDrift`, `setProjectBaseline`, query keys |

---

## 7. Concrete Implementation Roadmap for Worker

To deliver Requirement R2 cleanly without breaking existing tests, the worker should execute in 4 sequential phases:

### Phase 1: Shared Schemas & Database Models
1. In `packages/schemas/src/project.ts`: Add `baselineAnalysisId` to `ProjectSchema`.
2. In `packages/schemas/src/analysis.ts`: Add `isBaseline: z.boolean().default(false)` to analysis schemas.
3. In `packages/schemas/src/finding.ts` (or `drift.ts`): Define `DriftClassificationEnum`, `DriftSummarySchema`, `DriftReportSchema`.
4. Run `pnpm run build --filter @erppreflight/schemas` to verify types.

### Phase 2: Backend Enhancement (`apps/api`)
1. In `apps/api/src/modules/projects/dto/project.dto.ts`:
   - Create `SetBaselineDto` with `@IsUUID() @IsNotEmpty() analysisId: string`.
2. In `apps/api/src/modules/projects/projects.service.ts`:
   - Enforce `analysis.status === 'COMPLETED'` in `setBaseline`.
   - Rewrite `getDrift` using `f.fingerprint` (or `createFindingFingerprint`) and multi-item occurrence matching.
   - Implement dynamic Clean Core Index computation (`computeCleanCoreIndex`) to accurately compute `scoreDelta`.
3. In `apps/api/src/modules/analyses/analyses.service.ts`:
   - Include `isBaseline: Boolean(row.is_baseline)` in `findAll` and `findById`.
4. In `apps/api/src/modules/projects/projects.controller.ts`:
   - Use `SetBaselineDto` in `setBaseline`.
   - Optionally add `GET :id/baseline` and `DELETE :id/baseline`.
5. Unit tests:
   - Add comprehensive tests in `projects.service.spec.ts` for `setBaseline` (success, missing project, missing analysis, incomplete analysis) and `getDrift` (exact diff categorization, fingerprint matching, score delta calculation).

### Phase 3: Frontend Client & Query Layer (`apps/web`)
1. In `apps/web/src/lib/api-client.ts`:
   - Export `setProjectBaseline` and `fetchProjectDrift`.
2. In `apps/web/src/lib/query/query-keys.ts`:
   - Add `projects.baseline` and `projects.drift`.

### Phase 4: Frontend UI & Visualization (`apps/web`)
1. In `apps/web/src/components/findings/`:
   - Create `drift-badge.tsx` with non-color icons and accessible labels.
   - Add `driftClassification` to `findingColumns` in `finding-columns.tsx`.
   - Add `driftClassification` to `findingFacetedFilters`.
2. In `apps/web/src/app/projects/[id]/page.tsx`:
   - Query `fetchProjectDrift` when `project.baselineAnalysisId` exists.
   - Add Baseline & Drift card in `overview` tab.
   - In `history` tab, render `ACTIVE BASELINE` badge and `Set as Baseline` mutation button.
3. Verification:
   - Run `pnpm run typecheck`, `pnpm run check:deps`, `pnpm run check:no-production-facades`, and `pnpm run test`.
