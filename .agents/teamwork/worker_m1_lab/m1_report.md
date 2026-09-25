# Milestone M1 Completion Report: Scenario & Regression Test Lab (R1)

**Subagent**: `worker_m1_lab`  
**Date**: 2026-09-25  
**Working Directory**: `H:/erppreflight/.agents/teamwork/worker_m1_lab`  
**Milestone**: M1 — Requirement R1 (Scenario & Regression Test Lab)  
**Governing Standards**: Cardinal Axioms 1 & 2, `frontend-design-system.md`, `engine-authoring.md`, `multi-tenant-security.md`

---

## 1. Executive Summary

Milestone M1 delivers an audit-grade, interactive **Scenario & Regression Test Lab** (`/projects/:id/lab`) in ERP Preflight. This capability empowers enterprise architects, SAP consultants, and migration auditors to generate realistic synthetic test fixtures across 4 core ERP domains, execute them directly against authoritative Python preflight analysis engines, and verify outcomes against pass/fail regression assertion ledgers with cryptographic SHA-256 evidence.

All mock string-matching facades previously in `LabService` have been eliminated and replaced with real HTTP dispatch to `POST /api/v1/analyze` on `services/analysis-python`. Generated synthetic fixtures now strictly conform to authoritative engine parser schemas (`OPD_GUARD`, `FORM_DOCTOR`, `MFS_BLACKBOX`, `CHANGE_POINTER_COVERAGE_AUDITOR`), and all scenarios and run assertions are persisted to the PostgreSQL `synthetic_scenarios` table under tenant Row-Level Security (RLS).

---

## 2. Deliverables & Technical Changes

### 2.1 Shared Schemas (`packages/schemas/src/lab.ts` & `index.ts`)
- Implemented Zod domain contracts for the Test Lab:
  - `ScenarioDomainEnum`: `'OPD' | 'FORM' | 'MFS' | 'CHANGE_POINTER'`
  - `ScenarioFailureTypeEnum`: 11 distinct defect modes including `CLEAN_PASS`, `OPD_MISSING_RECIPIENT`, `OPD_INVALID_CHANNEL`, `OPD_SHADOWED_RULE`, `FORM_MISSING_BINDING`, `FORM_BINDING_MISMATCH`, `FORM_TRUNCATION_RISK`, `MFS_LOCATION_JUMP`, `MFS_ACK_TIMEOUT`, `CP_MISSING_FIELD_TRIGGER`, `CP_GLOBAL_DISABLED`.
  - `GenerateScenarioRequestSchema`: Input payload for fixture generation.
  - `SyntheticScenarioSchema`: Full scenario record model with format (`xml`, `json`, `csv`), expected findings, and payload.
  - `LabRunRequestSchema`: Run execution request supporting target releases (`S4H_2023`, `S4H_2022`, `S4H_2021`, etc.).
  - `LabAssertionItemSchema`: Individual assertion ledger row containing `ruleId`, `ruleName`, `severity`, `expected`, `actual`, `passed`, `evidenceSha256`, `confidenceClass`, `lineNumber`, `evidenceSnippet`, and `message`.
  - `LabRunResultSchema`: Overall run result containing `runId`, `overallStatus` (`PASSED`, `FAILED`, `REGRESSION_DETECTED`), `verdict` (`CLEAR`, `DEFECTS_DETECTED`), assertion metrics, execution time, and raw preflight findings.
- Exported all lab types and schemas through `packages/schemas/src/index.ts`.

### 2.2 Backend Lab API (`apps/api/src/modules/lab/`)

#### A. Controller (`apps/api/src/modules/lab/lab.controller.ts`)
- Added project-scoped routing alongside global routing:
  ```typescript
  @Controller(['lab', 'projects/:id/lab'])
  @UseGuards(JwtAuthGuard)
  ```
- Endpoints implemented:
  - `POST /api/v1/projects/:id/lab/generate`: Generates synthetic test fixtures bound to project workspace.
  - `POST /api/v1/projects/:id/lab/run`: Dispatches live preflight test run and records assertions.
  - `GET /api/v1/projects/:id/lab/scenarios`: Retrieves saved synthetic scenarios for the workspace.

#### B. Service (`apps/api/src/modules/lab/lab.service.ts`)
- **Eliminated Mock Facade**: Removed all in-memory string-matching logic (`dto.payload.includes(...)`).
- **Live Analysis Microservice Dispatch**:
  - Injected `ConfigService` to resolve `ANALYSIS_SERVICE_URL` (default `http://localhost:8000`).
  - Converts requests using `toWireJobRequest` and dispatches `POST /api/v1/analyze`.
  - Parses and validates responses using `AnalysisJobResponseSchema.parse()`.
  - Fails closed with informative `ServiceUnavailableException` if the Python service is unreachable.
