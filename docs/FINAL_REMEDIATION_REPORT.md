# Final Remediation Report

> Spec C §75 #2 and 13.12 #1 (final implementation report: exact commands run and test results).

| Field | Value |
|---|---|
| Merged commit | `0aaa83d` on `claude/sharp-mendel-xg6cus` (161 commits on top of the audited baseline `main` @ `7a76aea`; 58 of them are wave 5 after `6303f1d`). `main` carries the same content via PR #2 |
| Date | 2026-09-26 |
| Deployed? | **No.** Coolify did not auto-deploy the merge and its API is unreachable from the build environment; no production smoke. See `docs/LIVE_PRODUCTION_VERIFICATION.md` |
| Test totals (merged) | API 1218 · web 310 · local-agent 10 · Python 1665 passed + 1 skipped · **0 failed** |

## 1. Commands that define "green" (run on `0aaa83d`)

```bash
pnpm install --frozen-lockfile
pnpm run check:deps && pnpm run check:no-production-facades && pnpm run check:production-truth
pnpm run typecheck && pnpm run lint && pnpm run build
pnpm --filter @erppreflight/api run test:boot
pnpm run test                                    # vitest: api, web, local-agent
pnpm run test:python                             # pytest services/analysis-python/tests
python scripts/generate-engine-catalog.py --check
python scripts/generate-rule-catalog-i18n.py --check
PG_ADMIN_URL=postgres://… bash scripts/ci-migration-check.sh
PG_ADMIN_URL=… S3_ACCESS_KEY=… S3_SECRET_KEY=… bash scripts/ci-live-e2e.sh
pnpm exec playwright test                        # default config
pnpm run test:e2e:live                           # playwright.live.config.ts (PW_BROWSERS=chromium)
```

| Command | Result (merged) | Skipped / failed |
|---|---|---|
| typecheck / lint / build / test:boot | 0 errors / pass / pass / pass | — |
| check:deps, check:no-production-facades, check:production-truth | pass | — |
| vitest | API 1218, web 310, local-agent 10 | 0 / 0 |
| pytest (service) | 1665 passed | 1 skipped (`importorskip` of the optional OTel SDK in `tests/test_observability.py`) / 0 failed |
| engine catalog check | up to date: 19 engines | — |
| migration check | 001–026 clean + idempotent, deterministic schema, **67 tenant tables** ENABLE+FORCE RLS, `erppreflight_app` NOSUPERUSER NOBYPASSRLS, upgrade path from the v0 schema with v0-shaped data | — |
| live suites (12 existing) | API smoke, UI, account UI, public (EN/DE), commercial, commercial UI, findings, analyze, tools, i18n, enterprise, integrations UI | 0 failed |
| live suites (6 new) | session-security 16, analysis-lifecycle 16, tenant-admin 37, admin-governance 44, engines 16, platform-hardening 12 | 0 failed |
| Playwright | default config 13/13; `playwright.live.config.ts` 9/9 (Chromium only; incl. axe-core WCAG 2.2 AA audit) | Firefox/WebKit not run |
| Upgrade drill from `main@7a76aea` with data | 76/76 (`docs/runbooks/UPGRADE_FROM_V0.md`) | — |
| `python -m pytest tests/e2e tests/empirical_redaction_stress.py` | not part of the `0aaa83d` run (last result: 267 passed on `6303f1d`) | — |
| GitHub Actions (ci, security, docker, release) | **not run** — jobs fail at account level after ~3 s | — |
| Production smoke | **not run** — no deployment | — |

## 2. Defects fixed from the 2026-09-25 audit (P0/P1)

API crashed on startup (missing `EntitlementGuard` dependency); uploaded files were never analysed; ClamAV NUL-terminated
replies flagged every file as infected; redaction overwrote the clean object and corrupted XML; engines emitted VERIFIED
verdicts on empty input; cross-tenant access via `X-Tenant-Id`; the app ran as Postgres superuser so RLS never applied;
leaked Coolify token and super-admin password in code (removed; **rotation is an owner action**); browser had no API
URL at build time; report URLs pointed to the internal MinIO host; audit inserts failed on wrong column names; BullMQ
ignored the `REDIS_URL` db index (`c3f9b10`); no upload size cap.

## 3. Workstreams (merged)

### 3.1 Waves 1–4

| WS | Merge | Deliverables | Key files |
|---|---|---|---|
| E | `89ac142` | CI (`ci.yml` incl. live-e2e + migration check), `security.yml`, `docker.yml`, `release.yml` (SBOM, provenance, cosign), Renovate, image hardening, backup/restore + drill, runbooks, guides | `.github/workflows/`, `scripts/backup.sh`, `scripts/restore.sh`, `docs/runbooks/` |
| D | `a63e39d` | Declared input contracts for all 19 engines, ABAP tokenizer, determinism, nested archives depth 2, Hypothesis property tests, telemetry, generated engine catalog | `services/analysis-python/src/`, `ENGINE_CATALOG.md` |
| C | `2779e67` | Audit trail, usage metering, plan catalog, 402 limits, trial, Stripe, 6 report types × 6 formats, retention, super admin, feature flags, support | migrations 012, 016 |
| B | `8af92e5` | Mail, e-mail verification, password reset, TOTP 2FA, sessions, invitations, org switcher, GDPR | migration 011 |
| A | `e6965e3` | Public site `/en` `/de`, pricing, knowledge articles, legal pages, CSP, sitemap | migration 013 |
| F | `53432cd` | Knowledge graph, Cloudification ingestion, ROSA file import, release intelligence, notifications | migration 014 |
| H | `fb01260` | Connector framework (9 types), adapters + doubles, local agent, OIDC SSO + SCIM, partner mode, observability, API reference, CLI | migration 015 |
| W1 | `cd49e77` | Finding lifecycle, comments, assignments, attachments, suppression carry-over, Test Lab | migration 017 |
| W2 | `637df1e` | Problem Router, `/analyze`, SSE progress, Full Project Preflight, reports hub | migration 018 |
| W3 | `1056237` | Free tools, programmatic SEO with quality gate, docs EN/DE, content workflow | migration 019 |
| W4 | `a1b8470` | EN/DE localisation of the app, responsive navbar | `apps/web/src/i18n/messages/app/` |
| Final | `013fc6f`, `6303f1d` | SSO-enforced orgs block password login; remaining plan limits enforced; constant-time agent-gate signature | `auth.service.ts`, `entitlements.service.ts` |

