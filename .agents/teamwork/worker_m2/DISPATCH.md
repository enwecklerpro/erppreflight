# Worker M2 Dispatch

## 2026-09-24T21:22:18Z

You are Worker M2 (teamwork_preview_worker).
Your working directory is H:/erppreflight/.agents/teamwork/worker_m2.
You MUST read the original user request at H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md before starting.
Also review the comprehensive blueprint prepared by Explorer 1 at:
H:/erppreflight/.agents/teamwork/explorer_survey_1/handoff.md
And adhere to H:/erppreflight/AGENTS.md, /.agents/skills/secure-file-parser.md, and /.agents/skills/multi-tenant-security.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP (You may ONLY edit or create these files):
- apps/api/src/modules/ingestion/clamav.scanner.ts
- apps/api/test/ingestion_security.spec.ts
- apps/api/src/modules/jobs/jobs.service.ts
- apps/api/src/modules/jobs/analysis.processor.ts
- apps/api/src/modules/jobs/jobs.module.ts
- apps/api/src/app.module.ts
- apps/api/src/modules/ingestion/files.controller.ts
- apps/web/src/app/projects/[id]/page.tsx

TASKS FOR MILESTONE M2:
1. R3: ClamAV Fail-Closed Production Security in `apps/api/src/modules/ingestion/clamav.scanner.ts`:
   - Parse `CLAMAV_MOCK_MODE`:
     `this.isMockMode = String(this.config.get('CLAMAV_MOCK_MODE', 'true')).toLowerCase() === 'true';`
   - In `scanBuffer()`:
     - Set socket timeout (`socket.setTimeout(10000)`). On timeout, if `!this.isMockMode`, fail closed with error or return `{ isInfected: true, virusName: 'SCAN_FAILED_TIMEOUT', scanDurationMs }`.
     - On socket error (`socket.on('error')`): If `!this.isMockMode`, fail closed with error or return `{ isInfected: true, virusName: 'SCAN_FAILED_CONNECTION_ERROR', scanDurationMs }`. NEVER call `mockScan()` in production mode!
     - On unexpected response: If `!this.isMockMode`, fail closed with `{ isInfected: true, virusName: 'SCAN_FAILED_UNRECOGNIZED_RESPONSE', scanDurationMs }`.
   - Update `apps/api/test/ingestion_security.spec.ts` with comprehensive unit tests:
     - Verify fail-closed when `CLAMAV_MOCK_MODE=false` on unreachable socket / connection refused.
     - Verify fail-closed on socket timeout with `CLAMAV_MOCK_MODE=false`.
     - Verify fail-closed on unexpected response string with `CLAMAV_MOCK_MODE=false`.
     - Ensure existing tests with mock mode continue to pass.
2. R2: Durable BullMQ Worker Pipeline & S3 Clean Fetch:
   - Register `BullModule` in `apps/api/src/app.module.ts`:
     - Import `BullModule.forRootAsync({ useFactory: (config: ConfigService) => ({ connection: { host: config.get('REDIS_HOST', 'localhost'), port: config.get('REDIS_PORT', 6379), maxRetriesPerRequest: null } }), inject: [ConfigService] })`.
   - In `apps/api/src/modules/jobs/jobs.module.ts`:
     - Register queue: `BullModule.registerQueue({ name: 'analysis-queue' })`.
     - Register `AnalysisProcessor` as provider.
   - Refactor `triggerAnalysis()` in `apps/api/src/modules/jobs/jobs.service.ts`:
     - Insert analysis record with `status: 'QUEUED'`.
     - Add job to BullMQ queue: `this.analysisQueue.add('analyze', jobPayload, { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 500 })`.
     - Immediately return HTTP 202 / queued analysis record.
   - Create `AnalysisProcessor` (`apps/api/src/modules/jobs/analysis.processor.ts`):
     - `@Processor('analysis-queue')` extending `WorkerHost`.
     - On processing: transitions status to `RUNNING`.
     - If `artifactS3Key` is present and `rawContent` is null, retrieves clean artifact from S3 via `S3StorageService.getCleanStream(artifactS3Key)` into memory and populates `rawContent`.
     - Calls Python analysis service (`POST ${ANALYSIS_SERVICE_URL}/api/v1/analyze`).
     - Validates response schema and persists findings & evidence into PostgreSQL with tenant context (`organization_id = tenantId`).
     - Transitions status to `COMPLETED` (or `FAILED`).
3. R1: Artifact Upload Endpoint & Dropzone UI:
   - In `apps/api/src/modules/ingestion/files.controller.ts`:
     - Provide `POST /api/v1/projects/:projectId/artifacts` (or route supporting file upload / artifact staging) that connects to `IngestionService.processFile(...)`.
   - In `apps/web/src/app/projects/[id]/page.tsx`:
     - Replace the static placeholder card on lines 378-394 with a real, accessible Artifact Dropzone component with file input, drag-and-drop, format validation (.xml, .json, .csv, .zip, .abap), upload mutation, and listing of uploaded project artifacts with quarantine status badges.

VERIFICATION:
Run tests:
- `pnpm --filter @erppreflight/api test`
- `pnpm run typecheck`
Document all changes, test commands, and test results in `H:/erppreflight/.agents/teamwork/worker_m2/handoff.md`. Send completion message when done.
