# Final Remediation Report

> Spec C §75 #2 and 13.12 #1 (final implementation report: exact commands run and test results).

| Field | Value |
|---|---|
| Merged commit | `6303f1d` on `claude/sharp-mendel-xg6cus` (102 commits on top of the audited baseline `main` @ `7a76aea`) |
| Date | 2026-09-26 |
| Deployed? | **No.** No deployment to Hostinger/Coolify; no production smoke. See `docs/LIVE_PRODUCTION_VERIFICATION.md` |
| Test totals (merged) | API 979 · web 233 · local-agent 10 · Python 1169 passed + 1 skipped · Python e2e/redaction 267 · **0 failed** |

## 1. Commands that define "green" (run on `6303f1d`)

```bash
pnpm install --frozen-lockfile
pnpm run check:deps && pnpm run check:no-production-facades && pnpm run check:production-truth
pnpm run typecheck && pnpm run lint && pnpm run build
pnpm --filter @erppreflight/api run test:boot
pnpm run test                                    # vitest: api, web, local-agent
pnpm run test:python                             # pytest services/analysis-python/tests
python -m pytest tests/e2e tests/empirical_redaction_stress.py -q
python scripts/generate-engine-catalog.py --check
PG_ADMIN_URL=postgres://… bash scripts/ci-migration-check.sh
PG_ADMIN_URL=… S3_ACCESS_KEY=… S3_SECRET_KEY=… bash scripts/ci-live-e2e.sh
```

| Command | Result (merged) | Skipped / failed |
|---|---|---|
| typecheck / lint / build / test:boot | 13/13 packages 0 errors / pass / pass / pass | — |
| check:deps, check:no-production-facades, check:production-truth | pass | — |
| vitest | API 979, web 233, local-agent 10 | 0 / 0 |
| pytest (service) | 1169 passed | 1 skipped (`importorskip` of the optional OTel SDK in `tests/test_observability.py`) / 0 failed |
| pytest (tests/e2e + redaction stress) | 267 passed | 0 / 0 |
| engine catalog check | up to date: 19 engines, 130 declared rules | — |
| migration check | 001–019 clean + idempotent, deterministic schema, 62 tenant tables ENABLE+FORCE RLS, `erppreflight_app` NOSUPERUSER NOBYPASSRLS | — |
| live suites | `e2e-live-smoke.sh` 77/77; UI, account UI, public (EN/DE), commercial (~64), commercial UI (17), findings (14), analyze (13), tools (24), i18n (32 app + 5 public DE), enterprise 85/85, integrations UI 17/17 | 0 failed (enterprise suite: see `docs/E2E_TEST_REPORT.md` §3 note) |
| GitHub Actions (ci, security, docker, release) | **not run** — never triggered on GitHub | — |
| Production smoke | **not run** — no deployment | — |

## 2. Defects fixed from the 2026-09-25 audit (P0/P1)

API crashed on startup (missing `EntitlementGuard` dependency); uploaded files were never analysed; ClamAV NUL-terminated
replies flagged every file as infected; redaction overwrote the clean object and corrupted XML; engines emitted VERIFIED
verdicts on empty input; cross-tenant access via `X-Tenant-Id`; the app ran as Postgres superuser so RLS never applied;
leaked Coolify token and super-admin password in code (removed; **rotation is an owner action**); browser had no API
URL at build time; report URLs pointed to the internal MinIO host; audit inserts failed on wrong column names; BullMQ
ignored the `REDIS_URL` db index (`c3f9b10`); no upload size cap. Details per commit: `RELEASE_READINESS_REPORT.md` §5.

## 3. Workstreams (merged)

