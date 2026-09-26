# SaaS Feature Matrix

> Spec C §75 #7. Features from Part 10 and remediation prompt C §21–§24, §61–§63, each checked against the code.
> **Done** = implemented, with the named evidence read in the code; "live" means it was exercised by a live suite on the
> local production-mode stack. **Partial** = the named part is missing. **Missing** = absent.

| Field | Value |
|---|---|
| Commit | `0aaa83d` on `claude/sharp-mendel-xg6cus` (wave 5 merged) |
| Date | 2026-09-26 |
| Deployment checked | **None** — production is not deployed with this code; nothing verified in production |
| Tests | API 1218 / web 310 / local-agent 10 / Python 1665 (+1 skipped) — 0 failed. Live: 12 existing suites (commercial, commercial UI, API smoke, enterprise, …) plus session-security 16, tenant-admin 37, admin-governance 44, platform-hardening 12 (commands: `docs/E2E_TEST_REPORT.md`) |

Paths are relative to `apps/api/src/modules/` unless stated; endpoints are under `/api/v1`.

## Part 10.1–10.2 Tenancy and authentication

| Feature | Status | Evidence |
|---|---|---|
| Organisation-based tenancy with RLS | Done (live) | `tenancy/tenancy.guard.ts`; `scripts/ci-migration-check.sh` (67 tables); cross-tenant denials in `e2e-live-smoke.sh` |
| Roles | Partial | 6 org roles (`ORGANIZATION_OWNER`, `SECURITY_ADMIN`, `LEAD_ARCHITECT`, `MIGRATION_CONSULTANT`, `AUDITOR`, `VIEWER`) + system `SUPER_ADMIN` (`packages/auth/src/permissions.ts`). Spec lists 12; no Billing Admin/Reviewer/Developer roles |
| Granular permissions | Partial | Permission map exists in `packages/auth`, but API guards check role names (`@Roles`); ABAC deferred (ADR-101) |
| E-mail/password, Argon2id | Done (live) | `auth/auth.service.ts` |
| Magic link | Done (live) | `POST auth/magic-link`, `auth/magic-link/{preview,verify}` (migration 025), `/login/magic`; session-security suite |
| OIDC SSO (per organisation), enforcement | Done (live vs OIDC double) | `sso/sso.controller.ts` (`sso/discover`, `login`, `callback`); `SSO_REQUIRED` in `auth.service.ts` (`013fc6f`) |
| SAML | Missing | — |
| TOTP 2FA, recovery codes, org "require 2FA" | Done (live) | `auth.controller.ts` `2fa/*`; `organizations.controller.ts` `PATCH current/security`; `tenancy.middleware.ts` `require_2fa` |
| Session/device management | Done (live) | `GET/DELETE auth/sessions`, `logout-all`; `auth/strategies/jwt.strategy.ts`; HttpOnly cookie-only browser sessions + CSRF guard (`auth/session-cookie.ts`, `auth/csrf.guard.ts`) |
| SCIM provisioning | Done (live vs double) | `sso.controller.ts` `@Controller('scim/v2')` Users/Groups |
| IP allowlists | Done (live) | `GET/PUT/DELETE organizations/current/ip-allowlist` (Enterprise `ipAllowlist` feature, CIDR validation, 409 lockout protection, 403 `IP_NOT_ALLOWED`; `tenant-access/ip-allowlist.service.ts`, migration 021). Requires `TRUST_PROXY` = real proxy hop count |

## Part 10.3–10.5, C §21–§23 Plans, entitlements, billing, usage

