# Dispatch Record

## 2026-09-24T21:13:54Z

Execute and verify the 7 core production SaaS gaps in ERP Preflight:
1. R1: Real Artifact Upload UI & End-to-End Ingestion Pipeline (Dropzone tab in apps/web/src/app/projects/[id]/page.tsx -> POST /api/v1/projects/:id/artifacts -> Magic bytes -> Quarantine -> ClamAV -> Secret redaction -> Clean storage -> analysis job fetches clean artifact from S3/MinIO and feeds target engines).
2. R2: Durable BullMQ Worker Pipeline (Queue Separation: triggerAnalysis enqueues to 'analysis-queue', returns HTTP 202 / QUEUED immediately; dedicated AnalysisProcessor consumes job, transitions status RUNNING -> COMPLETED/FAILED, fetches artifact, calls Python engine, persists findings + evidence with tenant RLS).
3. R3: ClamAV Fail-Closed Production Security (When CLAMAV_MOCK_MODE=false, socket errors/timeouts/failures must fail closed with SCAN_FAILED/QUARANTINE_REJECTED. Add unit tests for connection drop).
4. R4: HttpOnly Session Cookies & Login/Signup UI (apps/web/src/app/login/page.tsx, apps/web/src/app/signup/page.tsx, Set-Cookie erppreflight_session on auth controller, POST /api/v1/auth/logout, JwtAuthGuard supports Cookie and Bearer, credentials: 'include' in custom-instance.ts).
5. R5: Canonical API URL Resolution (Canonicalize NEXT_PUBLIC_API_URL to /api/v1, update resolveApiUrl to auto-prepend /api/v1 if missing, add tests for all URL permutations).
6. R6: Dynamic Engine Matrix Failure Representation (No static OPERATIONAL fallback on API failure; render STATUS: UNKNOWN or OFFLINE with non-color severity indicators and retry prompt; update scripts/check-no-production-facades.mjs).
7. R7: Playwright E2E Test Suite with Known-Bad SAP Golden Fixture (@playwright/test in monorepo, tests/e2e/preflight-pipeline.spec.ts verifying signup, login, project creation, defective XML upload, analysis trigger, BullMQ worker completion, findingsCount >= 1, OPD_DETERMINATION_STEP_MISSING, SHA-256 evidence pointer, Findings Ledger and Dashboard Clean Core Index update).

Follow repository guidelines in AGENTS.md, maintain progress.md and BRIEFING.md in your working directory. Ensure all monorepo checks pass (pnpm run build, pnpm run typecheck, pnpm run lint, unit tests, and Playwright E2E). When complete and verified, report victory so that the independent victory audit can be triggered.
