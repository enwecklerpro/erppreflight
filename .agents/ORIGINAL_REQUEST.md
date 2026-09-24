# Original User Request

## 2026-09-24T01:10:30Z

Use a large team of agents for full-scale parallel build of all 18 engines and platform services.

Build ERP Preflight, a production-grade, enterprise-ready multi-tenant SaaS platform for SAP preflight analysis, clean core auditing, migration verification, and release intelligence, deployed end-to-end for Hostinger via Coolify.

Working directory: H:/erppreflight
Integrity mode: development

Reference specification: H:/erppreflight/ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md

## Requirements

### R1. Production Monorepo & Platform Foundation
Initialize and structure the repository as an enterprise-grade monorepo containing:
- Web Application: Next.js frontend with responsive UI, dashboard, project workspaces, analysis inspector, and role-based access.
- API Backend: NestJS core service handling multi-tenant auth, workspace/project management, file upload coordination, job queuing (BullMQ/Redis), and reporting APIs.
- Analysis Engine: Python FastAPI microservice providing deterministic parsing, rule-based evaluations, and statistical analysis.
- Shared Persistence: PostgreSQL database schema with migration scripts, pgvector indexing, and Redis for caching and coordination.
- Documentation & ADRs: IMPLEMENTATION_STATUS.md, ARCHITECTURE_DECISIONS.md, and deployment runbooks.

### R2. Complete Implementation of the 18 SAP Preflight Engines
Simultaneously build out deterministic parsers, domain rule engines, and analysis pipelines across all defined operational domains:
1. Output & Extensibility: OPD Guard, FormDoctor, Custom Field Flow Doctor, Extension Impact Guard.
2. Migration & Clean Core: SPRO2Cloud, ECC2Cloud Navigator, SAP Gap Radar, Clean Core Object Guard.
3. Integration: Change Pointer Coverage Auditor, API Change Guard.
4. Release & Transport: Software Collection Dependency Guard, Transport Dependency Analyzer.
5. Operations: Safe Decommission Preflight, Fiori 403 Root-Cause Doctor, Workflow Stuck Explainer, IAM Cost Optimizer, Account Determination Preflight, System Refresh Delta Guard.
6. Warehouse Automation: MFS BlackBox.
7. Shared Platform Services: Evidence Engine, Confidence Classifier (VERIFIED, RULE_DERIVED, INFERRED, UNKNOWN), AI Problem Router with pluggable LLM gateway, and Audit Trail.

### R3. Secure Ingestion Pipeline & Multi-Tenant Isolation
- Ingestion pipeline with file format validation (XML, JSON, CSV, ZIP, ABAP/text), quarantine scanning, and secret/credential redaction.
- Signed, short-lived URLs for file storage and generated preflight audit reports (PDF/JSON/CSV).
- Multi-tenant data segregation enforcing tenant boundaries on every database query and storage artifact.

### R4. Hostinger & Coolify End-to-End Deployment Configuration
- Provide production-ready docker-compose.coolify.yml orchestrating web, api, analysis-python, postgresql, and redis containers.
- Pinned container Dockerfiles with multi-stage builds, non-root execution, and minimal image footprint.
- Comprehensive .env.example documenting all configuration keys (database, redis, storage, auth secrets, Coolify domains).
- Standardized health check endpoints (/health/liveness, /health/readiness) for every service container.
- Automated database migration runner executed during container startup before traffic ingress.

## Acceptance Criteria

### Automated Build & Code Quality
- [ ] Monorepo build passes cleanly via pnpm run build with zero TypeScript errors.
- [ ] Code formatting and linting pass via pnpm run lint across all packages.
- [ ] Python analysis service passes pytest test suite with 100% test success rate.
- [ ] Backend NestJS unit and integration tests pass via pnpm test.

