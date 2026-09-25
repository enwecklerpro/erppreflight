# Handoff Report: Survey of Requirement R1 (Scenario & Regression Test Lab)

**Agent**: `survey_explorer_1`  
**Working Directory**: `H:/erppreflight/.agents/teamwork/survey_explorer_1`  
**Handoff Type**: Hard (Task Complete)  
**Target Milestone**: Requirement R1 Investigation & Architectural Blueprint  

---

## 1. Observation

1. **Frontend Project Routes**:
   - `list_dir` on `H:/erppreflight/apps/web/src/app/projects/[id]` returned 5 subroutes:
     - `findings/page.tsx`
     - `objects/page.tsx`
     - `page.tsx`
     - `simulation/page.tsx`
     - `traceability/page.tsx`
   - `apps/web/src/app/projects/[id]/lab/page.tsx` does **not** exist.
   - Sibling pages (`findings/page.tsx:60-70`, `simulation/page.tsx:49-65`) utilize breadcrumb navigation, TanStack Query (`useQuery`, `useMutation`), and non-color severity badges (`apps/web/src/components/findings/severity-badge.tsx`).

2. **Backend Lab Module**:
   - `apps/api/src/modules/lab/lab.controller.ts:6-20`:
     ```typescript
     @Controller('lab')
     @UseGuards(JwtAuthGuard)
     export class LabController {
       @Post('generate')
       generateScenario(@Body() dto: GenerateScenarioDto) { ... }
       @Post('run')
       runScenario(@Body() dto: RunScenarioDto) { ... }
     }
     ```
     Controller is mapped to `/api/v1/lab`, missing project workspace route `POST /api/v1/projects/:id/lab/generate` mandated by `ORIGINAL_REQUEST.md:114`.
   - `apps/api/src/modules/lab/lab.service.ts:40`: `constructor(private readonly db: DatabaseService) {}` has an injected database service, but `this.db` is never called.
   - `apps/api/src/modules/lab/lab.service.ts:220-284`: `runScenario` executes in-memory string matching (`dto.payload.includes('RECEIVER_ROLE=""')`) rather than dispatching to Python preflight engines.
   - `packages/database/migrations/006_baselines_and_lab.sql:14-26`: Table `synthetic_scenarios` is already created with `id`, `organization_id`, `project_id`, `domain`, `scenario_name`, `failure_type`, `payload`, `expected_findings`, `last_run_result`, and RLS policy `tenant_isolation_synthetic_scenarios`.

3. **Python Analysis Engines & Golden Fixtures**:
   - `services/analysis-python/src/engines/opd_guard.py:26-32`: `OPDGuardEngine` registers `EngineType.OPD_GUARD`, supports XML, JSON, CSV, and parses `<OutputParameterDetermination>` with `<Scenario>` and `<DecisionTables><Table name="...">`.
   - `services/analysis-python/src/engines/form_doctor.py:48-54`: `FormDoctorEngine` registers `EngineType.FORM_DOCTOR`, traverses `<field><bind match="dataRef" ref="..."/></field>`, evaluating paths against runtime XML.
   - `services/analysis-python/src/engines/mfs_blackbox.py:30-45`: `MFSBlackBoxEngine` registers `EngineType.MFS_BLACKBOX`, auditing conveyor graph jumps and ACK timeouts from JSON/CSV.
   - `services/analysis-python/src/engines/change_pointer.py:165-175`: `ChangePointerEngine` registers `EngineType.CHANGE_POINTER_COVERAGE_AUDITOR`, evaluating BD61/BD50/BD52 configurations.
   - `services/analysis-python/src/api/analyze.py:13-24`: `POST /api/v1/analyze` accepts `AnalysisRequest` with `raw_content: Optional[str]`, enabling direct payload execution.

4. **Schemas & Dependencies**:
   - `packages/schemas/src/index.ts` has no `lab.ts` export.
   - `scripts/check-no-dependency-soup.mjs:42-171`: Mandates TanStack Form (`@tanstack/react-form` + Zod), TanStack Query (`@tanstack/react-query`), Base UI, and strictly forbids `react-hook-form`, `redux`, and duplicate libraries.
   - `scripts/check-no-production-facades.mjs:19-85`: Forbids mock findings, mock constants, and mock fallback facades.