| Feature | Status | Evidence |
|---|---|---|
| Plan catalog | Partial | `packages/schemas/src/plans.ts`: FREE (0), STARTER (490 €), PROFESSIONAL (1490 €), ENTERPRISE and PARTNER (contact sales). Spec names Free/Pro/Consultant/Team/Enterprise. Catalog is code, **not admin-configurable** |
| Internal entitlement service (Stripe is not the authority) | Done (live) | `billing/entitlements.service.ts` `resolvePlanState`, `checkEntitlement`; `guards/entitlement.guard.ts` |
| Entitlement sources: Free, Stripe, Trial, Partner, enterprise contract | Partial | Free/Stripe/Trial/PARTNER tier; enterprise contract = admin plan change + `PATCH admin/tenants/:id/limits`. SAP Store: not implemented (spec: future) |
| Enforced limits (402/403) | Done | Enforced: projects, analyses/month, landscapes, storage, exports/month, team members (invitations), AI tokens/month (AI gateway), agent gate, Cloud ALM/work-item sync, air-gapped export (offline HTML, reproducibility bundle), What-If change sets, report branding, IP allowlist (`billing/entitlements.service.ts`, `test/billing_entitlements.spec.ts`). Not modelled: file size per plan, release watches, connectors, local agent, SSO, private deployment |
| 14-day trial | Done (live) | `entitlements.service.ts` (`TRIAL_DAYS`, `billing.trial.started` audit) |
| Stripe checkout, customer portal | Done (not verified with real Stripe) | `billing/billing.controller.ts` `checkout`, `portal`; `billing-provider.ts` |
| Subscription upgrade/downgrade/cancel | Partial | Through the Stripe portal; state from `customer.subscription.*` webhooks; no in-app plan switch |
| Webhook verification + idempotency | Done (live, locally signed events) | `billing.service.ts` (`billing_events` per provider event id); migration 016 |
| Invoices, failed payment | Done | `GET billing/invoices`; `invoice.payment_failed` handler |
| Coupons, VAT metadata | Partial | Stripe `allow_promotion_codes`, `tax_id_collection` in `billing-provider.ts`; no internal tax ledger |
| Credits | Missing | — |
| Usage metering | Partial | `usage/usage.service.ts`, metrics `ANALYSIS_RUN`, `ENGINE_EXECUTION`, `ARTIFACT_UPLOAD`, `ARTIFACT_BYTES`, `REPORT_EXPORT`, `AI_TOKENS`, `CONNECTOR_REQUEST` (migration 024); uploads metered exactly once on every path (`ingestion.service.ts` `confirmUpload`). Not metered: API calls, heavy-log processing |
| Usage UI (current, limit, reset date) | Done (live UI) | `apps/web/src/app/settings/billing/page.tsx`; `GET billing/overview`, `billing/usage/daily` |
| Admin revenue / cost / margin | Partial | `GET admin/business`: estimated MRR/ARR from list prices; no infra/AI cost or gross-margin estimate |

## Part 10.6–10.14, C §24 Super admin and support

| Feature | Status | Evidence |
|---|---|---|
| `/admin` console | Done (live UI) | `apps/web/src/app/admin/page.tsx` tabs: overview, business, incidents, support, flags, tenants, users, engines, queues; plus `/admin/{rules,ai,knowledge,sources}` |
| Dashboard metrics | Partial | Present: MRR/ARR estimate, trials, tenants by tier/status, active orgs/users (30 d), analyses/day, error rate (7 d), storage, queues (`admin.service.ts`); AI spend per task (`/admin/ai`), source freshness (`/admin/sources`). Missing: conversion, churn, infra cost, gross margin |
| Organisation admin | Partial | Inspect, change plan, adjust limits (`admin.controller.ts`); suspend/unsuspend, bounded trial extension, break-glass IP allowlist removal (`tenant-access/tenant-admin.controller.ts`, mandatory reason, audited in the tenant chain + `platform_audit_events`). Missing: grant credits |
| Safe impersonation (C §24, 10.8) | Done (live) | `POST/GET admin/impersonations`, `…/:id/end`, `…/:id/requests` (`tenant-access/impersonation.*`): distinct token, HttpOnly cookie, ≤ 30 min, read-only by default, secrets always denied, every request audited (fail-closed), banner with countdown |
| Knowledge admin | Partial | `/admin/knowledge`: article workflow (draft → review → publish) + read-only knowledge-graph view (`admin/knowledge-graph/{summary,objects,conflicts}`). Curated objects and object review are API only (`knowledge-graph/admin`) |
| Rule admin (10.10) | Done (live) | `/admin/rules` (`governance/rule-governance.*`): inventory, golden coverage, deterministic self-test (`POST /api/v1/rules/{code}/self-test`), DRAFT → IN_REVIEW → PUBLISHED → DEPRECATED with publish gate. 49 of 233 codes lack a golden case and cannot be published yet |
| AI admin (10.11) | Done (live vs local stub) | `/admin/ai` (`ai-gateway/ai-admin.controller.ts`, `ai-governance.service.ts`): per-task provider/model/fallback/max tokens/temperature/privacy mode, provider kill switch, monthly cost ceiling reserved atomically (`ai_task_budget`), spend ledger |
| Source sync admin (10.12) | Done (live) | `/admin/sources` (`governance/source-sync-admin.*`): freshness, errors, items, changes, retry; hourly `SOURCE_FRESHNESS_CRON` job opens stale alerts (in-app + e-mail to super admins) |
| OSS/third-party admin (10.13) | Partial | `THIRD_PARTY_NOTICES.md` + `scripts/generate-third-party-notices.py`, CycloneDX SBOM in CI; no admin screen |
| Support tickets with correlation id + diagnostic snapshot (C §62) | Done (live) | `support/support.controller.ts` (`support/tickets`, `admin/support/tickets`); conversation threads and e-mails to requester and `SUPPORT_INBOX_EMAIL` (`d2a5e76`) |
| Report incorrect finding | Done | `apps/web/src/components/findings/finding-detail-row.tsx` → `settings/support` |
| Temporary support access with expiry + audit | Done (live) | `support/access-grants`, `…/revoke` |