### Functional Engine & End-to-End Pipeline
- [ ] Deterministic parsing and analysis verified with fixture test data for all 18 engines.
- [ ] Ingestion pipeline successfully validates test uploads, quarantines invalid formats, redacts secrets, and enqueues jobs into Redis.
- [ ] Asynchronous worker processes analysis jobs, writes structured findings into PostgreSQL, and assigns valid provenance classes (VERIFIED, RULE_DERIVED, INFERRED).
- [ ] Export engine successfully generates downloadable preflight assessment reports.

### Coolify & Hostinger Readiness
- [ ] docker-compose.coolify.yml launches all services (docker compose -f docker-compose.coolify.yml up -d) with zero crash loops.
- [ ] Healthcheck endpoints for web, api, and analysis-python return HTTP 200 OK within 60 seconds of container boot.
- [ ] Database migrations execute automatically and idempotently on boot without manual intervention.

## 2026-09-24T02:48:48Z

Focused multi-agent team for TanStack architecture, library standardization, and agent skills playbooks.

Implement the curated library stack (Part 21), repository-local agent skills and playbooks (Part 22), and full TanStack suite architecture in ERP Preflight inside `H:/erppreflight`.

Working directory: H:/erppreflight
Integrity mode: development

References:
- H:/erppreflight/21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md
- H:/erppreflight/22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md
- H:/erppreflight/ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md

## Requirements

### R1. Repository Agent Skills & Architecture Playbooks (Part 22)
- Author all 8 canonical markdown playbook files in `/.agents/skills/`:
  1. `frontend-design-system.md`: shadcn/Base UI rules, design tokens, light/dark accessibility, typography, responsive behavior.
  2. `data-table-and-large-list.md`: TanStack Table & Virtualization rules, URL-backed filters, keyboard accessibility.
  3. `dependency-graph.md`: React Flow (`@xyflow/react`) rules, ELK layout, graph IDs, accessible table fallback.
  4. `engine-authoring.md`: Standard engine structure (metadata, input schema, parser, deterministic rules, finding codes, evidence, test fixtures).
  5. `sap-evidence.md`: Release-specific SAP facts, provenance tracking, clean core distinction, UNKNOWN confidence rules.
  6. `release-aware-knowledge.md`: Knowledge versioning, product edition tagging, checksum tracking.
  7. `secure-file-parser.md`: Magic bytes verification, size/archive limits, XXE/path-traversal protection, secret scrubbing.
  8. `multi-tenant-security.md`: Tenant isolation rules, RLS enforcement, presigned URLs.
- Create root `AGENTS.md` specifying triggers, mapping agent roles to playbooks, and establishing non-negotiable architectural invariants.

### R2. Curated Library Standardization & Clean Monorepo Alignment (Part 21)
- Standardize dependencies across `apps/web` and packages:
  - Base UI + shadcn/ui component layer with Tailwind CSS, Lucide icons, and disciplined Motion (`motion/react`) respecting `prefers-reduced-motion`.
  - Zod 4 runtime schema validation across boundaries.
  - Orval configuration for OpenAPI client and typed hook generation.
  - `@xyflow/react` integration for dependency graph visualization.
- Ensure strict zero-duplication policy (no React Hook Form, no Redux, no mixing incompatible primitive frameworks).

### R3. Enterprise TanStack Suite Architecture & Reusable Primitives
- **TanStack Query**:
  - Centralized SSR-safe QueryClient factory in `apps/web` preventing client singleton leaks during Next.js App Router SSR.
  - Type-safe query and mutation hook patterns with automated cache invalidation and optimistic updates.
- **TanStack Table & Virtual**:
  - Enterprise data table component (`DataTable`) supporting multi-column sorting, facet filtering, column visibility toggles, pagination, and bulk selection.
  - Seamless virtualization integration with `@tanstack/react-virtual` for handling tens of thousands of rows without DOM bloat.
  - Dedicated reference tables for Findings and SAP Object Inventory with CSV/JSON export actions.
- **TanStack Form**:
  - Type-safe form abstraction integrated with Zod validation schemas and accessible input components.
- **TanStack Pacer**:
  - Utility hooks for debounced global search, throttled filter queries, and batch input handling.

## Acceptance Criteria

