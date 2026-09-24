# Milestone 1 Wire Schema Alignment Investigation & Fix Blueprint — Handoff Report

**Agent**: `m1_it2_explorer_3`  
**Role**: Teamwork Explorer (Wire Contract Specialist)  
**Working Directory**: `H:/erppreflight/.agents/m1_it2_explorer_3`  
**Target Root**: `H:/erppreflight`  
**Timestamp**: 2026-09-24T01:58:00Z  
**Verdict**: **INVESTIGATION_COMPLETE / ACTIONABLE_BLUEPRINT_READY**  

---

## 1. Observation

### 1.1 Property Naming and Structure Divergence
1. **Wire Request Drift**:
   - `PROJECT.md` lines 107–119 and `services/analysis-python/src/models/request.py` lines 24–36 define snake_case wire fields: `job_id`, `tenant_id`, `project_id`, `engine_type`, `target_release`, `artifact_s3_key`, `artifact_type`, `configuration`, `raw_content`.
   - `packages/schemas/src/analysis.ts` lines 5–15 defined `AnalysisJobRequestSchema` exclusively with camelCase fields: `jobId`, `tenantId`, `projectId`, `engineType`, `targetRelease`, `artifactS3Key`, `artifactType`, `configuration`, `rawContent`.
   - Empirical proof in `apps/api/test/adversarial_challenge.spec.ts` line 47: `AnalysisJobRequestSchema.safeParse(pythonWireRequest).success` evaluates to `false` with missing field issues for `jobId`, `tenantId`, `projectId`.

2. **Finding Schema & Affected Objects Drift**:
   - `PROJECT.md` line 101 and `services/analysis-python/src/models/finding.py` line 20 define `affected_objects: List[str] = Field(default_factory=list)` (e.g. `['APOC_OR_ISS_CHNL', 'BRF_DECISION_TABLE_01']`).
   - `packages/schemas/src/finding.ts` lines 5–10, 28 defined `affectedObjects: z.array(AffectedObjectSchema)` where `AffectedObjectSchema` strictly requires `{ name: string, type: string, package?: string, tier?: CleanCoreTier }`.
   - In addition, `FindingSchema` required `engineType: EngineTypeEnum`, whereas in Python's `Finding` model and `PROJECT.md` line 124, `engine_type` resides exclusively at the root of `AnalysisResponse` / `AnalysisJobResponse`.
   - Empirical proof in `apps/api/test/adversarial_challenge.spec.ts` line 87: `FindingSchema.safeParse(pythonFindingWire).success` evaluates to `false`.

3. **Untyped NestJS Dispatch and Leakage**:
   - In `apps/api/src/modules/jobs/jobs.service.ts` lines 88–96: The outbound dispatch manually created an untyped object `payload = { job_id: analysisId, ... }`, omitting `artifact_type` and `configuration`.
   - Line 104–106: If the Python engine responded with non-200 HTTP status (e.g. 422 or 500), the response was silently ignored, and line 143 marked the analysis as `'COMPLETED'`, creating false positives.
   - Lines 108–135: Evidence arrays returned by Python were ignored and never inserted into the PostgreSQL `evidence` table (`001_initial_schema.sql` lines 130–145).
   - Lines 164–172: `getAnalysis()` returned raw PostgreSQL snake_case rows (`rule_id`, `engine`, `confidence_class`, `affected_objects`) directly to the web client, causing Next.js components (`apps/web/src/app/inspector/page.tsx` line 108, `apps/web/src/components/evidence-inspector.tsx` line 65) to receive `undefined` for `finding.ruleId` and `finding.engineType`.

---

## 2. Logic Chain

