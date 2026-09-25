# Handoff Report: Milestone M2 (Digital Project Baselines & Configuration Drift Engine)

**Agent**: `worker_m2_baseline`  
**Timestamp**: `2026-09-25T03:31:30Z`  
**Handoff Type**: Hard Handoff (Task Complete)  
**Working Directory**: `H:/erppreflight/.agents/teamwork/worker_m2_baseline`  
**Milestone**: M2 (Digital Project Baselines & Configuration Drift Engine - R2)

---

## 1. Observation

1. **Schema & Domain Extensions**:
   - `packages/schemas/src/project.ts`: Added `baselineAnalysisId: z.string().uuid().optional().nullable()` to `ProjectSchema`. Added `DriftClassificationEnum` (`'KNOWN_BASELINE_RISK' | 'NEWLY_INTRODUCED_RISK' | 'RESOLVED_RISK'`), `DriftSummarySchema`, and `SetBaselineRequestSchema`.
   - Command: `pnpm --filter @erppreflight/schemas build` exited with code 0 (`tsc`).

2. **Backend Baseline & Drift Engine Implementation**:
   - `apps/api/src/modules/projects/projects.service.ts`:
     - Line 90: `if (analysis.status && analysis.status.toUpperCase() !== 'COMPLETED') throw new BadRequestException(...)`.
     - Lines 188–235: Grouped findings into `baselineBuckets` and `comparisonBuckets` indexed by `getFindingKey(f)` (SHA-256 fingerprint via `createFindingFingerprint`).
     - Lines 202–230: Implemented multi-occurrence bucket matching (`Math.min(base.length, comp.length)` as `KNOWN_BASELINE_RISK`, comp excess as `NEWLY_INTRODUCED_RISK`, baseline excess as `RESOLVED_RISK`).
     - Lines 232–242: Computed dynamic `scoreDelta` using `computeCleanCoreIndex(findings)` (`100 - min(100, blockers * 15 + criticals * 8 + majors * 3)`).
   - `apps/api/src/modules/projects/projects.controller.ts`: Mounted `SetBaselineDto` on `@Post(':id/baseline')`.
   - `apps/api/src/modules/analyses/analyses.service.ts`: Lines 39 and 66: Added `isBaseline: Boolean(row.is_baseline)` in `findAll` and `findById`.

3. **Web Frontend Integration**:
   - `apps/web/src/lib/api-client.ts`: Exported `setProjectBaseline`, `fetchProjectDrift`, `ProjectDriftReport`, `fetchAnalyses` with `isBaseline`, and `ProjectListItem`.
   - `apps/web/src/app/projects/[id]/page.tsx`:
     - Overview tab (lines 447–515): Renders Baseline & Configuration Drift KPI card showing active baseline ID, baseline date, Clean Core score delta, new risks count, resolved risks count, known baseline risks, and navigation button when no baseline is set.
     - Run History tab (lines 915–960): Renders `ACTIVE BASELINE` badge with `ShieldCheck` icon when `drift?.baseline?.id === run.id || run.isBaseline`. Renders `"Set as Baseline"` button with `BookmarkCheck` icon for completed non-baseline runs.
   - `apps/web/src/components/findings/finding-columns.tsx`:
     - Implemented `DriftBadge` with WCAG 2.2 AA non-color triad (`AlertTriangle` for new regressions, `ShieldAlert` for known baseline, `CheckCircle2` for resolved risks).
     - Added `driftClassification` column to `findingColumns` (size 190px).
     - Added `driftClassification` filter to `findingFacetedFilters`.

4. **Automated Test Results**:
   - `pnpm --filter @erppreflight/api exec vitest run src/modules/projects/projects.service.spec.ts src/modules/analyses/analyses.service.spec.ts test/lab_and_baselines.spec.ts`:
     - Result: `Test Files 3 passed (3), Tests 23 passed (23), Duration 1.13s`.
   - `pnpm --filter @erppreflight/web test`:
     - Result: `Test Files 8 passed (8), Tests 131 passed (131)`.
   - `pnpm --filter @erppreflight/web typecheck`:
     - Result: `tsc --noEmit` exited with code 0.
   - `pnpm --filter @erppreflight/web build`:
     - Result: `next build` exited with code 0 (24/24 static pages generated).
   - `pnpm run check:no-production-facades`:
     - Result: `[PASS] All production facade & security checks PASSED cleanly!`.
   - `pnpm run check:deps`:
     - Result: `100% compliant with No-Dependency-Soup standard!`.

---

## 2. Logic Chain

1. **Baseline Invariance Validation (Observation 2)**:
   - Incomplete or failed runs cannot provide a valid audit reference. Enforcing `analysis.status === 'COMPLETED'` ensures that baseline runs contain full engine coverage and defensible findings.
2. **Deterministic Cryptographic Matching (Observations 2 & 4)**:
   - Pre-existing string concatenation (`${rule_id}:${title}`) collapsed distinct findings across different SAP objects and files.
   - Using the 64-character SHA-256 finding fingerprint combined with multi-occurrence bucket arrays preserves granular identity and allows distinguishing exact new vs resolved risks without key collisions.
3. **Dynamic Score Delta (Observations 2 & 4)**:
   - `analyses` table does not persist `clean_core_score`. Computing the Clean Core Index dynamically using the canonical formula ($100 - \min(100, 15B + 8C + 3M)$) allows `scoreDelta` to accurately report quality progression (`+X.X%` or `-X.X%`).
4. **End-to-End User Experience (Observation 3)**:
   - Exposing `isBaseline` on `analyses.service.ts` enables the Run History tab to display `ACTIVE BASELINE` badges immediately upon data load.
   - The Overview tab KPI card and Findings Ledger faceted filters provide visibility into configuration drift across both summary and granular views.

---

## 3. Caveats

1. **Concurrent ObjectsModule Scaffolding**:
   - `apps/api/test/objects.spec.ts` had 4 failing tests caused by an in-progress implementation in `src/modules/objects` owned by `worker_m4_inspector`. All 29 other test suites in `apps/api` (including all baseline and drift tests) passed cleanly.
2. **Finding Line Number Shifts**:
   - As designed by Cardinal Axiom 2, finding fingerprints are keyed by `(ruleId, affectedObjectName, artifactPath)` rather than line numbers, ensuring line insertions or deletions in upstream ABAP/XML do not produce false positive drift.

---

## 4. Conclusion

Milestone M2: Digital Project Baselines & Configuration Drift Engine (R2) is fully implemented, verified, and ready for integration. All acceptance criteria and Cardinal Axioms are satisfied with zero dummy facades or stubs.

---

## 5. Verification Method

To independently verify the implementation:

1. **Verify Backend Baseline & Drift Tests**:
   ```bash
   pnpm --filter @erppreflight/api exec vitest run src/modules/projects/projects.service.spec.ts src/modules/analyses/analyses.service.spec.ts test/lab_and_baselines.spec.ts
   ```
   *Expected*: 23/23 tests pass with 0 failures.

2. **Verify Frontend Tests & Typecheck**:
   ```bash
   pnpm --filter @erppreflight/web test
   pnpm --filter @erppreflight/web typecheck
   ```
   *Expected*: 131/131 tests pass with 0 TypeScript errors.

3. **Verify Monorepo Governance & No-Facade Checks**:
   ```bash
   pnpm run check:no-production-facades
   pnpm run check:deps
   ```
   *Expected*: 0 violations reported.
