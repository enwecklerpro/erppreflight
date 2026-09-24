# Project: ERP Preflight - 7 Production SaaS Gaps

## Architecture
ERP Preflight is an enterprise multi-tenant SaaS platform for SAP preflight analysis, clean core auditing, migration verification, and release intelligence.
The current operational cycle closes the 7 production SaaS gaps to achieve an end-to-end verifiable preflight pipeline from browser file upload through BullMQ worker execution to persisted findings ledger.

### Monorepo Map & Boundaries
- `apps/web`: Next.js 15 App Router, React 19, Base UI, TanStack Query/Form/Table, Tailwind CSS. Communicates exclusively with `apps/api` via HTTP/REST.
- `apps/api`: NestJS 11 Core SaaS Backend, Express platform, Drizzle ORM, BullMQ Redis queues, S3/MinIO storage, multi-tenant PostgreSQL RLS.
- `services/analysis-python`: Stateless Python 3.13 FastAPI microservice with 18 SAP Preflight Engines + MFS BlackBox, deterministic SafeXmlParser, Pydantic models.
- `packages/*`: Shared leaf libraries (`@erppreflight/schemas`, `@erppreflight/database`, `@erppreflight/tenancy`, `@erppreflight/evidence`, `@erppreflight/auth`).
- `tests/e2e`: Playwright E2E test suite and fixtures.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| R1 | Real Artifact Upload UI & Ingestion Pipeline | Dropzone in `apps/web/src/app/projects/[id]/page.tsx`, `POST /api/v1/projects/:id/artifacts`, S3 clean storage promotion and fetching clean stream for Python engines | M2 | Survey 1 |
| R2 | Durable BullMQ Worker Pipeline | Queue separation in `JobsService`: enqueue to `analysis-queue` with exponential backoff, return HTTP 202 `QUEUED`; `AnalysisProcessor` executes background job, calls Python `/api/v1/analyze`, persists findings+evidence with tenant RLS | M2 | Survey 1 |
| R3 | ClamAV Fail-Closed Production Security | When `CLAMAV_MOCK_MODE=false`, socket error/timeout/unexpected response fails closed with `SCAN_FAILED`/`QUARANTINE_REJECTED`. Comprehensive unit tests. | M2 | Survey 1 |
| R4 | HttpOnly Session Cookies & Login/Signup UI | `apps/web/src/app/login/page.tsx`, `apps/web/src/app/signup/page.tsx`, `Set-Cookie: erppreflight_session=...` on register/login, `POST /api/v1/auth/logout`, dual Bearer/Cookie `JwtAuthGuard`, `credentials: 'include'` | M1 | Survey 2 |
| R5 | Canonical API URL Resolution | `NEXT_PUBLIC_API_URL` canonicalized to `/api/v1`, `resolveApiUrl()` auto-prepends `/api/v1` if missing, comprehensive unit test suite covering 9 URL permutations | M1 | Survey 2 |
| R6 | Dynamic Engine Matrix Failure Representation | No static `OPERATIONAL` fallback on API failure; render `STATUS: UNKNOWN` or `OFFLINE` with triad non-color severity indicators and retry prompt; `check-no-production-facades.mjs` verification | M3 | Survey 3 |
| R7 | Playwright E2E Suite & Known-Bad Fixture | `@playwright/test` setup, `known_bad_billing_opd.xml`, `opd_guard.py` XML parser + `OPD_DETERMINATION_STEP_MISSING` rule, and `tests/e2e/preflight-pipeline.spec.ts` | M4 | Survey 3 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| **M1** | Auth, Cookies & URL Resolution | R4 (Login/Signup UI, HttpOnly session cookie, logout, dual auth guard) + R5 (`resolveApiUrl()` auto-prepend `/api/v1`, 9-case unit tests) | none | PLANNED |
| **M2** | Ingestion, BullMQ & ClamAV Fail-Closed | R1 (Artifact Dropzone, upload endpoint, clean artifact fetch) + R2 (BullMQ `analysis-queue`, `AnalysisProcessor`, tenant RLS persistence) + R3 (ClamAV fail-closed, connection drop tests) | none | PLANNED |
| **M3** | Engine Matrix Dynamic Resilience | R6 (Dynamic status, unknown/offline representation, non-color indicators, retry prompt, anti-facade script) | none | PLANNED |
| **M4** | Playwright E2E Suite & OPD XML Support | R7 (`opd_guard.py` XML support, `known_bad_billing_opd.xml`, Playwright config & test suite) | M1, M2 | PLANNED |
| **M5** | Full Monorepo Quality Gates & Verification | Monorepo build, typecheck, lint, facade check, vitest/jest, pytest, playwright E2E, forensic audit | M1, M2, M3, M4 | PLANNED |

---

## Code Layout
- Frontend Auth: `apps/web/src/app/login/page.tsx`, `apps/web/src/app/signup/page.tsx`
- Frontend API Client & Dropzone: `apps/web/src/lib/api/custom-instance.ts`, `apps/web/src/lib/api-client.ts`, `apps/web/src/app/projects/[id]/page.tsx`
- Frontend Engine Matrix: `apps/web/src/components/engine-matrix.tsx`
- Backend Auth: `apps/api/src/modules/auth/auth.controller.ts`, `auth.service.ts`, `strategies/jwt.strategy.ts`
- Backend Ingestion: `apps/api/src/modules/ingestion/files.controller.ts`, `clamav.scanner.ts`
- Backend Jobs & Queues: `apps/api/src/modules/jobs/jobs.service.ts`, `analysis.processor.ts`, `jobs.module.ts`, `apps/api/src/app.module.ts`
- Python Analysis: `services/analysis-python/src/engines/opd_guard.py`, `tests/`
- E2E Testing: `playwright.config.ts`, `tests/fixtures/known_bad_billing_opd.xml`, `tests/e2e/preflight-pipeline.spec.ts`
- Anti-Facade Verification: `scripts/check-no-production-facades.mjs`
