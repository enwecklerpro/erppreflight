# Handoff Report — Explorer Survey 1
**Mission**: Comprehensive Survey of R1 (Artifact Upload UI & Ingestion Pipeline), R2 (Durable BullMQ Worker Pipeline), and R3 (ClamAV Fail-Closed Production Security)  
**Date**: 2026-09-24T21:21:00Z  
**Author**: Explorer Survey 1 (`teamwork_preview_explorer`)  
**Working Directory**: `H:/erppreflight/.agents/teamwork/explorer_survey_1`  

---

## 1. Observation

### 1.1 Requirement R1: Artifact Upload UI & Ingestion Pipeline

#### A. Frontend UI (`apps/web/src/app/projects/[id]/page.tsx`)
- **Tab Registration**: Line 36 defines tab state `'overview' | 'findings' | 'objects' | 'artifacts' | 'history' | 'launcher'`. Line 178 registers the tab button:
  ```tsx
  { id: 'artifacts', label: 'Artifact Dropzone', icon: UploadCloud }
  ```
- **Tab Content (Lines 378–394)**: The current Artifact Dropzone tab renders a purely static facade:
  ```tsx
  {activeTab === 'artifacts' && (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <div className="text-center py-8">
        <UploadCloud className="h-12 w-12 text-primary mx-auto mb-3" />
        <h3 className="text-base font-bold text-foreground">Staged SAP Artifacts</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
          Secure quarantine scanning, MIME sniffing, and secret scrubbing for customer ZIPs, XML, and ABAP dumps.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1 rounded border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
            <FileCheck2 className="h-3.5 w-3.5" />
            Antivirus Scanner Active
          </span>
        </div>
      </div>
    </div>
  )}
  ```
- **Violations Identified**:
  - No `<input type="file">` or drag-and-drop dropzone exists.
  - No file staging list or table showing uploaded files for the project.
  - No TanStack Form or Zod client validation.
  - No upload mutation calling the backend API.
  - `apps/web/src/lib/api-client.ts` contains zero functions for requesting presigned uploads, confirming uploads, or querying uploaded files.
  - Violates Cardinal Axiom 1 (*"A page that renders is not a completed feature"*).

#### B. API Ingestion Endpoints (`apps/api`)
- **Absence of `POST /api/v1/projects/:id/artifacts`**:
  - Grep across `apps/api/src` for `artifacts` yields zero matches.
  - The existing upload controller is `apps/api/src/modules/ingestion/files.controller.ts` (lines 16–74):
    - Controller path: `@Controller('projects/:projectId/files')`
    - Routes:
      - `POST /api/v1/projects/:projectId/files/presign-upload` -> `requestPresignedUpload()`
      - `POST /api/v1/projects/:projectId/files/:fileId/confirm` -> `confirmUpload()`
      - `GET /api/v1/projects/:projectId/files/:fileId/presign-download` -> `getPresignedDownloadUrl()`
      - `GET /api/v1/projects/:projectId/files` -> `listFiles()`
      - `GET /api/v1/projects/:projectId/files/:fileId` -> `getFile()`
- **HTTP Platform**:
  - `apps/api/src/main.ts` (line 28) initializes NestJS with `NestFactory.create(AppModule, { bufferLogs: true })`, using `@nestjs/platform-express` (`package.json` line 30).
  - Multer or Fastify multipart is NOT currently registered or used. Uploads were architected to go directly to MinIO/S3 via presigned PUT URLs, followed by an API confirmation step (`confirmUpload`).
  - Either a direct multipart `POST /api/v1/projects/:id/artifacts` endpoint (or alias/wrapper around the ingestion pipeline) must be provided to fulfill R1.

#### C. Ingestion Pipeline Trace
1. **Magic Bytes Validation**: `apps/api/src/modules/ingestion/mime-magic.validator.ts`:
   - Inspects binary buffer headers for XML (`<?xml`), JSON (`{`, `[`), CSV, and ZIP (`PK\x03\x04`).
   - Rejects XXE injection with external `SYSTEM` entity (`SECURITY_XXE_DETECTED`).
   - Rejects spoofed PE Windows executables (`MZ` header) and Linux ELF binaries (`\x7fELF`).
