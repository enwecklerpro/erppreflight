# Original User Request

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

## 2026-09-25T03:10:02Z

Execute and verify the next 4 critical enterprise capabilities in ERP Preflight (`H:/erppreflight`) based on Parts 05, 14, 15, and 16 of the Master Specification, providing interactive test generation, baseline comparison, audit bundles, and deep object inspection.

Working directory: `H:/erppreflight`
Integrity mode: development

---

## Requirements

### R1. Scenario & Regression Test Lab (`/projects/:id/lab`)
- Build an interactive Scenario & Regression Test Lab in `apps/web/src/app/projects/[id]/lab/page.tsx` and NestJS `LabModule` (`POST /api/v1/projects/:id/lab/generate`).
- Support synthetic fixture generation across 4 core domains:
  - OPD Output decision table scenarios (Email/Print/EDI channel test payloads)
  - Adobe Document Services (ADS) Form XML schema binding variations
  - MFS PLC telegram sequences with simulated conveyor topology events
  - Material Master (MATMAS) change pointer delta triggers
- Allow consultants to execute live test runs against preflight engines directly in the browser with pass/fail regression assertion ledgers.

### R2. Digital Project Baselines & Configuration Drift Engine
- Implement Project Baseline management in `apps/api/src/modules/projects/` and Web UI:
  - User can mark any completed analysis run as the official `PROJECT_BASELINE`.
  - Future analysis runs compare against the baseline to categorize findings into:
    - `KNOWN_BASELINE_RISK` (pre-existing accepted issues)
    - `NEWLY_INTRODUCED_RISK` (regression drift introduced since baseline)
    - `RESOLVED_RISK` (successfully mitigated issues)
- Visualize before/after drift metrics in project overview and findings ledger.

### R3. Cryptographic Reproducibility Bundle Downloader (`.zip`)
- Implement backend endpoint `GET /api/v1/analyses/:id/reproducibility-bundle` generating a signed ZIP export:
  - `manifest.json`: Engine versions, rule bundle versions, knowledge snapshot ID (`KNOW_SNAP_2026_09_24`), target SAP release.
  - `normalized_hashes.json`: SHA-256 hashes of original and sanitized input artifacts.
  - `findings_ledger.json`: Complete deterministic findings with cryptographic evidence pointers.
  - `remediation_guide.md`: Technical remediation steps tailored to the target release.
- Add "Download Reproducibility Bundle" action in Universal Inspector and Findings views.

### R4. Universal SAP Object Inspector (`/objects` & Modal)
- Implement universal object inspection in `apps/web/src/app/projects/[id]/objects/page.tsx` and interactive modal:
  - Displays object metadata (type: CDS, Table, BAdI, Class, Form, OPD Table, Telegram).
  - Target release compatibility and Clean Core Tier classification (Tier 1 Cloud, Tier 2 Released, Tier 3 Legacy).
  - Upstream and downstream dependencies with clickable graph links.
  - Associated active findings and audit history.

---

## Acceptance Criteria

### Test Lab & Synthetic Generation
- [ ] Users can generate synthetic test fixtures for OPD, Forms, MFS, and Change Pointers.
- [ ] Live execution runs test payloads against Python engines and returns deterministic regression results.
- [ ] Synthetic fixtures are clearly labeled with non-color indicators.

### Baselines & Drift
- [ ] Project workspace allows setting an analysis as active baseline.
- [ ] Subsequent preflights compute exact finding diffs (New, Resolved, Persistent).
- [ ] Executive summary highlights newly introduced risk vs existing accepted baseline risk.

### Reproducibility Bundle
- [ ] `GET /api/v1/analyses/:id/reproducibility-bundle` downloads a valid ZIP archive.
- [ ] Archive contains manifest, hashes, deterministic findings, and remediation markdown.
- [ ] Zero unredacted customer secrets or passwords contained in the bundle.

### Universal Object Inspector
- [ ] Clicking any known SAP object opens the detailed inspector drawer/modal.
- [ ] Object details show Clean Core tiering, release status, dependent transports, and linked findings.

### Quality & Performance Gates
- [ ] `pnpm run check:deps` passes with zero forbidden duplicate libraries.
- [ ] `pnpm run check:no-production-facades` passes with zero mock facades.
- [ ] `pnpm run typecheck` and `pnpm run build` complete with 0 TypeScript/compilation errors.
- [ ] 100% test pass rate across TypeScript (`pnpm run test`) and Python (`pnpm run test:python`).

