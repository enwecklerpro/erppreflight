# Project: ERP Preflight — Next 4 Enterprise Capabilities

## Architecture
ERP Preflight is an enterprise multi-tenant SaaS platform for SAP preflight analysis, clean core auditing, migration verification, and release intelligence.
This operational cycle implements and verifies the next 4 critical enterprise capabilities based on Parts 05, 14, 15, and 16 of the Master Specification:
1. R1: Scenario & Regression Test Lab (`/projects/:id/lab`)
2. R2: Digital Project Baselines & Configuration Drift Engine
3. R3: Cryptographic Reproducibility Bundle Downloader (`.zip`)
4. R4: Universal SAP Object Inspector (`/objects` & Modal)

### Monorepo Map & Boundaries
- `apps/web`: Next.js 15 App Router, React 19, Base UI, TanStack Query/Form/Table, Tailwind CSS. Communicates exclusively with `apps/api` via HTTP/REST.
- `apps/api`: NestJS 11 Core SaaS Backend, Drizzle ORM, BullMQ Redis queues, S3/MinIO storage, multi-tenant PostgreSQL RLS.
- `services/analysis-python`: Stateless Python 3.13 FastAPI microservice with 18 SAP Preflight Engines + MFS BlackBox, deterministic SafeXmlParser, Pydantic models.
- `packages/*`: Shared leaf libraries (`@erppreflight/schemas`, `@erppreflight/database`, `@erppreflight/tenancy`, `@erppreflight/evidence`, `@erppreflight/auth`).
- `tests/e2e`: Playwright E2E test suite and fixtures.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| R1 | Scenario & Regression Test Lab | Interactive Test Lab in `apps/web/src/app/projects/[id]/lab/page.tsx` and NestJS `LabModule` (`POST /api/v1/projects/:id/lab/generate` and `run`), synthetic fixture generation across 4 core domains (OPD, ADS Forms, MFS Telegrams, MATMAS Change Pointers), live engine execution against `services/analysis-python`, pass/fail regression assertion ledgers with `SeverityBadge`. | M1 | survey_explorer_1 |
| R2 | Digital Project Baselines & Configuration Drift Engine | Baseline management in `apps/api/src/modules/projects/`, marking completed analysis as `PROJECT_BASELINE`, drift categorization (`KNOWN_BASELINE_RISK`, `NEWLY_INTRODUCED_RISK`, `RESOLVED_RISK`) using deterministic SHA-256 fingerprint bucket matching, dynamic Clean Core delta calculation, Web UI Overview KPI card, History baseline badge/action, Findings Ledger drift column, badges, and filters. | M2 | survey_explorer_2 |
| R3 | Cryptographic Reproducibility Bundle Downloader | Backend endpoint `GET /api/v1/analyses/:id/reproducibility-bundle` streaming signed ZIP export (`manifest.json` with `KNOW_SNAP_2026_09_24`, `normalized_hashes.json`, `findings_ledger.json`, `remediation_guide.md`), `SecretRedactorService` protection, UI download buttons in Findings, Universal Inspector, and Run History. | M3 | survey_explorer_3 |
| R4 | Universal SAP Object Inspector | Remove client-side mock generator `generateMockSapObjects`, backend `ObjectsModule` (`GET /api/v1/projects/:id/objects` and `/:objectName`), Clean Core Tiers (1/2/3), target release compatibility, dependency links, interactive `ObjectDetailDrawer` launched by clicking SAP objects across findings table and detail rows. | M4 | survey_explorer_3 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| **M1** | Scenario & Regression Test Lab | R1 (Lab UI `/projects/:id/lab`, NestJS `LabModule` project routes, real Python analysis dispatch, synthetic templates for 4 domains, `packages/schemas/src/lab.ts`, persistence to `synthetic_scenarios`) | none | IN_PROGRESS |
| **M2** | Digital Project Baselines & Configuration Drift Engine | R2 (`ProjectsService.setBaseline` validation, fingerprint-based drift comparison, dynamic Clean Core delta, `AnalysesService` `isBaseline` inclusion, Web UI Overview KPI, History promotion, Findings drift column/filters) | none | DONE |
| **M3** | Cryptographic Reproducibility Bundle Downloader | R3 (`GET /analyses/:id/reproducibility-bundle` multi-file signed ZIP export with manifest, hashes, findings ledger, remediation guide, secret redaction, Web UI download buttons) | none | PLANNED |
| **M4** | Universal SAP Object Inspector | R4 (Eliminate client-side mock generator, NestJS `ObjectsModule` with real aggregated inventory, Clean Core tiering & release compatibility, global interactive `ObjectDetailDrawer` wired to findings links) | M2, M3 | PLANNED |
| **M5** | Full Monorepo Quality Gates & Verification | Clean monorepo build, strict typecheck, lint, anti-facade audit, dependency soup audit, unit tests, python tests, Playwright E2E verification | M1, M2, M3, M4 | PLANNED |

