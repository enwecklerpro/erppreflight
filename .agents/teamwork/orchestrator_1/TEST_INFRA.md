# E2E Test Infra: ERP Preflight

## Test Philosophy
- Opaque-box, requirement-driven end-to-end verification.
- Validates the complete user journey from browser login and project setup to artifact upload, BullMQ background analysis, and verified finding persistence in the Findings Ledger and Clean Core Index.

## Feature Inventory Coverage (R1 - R7)
| # | Feature | Requirement | Verification Method |
|---|---------|-------------|---------------------|
| 1 | Artifact Upload UI & Ingestion | R1 | Playwright file upload into Dropzone, API HTTP 201/200, clean storage promotion |
| 2 | Durable BullMQ Pipeline | R2 | BullMQ queue job enqueue, status transition to RUNNING then COMPLETED, DB persistence |
| 3 | ClamAV Fail-Closed Security | R3 | Vitest unit tests simulating connection drop and timeout with CLAMAV_MOCK_MODE=false |
| 4 | HttpOnly Session Cookies & Auth UI | R4 | Playwright signup & login form interaction, Set-Cookie header assertion, authenticated navigation |
| 5 | Canonical API URL Resolution | R5 | Vitest unit tests across 9 URL permutations and Playwright request interception |
| 6 | Dynamic Engine Matrix Resilience | R6 | Vitest/Playwright assertion verifying OFFLINE/UNKNOWN on API failure, anti-facade script |
| 7 | Full Preflight Pipeline with Defective SAP XML | R7 | Playwright E2E spec verifying `OPD_DETERMINATION_STEP_MISSING` finding and SHA-256 evidence pointer |

## Test Architecture
- Test Runner: `@playwright/test`
- Configuration: `playwright.config.ts` (baseURL: `http://localhost:3000`, testDir: `tests/e2e`)
- Golden Fixture: `tests/fixtures/known_bad_billing_opd.xml` (Missing Channel determination for F2 billing)
- E2E Spec: `tests/e2e/preflight-pipeline.spec.ts`

## Pass/Fail Criteria
- User can register and log in via UI forms receiving `erppreflight_session` HttpOnly cookie.
- User can create an S/4HANA 2023 project workspace.
- User can drag/drop `known_bad_billing_opd.xml` into the Artifact Dropzone tab.
- Preflight analysis executes asynchronously via BullMQ and completes without error.
- Findings Ledger displays at least 1 finding with rule ID `OPD_DETERMINATION_STEP_MISSING`.
- Finding detail displays non-empty SHA-256 evidence hash and artifact reference.
- Executive Dashboard reflects the Clean Core Index reduction.
