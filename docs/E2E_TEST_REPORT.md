# E2E & Quality-Gate Test Report

> Spec C §75 #5 and 13.12 ("exact commands run and test results").

| Field | Value |
|---|---|
| Commit | `6303f1d` on `claude/sharp-mendel-xg6cus` (final merged tree) |
| Date | 2026-09-26 |
| Run by | Coordinator, in the build sandbox |
| Deployment checked | **None.** No production (erppreflight.com) or staging deployment was tested. Every "live" result below ran against a local stack. |
| GitHub Actions | **Never executed on GitHub.** Workflows are actionlint-clean; their commands were run locally. |

## 1. Environment

| Item | Value |
|---|---|
| Infrastructure | Containers from `docker-compose.coolify.yml` images: `pgvector/pgvector:pg16`, `redis:7.2-alpine`, `elestio/minio`, `clamav/clamav` (real clamd, real signatures) |
| API | `node apps/api/dist/src/main.js`, `NODE_ENV=production`, `DB_RUNTIME_ROLE=erppreflight_app`, `MAIL_TRANSPORT=dev` |
| Analysis | `services/analysis-python` (uvicorn), 19 engines |
| Web | Next.js production build (`next start` / standalone) |
| External SaaS | Contract test doubles only (`apps/api/test/doubles/run-doubles.cjs`): Cloud ALM, Jira, Azure DevOps, ServiceNow, OData, Git, OIDC IdP. No real Stripe/SMTP/AI provider |

## 2. Static gates and unit/integration suites

| Command | Result | Skipped / failed |
|---|---|---|
| `pnpm run check:deps` / `check:no-production-facades` / `check:production-truth` | pass / pass / pass | — |
| `pnpm run typecheck` | 13/13 packages, 0 errors | — |
| `pnpm run lint` | pass | — |
| `pnpm run build` | pass | — |
| `pnpm --filter @erppreflight/api run test:boot` | pass (AppModule DI graph resolves) | — |
| `pnpm run test` | **API 979, web 233, local-agent 10 passed** | 0 skipped, 0 failed |
| `pnpm run test:python` (`pytest services/analysis-python/tests`) | **1169 passed** | **1 skipped**, 0 failed. The only skip markers in the suite are the `pytest.importorskip("opentelemetry…")` calls in `tests/test_observability.py` (optional OTel SDK not installed) |
| `python -m pytest tests/e2e tests/empirical_redaction_stress.py -q` | **267 passed** | 0 |
| `python scripts/generate-engine-catalog.py --check` | up to date (19 engines, 130 declared rules) | — |
| `PG_ADMIN_URL=postgres://… bash scripts/ci-migration-check.sh` | migrations 001–019 apply on a fresh DB; second run no-op; deterministic `pg_dump`; **62 tenant tables** with ENABLE + FORCE RLS + policy; `erppreflight_app` NOSUPERUSER NOBYPASSRLS | — |

## 3. Live suites (real services, no mocks except external SaaS doubles)

All passed on the final tree. Environment variables are the ones the scripts read.

