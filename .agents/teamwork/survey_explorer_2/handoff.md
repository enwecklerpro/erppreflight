# Handoff Report: Requirement R2 (Digital Project Baselines & Configuration Drift Engine)

**Agent**: `survey_explorer_2`  
**Date**: `2026-09-25T03:18:00Z`  
**Type**: Hard Handoff  
**Working Directory**: `H:/erppreflight/.agents/teamwork/survey_explorer_2`  
**Detailed Report**: `H:/erppreflight/.agents/teamwork/survey_explorer_2/survey_r2_report.md`

---

## 1. Observation

1. **Database Schema & Migrations**:
   - `packages/database/migrations/006_baselines_and_lab.sql` (lines 8–11):
     ```sql
     -- 1. Extend analyses with is_baseline flag
     ALTER TABLE analyses ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN NOT NULL DEFAULT false;

     -- 2. Extend projects with baseline_analysis_id reference
     ALTER TABLE projects ADD COLUMN IF NOT EXISTS baseline_analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL;
     ```
   - `packages/database/migrations/001_initial_schema.sql` (lines 108–127):
     `findings` table defines `fingerprint VARCHAR(64) NOT NULL`, `rule_id VARCHAR(100) NOT NULL`, `affected_objects JSONB NOT NULL DEFAULT '[]'`, `severity VARCHAR(50) NOT NULL`.
   - `analyses` table in `001_initial_schema.sql` (lines 96–106) defines `id`, `organization_id`, `project_id`, `status`, `engine_types`, `target_release`, `created_at`, `completed_at`. It does NOT have a `clean_core_score` column.

2. **Existing Backend Baseline Logic**:
   - `apps/api/src/modules/projects/projects.service.ts` (lines 79–111):
     `setBaseline(organizationId, projectId, analysisId)` resets `is_baseline` for other analyses of the project and sets `projects.baseline_analysis_id = analysisId`. It checks that the analysis exists, but DOES NOT check that `analysis.status === 'COMPLETED'`.
   - `apps/api/src/modules/projects/projects.controller.ts` (lines 63–80):
     `@Post(':id/baseline')` and `@Get(':id/drift')` are mounted on `ProjectsController`.
   - `apps/api/src/modules/analyses/analyses.service.ts` (lines 34–45 & 61–73):
     `findAll` and `findById` queries omit `is_baseline`, returning only `status`, `engineTypes`, `targetRelease`, `findingsCount`, `createdAt`, `completedAt`.

3. **Existing Backend Drift Comparison Algorithm**:
   - `apps/api/src/modules/projects/projects.service.ts` (lines 190–200):
     ```typescript
     const baselineMap = new Map<string, any>();
     baselineFindings.forEach((f: any) => {
       const key = `${f.rule_id || f.ruleId}:${f.title}`;
       baselineMap.set(key, f);
     });
     ```
   - `apps/api/src/modules/projects/projects.service.ts` (line 248):
     ```typescript
     scoreDelta: Number((comparisonAnalysis.clean_core_score || 0) - (baselineAnalysis.clean_core_score || 0))
     ```
     Since `clean_core_score` does not exist on `analyses`, this always calculates `0 - 0 = 0`.

4. **Cryptographic Fingerprint Standard**:
   - `packages/evidence/src/hashing.ts` (lines 13–19):
     ```typescript
     export function createFindingFingerprint(
       ruleId: string,
       affectedObjectName: string,
       artifactPath: string
     ): string {
       return calculateSha256(`${ruleId.trim()}:${affectedObjectName.trim()}:${artifactPath.trim()}`);
     }
     ```
   - `apps/api/src/modules/jobs/analysis.processor.ts` (lines 172–175):
     `const fingerprint = f.fingerprint || createFindingFingerprint(f.ruleId, firstObjName, firstArtifact);` is persisted into PostgreSQL for every finding.

5. **Clean Core Score Calculation**:
   - `apps/api/src/modules/findings/findings.service.ts` (lines 199–200):
     ```typescript
     const penalty = Math.min(100, blockers * 15 + criticals * 8 + majors * 3);
     const cleanCoreIndex = total === 0 ? 100 : Math.max(0, Math.round((100 - penalty) * 10) / 10);
     ```

6. **Web Frontend**:
   - `apps/web/src/app/projects/[id]/page.tsx`: Contains tabs `overview`, `findings`, `objects`, `artifacts`, `history`, `launcher`. Zero references to `drift` or `baseline`.
   - `apps/web/src/lib/api-client.ts`: Zero references to `drift` or `baseline`.
   - `apps/web/src/components/findings/finding-columns.tsx`: No column or faceted filter for drift classification (`KNOWN_BASELINE_RISK`, `NEWLY_INTRODUCED_RISK`, `RESOLVED_RISK`).

---

## 2. Logic Chain

1. **From Observation 1 & 2**:
   - The PostgreSQL schema already has `projects.baseline_analysis_id` and `analyses.is_baseline` via migration `006_baselines_and_lab.sql`.
   - However, because `AnalysesService.findAll` and `findById` do not select `is_baseline`, frontend clients cannot determine which analysis run in the history list is the active baseline without making extra API calls.
   - Furthermore, `setBaseline` does not validate `analysis.status === 'COMPLETED'`, violating the user specification ("User can mark any completed analysis run as the official PROJECT_BASELINE").