### Playbooks & Governance Verification
- [ ] All 8 canonical playbooks exist in `/.agents/skills/` and strictly follow the specification in Part 22.
- [ ] Root `AGENTS.md` is present and valid, mapping each playbook to its trigger context and invariants.

### Build & Type Safety
- [ ] `apps/web` and monorepo packages build cleanly (`pnpm run build`) with zero TypeScript errors.
- [ ] Monorepo passes lint check (`pnpm run lint`) without dependency or schema violations.

### TanStack Suite Functionality & Tests
- [ ] Automated tests verify SSR-safety and query hydration of the QueryClient factory.
- [ ] Unit and component tests verify TanStack Table sorting, filtering, selection, and virtualized row rendering.
- [ ] TanStack Form validation tests confirm correct Zod schema validation errors and submission workflows.
- [ ] Reference pages for Findings and SAP Object Inventory render cleanly and interact with virtualized data grids.

## 2026-09-24T21:12:00Z

Execute and verify the 7 core production SaaS gaps in ERP Preflight (`H:/erppreflight`), delivering an end-to-end verifiable migration preflight pipeline from browser file upload through BullMQ worker execution to persisted findings ledger.

Working directory: `H:/erppreflight`
Integrity mode: development

---

## Requirements

### R1. Real Artifact Upload UI & End-to-End Ingestion Pipeline
- Build an accessible drag-and-drop / file-picker Upload component in `apps/web/src/app/projects/[id]/page.tsx` (Artifact Dropzone tab).
- Connect the frontend upload action to NestJS ingestion endpoint `POST /api/v1/projects/:id/artifacts`.
- Pipeline: Uploaded artifact -> Magic bytes validation -> Quarantine storage (`erppreflight-quarantine`) -> ClamAV scan -> Secret redaction -> Clean storage (`erppreflight-clean`).
- Connect clean artifacts to Preflight Analysis runs: when an analysis job is triggered, the worker fetches the clean artifact content from S3/MinIO and passes it to the target Python Preflight engines.

### R2. Durable BullMQ Worker Pipeline (Queue Separation)
- Refactor `triggerAnalysis()` in `apps/api/src/modules/jobs/jobs.service.ts`:
  - Enqueue job into BullMQ Redis queue `analysis-queue` with job options (attempts: 3, exponential backoff, removeOnComplete: 100, removeOnFail: 500).
  - Immediately return HTTP 202 / queued job record with `status: QUEUED`.
- Implement a dedicated BullMQ worker processor (`AnalysisProcessor` in `apps/api/src/modules/jobs/analysis.processor.ts`):
  - Consumes jobs from `analysis-queue`.
  - Sets analysis status to `RUNNING`.
  - Retrieves clean artifact from S3 if `artifactS3Key` is present, or uses inline content.
  - Calls Python analysis service (`http://analysis-python:8000/analyze`).
  - Persists findings and cryptographic evidence into PostgreSQL with tenant RLS.
  - Updates analysis status to `COMPLETED` or `FAILED`.

### R3. ClamAV Fail-Closed Production Security
- Modify `apps/api/src/modules/ingestion/clamav.scanner.ts`:
  - When `CLAMAV_MOCK_MODE` is `false` (production): any socket error, connection timeout, daemon failure, or unrecognized response MUST fail closed with `SCAN_FAILED` / `QUARANTINE_REJECTED`.
  - Under no circumstances shall an unverified file fall back to mock clean in production mode.
  - Add unit tests verifying fail-closed behavior on connection drop.

### R4. HttpOnly Session Cookies & Login / Signup User Interface
- Implement standard authentication web pages in `apps/web`:
  - `apps/web/src/app/login/page.tsx`: email & password login with validation errors and link to signup.
  - `apps/web/src/app/signup/page.tsx`: organization name, email, password registration form.
- Enhance NestJS `AuthController`:
  - Issue `Set-Cookie: erppreflight_session=...; HttpOnly; Secure; SameSite=Lax; Path=/` on login and register.
  - Provide `POST /api/v1/auth/logout` endpoint that clears the session cookie.
  - Support both `Authorization: Bearer <token>` and `Cookie: erppreflight_session=<token>` in `JwtAuthGuard`.