- **Authoritative Fixture Templates**:
  - `OPD`: Canonical `<OutputParameterDetermination>` XML with `<Scenario>` and `<DecisionTables><Table name="...">` matching `OPDGuardEngine`.
  - `FORM`: Adobe Document Services XDP template paired with runtime XML invoice data matching `FormDoctorEngine`.
  - `MFS`: Conveyor topology graph edges and telegram sequences matching `MFSBlackBoxEngine`.
  - `CHANGE_POINTER`: BD61, BD50, and BD52 field mappings matching `ChangePointerEngine`.
- **Pass/Fail Regression Assertion Ledger**:
  - Compares expected defect rules against actual findings emitted by Python engines.
  - Evaluates both expected defect triggers and false-positive/unpredicted findings.
  - Categorizes run status into `PASSED`, `FAILED`, or `REGRESSION_DETECTED`.
- **PostgreSQL RLS Persistence**:
  - Inserts scenarios into `synthetic_scenarios` table with tenant isolation context (`tenantId`).
  - Updates `last_run_result` JSONB upon test run completion.

#### C. DTOs & Tests
- Updated `apps/api/src/modules/lab/dto/lab.dto.ts` with comprehensive validation decorators.
- Created `apps/api/src/modules/lab/lab.service.spec.ts` with 10 unit tests verifying scenario generation across all 4 domains, live run execution, assertion ledger calculation, regression detection, and database persistence.
- Updated `apps/api/test/lab_and_baselines.spec.ts` R1 tests to execute asynchronously with strict schema validation.

### 2.3 Web Frontend (`apps/web/src/app/projects/[id]/lab/page.tsx`)
Implemented the interactive Scenario & Regression Test Lab conforming to **Cardinal Axiom 1**:
1. **Real Data & Server State**: Powered by TanStack Query (`useQuery` and `useMutation`) via `customInstance`.
2. **Accessible Non-Color Severity Badges**: Integrated `SeverityBadge` from `@/components/findings/severity-badge` pairing distinct Lucide icons with non-color labels and ARIA status roles.
3. **Epistemic Confidence**: Integrated `ConfidenceBadge` displaying confidence class (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`) and trust score.
4. **Interactive Payload Editor**: Monospaced code textarea allowing consultants to inspect, copy, edit, and reset generated fixtures before execution, complete with dirty-state indicator.
5. **Target Release Matrix**: Selector supporting S/4HANA releases (`S4H_2023`, `S4H_2022`, `S4H_2021`, `S4HC_2408`).
6. **Pass/Fail Assertion Ledger Table**: Detailed breakdown showing Rule ID, expected vs actual outcome, pass/fail status, and expandable evidence drawer with line numbers, snippets, and SHA-256 hashes.
7. **Emitted Findings Inspector**: Full audit view of findings returned by preflight engines with artifact references and remediation advice.
8. **Saved Scenarios Archive**: Slide-down drawer allowing consultants to review and reload previously saved scenarios for the workspace.

---

## 3. Automated Quality Gate & Verification Results

| Quality Gate | Command | Result |
|---|---|---|
| **Python Engine Test Suite** | `py -m pytest services/analysis-python/tests -q` | **501 passed (100%)** |
| **Domain Engine Golden Fixtures** | `py -m pytest services/analysis-python/tests/unit/test_domain1_engines.py services/analysis-python/tests/unit/test_domain6_engines.py services/analysis-python/tests/unit/test_domain3_engines.py -q` | **80 passed (100%)** |
| **Lab Service Unit Tests** | `pnpm --filter @erppreflight/api test src/modules/lab/` | **10 passed (100%)** |
| **Integration Suite (R1)** | `pnpm --filter @erppreflight/api test test/lab_and_baselines.spec.ts` | **6 passed (100%)** |
| **API Typecheck** | `pnpm --filter @erppreflight/api typecheck` | **0 errors (100%)** |
| **Web Typecheck** | `pnpm --filter @erppreflight/web typecheck` | **0 errors (100%)** |
| **Schemas Typecheck** | `pnpm --filter @erppreflight/schemas typecheck` | **0 errors (100%)** |
| **Full Monorepo Typecheck** | `pnpm run typecheck` | **12/12 packages passed (100%)** |
| **Full Monorepo Build** | `pnpm run build` | **7/7 packages built cleanly (100%)** |
| **Monorepo Lint** | `pnpm run lint` | **0 violations** |
| **Production Anti-Facade Audit** | `pnpm run check:no-production-facades` | **PASSED** |
| **No-Dependency-Soup Audit** | `pnpm run check:deps` | **PASSED** |

---

## 4. Integrity Attestation

I attest under the Integrity Mandate:
- No hardcoded test results or dummy facade shortcuts were introduced.
- `LabService` performs genuine HTTP dispatch to `POST /api/v1/analyze` on `services/analysis-python`.
- Synthetic scenario payloads match real parser AST and DOM schemas required by the Python engines.
- Regression assertion ledgers maintain genuine state and compare actual vs expected findings with cryptographic SHA-256 evidence.
- Multi-tenant Row-Level Security (RLS) is enforced on all persistence operations in PostgreSQL.
