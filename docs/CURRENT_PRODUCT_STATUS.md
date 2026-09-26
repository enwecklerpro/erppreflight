# ERP Preflight — Current Product Status (canonical)

> Spec C §64 / §75 #1. **This file is the canonical per-capability status.** No marketing terms.
> Older status files (`IMPLEMENTATION_STATUS.md`, `docs/PRODUCTION_READINESS_MATRIX.md`,
> `docs/archive/audits/*`) are superseded by this file.

| Field | Value |
|---|---|
| Commit | `6303f1d` on branch `claude/sharp-mendel-xg6cus` (all workstreams merged; baseline audited: `main` @ `7a76aea`) |
| Status date | 2026-09-26 |
| Deployment checked | **None.** No production or staging deployment was verified. All live results below come from a local production-mode stack in the build sandbox (see "Verification basis"). |
| Test totals | API 979 · web 233 · local-agent 10 · Python 1169 passed + 1 skipped · Python e2e/redaction 267 · 0 failed |

## Status values

| Value | Meaning |
|---|---|
| `VERIFIED_PRODUCTION` | Verified on the production deployment (erppreflight.com) |
| `COMPLETE_NOT_DEPLOYED` | Implemented and verified against a live local stack (real Postgres/Redis/MinIO/ClamAV, API in `NODE_ENV=production`), not verified in production |
| `PARTIAL` | Works in part; the gap is named |
| `NOT_IMPLEMENTED` | Absent |
| `BLOCKED` | Needs an external credential, external system or owner action to verify or complete |

**No capability is `VERIFIED_PRODUCTION`.** Nothing on this branch has been deployed.

## Verification basis

Commands and counts: `docs/E2E_TEST_REPORT.md`. Live stack: Postgres 16/pgvector, Redis 7.2, MinIO, real ClamAV
(containers from `docker-compose.coolify.yml`), API with `NODE_ENV=production` and `DB_RUNTIME_ROLE=erppreflight_app`,
Python analysis service, Next.js production build. External SaaS (Stripe, SMTP provider, AI providers, Cloud ALM,
Jira, Azure DevOps, ServiceNow, OIDC IdP) was exercised only against contract test doubles (`apps/api/test/doubles/`).

## Core product loop

| Capability | Status | Evidence / gap |
|---|---|---|
| Sign up, log in, log out, server-side sessions + revocation | COMPLETE_NOT_DEPLOYED | `apps/api/src/modules/auth/auth.controller.ts` (`sessions`, `logout-all`); `e2e-live-smoke.sh` 77/77 |
| E-mail verification, password reset/change, TOTP 2FA + recovery codes | COMPLETE_NOT_DEPLOYED | `auth.controller.ts`; `e2e-account-ui-smoke.cjs`; real mail provider not tested (dev transport) |
| Organisations, invitations, members/roles, org switcher, ownership transfer | COMPLETE_NOT_DEPLOYED | `organizations.controller.ts`, `invitations.controller.ts`; account UI smoke |
| Tenant isolation (RLS + membership-verified tenant) | COMPLETE_NOT_DEPLOYED | Migration check: 62 tenant tables ENABLE+FORCE RLS, role NOSUPERUSER NOBYPASSRLS; live denials for project, findings, lab, analysis, report download, spoofed `X-Tenant-Id` → 403/404 |
| Projects (create, edit, context, delete) | COMPLETE_NOT_DEPLOYED | `projects.controller.ts`; UI smoke |
| Upload: magic bytes, archive limits (nesting depth 2), ClamAV fail-closed, redaction, 100 MB cap (413) | COMPLETE_NOT_DEPLOYED | `ingestion/files.controller.ts`, `archive-safety.guard.ts`; live smoke with real clamd |
| Asynchronous analysis (BullMQ → Python), SSE progress, Full Project Preflight | COMPLETE_NOT_DEPLOYED | `analyses.controller.ts` (`progress`, `events`, `orchestration`), `full-preflight.controller.ts`; `e2e-analyze-smoke.cjs` 13 |
| Findings with evidence (path, line, SHA-256, provenance), lifecycle, comments, assignment, attachments | COMPLETE_NOT_DEPLOYED | `findings.controller.ts`; `e2e-findings-smoke.cjs` 14 |
| Reports: 6 report types × PDF/XLSX/CSV/JSON/HTML/ZIP_ALL, tenant branding, reports hub | COMPLETE_NOT_DEPLOYED | `export/export.controller.ts`, `reports-hub.controller.ts`; commercial smoke + UI |
| Audit trail (hash chain per tenant, verify endpoint + UI) | COMPLETE_NOT_DEPLOYED | `audit/audit.controller.ts` `GET /audit/verify`; 47 `@Audited` call sites; live: 1852 events / 104 orgs, 0 gaps |
| GDPR export / account + organisation deletion | COMPLETE_NOT_DEPLOYED | `account.controller.ts`, `organizations.controller.ts` `current/export`, `DELETE current`; account UI smoke |

## Engines and product intelligence