---

## 2. Logic Chain

1. From Observation 1, `apps/web/src/app/projects/[id]/lab/page.tsx` must be created. To adhere to Cardinal Axiom 1 and match sibling pages, it must integrate real TanStack Query hooks, form state with dirty tracking, non-color severity indicators, and error boundaries.
2. From Observation 2, `LabController` lacks project routing (`/projects/:id/lab`), and `LabService` currently contains mock string-matching logic that violates Cardinal Axiom 2 and fails `check-no-production-facades.mjs`.
3. From Observation 2 and 3, `LabService` must dispatch live test payloads to `services/analysis-python` (`POST /api/v1/analyze`) via `fetch` using `ANALYSIS_SERVICE_URL`, exactly as implemented in `AnalysisProcessor`.
4. From Observation 3, the synthetic scenario generator templates previously produced generic `<decisionTable>` XML that would fail parsing in `opd_guard.py`. Aligning the synthetic templates to canonical fixture structures (`tests/fixtures/known_bad_billing_opd.xml`) guarantees deterministic rule evaluation.
5. From Observation 2, `synthetic_scenarios` already exists in PostgreSQL with tenant RLS; `LabService` can directly persist generated scenarios and last run assertion outcomes using `this.db.query(...)`.
6. From Observation 4, creating `packages/schemas/src/lab.ts` and exporting it through `index.ts` establishes end-to-end typed contracts across NestJS DTOs, Web TanStack mutations, and regression assertion ledgers without introducing forbidden dependencies.

---

## 3. Caveats

- **Service Connectivity Assumption**: In production and staging, `services/analysis-python` runs as a container on port 8000. In local offline development environments where Python is not running, `LabService` should provide clear network failure feedback rather than silently returning mock clean data.
- **Form Doctor Multi-Part Payloads**: `FormDoctorEngine` expects both an XDP template and a runtime XML payload. For single-text area inputs, the synthetic generator should pass both payloads either via structured configuration or combined payload blocks.
- **No Caveats on Database Migrations**: Migration `006_baselines_and_lab.sql` is already applied; no new DDL schema migrations are needed for R1.

---

## 4. Conclusion

Requirement R1 is completely architecturally defined and ready for direct implementation:
1. **Frontend**: Implement `apps/web/src/app/projects/[id]/lab/page.tsx` with domain switching (OPD, Form, MFS, Change Pointer), synthetic generator controls, interactive payload editor, live execution trigger, and pass/fail assertion ledger table with non-color severity badges.
2. **Backend**: Extend `LabController` with `@Controller(['lab', 'projects/:id/lab'])` to support `POST /api/v1/projects/:id/lab/generate` and `POST /api/v1/projects/:id/lab/run`. Refactor `LabService` to dispatch real requests to Python `POST /api/v1/analyze`, compute pass/fail regression assertion ledgers, and persist to `synthetic_scenarios`.
3. **Schemas**: Add `packages/schemas/src/lab.ts` with Zod domain models and assertion ledger types.
4. **Python Alignment**: Ensure synthetic templates output valid XML/JSON matching `opd_guard.py`, `form_doctor.py`, `mfs_blackbox.py`, and `change_pointer.py`.

---

## 5. Verification Method

1. **Schema and Monorepo Typecheck**:
   ```bash
   pnpm run typecheck
   ```
2. **Dependency & Facade Compliance**:
   ```bash
   pnpm run check:deps
   pnpm run check:no-production-facades
   ```
3. **Python Engine Golden Fixture Verification**:
   ```bash
   pytest services/analysis-python/tests -v
   ```
4. **Backend Lab Service Tests**:
   ```bash
   pnpm --filter @erppreflight/api test src/modules/lab/
   ```
5. **Inspect Detailed Survey Report**:
   Inspect `H:/erppreflight/.agents/teamwork/survey_explorer_1/survey_r1_report.md` for full implementation blueprints and code mappings.