2. **From Observation 3 & 4**:
   - The current drift comparison logic indexes findings by `key = `${f.rule_id || f.ruleId}:${f.title}``.
   - When an engine generates multiple findings under the same rule and title across different SAP objects or file paths, subsequent findings overwrite preceding findings in the map, losing findings.
   - Observation 4 confirms that `findings.fingerprint` is already generated via `createFindingFingerprint(ruleId, objName, artifactPath)` and stored as a `VARCHAR(64)` SHA-256 hash on every finding.
   - Therefore, replacing `${rule_id}:${title}` with `f.fingerprint` (with multi-item occurrence bucket support) eliminates collisions and adheres to Cardinal Axiom 2.

3. **From Observation 1 & 3 & 5**:
   - Observation 1 proves `clean_core_score` does not exist on `analyses`.
   - Observation 3 proves `scoreDelta` reads this non-existent field, resulting in a zero delta.
   - Observation 5 provides the canonical Clean Core Index penalty calculation used in `findings.service.ts`.
   - Computing Clean Core Index dynamically for baseline and comparison findings allows `scoreDelta` to report actual quality improvements (`+X%`) or regression impacts (`-Y%`).

4. **From Observation 6**:
   - The web frontend currently has no baseline promotion UI, no drift summary cards, no drift query hooks, and no drift classification badges in the findings table.
   - Integrating `setBaseline` and `getDrift` into `api-client.ts`, `query-keys.ts`, `page.tsx`, and `finding-columns.tsx` fulfills all acceptance criteria for R2.

---

## 3. Caveats

1. **Migration State**: Migration `006_baselines_and_lab.sql` is present on disk. In test environments using in-memory or fresh databases, `runMigrations()` will apply it automatically. In long-running development databases, verification of migration history in `_migrations` may be required.
2. **Multiple Violations on Same Object**: If a single SAP object within the same file produces multiple violations of the exact same rule, they share the same `(ruleId, objName, artifactPath)` fingerprint unless a line number or snippet hash is included. Multi-item array grouping (`Map<string, Finding[]>`) cleanly handles this without requiring line-number sensitivity (which would cause false drift if code lines shift).
3. **Partial Analysis Runs**: If an analysis run had status `PARTIAL` (e.g. 1 out of 3 engines failed), should it be eligible for baseline? By specification, only `COMPLETED` runs should be allowed to guarantee full engine coverage.

---

## 4. Conclusion

Requirement R2 is partially scaffolded at the backend controller level, but possesses critical defects in finding identity matching and score delta computation, alongside a total absence of frontend integration.

To resolve R2 completely:
1. **Model & Schema Update**:
   - Add `baselineAnalysisId` to `ProjectSchema` (`packages/schemas/src/project.ts`).
   - Add `isBaseline` to `AnalysisSchema` (`packages/schemas/src/analysis.ts`).
   - Define `DriftClassificationEnum`, `DriftSummarySchema`, and `DriftReportSchema`.
2. **Backend Engine Fixes (`apps/api`)**:
   - In `ProjectsService.setBaseline`: Validate `analysis.status === 'COMPLETED'`.
   - In `ProjectsService.getDrift`: Replace `${rule_id}:${title}` with `f.fingerprint` and multi-item bucket matching.
   - In `ProjectsService.getDrift`: Compute `scoreDelta` dynamically using the canonical Clean Core Index formula.
   - In `AnalysesService`: Include `isBaseline: Boolean(row.is_baseline)` in `findAll` and `findById`.
3. **Frontend Integration (`apps/web`)**:
   - Add `setProjectBaseline` and `fetchProjectDrift` to `api-client.ts`.
   - Add `projects.baseline` and `projects.drift` to `query-keys.ts`.
   - Add Baseline & Drift KPI card to workspace Overview tab (`apps/web/src/app/projects/[id]/page.tsx`).
   - Add `ACTIVE BASELINE` badge and `Set as Baseline` button to Run History tab.
   - Add `DriftBadge` component, `driftClassification` column, and faceted filter to Findings Ledger (`finding-columns.tsx`).

---

## 5. Verification Method

To independently verify the findings and the eventual implementation:

1. **Verify Database Schema**:
   Inspect `packages/database/migrations/006_baselines_and_lab.sql`:
   ```bash
   grep -n "is_baseline" packages/database/migrations/006_baselines_and_lab.sql
   grep -n "baseline_analysis_id" packages/database/migrations/006_baselines_and_lab.sql
   ```

2. **Verify Backend Comparison & Controller**:
   Inspect `apps/api/src/modules/projects/projects.service.ts`:
   - Lines 80–110: `setBaseline`
   - Lines 190–225: `getDrift` matching key and `scoreDelta`
   Run existing NestJS unit tests:
   ```bash
   pnpm --filter @erppreflight/api test
   ```

3. **Verify Fingerprint Generation**:
   Inspect `packages/evidence/src/hashing.ts`:
   - Line 13: `createFindingFingerprint`

4. **Verify Frontend Gaps**:
   Search for `drift` or `baseline` in `apps/web/src/app/projects/[id]/page.tsx`:
   ```bash
   grep -rn "baseline" apps/web/src/app/projects/
   ```
   (Currently returns no matches).