| Capability | Status | Evidence / gap |
|---|---|---|
| 19 engines with declared input contracts, parsers, rules, fixtures, tests | COMPLETE_NOT_DEPLOYED | `ENGINE_CATALOG.md` (`--check` up to date, 130 declared rules); empty and non-SAP input → `*_INSUFFICIENT_INPUT` / `*_PARSE_ERROR` at UNKNOWN (Gap Radar answers non-SAP text with `GAP_RADAR_UNKNOWN_REQUIREMENT`, UNKNOWN) |
| Clean Core on real ABAP with knowledge snapshot | COMPLETE_NOT_DEPLOYED | Tokenizer `src/parsers/abap_tokenizer.py`; live: MARA/BSEG/BAPI flagged VERIFIED with official successors; released objects and string literals not flagged |
| Knowledge graph + SAP Cloudification Repository sync | COMPLETE_NOT_DEPLOYED | Migration 014; real sync 13 files, 68,627 objects; see `docs/KNOWLEDGE_GRAPH_STATUS.md` |
| ROSA | PARTIAL | File-import adapter only; live ROSA needs a customer-hosted endpoint |
| Release intelligence, release watches, notifications | COMPLETE_NOT_DEPLOYED | `release-intelligence.controller.ts`, `notifications.controller.ts` |
| Test Lab (regression tests, schedules) | PARTIAL | `lab/regression/regression-lab.controller.ts`; W2 generated tests and W1 regression tests are separate models; lab runs create no analysis record |
| What-If ChangeSet simulation | COMPLETE_NOT_DEPLOYED | `changesets.controller.ts` `:id/simulate`; `/projects/[id]/simulation`; unit tests only, not in a live smoke |
| Problem Router (`/analyze`) | COMPLETE_NOT_DEPLOYED | `router.controller.ts`, rule set `router-2026.09.1`; AI path optional, capped at 0.60 |
| AI assistance (explanations, intent) | BLOCKED | Deterministic fallback works; no real OpenAI/Anthropic call verified |

## SaaS and commercial

| Capability | Status | Evidence / gap |
|---|---|---|
| Plan catalog, entitlements, 402 plan limits, 14-day trial | COMPLETE_NOT_DEPLOYED | `packages/schemas/src/plans.ts`, `billing/entitlements.service.ts`; commercial smoke |
| Stripe checkout, portal, idempotent webhooks | BLOCKED | Code + signed-webhook smoke with local secret; no real Stripe account exercised |
| Usage metering (user + admin views) | PARTIAL | 6 metrics; connector requests and heavy-log processing not metered; `ARTIFACT_BYTES` not metered on the presigned-confirm path |
| Super admin (business, incidents, support, flags, tenants, users, engines, queues) | PARTIAL | `admin.controller.ts`, `/admin`; no safe impersonation, no suspend, no plan editor, no rule/AI admin; see `docs/SAAS_FEATURE_MATRIX.md` |
| Feature flags, support tickets + temporary access grants | COMPLETE_NOT_DEPLOYED | `feature-flags.controller.ts`, `support.controller.ts` |
| API keys, webhooks (signed, delivery log, replay), CLI, API reference | COMPLETE_NOT_DEPLOYED | `api-keys`, `webhooks.controller.ts`, `packages/cli`, `observability/api-reference.ts`; enterprise live suite 85/85 |
| Public site EN/DE, pricing, legal, SEO, free tools, docs | COMPLETE_NOT_DEPLOYED | `apps/web/src/app/[locale]/**`; public + tools smoke; see `docs/SEO_READINESS_REPORT.md`. Legal texts need lawyer review |
| App localisation EN/DE | PARTIAL | 32 app pages pass the DE smoke; integrations UI and launcher/run-history strings partly English; API errors and engine rule texts English |

## Enterprise

| Capability | Status | Evidence / gap |
|---|---|---|
| OIDC SSO (+ enforcement), SCIM 2.0 | COMPLETE_NOT_DEPLOYED | `sso/sso.controller.ts`; verified against a local OIDC double only. No SAML |
| Connector framework (9 types), Cloud ALM/Jira/Azure DevOps/ServiceNow adapters | PARTIAL | Verified against contract doubles; Cloud ALM API paths unvalidated against a real tenant |
| Local agent (enroll, daemon, signed jobs, revoke) | COMPLETE_NOT_DEPLOYED | `apps/local-agent`, `infra/docker/Dockerfile.local-agent`; enterprise live suite |
| Partner mode | PARTIAL | `partners.controller.ts`; no partner rule/knowledge packs |
| Policy authorization (ABAC) | NOT_IMPLEMENTED | Deferred by ADR-101; RBAC role guards + partner delegation |

## Operations, security and delivery

| Capability | Status | Evidence / gap |
|---|---|---|
| Health endpoints (liveness, readiness with 5 dependencies) | COMPLETE_NOT_DEPLOYED | `health.controller.ts` |
| Logs (Pino), tracing (OTel), error reporting (Sentry protocol), Prometheus metrics | PARTIAL | `apps/api/src/observability/`; no dashboards or alert rules shipped |
| CI (ci, security, docker, release workflows) | PARTIAL | Written, actionlint clean, every job reproduced locally; **never run on GitHub** |
| Container images | PARTIAL | API + web images built with sandbox CA; analysis image only without apt steps |
| Backups + verified restore drill | COMPLETE_NOT_DEPLOYED | `scripts/backup.sh`, `scripts/restore.sh`; VPS cron/off-site copy not configured |
| High availability | NOT_IMPLEMENTED | Single VPS |
| Load test, Lighthouse/axe audit, penetration test | NOT_IMPLEMENTED | Not run |
| Leaked-credential rotation | BLOCKED | Owner action (see `RELEASE_READINESS_REPORT.md` §1) |

Remaining limitations in detail: `docs/KNOWN_LIMITATIONS.md`.