## Part 10.15–10.20 Compliance

| Feature | Status | Evidence |
|---|---|---|
| Tamper-evident audit log | Done (live) | `audit/audit.controller.ts` `GET audit/verify`; per-tenant hash chain; 76 `@Audited` call sites; `/settings/audit`; append-only `platform_audit_events` for operator actions |
| File retention (tenant-configurable) | Done | `retention/retention.controller.ts`, `/settings/retention`; bounded by plan `maxArtifactRetentionDays` |
| Encrypted secrets | Done | `connectors/credential-vault.ts` (connector credentials, webhook secrets) |
| Upload security pipeline | Done (live) | magic bytes, ClamAV, archive limits, redaction, 100 MB cap (`ingestion/`) |
| CSP, rate limiting, secure cookies, CSRF, CORS | Done | `apps/web/src/lib/csp.ts` + `middleware.ts`; Redis-backed `rate-limit/rate-limiter.service.ts` shared by all API instances (`auth/guards/auth-rate-limit.guard.ts`); HttpOnly session cookie + `auth/csrf.guard.ts` |
| GDPR consent, export, deletion | Done (live) | `apps/web/src/components/public/cookie-consent.tsx`; `account.controller.ts`; `organizations.controller.ts` `current/export` |
| Subprocessor registry, DPA page | Partial | `/legal/subprocessors`, `/legal/dpa` from `NEXT_PUBLIC_LEGAL_*`; no DPA signing workflow, no data-region abstraction |
| Public `/security` page | Done | `apps/web/src/app/[locale]/security/page.tsx` |

## C §61–§63 Partner mode, support, feature flags

| Feature | Status | Evidence |
|---|---|---|
| Partner grants with strict isolation | Done (live) | `partners/partners.controller.ts`; grants table with its own RLS policy |
| Partner overview, client-specific access | Done (live) | `GET partners/clients`, `POST partners/grants` |
| White-label reports | Partial | Per-organisation branding (`GET/PUT reports/branding`); no partner-level branding |
| Partner rules / knowledge packs | Missing | — |
| Feature flags: environment, plan, org, cohort (percentage), beta, admin-managed | Done | `feature-flags/feature-flags.service.ts` (evaluation order kill switch → env → org deny/allow → plan → beta → rollout); `admin/feature-flags` |

## Summary

Done: 33 · Partial: 14 · Missing: 3 (counted from the rows above; at `6303f1d`: 26 / 16 / 8). Wave 5 closed magic link,
IP allowlists, safe impersonation, Rule/AI/Source Sync Admin. Main gaps for a paid launch: plans not admin-configurable,
no credits, no real Stripe verification, and production is not deployed yet.