2. **Archive Safety**: `apps/api/src/modules/ingestion/archive-safety.guard.ts`:
   - Blocks Zip Slip path traversal (`../`, `..\`).
   - Enforces max 500 MB uncompressed limit, max 100:1 compression ratio, and max 10,000 files.
3. **ClamAV Antivirus**: `apps/api/src/modules/ingestion/clamav.scanner.ts`:
   - Scans stream or buffer. Sets status to `QUARANTINED` if infected.
4. **Secret Redaction**: `apps/api/src/modules/redaction/secret-redactor.service.ts`:
   - Redacts SAP passwords, RFC destination tokens, private keys, AWS tokens.
5. **Clean Bucket Promotion**: `apps/api/src/modules/storage/s3-storage.service.ts`:
   - Promotes artifact from `erppreflight-quarantine` to `erppreflight-clean`.
   - Key layout: `tenants/{organization_id}/projects/{project_id}/{file_id}/{file_name}`.

#### D. Fetching Clean Artifacts for Analysis Runs
- **Current Defect in `JobsService`**:
  - In `apps/api/src/modules/jobs/jobs.service.ts` lines 131–151:
    ```typescript
    const wirePayload = toWireJobRequest({
      jobId: analysisId,
      tenantId: organizationId,
      projectId: projectId,
      engineType: engine,
      targetRelease: targetRelease as TargetRelease,
      artifactS3Key: artifactS3Key ?? null,
      artifactType,
      configuration: configuration ?? {},
      rawContent: rawContent ?? null,
    });
    const res = await fetch(`${this.analysisUrl}/api/v1/analyze`, ...);
    ```
  - When `artifactS3Key` is passed from the caller, `JobsService` does NOT retrieve the artifact from S3. It passes `rawContent: null` and forwards `artifactS3Key`.
- **Python Engine Architecture**:
  - In `services/analysis-python/src/engines/opd_guard.py` (lines 78–81, 142, 157–184) and other engines (`clean_core.py`, `ecc2cloud.py`, `iam_cost_guard.py`):
    The engines are stateless and decoupled; they have no S3 client. They inspect `request.raw_content` or `request.artifacts[].raw_content`.
  - Because `rawContent` is null, Python engines receive empty content, yielding zero parsed tables and incomplete determinations.
  - The API worker must use `S3StorageService.getCleanStream(artifactS3Key)` to stream the clean artifact into memory and populate `rawContent` before calling the Python `/api/v1/analyze` endpoint.

---

### 1.2 Requirement R2: Durable BullMQ Worker Pipeline

#### A. Current Analysis Job Enqueueing (`apps/api/src/modules/jobs/jobs.service.ts`)
- **Lines 72–98**:
  ```typescript
  // 1. Create analysis record
  await this.db.query(
    `INSERT INTO analyses (id, organization_id, project_id, status, engine_types, target_release, triggered_by)
     VALUES ($1, $2, $3, 'QUEUED', $4, $5, $6)`,
    [analysisId, organizationId, dto.projectId, JSON.stringify(dto.engineTypes), targetRelease, userId]
  );

  // 2. Dispatch asynchronously to Python analysis service
  this.runEngines(
    analysisId,
    organizationId,
    dto.projectId,
    dto.engineTypes,
    targetRelease,
    dto.artifactS3Key,
    dto.artifactType,
    dto.rawContent,
    dto.configuration
  ).catch((err) => {
    this.logger.error(`Error executing analysis job ${analysisId}: ${err.message}`);
  });
  ```
- **Observations**:
  - Jobs are NOT enqueued into Redis BullMQ!
  - `this.runEngines()` is invoked as an untracked, detached JavaScript Promise. If the Node.js process restarts, any running or queued analyses are lost immediately.
  - Queue `analysis-queue` does not exist in code (only documented in `PROJECT.md`).

#### B. BullMQ Infrastructure & `AnalysisProcessor`
- **Missing Processor**: `apps/api/src/modules/jobs/analysis.processor.ts` does NOT exist.
- **Unregistered BullModule**:
  - `@nestjs/bullmq` (^11.0.2) and `bullmq` (^5.41.6) are present in `apps/api/package.json`.
  - `apps/api/src/modules/ingestion/ingestion.processor.ts` defines an `@Processor('ingestion-queue')`, but `BullModule` is not imported anywhere in `app.module.ts`, `jobs.module.ts`, or `ingestion.module.ts`.
  - `BullModule.forRootAsync` and `BullModule.registerQueue({ name: 'analysis-queue' })` are completely absent.
- **Redis Connection**:
  - `apps/api/src/modules/jobs/redis-connection.factory.ts` exists and configures `ioredis` with `maxRetriesPerRequest: null`.

#### C. Status Transitions, Python Invocation & Tenant RLS Persistence
- **Status Transitions**:
  - Initial creation: `status = 'QUEUED'` (in `analyses` table).
  - On processor pickup: must transition to `status = 'RUNNING'`.
  - On completion: transitions to `COMPLETED` (or `PARTIAL` / `FAILED`), setting `completed_at = NOW()`.
- **Python Service Invocation**:
  - Endpoint: `POST ${ANALYSIS_SERVICE_URL}/api/v1/analyze` (default: `http://localhost:8000`).
  - Wire schema: `toWireJobRequest()` / `AnalysisJobRequestWireSchema` from `@erppreflight/schemas`.
  - Response schema: `AnalysisJobResponseSchema`.
- **RLS Persistence Invariant**:
  - Currently in `jobs.service.ts` lines 122, 197, 222, 246: queries bypass RLS with `{ bypassRls: true }` because `TenancyContext` (AsyncLocalStorage) is only populated during HTTP requests.
  - In `DatabaseService.ts` (lines 114–127), passing `{ tenantId: organizationId }` enables `withTenantTransaction(tenantId, ...)` which executes `SELECT set_config('app.current_tenant_id', $1, true)`.
  - Findings (`findings` table) and Evidence (`evidence` table) must be persisted within the tenant-scoped transaction so PostgreSQL RLS policies (`organization_id = get_current_tenant_id()`) are strictly enforced.

---

### 1.3 Requirement R3: ClamAV Fail-Closed Production Security

#### A. Scanner Implementation (`apps/api/src/modules/ingestion/clamav.scanner.ts`)
- **Constructor (Lines 18–22)**:
  ```typescript
  this.host = this.config.get<string>('CLAMAV_HOST', 'localhost');
  this.port = this.config.get<number>('CLAMAV_PORT', 3310);
  this.isMockMode = this.config.get<boolean>('CLAMAV_MOCK_MODE', true);
  ```
  *Note*: If `CLAMAV_MOCK_MODE` is provided as environment variable string `'false'`, `config.get<boolean>` may evaluate to truthy string `'false'`.
- **Unexpected Response Fallback (Lines 64–68)**:
  ```typescript
  } else {
    this.logger.warn(`ClamAV unexpected response: ${trimmed}, falling back to mock check`);
    resolve(this.mockScan(buffer, startTime));
  }
  ```
- **Socket Error Fallback (Lines 70–74)**:
  ```typescript
  socket.on('error', (err) => {
    this.logger.warn(`ClamAV socket connection failed (${err.message}), falling back to mock mode`);
    resolve(this.mockScan(buffer, startTime));
  });
  ```
- **Missing Socket Timeout**:
  - No `socket.setTimeout()` is configured. If ClamAV hangs, the Promise remains pending indefinitely.
- **Fail-Open Security Vulnerability**:
  - `mockScan()` only returns `isInfected: true` if the payload explicitly contains the string `'EICAR-STANDARD-ANTIVIRUS-TEST-FILE'`.
  - Any other file (including real, live malware) returns `{ isInfected: false }`.
  - In production (`CLAMAV_MOCK_MODE=false`), if ClamAV daemon is unreachable, drops the connection, or sends an unparseable response, **it falls back to `mockScan` and marks the file CLEAN!**
  - This is an enterprise security risk and directly violates Requirement R3.

#### B. Existing Unit Tests (`apps/api/test/ingestion_security.spec.ts`)
- **Lines 11–21 & 165–178**:
  - Test suite explicitly hardcodes `CLAMAV_MOCK_MODE: true`.
  - Only two tests exist:
    1. `passes clean business files` (mock mode).
    2. `detects EICAR standard test virus signature and quarantines` (mock mode).
- **Missing Tests**:
  - No test with `CLAMAV_MOCK_MODE: false`.
  - No test simulating `ECONNREFUSED` or daemon offline -> asserting fail-closed (`SCAN_FAILED`).
  - No test simulating socket timeout -> asserting fail-closed.
  - No test simulating unexpected daemon output (e.g. malformed greeting) -> asserting fail-closed.
  - No test validating standard `stream: OK` and `stream: <virus> FOUND` parsing over a live/mock TCP socket.

---

## 2. Logic Chain

```
[Observation 1.1A: Artifact Dropzone is static text card]
        │
        ▼
[Impact: Users cannot upload files from the workspace UI; Cardinal Axiom 1 violated]
        │
        ▼
[Observation 1.1B: No POST /api/v1/projects/:id/artifacts; existing API is presigned files controller]
        │
        ▼
[Deduction: Frontend and Backend upload contracts are disconnected; either POST /artifacts endpoint must be created or files controller wired to UI dropzone]
        │
        ▼
[Observation 1.1D: Python engines require raw_content; JobsService only forwards artifactS3Key without reading S3]
        │
        ▼
[Deduction: Analysis runs against uploaded files fail to find any rules because engine receives null payload]
        │
        ▼
[Observation 1.2A/B: JobsService runs detached promises; BullMQ is unconfigured; AnalysisProcessor does not exist]
        │
        ▼
[Impact: Preflight analyses lack durability, concurrency control, retry policies, and process-crash resilience]
        │
        ▼
[Observation 1.2C: runEngines uses bypassRls: true instead of scoped tenant transaction]
        │
        ▼
[Impact: Weakens tenant boundary in data persistence; violates Cardinal Axiom 2 & RLS mandate]
        │
        ▼
[Observation 1.3A: ClamAvScanner socket error & unknown response fall back to mockScan]
        │
        ▼
[Impact: In production, ClamAV daemon failure allows malware into clean bucket (fail-open disaster)]
        │
        ▼
[Observation 1.3B: Unit tests only test CLAMAV_MOCK_MODE = true]
        │
        ▼
[Conclusion: ClamAV must fail closed immediately on error when CLAMAV_MOCK_MODE is false, supported by robust TCP socket unit tests]
```

---

## 3. Caveats

1. **Read-Only Scope**: This report is purely observational and analytical. No production code or configuration files were modified.
2. **MinIO / ClamAV Live Daemons**: In local test environments, MinIO (port 9000) and ClamAV (port 3310) are typically provided via Docker Compose (`docker-compose.coolify.yml`). Unit tests in `vitest` should continue to support mock mode when daemons are unavailable, but must strictly verify fail-closed behavior when mock mode is deactivated.
3. **Upload Approach Trade-off**:
   - *Option A (Direct Multipart)*: Implement `POST /api/v1/projects/:id/artifacts` accepting `multipart/form-data` with Express Multer, streaming directly through `IngestionService.processFile(buffer)`.
   - *Option B (Presigned S3 + Confirm)*: Keep the existing presigned PUT flow (`/files/presign-upload` -> PUT MinIO -> `/files/:fileId/confirm`) and alias `POST /projects/:id/artifacts` or bind the Dropzone directly to it.
   - *Recommendation*: Support both, or provide `POST /api/v1/projects/:id/artifacts` that accepts either a direct multipart file or a JSON payload with `fileId`/`storagePath`, executing the full 5-stage ingestion verification pipeline and returning the clean artifact metadata.

---

## 4. Conclusion & Actionable Blueprint

### 4.1 Actions for Requirement R1 (Artifact Upload & Ingestion Pipeline)
1. **Frontend Dropzone Component**:
   - Replace lines 378–394 in `apps/web/src/app/projects/[id]/page.tsx` with an interactive, accessible Dropzone component.
   - Include drag-and-drop target, browse button, file format validation (`.xml`, `.json`, `.csv`, `.zip`, `.abap`), progress bar, and list of uploaded project artifacts with quarantine status badges (`CLEAN`, `QUARANTINED`, `PENDING_SCAN`).
   - Add `uploadArtifact` / `fetchProjectArtifacts` methods to `apps/web/src/lib/api-client.ts`.
2. **Ingestion Endpoint `POST /api/v1/projects/:id/artifacts`**:
   - In `apps/api/src/modules/ingestion/files.controller.ts` (or a dedicated `ArtifactsController`):
     Add `@Post('artifacts')` (or `@Controller('projects/:projectId/artifacts')`) handling artifact ingestion.
   - Connect the upload directly to `IngestionService.processFile(...)`, generating the clean key `tenants/{tenantId}/projects/{projectId}/{fileId}/{safeFileName}`.
3. **Connect Clean Artifacts to Analysis Runner**:
   - In `apps/api/src/modules/jobs/jobs.service.ts` (and `AnalysisProcessor`):
     When `artifactS3Key` is present and `rawContent` is null, retrieve the artifact from clean S3 storage via `S3StorageService.getCleanStream(artifactS3Key)` into a UTF-8 buffer/string and assign it to `rawContent` before sending the payload to Python.

### 4.2 Actions for Requirement R2 (Durable BullMQ Worker Pipeline)
1. **Register BullModule in `apps/api`**:
   - In `app.module.ts`: Import `BullModule.forRootAsync(...)` using Redis configuration from `ConfigService`.
   - In `jobs.module.ts`: Import `BullModule.registerQueue({ name: 'analysis-queue' })`.
2. **Implement `AnalysisProcessor` (`apps/api/src/modules/jobs/analysis.processor.ts`)**:
   - Create `@Processor('analysis-queue')` extending `WorkerHost`.
   - Implement `process(job: Job<AnalysisJobData>)`:
     - Updates status to `RUNNING`.
     - Fetches clean artifact from S3 if `artifactS3Key` is present.
     - Dispatches HTTP call to `${ANALYSIS_SERVICE_URL}/api/v1/analyze`.
     - Validates response with `AnalysisJobResponseSchema`.
     - Persists findings and evidence inside `db.withTenantTransaction(organizationId, ...)` or with `{ tenantId: organizationId }` to uphold RLS.
     - Updates status to `COMPLETED` (or `FAILED`).
3. **Refactor `JobsService.triggerAnalysis()`**:
   - Insert analysis row with status `'QUEUED'`.
   - Enqueue to `this.analysisQueue.add('analyze', jobData, { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 500 })`.
   - Return `{ analysisId, status: 'QUEUED', ... }` immediately (HTTP 202).

### 4.3 Actions for Requirement R3 (ClamAV Fail-Closed Production Security)
1. **Harden `apps/api/src/modules/ingestion/clamav.scanner.ts`**:
   - Parse `CLAMAV_MOCK_MODE`:
     `this.isMockMode = String(this.config.get('CLAMAV_MOCK_MODE', 'true')).toLowerCase() === 'true';`
   - In `scanBuffer()`:
     - Set socket timeout (`socket.setTimeout(10000)`).
     - On timeout, destroy socket:
       If `!this.isMockMode`, fail closed with error or return `{ isInfected: true, virusName: 'SCAN_FAILED_TIMEOUT', scanDurationMs }`.
     - On socket error (`socket.on('error')`):
       If `!this.isMockMode`, fail closed with error or return `{ isInfected: true, virusName: 'SCAN_FAILED_CONNECTION_ERROR', scanDurationMs }`. Under NO circumstances call `mockScan()` in production mode!
     - On unrecognized response:
       If `!this.isMockMode`, fail closed with `{ isInfected: true, virusName: 'SCAN_FAILED_UNRECOGNIZED_RESPONSE', scanDurationMs }`.
2. **Add Comprehensive Unit Tests in `apps/api/test/ingestion_security.spec.ts`**:
   - Test fail-closed on unreachable port (connection refused) with `CLAMAV_MOCK_MODE: false`.
   - Test fail-closed on socket timeout with `CLAMAV_MOCK_MODE: false`.
   - Test fail-closed on unexpected response string with `CLAMAV_MOCK_MODE: false`.
   - Test successful clean and infected detection with a mock TCP net server simulating the ClamAV `zINSTREAM` protocol.

---

## 5. Verification Method

To verify these findings and any future implementation:

1. **Inspect Files and Line References**:
   - `apps/web/src/app/projects/[id]/page.tsx`: Lines 378–394 (Dropzone placeholder).
   - `apps/api/src/modules/ingestion/files.controller.ts`: Lines 16–75 (existing endpoints).
   - `apps/api/src/modules/jobs/jobs.service.ts`: Lines 63–106 (`triggerAnalysis` detached promise), Lines 131–151 (`toWireJobRequest` missing S3 download).
   - `apps/api/src/modules/ingestion/clamav.scanner.ts`: Lines 64–74 (mock fallback on error).
   - `services/analysis-python/src/engines/opd_guard.py`: Lines 78–81, 142–184 (requires `raw_content`).

2. **Execute Existing Test Suites**:
   ```bash
   # Run API unit & security tests (Vitest)
   pnpm --filter @erppreflight/api test

   # Run Python engine tests (Pytest)
   pytest services/analysis-python/tests -v
   ```

3. **Invalidation Conditions**:
   - This report is invalidated if `POST /api/v1/projects/:id/artifacts` is already present under an unindexed alias.
   - This report is invalidated if an external microservice handles BullMQ queue consumption for `analysis-queue`.