| Suite | Command | Result |
|---|---|---|
| API smoke | `API_BASE_URL=http://localhost:3001 [MAIL_DEV_OUTBOX_TOKEN=…] bash scripts/e2e-live-smoke.sh` (`pnpm smoke:live`) | **77/77** — register/login, e-mail verification, reset, 2FA, invitations, org switch, GDPR export/deletion, upload + ClamAV CLEAN, OPD Guard run, exports, cross-tenant denials, redaction at rest |
| UI core journey (Chromium) | `WEB_URL=… [API_URL=…] [MAIL_DEV_OUTBOX_TOKEN=…] [CHROMIUM_PATH=…] node scripts/e2e-ui-smoke.cjs` | pass |
| Account UI | `WEB_URL=… node scripts/e2e-account-ui-smoke.cjs` | pass |
| Public site EN/DE | `WEB_URL=… node scripts/e2e-public-smoke.cjs` | pass |
| Commercial / governance API | `API_BASE_URL=… SUPER_ADMIN_EMAIL=… SUPER_ADMIN_PASSWORD=… [STRIPE_WEBHOOK_SECRET=whsec_…] python3 scripts/e2e-commercial-smoke.py` | pass (~64 checks) |
| Commercial UI | `WEB_URL=… API_BASE_URL=… SUPER_ADMIN_EMAIL=… SUPER_ADMIN_PASSWORD=… node scripts/e2e-commercial-ui.cjs` | 17 steps pass |
| Findings | `WEB_URL=… API_BASE_URL=… MAIL_DEV_OUTBOX_TOKEN=… node scripts/e2e-findings-smoke.cjs` | 14 pass |
| Analyze / router | `WEB_URL=… API_BASE_URL=… MAIL_DEV_OUTBOX_TOKEN=… node scripts/e2e-analyze-smoke.cjs` | 13 pass |
| Free tools | `WEB_URL=… API_BASE_URL=… [SUPER_ADMIN_EMAIL/PASSWORD] node scripts/e2e-tools-smoke.cjs` | 24 pass |
| i18n (DE) + 375/1440 px | `WEB_URL=… node scripts/e2e-i18n-smoke.cjs` (`pnpm smoke:i18n`) | 32 app pages + 5 public pages in DE pass |
| Enterprise integrations | `API_BASE_URL=… DOUBLES_FILE=… DATABASE_URL=… METRICS_TOKEN=… MAIL_DEV_OUTBOX_TOKEN=… node scripts/e2e-enterprise-live.cjs` | **85/85** (see note) |
| Integrations UI | `WEB_URL=… API_BASE_URL=… DOUBLES_FILE=… node scripts/e2e-integrations-ui.cjs <dir>` | **17/17** |
| Combined CI job | `PG_ADMIN_URL=… S3_ACCESS_KEY=… S3_SECRET_KEY=… bash scripts/ci-live-e2e.sh` | API + UI + analyze + findings + i18n + tools smoke, backup/restore drill |

**Note on the enterprise suite.** It passed 85/85 with the enterprise API as the only consumer of its database. When a
second API process (without `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true`) shared the same database, its outbox dispatcher
picked up the webhook event first and refused the private test receiver, so one webhook-replay check failed. This is an
artifact of the test environment, not a product defect; run the suite with one API per database.

## 4. Specific live observations

- Real SAP Cloudification Repository sync: 13 files, 68,627 objects, 341,247 release states, 10,160 successor edges, ~37 s; second run NOOP.
- Clean Core on real ABAP: `SELECT … MARA` (line 4), `UPDATE BSEG` (line 7), `CALL FUNCTION 'BAPI_MATERIAL_SAVEDATA'` (line 8) flagged VERIFIED with official successors from the snapshot; `I_PRODUCT`, `CL_ABAP_TYPEDESCR` and text in string literals not flagged.
- SSO enforcement: `enforce_sso` on → password login 403 `SSO_REQUIRED` with `loginUrl`; off → 200.
- Audit chain: 1852 events across 104 organisations, 0 null `chain_seq`, 0 gaps; `GET /api/v1/audit/verify` → `isValid`, 65 events, no anomalies.
- Upload over 100 MB → 413. Cross-tenant project/findings/lab/analysis/report-download/spoofed `X-Tenant-Id` → 403/404.

## 5. Not run / not verified

| Item | Reason |
|---|---|
| Production smoke against erppreflight.com | No deployment was made. Procedure: `docs/LIVE_PRODUCTION_VERIFICATION.md` |
| GitHub Actions (ci, security, docker, release) | Never triggered on GitHub |
| Full `docker build` of all three images | Debian/Alpine mirrors blocked in the sandbox; API + web built with sandbox CA, analysis image without apt steps |
| `pnpm exec playwright test` (`playwright.config.ts`, `tests/e2e/*.spec.ts`) | Not run on the final tree; the Chromium smoke scripts above cover the browser journeys. No `playwright.live.config.ts` exists, so the multi-browser hook in `ci-live-e2e.sh` is skipped |
| Load test, Lighthouse, axe accessibility audit, penetration test | Not performed |
| Real Stripe, SMTP/HTTP mail provider, OpenAI/Anthropic, SAP Cloud ALM/Jira/Azure DevOps/ServiceNow tenants, OIDC IdP | Credentials/tenants not available; contract doubles only |

History: the first remediation round (2026-09-25/26) recorded API smoke 21/21, UI 7/7, API 678/681, web 155,
Python 548. Those numbers are superseded by the table above.
