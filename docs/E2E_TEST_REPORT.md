# E2E & Quality-Gate Test Report

> Spec C §75 #5 and 13.12 ("exact commands run and test results").

| Field | Value |
|---|---|
| Commit | `0aaa83d` on `claude/sharp-mendel-xg6cus` (wave 5 merged; `main` carries the same content via PR #2) |
| Date | 2026-09-26 |
| Run by | Coordinator, integration run in the build sandbox |
| Deployment checked | **None.** Production is not deployed with this code. Every "live" result below ran against a local stack. |
| GitHub Actions | **Never executed on GitHub.** Jobs fail after ~3 s at account level; their commands were run locally. |

## 1. Environment

| Item | Value |
|---|---|
| Infrastructure | Postgres 16 + pgvector, Redis 7.2, MinIO, ClamAV (real clamd, real signatures) — images as pinned in `docker-compose.coolify.yml` |
| API | `node apps/api/dist/src/main.js`, `NODE_ENV=production`, `DB_RUNTIME_ROLE=erppreflight_app`, `MAIL_TRANSPORT=dev`; a second API process for the platform-hardening suite |
| Analysis | `services/analysis-python` (uvicorn), 19 engines |
| Web | Next.js production build |
| External SaaS | Contract test doubles (`apps/api/test/doubles/run-doubles.cjs`); OpenAI-compatible local stub in the governance suite. No real Stripe/SMTP/AI provider |

## 2. Static gates and unit/integration suites

| Command | Result | Skipped / failed |
|---|---|---|
| `pnpm run check:deps` / `check:no-production-facades` / `check:production-truth` | pass | — |
| `pnpm run typecheck` / `lint` / `build` | 0 errors / pass / pass | — |
| `pnpm --filter @erppreflight/api run test:boot` | pass (AppModule DI graph resolves) | — |
| `pnpm run test` | **API 1218, web 310, local-agent 10 passed** | 0 skipped, 0 failed |
| `pnpm run test:python` (`pytest services/analysis-python/tests`) | **1665 passed** | **1 skipped** (`pytest.importorskip("opentelemetry…")` in `tests/test_observability.py`), 0 failed |
| `python scripts/generate-engine-catalog.py --check` | up to date (19 engines) | — |
| `python scripts/generate-rule-catalog-i18n.py --check` | up to date (233 codes) | — |
| `PG_ADMIN_URL=postgres://… bash scripts/ci-migration-check.sh` | migrations 001–026 apply on a fresh DB; second run no-op; deterministic `pg_dump`; **67 tenant tables** with ENABLE + FORCE RLS + policy; `erppreflight_app` NOSUPERUSER NOBYPASSRLS; upgrade from the v0 schema (001–009) with v0-shaped data keeps every row, backfills audit `chain_seq` and legacy finding provenance (026) | — |
| `python -m pytest tests/e2e tests/empirical_redaction_stress.py -q` | not part of this run (last result 267 passed on `6303f1d`) | — |

## 3. Live suites (real services, no mocks except external SaaS doubles)

All passed on `0aaa83d`. Environment variables are the ones the scripts read (handover §5.3).

### 3.1 Existing suites (12)

| Suite | Command |
|---|---|
| API smoke | `bash scripts/e2e-live-smoke.sh` (`pnpm smoke:live`) |
| UI core journey (Chromium) | `node scripts/e2e-ui-smoke.cjs` |
| Account UI | `node scripts/e2e-account-ui-smoke.cjs` |
| Public site EN/DE | `node scripts/e2e-public-smoke.cjs` |
| Commercial / governance API | `python3 scripts/e2e-commercial-smoke.py` |
| Commercial UI | `node scripts/e2e-commercial-ui.cjs` |
| Findings | `node scripts/e2e-findings-smoke.cjs` |
| Analyze / router | `node scripts/e2e-analyze-smoke.cjs` |
| Free tools | `node scripts/e2e-tools-smoke.cjs` |
| i18n (DE) + 375/1440 px | `node scripts/e2e-i18n-smoke.cjs` (`pnpm smoke:i18n`), extended to integrations, findings, lab, launcher/run history, API error codes, German rule titles and server content |
| Enterprise integrations | `node scripts/e2e-enterprise-live.cjs` (one API per database) |
| Integrations UI | `node scripts/e2e-integrations-ui.cjs <dir>` |

### 3.2 New suites of wave 5 (6)

| Suite | Command | Result |
|---|---|---|
| Session security | `node scripts/e2e-session-security-smoke.cjs` (`pnpm smoke:session-security`) | **16/16** — no JWT in web storage, legacy token purge, cookie flags, CSRF 403 (missing/forged token, foreign Origin/Referer, `Origin: null`, foreign-origin login) and 2xx with the header, Bearer exemption, logout revocation, magic link end to end |
| Analysis lifecycle | `node scripts/e2e-analysis-lifecycle-smoke.cjs` (`pnpm smoke:analysis-lifecycle`) | **16/16** — detail page, cancel queued + running, rerun, double rerun 409, Test Lab runs, promotion, VIEWER 403, cross-tenant 404, EN/DE + 375 px |
| Tenant administration | `node scripts/e2e-tenant-admin-smoke.cjs` (`pnpm smoke:tenant-admin`) | **37/37** — impersonation incl. negative cases, suspension, trial extension, IP allowlist, support e-mails, browser checks |
| Platform governance | `node scripts/e2e-admin-governance-smoke.cjs` (`pnpm smoke:admin-governance`) | **44/44** — SUPER_ADMIN-only access, self-test + publish gate, AI kill switch and cost ceiling (8 parallel calls, 2 reach the provider), knowledge workflow, stale alerts, source retry, UI EN/DE |
| Engines | `node scripts/e2e-engines-smoke.cjs` (`pnpm smoke:engines`) | **16/16** — Gap Radar contract, API Change Guard baselines, MFS log streaming, baseline UI |
| Platform hardening | `node scripts/e2e-platform-hardening-smoke.cjs` (`pnpm smoke:platform-hardening`) | **12/12** — shared Redis rate limit across two API processes, upload metered once (presigned + multipart), assignment notification (DE e-mail, deep link), FormDoctor file names |

### 3.3 Playwright

| Command | Result |
|---|---|
| `pnpm exec playwright test` (`playwright.config.ts`) | **13/13** |
| `pnpm run test:e2e:live` (`playwright.live.config.ts`, `PW_BROWSERS=chromium`) | **9/9** — live preflight pipeline (signup → upload → OPD Guard → evidence) and axe-core WCAG 2.2 AA audit (public home EN/DE, login, projects, workspace, findings, finding detail, analyze, settings) |

Chromium only. Firefox and WebKit were not run.

### 3.4 Upgrade drill

Upgrade from `main@7a76aea` with data to this tree: **76/76** (`docs/runbooks/UPGRADE_FROM_V0.md`). Findings: the old
`main` API cannot boot as committed (DI error, crash on first request), and uploads made on v0 were quarantined by the
old ClamAV reply parser; they stay quarantined after the upgrade.

### 3.5 Combined CI job

`PG_ADMIN_URL=… S3_ACCESS_KEY=… S3_SECRET_KEY=… bash scripts/ci-live-e2e.sh` runs API, UI, analyze, findings, i18n,
session, lifecycle, engines, tools, tenant-admin, governance and hardening suites, the Playwright live config and the
backup/restore drill (knowledge snapshot synced first, `e5fd2e2`).

## 4. Not run / not verified

| Item | Reason |
|---|---|
| Production smoke against erppreflight.com | Not deployed (Coolify did not auto-deploy; its API is unreachable from the build environment). Procedure: `docs/LIVE_PRODUCTION_VERIFICATION.md` |
| GitHub Actions (ci, security, docker, release) | Jobs fail at account level after ~3 s |
| Full `docker build` of all images | Debian/Alpine mirrors blocked in the sandbox |
| Playwright on Firefox/WebKit | Not run |
| Load test, Lighthouse, penetration test | Not performed |
| Real Stripe, mail provider, OpenAI/Anthropic, SAP Cloud ALM/Jira/Azure DevOps/ServiceNow, OIDC IdP | Contract doubles / stubs only |

History: `6303f1d` recorded API 979, web 233, local-agent 10, Python 1169 (+1 skipped), Python e2e 267; the first
remediation round recorded API smoke 21/21, UI 7/7, API 678/681, web 155, Python 548. Superseded by the tables above.