### 3.2 Wave 5

| Workstream | Merge | Deliverables | Key files / migration |
|---|---|---|---|
| session-security | `bb32a2a` | HttpOnly cookie-only browser sessions, global `CsrfGuard` (signed double-submit + Origin/Referer, 403 `CSRF_REJECTED`), `GET /auth/csrf`, magic-link sign-in (single use, 15 min, 2FA continuation); magic links revoked on credential reset (`3c2e758`) | `auth/session-cookie.ts`, `auth/csrf.guard.ts`, `apps/web/src/lib/api/custom-instance.ts`; migration 025 |
| analysis-lifecycle | `11c3233` | `GET /analyses/:id/detail`, cancel (cooperative, publish gate), rerun with identical inputs (one active rerun per source, `c96ee3a`), Test Lab runs recorded as analyses, generated-test promotion, `/projects/[id]/analyses/[analysisId]` | `analyses/analysis-lifecycle.*`, `components/analysis-run/`; migration 020 |
| tenant-access-admin | `681b709` | Suspension, trial extension, safe impersonation (read-only default, per-request audit, case-folded policy `993b5f5`), IP allowlist, support ticket threads + e-mails, `/suspended` | `modules/tenant-access/`, `components/tenant-access/`; migration 021 |
| admin-governance | `fab5443` | Rule Admin with deterministic golden self-test (157 cases) and publish gate, AI Admin (per-task model, kill switch, atomic cost ceiling `4df5220`), knowledge workflow UI, Source Sync Admin with stale alerts | `modules/governance/`, `ai-gateway/ai-governance*.ts`, `src/selftest/`, `app/admin/{rules,ai,knowledge,sources}`; migration 022 |
| i18n-completion | `7755784` | EN/DE for integrations, launcher, run history, findings, lab; stable API error `code` with EN/DE text; German templates/changelog/connectors; German rule catalog for all 233 codes with parity gates | `common/filters/api-error-codes.ts`, `i18n/rule-catalog/`, `scripts/generate-rule-catalog-i18n.py` |
| engines-completion | `51072dd` | Gap Radar input contract, MFS streaming (`POST /api/v1/analyze/stream`, spool guards `3de97d9`), API Change Guard stored baselines + oasdiff-level categories (8 new codes), abapGit overlay scan | `engines/api_change.py`, `core/streaming.py`, `modules/api-baselines/`; migration 023 |
| platform-hardening | `d68a134` | Redis-backed distributed rate limiting, exactly-once upload metering (`b825adb`), `CONNECTOR_REQUEST` metric, finding-assignment notification (in-app + EN/DE e-mail, deep link), FormDoctor real file names | `modules/rate-limit/`, `ingestion.service.ts`, `notifications/`; migration 024 |
| ops-quality | `99c2211` | Playwright live suite + axe-core audit (contrast fixes), Prometheus alert rules + Grafana dashboard, digest-pinned images, `db-backup` → `migrate` compose jobs, `requirements-dev.txt`, CODEOWNERS, `pnpm audit --prod` 0 advisories, `ROADMAP_AFTER_V1.md` | `playwright.live.config.ts`, `infra/observability/`, `docker-compose.coolify.yml`, `.github/CODEOWNERS` |
| upgrade | `c3729cb`, `76d20d6` | v0 finding reviews preserved, legacy finding source backfill, upgrade runbook | migration 026, `docs/runbooks/UPGRADE_FROM_V0.md` |
| integration | `67993ff`, `7d99827`, `e5fd2e2`, `0aaa83d` | Error-code localisation across merged workstreams, compose passthrough of new settings, knowledge sync before live suites, cookie-only sessions in all live suites | — |

## 4. Not done / not verified

- Deployment and production smoke (owner: Coolify Redeploy or instance domain); GitHub Actions (account-level failure).
- Full docker builds of all images (sandbox mirrors blocked).
- Real Stripe, mail provider, AI providers, Cloud ALM/Jira/Azure DevOps/ServiceNow tenants, OIDC IdP.
- Load test, Lighthouse, penetration test; Playwright on Firefox/WebKit; alert routing.
- Rotation of the secrets shared in plain text (owner).
- Repository cleanup (C §65): proposal only (`docs/REPO_CLEANUP_PROPOSAL.md`).

## 5. Remaining limitations

`docs/KNOWN_LIMITATIONS.md` (maintained list), `SECURITY_REVIEW.md` §5, `docs/SAAS_FEATURE_MATRIX.md`.
