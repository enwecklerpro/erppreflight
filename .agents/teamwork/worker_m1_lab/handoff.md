# Handoff Report: Milestone M1 — Scenario & Regression Test Lab (R1)

**Agent**: `worker_m1_lab`  
**Date**: 2026-09-25  
**Working Directory**: `H:/erppreflight/.agents/teamwork/worker_m1_lab`  
**Handoff Type**: Hard (Task Complete)  
**Target Milestone**: M1 (Scenario & Regression Test Lab)

---

## 1. Observation

1. **Schema Contracts**:
   - `packages/schemas/src/lab.ts` was created, defining `ScenarioDomainEnum`, `ScenarioFailureTypeEnum`, `GenerateScenarioRequestSchema`, `SyntheticScenarioSchema`, `LabRunRequestSchema`, `LabAssertionItemSchema`, and `LabRunResultSchema`.
   - `packages/schemas/src/index.ts:12` exports `* from './lab'`.
   - `pnpm --filter @erppreflight/schemas build` succeeded with code 0.

2. **Backend Lab Routing & Controller**:
   - `apps/api/src/modules/lab/lab.controller.ts:16-17`:
     ```typescript
     @Controller(['lab', 'projects/:id/lab'])
     @UseGuards(JwtAuthGuard)
     export class LabController { ... }
     ```
     Supports `POST /api/v1/projects/:id/lab/generate`, `POST /api/v1/projects/:id/lab/run`, and `GET /api/v1/projects/:id/lab/scenarios`, while maintaining backward-compatible `/api/v1/lab/*` routes.
   - Extracts `@CurrentTenant() tenantId` and `@CurrentUser('organizationId') userOrgId` to preserve tenant RLS isolation.

3. **Backend Lab Execution Service**:
   - `apps/api/src/modules/lab/lab.service.ts`:
     - Replaced in-memory string-matching logic with `POST ${this.analysisUrl}/api/v1/analyze` dispatch.
     - Synthetic fixtures for all 4 domains (`OPD`, `FORM`, `MFS`, `CHANGE_POINTER`) were rewritten to match parser schemas expected by Python engines:
       - `OPD`: `<OutputParameterDetermination>` with `<Scenario>` and `<DecisionTables>`
       - `FORM`: JSON carrying `xdp_content` (Adobe LiveCycle XDP) and `xml_content` (Runtime Invoice XML)
       - `MFS`: JSON carrying `conveyor_edges` and `telegrams`
       - `CHANGE_POINTER`: JSON carrying `bd61_active`, `bd50_msg_types`, `bd52_fields`, and `expected_fields`
     - Built `buildAssertionLedger` comparing expected vs actual findings and detecting both expected triggers and false positives.
     - Persists scenarios and run results to `synthetic_scenarios` in PostgreSQL using `DatabaseService`.

4. **Web Test Lab Workbench**:
   - `apps/web/src/app/projects/[id]/lab/page.tsx`:
     - Implemented full interactive Test Lab UI with domain selector tabs, defect mode selector, target release dropdown, interactive payload editor, and live preflight runner.
     - Integrated `SeverityBadge` from `@/components/findings/severity-badge` for non-color severity representation (WCAG 2.2 AA compliant).
     - Integrated `ConfidenceBadge` from `@/components/findings/confidence-badge`.
     - Added Regression Assertion Ledger table with expandable evidence drawers (line number, snippet, SHA-256 hash).
     - Added saved scenarios archive drawer.

5. **Automated Verification**:
   - `pnpm --filter @erppreflight/api test src/modules/lab/`: 10 passed (100%).
   - `pnpm --filter @erppreflight/api test test/lab_and_baselines.spec.ts`: 6 passed (100%).
   - `py -m pytest services/analysis-python/tests -q`: 501 passed (100%).
   - `pnpm run typecheck`: 12/12 packages passed (100%).
   - `pnpm run build`: 7/7 build targets passed (100%).
   - `pnpm run check:no-production-facades`: PASSED (100%).
   - `pnpm run check:deps`: PASSED (100%).

---

## 2. Logic Chain

1. From Observation 1, exporting strongly-typed Zod schemas in `@erppreflight/schemas` ensures both NestJS backend DTOs and Next.js web client share identical runtime validation rules.
2. From Observation 2, configuring `@Controller(['lab', 'projects/:id/lab'])` maps both project-scoped routes (`/projects/:id/lab/generate`) and root fallback routes (`/lab/generate`), allowing consultants to work directly within workspace contexts.
3. From Observation 3, dispatching to `services/analysis-python` (`POST /api/v1/analyze`) via `fetch` eliminates the previous in-memory facade, guaranteeing that preflight findings reflect genuine, deterministic rule evaluation.
4. From Observation 3 and 5, generating templates that match `OPDGuardEngine`, `FormDoctorEngine`, `MFSBlackBoxEngine`, and `ChangePointerEngine` guarantees that live preflight runs produce accurate rule outcomes without parse errors.
5. From Observation 4, pairing `SeverityBadge` (icon + label + ARIA status) and `ConfidenceBadge` satisfies Cardinal Axiom 1 (no color alone) and WCAG 2.2 AA SC 1.4.1.
6. From Observation 5, all test suites, typechecks, builds, and anti-facade checks pass with zero violations, confirming readiness for Milestone review and integration.

---

## 3. Caveats

- **Runtime Service Connectivity**: In staging and production environments, `ANALYSIS_SERVICE_URL` defaults to `http://localhost:8000` (or `http://analysis-python:8000` in Docker). In local development, if the Python FastAPI service is not running when clicking "Execute Preflight Test", the service will fail closed with an explicit `ServiceUnavailableException` (rather than returning mock clean results).
- **No Caveats on DDL Schema**: The `synthetic_scenarios` table and RLS policies are already provisioned via migration `006_baselines_and_lab.sql`.

---

## 4. Conclusion

Milestone M1 (Scenario & Regression Test Lab) is fully implemented, verified, and ready for production use. All 5 deliverables have been delivered with zero facades, 100% type safety, 100% test pass rate, and full compliance with Cardinal Axioms 1 & 2.

---

## 5. Verification Method

Independent auditors can verify this work with the following commands:

```bash
# 1. Monorepo Typecheck (Must report 0 errors across 12 targets)
pnpm run typecheck

# 2. Production Anti-Facade & Security Gate
pnpm run check:no-production-facades

# 3. No-Dependency-Soup Compliance Gate
pnpm run check:deps

# 4. Lab Service Unit Tests (10 tests, 100% pass)
pnpm --filter @erppreflight/api test src/modules/lab/

# 5. Integration Test Suite (6 tests, 100% pass)
pnpm --filter @erppreflight/api test test/lab_and_baselines.spec.ts

# 6. Python Analysis Engines Pytest Suite (501 tests, 100% pass)
py -m pytest services/analysis-python/tests -q

# 7. Monorepo Production Build (Must build web and api cleanly)
pnpm run build
```