1. **Dual Serialization Mechanism**:
   - To support both internal TypeScript conventions (camelCase) and cross-boundary network contracts (snake_case) without breaking existing consumers, schemas must use `z.preprocess()` to normalize incoming keys before schema validation.
   - For every core schema (`AnalysisJobRequest`, `AnalysisMetrics`, `AnalysisJobResponse`, `Finding`, `EvidenceItem`), defining both a canonical camelCase schema (e.g. `FindingSchema`) and a wire snake_case schema (e.g. `FindingWireSchema`), paired with preprocessing, allows `safeParse()` to succeed regardless of which case is passed.
   - Coercing string items in `affectedObjects` into `{ name: string, type: 'SAP_OBJECT', package: null, tier: null }` allows `FindingSchema` to transparently accept `string[]` from Python, while preserving compatibility with `apps/web` which expects `{ name, type, tier }`.
   - Making `engineType` optional/nullable in `FindingSchema` ensures that isolated Python findings (which omit `engine_type`) validate without errors, while allowing `engineType` to be populated from the job context or database row.

2. **NestJS Service Dispatch Invariants**:
   - By running `toWireJobRequest()` on the outbound dispatch payload, NestJS enforces that the request strictly conforms to `PROJECT.md` line 108 before making the HTTP call.
   - Adding deterministic `artifact_type` detection (from extension or content) ensures Python receives valid format specifications (`XML`, `JSON`, `CSV`, etc.).
   - Explicitly handling non-200 responses and setting `status = 'FAILED'` or `'PARTIAL'` preserves the SaaS job lifecycle integrity.

3. **PostgreSQL Persistence & Frontend Retrieval**:
   - Inserting each finding into `findings` with the mapped columns (`engine`, `confidence_class`, `confidence_score`) and each evidence item into `evidence` with foreign key `finding_id = finding.id` maintains relational integrity and satisfies the Evidence Engine invariant.
   - In `getAnalysis()`, querying `findings` and `evidence`, then passing each row through `FindingSchema.parse(...)` converts PostgreSQL snake_case columns back into typed camelCase properties before delivering to the Next.js frontend.

---

## 3. Caveats

- **Existing Adversarial Tests Were Written as Demonstrators**: In `apps/api/test/adversarial_challenge.spec.ts`, tests currently assert `expect(result.success).toBe(false)` because they were designed to prove the bug existed. Once the fix is applied, those tests must be updated to assert `expect(result.success).toBe(true)` to pass.
- **pgvector Embeddings**: The `evidence` table has an optional `embedding vector(1536)` column for pgvector indexing. In Milestone 1, this column remains `NULL` until Milestone 2 AI Problem Router embeddings are generated.
- **Python-Side Tolerance**: Python `AnalysisRequest` currently expects snake_case (`job_id`). NestJS handles this mapping, but adding `validation_alias=AliasChoices` in Python `services/analysis-python` in a later pass will provide extra defensive tolerance.

---

## 4. Conclusion

The contract misalignment between `@erppreflight/schemas`, Python `services/analysis-python`, NestJS `jobs.service.ts`, and PostgreSQL `findings` has been thoroughly analyzed and diagnosed down to the exact lines of code.

A complete, actionable technical blueprint has been formulated and written to:
`H:/erppreflight/.agents/m1_it2_explorer_3/schema_alignment_plan.md`

The plan provides:
1. Complete replacement code for `packages/schemas/src/common.ts`, `evidence.ts`, `finding.ts`, `analysis.ts`, `converters.ts`, and `index.ts`.
2. Exact refactoring for `apps/api/src/modules/jobs/jobs.service.ts`.
3. Clear update specifications for `apps/api/test/adversarial_challenge.spec.ts`.

---

## 5. Verification Method

Once the implementer applies the blueprint:

1. **Rebuild `@erppreflight/schemas`**:
   ```powershell
   pnpm --filter @erppreflight/schemas build
   ```
   *Expected Result*: Clean build with zero TypeScript errors; types and ESM/CJS bundles generated in `packages/schemas/dist`.

2. **Run API Adversarial & Unit Test Suite**:
   ```powershell
   $env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"
   pnpm --filter @erppreflight/api test
   ```
   *Expected Result*: All 28 Vitest tests pass cleanly, confirming `AnalysisJobRequestSchema` and `FindingSchema` successfully parse snake_case wire payloads and reject invalid hex SHA-256 strings.

3. **Run Python Pytest Suite**:
   ```powershell
   py -m pytest services/analysis-python/tests -v
   ```
   *Expected Result*: All 27 tests pass cleanly, confirming no regressions on the Python FastAPI service.