| WS | Merge | Deliverables | Key files |
|---|---|---|---|
| E | `89ac142` | CI (`ci.yml` incl. live-e2e + migration check), `security.yml` (gitleaks, Trivy blocking, pip-audit), `docker.yml`, `release.yml` (SBOM, provenance, cosign), Renovate, `.dockerignore`, image hardening, backup/restore + drill, runbooks, deployment/admin/user guides | `.github/workflows/`, `scripts/backup.sh`, `scripts/restore.sh`, `docs/runbooks/` |
| D | `a63e39d` | Declared input contracts for all 19 engines, ABAP tokenizer, determinism, nested archives depth 2, Hypothesis property tests, telemetry, generated engine catalog | `services/analysis-python/src/`, `ENGINE_CATALOG.md` |
| C | `2779e67` | Audit trail (`@Audited`, per-tenant hash chain, verify UI), usage metering, plan catalog, 402 limits, 14-day trial, Stripe checkout/portal/idempotent webhooks, 6 report types × PDF/XLSX/CSV/JSON/HTML/ZIP_ALL with branding, retention sweep, super-admin business/incidents/support, feature flags, support tickets/grants | `apps/api/src/modules/{audit,usage,billing,export,retention,admin,feature-flags,support}` (migration 012; 016 adds RLS to `billing_events`, landed with the F merge) |
| B | `8af92e5` | Mail (SMTP/HTTP/dev), e-mail verification, password reset, TOTP 2FA + recovery codes, server-side sessions/revocation, invitations/members/roles, org switcher, GDPR export/delete | `auth`, `organizations`, `account`, `mail` (migration 011) |
| A | `e6965e3` | Public site `/en` `/de` (next-intl), pricing, 7 knowledge articles EN/DE, legal pages, SAP disclaimer, CSP, route guard, sitemap/robots, cookie consent | `apps/web/src/app/[locale]/`, `knowledge` (migration 013) |
| F | `53432cd` | Knowledge graph, Cloudification ingestion, ROSA file import, release intelligence/watches, notifications, Clean Core snapshot integration | `knowledge-graph`, `release-intelligence`, `notifications` (migration 014) |
| H | `fb01260` | Connector framework (9 types), Cloud ALM/Jira/Azure DevOps/ServiceNow adapters + doubles, local agent + Dockerfile, OIDC SSO + SCIM, partner mode, Pino/OTel/Sentry, Scalar reference, CLI, webhook catalog/replay | `connectors`, `sso`, `partners`, `apps/local-agent`, `packages/cli`, `apps/api/src/observability` (migration 015) |
| W1 | `cd49e77` | Finding lifecycle state machine, history, comments, assignments, attachments, suppression carry-over, finding versions, Test Lab | `findings`, `lab/regression` (migration 017) |
| W2 | `637df1e` | Problem Router (`router-2026.09.1`, optional AI ≤ 0.60), `/analyze`, SSE progress, Full Project Preflight + correlation, reports hub, project context | `router`, `analyses` (migration 018) |
| W3 | `1056237` | 6 free tools, programmatic SEO with quality gate (655 indexable locally), sitemap index, docs EN/DE, content workflow | `public-tools`, `apps/web/src/app/[locale]/{tools,sap,docs}` (migration 019) |
| W4 | `a1b8470` | EN/DE localisation of the app, 375/1440 px checks, jargon removal, inventory/matrix fixes | `apps/web/src/i18n/messages/app/` |
| Final | `6303f1d` | Password login blocked for members of SSO-enforced organisations | `apps/api/src/modules/auth/auth.service.ts` |

## 4. Not done / not verified

- Deployment and production smoke; GitHub Actions runs; full docker builds of all images (sandbox mirrors blocked).
- Real Stripe, mail provider, AI providers, Cloud ALM/Jira/Azure DevOps/ServiceNow tenants, OIDC IdP.
- Load test, Lighthouse/axe audit, penetration test; `pnpm exec playwright test` on the final tree.
- Repository cleanup (C §65): proposal only (`docs/REPO_CLEANUP_PROPOSAL.md`); `ROADMAP_AFTER_V1.md` not written.

## 5. Remaining limitations

`docs/KNOWN_LIMITATIONS.md` (maintained list), `SECURITY_REVIEW.md` §5, `docs/SAAS_FEATURE_MATRIX.md`.
