# SaaS Feature Matrix

> Spec C §75 #7. Features from Part 10 and remediation prompt C §21–§24, §61–§63, each checked against the code.
> **Done** = implemented, with the named evidence read in the code; "live" means it was exercised by a live suite on the
> local production-mode stack. **Partial** = the named part is missing. **Missing** = absent.

| Field | Value |
|---|---|
| Commit | `6303f1d` on `claude/sharp-mendel-xg6cus` |
| Date | 2026-09-26 |
| Deployment checked | **None** — nothing verified in production |
| Tests | API 979 / web 233 / local-agent 10 / Python 1169 (+1 skipped) / Python e2e 267 — 0 failed. Live: `e2e-commercial-smoke.py` (~64 checks), `e2e-commercial-ui.cjs` (17 steps), `e2e-live-smoke.sh` 77/77, `e2e-enterprise-live.cjs` 85/85 (commands: `docs/E2E_TEST_REPORT.md`) |

Paths are relative to `apps/api/src/modules/` unless stated; endpoints are under `/api/v1`.

## Part 10.1–10.2 Tenancy and authentication

| Feature | Status | Evidence |
|---|---|---|
| Organisation-based tenancy with RLS | Done (live) | `tenancy/tenancy.guard.ts`; `scripts/ci-migration-check.sh` (62 tables); cross-tenant denials in `e2e-live-smoke.sh` |
| Roles | Partial | 6 org roles (`ORGANIZATION_OWNER`, `SECURITY_ADMIN`, `LEAD_ARCHITECT`, `MIGRATION_CONSULTANT`, `AUDITOR`, `VIEWER`) + system `SUPER_ADMIN` (`packages/auth/src/permissions.ts`). Spec lists 12; no Billing Admin/Reviewer/Developer roles |
| Granular permissions | Partial | Permission map exists in `packages/auth`, but API guards check role names (`@Roles`); ABAC deferred (ADR-101) |
| E-mail/password, Argon2id | Done (live) | `auth/auth.service.ts` |
| Magic link | Missing | — |
| OIDC SSO (per organisation), enforcement | Done (live vs OIDC double) | `sso/sso.controller.ts` (`sso/discover`, `login`, `callback`); `SSO_REQUIRED` in `auth.service.ts` (`6303f1d`) |
| SAML | Missing | — |
| TOTP 2FA, recovery codes, org "require 2FA" | Done (live) | `auth.controller.ts` `2fa/*`; `organizations.controller.ts` `PATCH current/security`; `tenancy.middleware.ts` `require_2fa` |
| Session/device management | Done (live) | `GET/DELETE auth/sessions`, `logout-all`; `auth/strategies/jwt.strategy.ts` |
| SCIM provisioning | Done (live vs double) | `sso.controller.ts` `@Controller('scim/v2')` Users/Groups |
| IP allowlists | Missing | — |

## Part 10.3–10.5, C §21–§23 Plans, entitlements, billing, usage

| Feature | Status | Evidence |
|---|---|---|
| Plan catalog | Partial | `packages/schemas/src/plans.ts`: FREE (0), STARTER (490 €), PROFESSIONAL (1490 €), ENTERPRISE and PARTNER (contact sales). Spec names Free/Pro/Consultant/Team/Enterprise. Catalog is code, **not admin-configurable** |
| Internal entitlement service (Stripe is not the authority) | Done (live) | `billing/entitlements.service.ts` `resolvePlanState`, `checkEntitlement`; `guards/entitlement.guard.ts` |
| Entitlement sources: Free, Stripe, Trial, Partner, enterprise contract | Partial | Free/Stripe/Trial/PARTNER tier; enterprise contract = admin plan change + `PATCH admin/tenants/:id/limits`. SAP Store: not implemented (spec: future) |
| Enforced limits (402/403) | Done | Enforced: projects, analyses/month, landscapes, storage, exports/month, team members (invitations), AI tokens/month (AI gateway), agent gate, Cloud ALM/work-item sync, air-gapped export (offline HTML, reproducibility bundle), What-If change sets, report branding (`billing/entitlements.service.ts`, `test/billing_entitlements.spec.ts`). Not modelled: file size per plan, release watches, connectors, local agent, SSO, private deployment |
| 14-day trial | Done (live) | `entitlements.service.ts` (`TRIAL_DAYS`, `billing.trial.started` audit) |
| Stripe checkout, customer portal | Done (not verified with real Stripe) | `billing/billing.controller.ts` `checkout`, `portal`; `billing-provider.ts` |
| Subscription upgrade/downgrade/cancel | Partial | Through the Stripe portal; state from `customer.subscription.*` webhooks; no in-app plan switch |
| Webhook verification + idempotency | Done (live, locally signed events) | `billing.service.ts` (`billing_events` per provider event id); migration 016 |
| Invoices, failed payment | Done | `GET billing/invoices`; `invoice.payment_failed` handler |
| Coupons, VAT metadata | Partial | Stripe `allow_promotion_codes`, `tax_id_collection` in `billing-provider.ts`; no internal tax ledger |
| Credits | Missing | — |
| Usage metering | Partial | `usage/usage.service.ts`, metrics `ANALYSIS_RUN`, `ENGINE_EXECUTION`, `ARTIFACT_UPLOAD`, `ARTIFACT_BYTES`, `REPORT_EXPORT`, `AI_TOKENS`. Not metered: API calls, connector requests, heavy-log processing; `ARTIFACT_BYTES` missing on presigned confirm |
| Usage UI (current, limit, reset date) | Done (live UI) | `apps/web/src/app/settings/billing/page.tsx`; `GET billing/overview`, `billing/usage/daily` |
| Admin revenue / cost / margin | Partial | `GET admin/business`: estimated MRR/ARR from list prices; no infra/AI cost or gross-margin estimate |