- Update `apps/web/src/lib/api/custom-instance.ts` to include credentials (`credentials: 'include'`).

### R5. Canonical API URL Resolution
- Fix `apps/web/src/lib/api/custom-instance.ts` and environment configuration:
  - Canonicalize `NEXT_PUBLIC_API_URL` to `https://api.erppreflight.com/api/v1` in production (and `http://localhost:3001/api/v1` in development).
  - Update `resolveApiUrl()` so that if `path` does not begin with `/api/v1` and `cleanBase` does not end with `/api/v1`, `/api/v1` is automatically prepended.
  - Add test coverage for `resolveApiUrl` handling all URL permutations without 404s.

### R6. Dynamic Engine Matrix Failure Representation (No Static Fallback)
- Update `apps/web/src/components/engine-matrix.tsx` and `apps/web/src/lib/api-client.ts`:
  - When the engine status query fails or is unreachable, the UI must NOT fall back to static `OPERATIONAL`.
  - It must explicitly render `STATUS: UNKNOWN` or `OFFLINE` with non-color severity indicators and a retry prompt.
  - Update `scripts/check-no-production-facades.mjs` to assert that no static `OPERATIONAL` status fallback is used on API failure.

### R7. Playwright E2E Test Suite with Known-Bad SAP Golden Fixture
- Add `@playwright/test` to monorepo test harness.
- Create an automated end-to-end test (`tests/e2e/preflight-pipeline.spec.ts`):
  - User signs up -> Logs in.
  - Creates a new project workspace for S/4HANA 2023.
  - Uploads a golden defective SAP fixture (e.g. `tests/fixtures/known_bad_billing_opd.xml` with missing email channel).
  - Triggers preflight analysis.
  - Waits for BullMQ worker completion.
  - Asserts that `findingsCount >= 1`.
  - Asserts finding rule ID is `OPD_DETERMINATION_STEP_MISSING`.
  - Asserts evidence contains exact file pointer and non-empty SHA-256 hash.
  - Asserts finding appears in Findings Ledger table and updates Executive Dashboard Clean Core Index.

---

## Acceptance Criteria

### Ingestion & End-to-End Pipeline
- [ ] Users can drag-and-drop or select files in the Project Workspace Artifact Dropzone.
- [ ] Uploaded files undergo ClamAV scan and are stored in S3 clean bucket.
- [ ] Analysis execution fetches the clean file from S3 and delivers findings to the ledger.

### BullMQ Durability
- [ ] `POST /api/v1/analyses` enqueues an asynchronous BullMQ job and returns HTTP 202 / QUEUED immediately.
- [ ] `AnalysisProcessor` executes the analysis in the background and transitions status from `RUNNING` to `COMPLETED`.
- [ ] NestJS API tests pass with mocked or in-memory BullMQ Redis queue.

### Security
- [ ] `ClamAvScanner` rejects files with `SCAN_FAILED` when ClamAV daemon is unreachable and `CLAMAV_MOCK_MODE=false`.
- [ ] Authentication endpoints set HttpOnly session cookies.
- [ ] `Trivy` in `.github/workflows/security.yml` enforces `exit-code: 1` on unaccepted critical vulnerabilities.

### Frontend & Routing
- [ ] `/login` and `/signup` routes are accessible, fully styled, and functional.
- [ ] `resolveApiUrl()` correctly routes browser requests to `/api/v1/*` without 404 errors.
- [ ] `EngineMatrix` displays `OFFLINE` / `UNKNOWN` when the API is disconnected.
- [ ] `pnpm run check:no-production-facades` passes with zero violations.

### Verification & E2E
- [ ] Playwright E2E test runs against live/staging services, verifying artifact upload, BullMQ analysis, and finding persistence with exact SHA-256 evidence match.
- [ ] `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, and all unit tests pass with 100% success rate.