---

## Interface Contracts

### 1. Lab API (`M1`)
- `POST /api/v1/projects/:id/lab/generate`:
  - Request: `{ domain: 'OPD' | 'FORM' | 'MFS' | 'CHANGE_POINTER', scenarioName: string, failureType: string, options?: Record<string, any> }`
  - Response: `{ scenarioId: string, domain: string, scenarioName: string, payload: string, expectedFindings: any[] }`
- `POST /api/v1/projects/:id/lab/run`:
  - Request: `{ domain: string, payload: string, expectedFindings?: any[], engineTypes?: string[] }`
  - Response: `{ scenarioId?: string, executedAt: string, engineResults: any[], assertionLedger: Array<{ ruleId: string, ruleName: string, expected: boolean, actual: boolean, passed: boolean, severity: string, message: string }>, passedCount: number, failedCount: number, allPassed: boolean }`

### 2. Baselines & Drift API (`M2`)
- `POST /api/v1/projects/:id/baseline`:
  - Request: `{ analysisId: string }`
  - Response: `{ success: boolean, projectId: string, baselineAnalysisId: string }`
  - Rule: Validates `analysis.status === 'COMPLETED'`.
- `GET /api/v1/projects/:id/drift?analysisId=<optional>`:
  - Response: `{ baselineAnalysisId: string, comparisonAnalysisId: string, baselineDate: string, comparisonDate: string, newlyIntroduced: Finding[], resolved: Finding[], persistent: Finding[], summary: { newCount: number, resolvedCount: number, persistentCount: number, scoreDelta: number, baselineScore: number, currentScore: number } }`
  - Finding identity: SHA-256 `finding.fingerprint` with multi-occurrence bucket matching.

### 3. Reproducibility Bundle API (`M3`)
- `GET /api/v1/analyses/:id/reproducibility-bundle`:
  - Response: `application/zip` with `Content-Disposition: attachment; filename="reproducibility-bundle-<analysisId>.zip"`
  - Contents: `manifest.json`, `normalized_hashes.json`, `findings_ledger.json`, `remediation_guide.md`
  - Security: `SecretRedactorService.redact()` applied to all sensitive text fields.

### 4. SAP Objects API (`M4`)
- `GET /api/v1/projects/:id/objects?page=1&pageSize=50&tier=...&search=...`:
  - Response: `{ objects: SapObject[], total: number, page: number, pageSize: number, cleanCoreStats: { tier1Count: number, tier2Count: number, tier3Count: number, total: number } }`
- `GET /api/v1/projects/:id/objects/:objectName`:
  - Response: `SapObjectDetail` (metadata, Clean Core Tier, target release compatibility, dependency links, linked findings).

---

## Code Layout
- Lab Package Schema: `packages/schemas/src/lab.ts`, `packages/schemas/src/index.ts`
- Backend Lab: `apps/api/src/modules/lab/lab.controller.ts`, `lab.service.ts`, `lab.module.ts`
- Frontend Lab: `apps/web/src/app/projects/[id]/lab/page.tsx`
- Backend Baselines & Drift: `apps/api/src/modules/projects/projects.service.ts`, `projects.controller.ts`, `apps/api/src/modules/analyses/analyses.service.ts`
- Frontend Baselines & Drift: `apps/web/src/app/projects/[id]/page.tsx`, `apps/web/src/components/findings/finding-columns.tsx`, `apps/web/src/lib/api-client.ts`
- Backend Reproducibility Bundle: `apps/api/src/modules/analyses/analyses.controller.ts`, `analyses.service.ts`
- Frontend Bundle Actions: `apps/web/src/app/projects/[id]/findings/page.tsx`, `apps/web/src/app/inspector/page.tsx`, `apps/web/src/app/projects/[id]/page.tsx`
- Backend Objects: `apps/api/src/modules/objects/objects.controller.ts`, `objects.service.ts`, `objects.module.ts`, `apps/api/src/app.module.ts`
- Frontend Objects: `apps/web/src/app/projects/[id]/objects/page.tsx`, `apps/web/src/components/objects/types.ts`, `object-detail-drawer.tsx`, `apps/web/src/components/findings/finding-columns.tsx`, `finding-detail-row.tsx`
- Anti-Facade Verification: `scripts/check-no-production-facades.mjs`
- Dependency Verification: `scripts/check-no-dependency-soup.mjs`