## Part 10.6–10.14, C §24 Super admin and support

| Feature | Status | Evidence |
|---|---|---|
| `/admin` console | Done (live UI) | `apps/web/src/app/admin/page.tsx` tabs: overview, business, incidents, support, flags, tenants, users, engines, queues |
| Dashboard metrics | Partial | Present: MRR/ARR estimate, trials, tenants by tier/status, active orgs/users (30 d), analyses/day, error rate (7 d), storage, queues (`admin.service.ts`). Missing: conversion, churn, AI spend, infra cost, gross margin, source freshness |
| Organisation admin | Partial | Inspect, change plan, adjust limits (`admin.controller.ts`). Missing: suspend/reactivate, extend trial, grant credits |
| Safe impersonation (C §24, 10.8) | Missing | No code |
| Knowledge admin | Partial | API only: `admin/knowledge` (articles, workflow, revisions), `knowledge-graph/admin` (sync, curated objects, review); no admin screens |
| Rule admin (10.10) | Missing | — |
| AI admin (10.11) | Missing | Per-tenant token budget and provider circuit breaker exist in `ai-gateway/ai-gateway.service.ts`; no admin configuration or kill switch |
| Source sync admin (10.12) | Partial | `POST knowledge-graph/admin/sync`, `GET …/sync-runs`; no UI, no staleness alert |
| OSS/third-party admin (10.13) | Partial | `THIRD_PARTY_NOTICES.md` + `scripts/generate-third-party-notices.py`, CycloneDX SBOM in CI; no admin screen |
| Support tickets with correlation id + diagnostic snapshot (C §62) | Done (live) | `support/support.controller.ts` (`support/tickets`, `admin/support/tickets`) |
| Report incorrect finding | Done | `apps/web/src/components/findings/finding-detail-row.tsx` → `settings/support` |
| Temporary support access with expiry + audit | Done (live) | `support/access-grants`, `…/revoke` |

## Part 10.15–10.20 Compliance

| Feature | Status | Evidence |
|---|---|---|
| Tamper-evident audit log | Done (live) | `audit/audit.controller.ts` `GET audit/verify`; per-tenant hash chain; 47 `@Audited` call sites; `/settings/audit` |
| File retention (tenant-configurable) | Done | `retention/retention.controller.ts`, `/settings/retention`; bounded by plan `maxArtifactRetentionDays` |
| Encrypted secrets | Done | `connectors/credential-vault.ts` (connector credentials, webhook secrets) |
| Upload security pipeline | Done (live) | magic bytes, ClamAV, archive limits, redaction, 100 MB cap (`ingestion/`) |
| CSP, rate limiting, secure cookies, CORS | Done | `apps/web/src/lib/csp.ts` + `middleware.ts`; `auth/guards/auth-rate-limit.guard.ts` (in-memory); cookie `httpOnly` in `auth.controller.ts` |
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

Done: 26 · Partial: 16 · Missing: 8 (counted from the rows above). Main gaps for a paid launch: no safe impersonation,
plans not admin-configurable, several declared entitlements not enforced, no real Stripe verification.
