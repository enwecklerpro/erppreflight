# ERP Preflight — Current Product Status (canonical)

> Spec C §64 / §75 #1. **This file is the canonical per-capability status.** No marketing terms.
> Older status files (`IMPLEMENTATION_STATUS.md`, `docs/PRODUCTION_READINESS_MATRIX.md`,
> `docs/archive/audits/*`) are superseded by this file.

| Field | Value |
|---|---|
| Commit | `0aaa83d` on branch `claude/sharp-mendel-xg6cus` (wave 5 merged; `main` carries the same content via PR #2; baseline audited: `main` @ `7a76aea`) |
| Status date | 2026-09-26 |
| Deployment checked | **None.** Production is not deployed with this code (Coolify did not auto-deploy the merge; owner must redeploy). All live results below come from a local production-mode stack in the build sandbox (see "Verification basis"). |
| Test totals | API 1218 · web 310 · local-agent 10 · Python 1665 passed + 1 skipped · 0 failed; 18 live suites, Playwright 13/13 + 9/9 (Chromium), upgrade drill 76/76 |

## Status values

| Value | Meaning |
|---|---|
| `VERIFIED_PRODUCTION` | Verified on the production deployment (erppreflight.com) |
| `COMPLETE_NOT_DEPLOYED` | Implemented and verified against a live local stack (real Postgres/Redis/MinIO/ClamAV, API in `NODE_ENV=production`), not verified in production |
| `PARTIAL` | Works in part; the gap is named |
| `NOT_IMPLEMENTED` | Absent |
| `BLOCKED` | Needs an external credential, external system or owner action to verify or complete |

**No capability is `VERIFIED_PRODUCTION`.** Nothing on this commit has been deployed.

## Verification basis

Commands and counts: `docs/E2E_TEST_REPORT.md`. Live stack: Postgres 16/pgvector, Redis 7.2, MinIO, real ClamAV
(containers from `docker-compose.coolify.yml`), API with `NODE_ENV=production` and `DB_RUNTIME_ROLE=erppreflight_app`,
Python analysis service, Next.js production build. External SaaS (Stripe, SMTP provider, AI providers, Cloud ALM,
Jira, Azure DevOps, ServiceNow, OIDC IdP) was exercised only against contract test doubles (`apps/api/test/doubles/`).

## Core product loop

| Capability | Status | Evidence / gap |
|---|---|---|
| Sign up, log in, log out, server-side sessions + revocation | COMPLETE_NOT_DEPLOYED | `apps/api/src/modules/auth/auth.controller.ts` (`sessions`, `logout-all`); `e2e-live-smoke.sh` |
| Cookie-only browser sessions, CSRF guard, magic-link sign-in | COMPLETE_NOT_DEPLOYED | `auth/session-cookie.ts`, `auth/csrf.guard.ts`, `/login/magic` (migration 025); `e2e-session-security-smoke.cjs` 16/16 |
| E-mail verification, password reset/change, TOTP 2FA + recovery codes | COMPLETE_NOT_DEPLOYED | `auth.controller.ts`; `e2e-account-ui-smoke.cjs`; real mail provider not tested (dev transport) |
| Organisations, invitations, members/roles, org switcher, ownership transfer | COMPLETE_NOT_DEPLOYED | `organizations.controller.ts`, `invitations.controller.ts`; account UI smoke |
| Tenant isolation (RLS + membership-verified tenant) | COMPLETE_NOT_DEPLOYED | Migration check: 67 tenant tables ENABLE+FORCE RLS, role NOSUPERUSER NOBYPASSRLS; live denials for project, findings, lab, analysis, report download, spoofed `X-Tenant-Id` → 403/404 |
| Projects (create, edit, context, delete) | COMPLETE_NOT_DEPLOYED | `projects.controller.ts`; UI smoke |
| Upload: magic bytes, archive limits (nesting depth 2), ClamAV fail-closed, redaction, 100 MB cap (413) | COMPLETE_NOT_DEPLOYED | `ingestion/files.controller.ts`, `archive-safety.guard.ts`; live smoke with real clamd. Uploads are buffered fully in the API (no streaming ingestion) |
| Asynchronous analysis (BullMQ → Python), SSE progress, Full Project Preflight | COMPLETE_NOT_DEPLOYED | `analyses.controller.ts` (`progress`, `events`, `orchestration`), `full-preflight.controller.ts`; `e2e-analyze-smoke.cjs` |
| Analysis run lifecycle: detail page, cancel, rerun | COMPLETE_NOT_DEPLOYED | `analyses/analysis-lifecycle.*`, `/projects/[id]/analyses/[analysisId]` (migration 020); `e2e-analysis-lifecycle-smoke.cjs` 16/16 |
| Findings with evidence (path, line, SHA-256, provenance), lifecycle, comments, assignment (+ notification), attachments | COMPLETE_NOT_DEPLOYED | `findings.controller.ts`; `e2e-findings-smoke.cjs`; assignment notification in platform-hardening 12/12 |
| Reports: 6 report types × PDF/XLSX/CSV/JSON/HTML/ZIP_ALL, tenant branding, reports hub | COMPLETE_NOT_DEPLOYED | `export/export.controller.ts`, `reports-hub.controller.ts`; commercial smoke + UI. Exports are English by design |
| Audit trail (hash chain per tenant, verify endpoint + UI) | COMPLETE_NOT_DEPLOYED | `audit/audit.controller.ts` `GET /audit/verify`; 76 `@Audited` call sites |
| GDPR export / account + organisation deletion | COMPLETE_NOT_DEPLOYED | `account.controller.ts`, `organizations.controller.ts` `current/export`, `DELETE current`; account UI smoke |

## Engines and product intelligence

| Capability | Status | Evidence / gap |
|---|---|---|
| 19 engines with declared input contracts, parsers, rules, fixtures, tests | COMPLETE_NOT_DEPLOYED | `ENGINE_CATALOG.md` (`--check` up to date); 233 rule codes (138 finding rules); empty and non-SAP input → `*_INSUFFICIENT_INPUT` / `*_PARSE_ERROR` / `*_INVALID_INPUT` at UNKNOWN (incl. Gap Radar); `e2e-engines-smoke.cjs` 16/16 |
| Golden rule self-test | PARTIAL | 157 golden cases (`src/selftest/golden`); 49 of 233 codes uncovered (8 new API Change Guard codes + 41 others) — Rule Admin publish gate blocks them |
| API Change Guard stored baselines, MFS log streaming | COMPLETE_NOT_DEPLOYED | `modules/api-baselines` (migration 023), `POST /api/v1/analyze/stream`; engines suite |
| Clean Core on real ABAP with knowledge snapshot | COMPLETE_NOT_DEPLOYED | Tokenizer `src/parsers/abap_tokenizer.py`; live: MARA/BSEG/BAPI flagged VERIFIED with official successors; snapshot overlay also scans abapGit ZIPs |
| Knowledge graph + SAP Cloudification Repository sync | COMPLETE_NOT_DEPLOYED | Migration 014; real sync 13 files, 68,627 objects; see `docs/KNOWLEDGE_GRAPH_STATUS.md` |
| ROSA | PARTIAL | File-import adapter only; live ROSA needs a customer-hosted endpoint |
| Release intelligence, release watches, notifications | COMPLETE_NOT_DEPLOYED | `release-intelligence.controller.ts`, `notifications.controller.ts` |
| Test Lab (regression tests, schedules, generated-test promotion) | COMPLETE_NOT_DEPLOYED | `lab/regression/regression-lab.controller.ts`; lab runs recorded as `LAB_REGRESSION`/`LAB_SCENARIO` analyses; generated tests promotable (migration 020) |
| What-If ChangeSet simulation | COMPLETE_NOT_DEPLOYED | `changesets.controller.ts` `:id/simulate`; `/projects/[id]/simulation`; unit tests only, not in a live smoke |
| Problem Router (`/analyze`) | COMPLETE_NOT_DEPLOYED | `router.controller.ts`, rule set `router-2026.09.1`; AI path optional, capped at 0.60 |
| AI assistance (explanations, intent) | BLOCKED | Deterministic fallback works; governed by AI Admin (kill switch, cost ceiling, verified against a local stub); no real OpenAI/Anthropic call verified |

## SaaS and commercial

| Capability | Status | Evidence / gap |
|---|---|---|
| Plan catalog, entitlements, 402 plan limits, 14-day trial | COMPLETE_NOT_DEPLOYED | `packages/schemas/src/plans.ts`, `billing/entitlements.service.ts`; commercial smoke |
| Stripe checkout, portal, idempotent webhooks | BLOCKED | Code + signed-webhook smoke with local secret; no real Stripe account exercised |
| Usage metering (user + admin views) | PARTIAL | 7 metrics incl. `CONNECTOR_REQUEST`; uploads metered exactly once on every path; API calls and heavy-log processing not metered |
| Super admin (business, incidents, support, flags, tenants, users, engines, queues) | PARTIAL | `admin.controller.ts`, `/admin`; suspension, trial extension, impersonation (`modules/tenant-access`, live 37/37); no plan editor, no credits, no churn/margin figures; see `docs/SAAS_FEATURE_MATRIX.md` |
| Rule / AI / Knowledge / Source Sync Admin | COMPLETE_NOT_DEPLOYED | `modules/governance`, `ai-gateway/ai-admin.controller.ts`, `/admin/{rules,ai,knowledge,sources}` (migration 022); live 44/44. Knowledge-graph curation API only |
| Feature flags, support tickets (threads + e-mails) + temporary access grants | COMPLETE_NOT_DEPLOYED | `feature-flags.controller.ts`, `support.controller.ts`, `tenant-access` |
| API keys, webhooks (signed, delivery log, replay), CLI, API reference | COMPLETE_NOT_DEPLOYED | `api-keys`, `webhooks.controller.ts`, `packages/cli`, `observability/api-reference.ts`; enterprise live suite |
| Public site EN/DE, pricing, legal, SEO, free tools, docs | COMPLETE_NOT_DEPLOYED | `apps/web/src/app/[locale]/**`; public + tools smoke; see `docs/SEO_READINESS_REPORT.md`. Legal texts need lawyer review |
| App localisation EN/DE | COMPLETE_NOT_DEPLOYED | App incl. integrations, launcher, findings, lab; API error codes; German rule catalog (233 codes); German templates/changelog/connectors; i18n smoke. Gaps: notification e-mails English except assignment; exports English by design |

## Enterprise

| Capability | Status | Evidence / gap |
|---|---|---|
| OIDC SSO (+ enforcement), SCIM 2.0 | COMPLETE_NOT_DEPLOYED | `sso/sso.controller.ts`; verified against a local OIDC double only. No SAML |
| IP allowlist, tenant suspension | COMPLETE_NOT_DEPLOYED | `tenant-access/ip-allowlist.service.ts`, `tenant-access.service.ts` (migration 021); correct client address requires `TRUST_PROXY` = real hop count |
| Connector framework (9 types), Cloud ALM/Jira/Azure DevOps/ServiceNow adapters | PARTIAL | Verified against contract doubles; Cloud ALM API paths unvalidated against a real tenant |
| Local agent (enroll, daemon, signed jobs, revoke) | COMPLETE_NOT_DEPLOYED | `apps/local-agent`, `infra/docker/Dockerfile.local-agent`; enterprise live suite |
| Partner mode | PARTIAL | `partners.controller.ts`; no partner rule/knowledge packs |
| Policy authorization (ABAC) | NOT_IMPLEMENTED | Deferred by ADR-101; RBAC role guards + partner delegation |

## Operations, security and delivery

| Capability | Status | Evidence / gap |
|---|---|---|
| Health endpoints (liveness, readiness with 5 dependencies) | COMPLETE_NOT_DEPLOYED | `health.controller.ts` |
| Logs (Pino), tracing (OTel), error reporting (Sentry protocol), Prometheus metrics, alert rules, dashboard | PARTIAL | `apps/api/src/observability/`; `infra/observability` (14 alert rules, Grafana dashboard, opt-in profile); alert routing not configured |
| Rate limiting | COMPLETE_NOT_DEPLOYED | `modules/rate-limit` (Redis, shared by all API instances); live with two API processes |
| CI (ci, security, docker, release workflows) | BLOCKED | Written, every job reproduced locally; GitHub Actions jobs fail at account level after ~3 s (owner) |
| Container images | PARTIAL | Digest-pinned; full builds not re-verified in the sandbox |
| Migrations as a job with pre-migration backup; upgrade from v0 | COMPLETE_NOT_DEPLOYED | `db-backup` → `migrate` compose jobs; upgrade drill 76/76 (`docs/runbooks/UPGRADE_FROM_V0.md`) |
| Production deployment | BLOCKED | Coolify did not auto-deploy; owner must Redeploy or set the Coolify instance domain |
| Backups + verified restore drill | COMPLETE_NOT_DEPLOYED | `scripts/backup.sh`, `scripts/restore.sh`; VPS cron/off-site copy not configured |
| High availability | NOT_IMPLEMENTED | Single VPS |
| Accessibility audit (axe-core WCAG 2.2 AA) | COMPLETE_NOT_DEPLOYED | `tests/e2e/accessibility.live.spec.ts` (Chromium) |
| Load test, Lighthouse, penetration test; Firefox/WebKit runs | NOT_IMPLEMENTED | Not run |
| Credential rotation (leaked + plain-text shared secrets, production `MASTER_ENCRYPTION_KEY`) | BLOCKED | Owner action (see `RELEASE_READINESS_REPORT.md` §1) |

Remaining limitations in detail: `docs/KNOWN_LIMITATIONS.md`.
