# ERP Preflight — Release Readiness Report

> **Commit:** `6303f1d` · **Branch:** `claude/sharp-mendel-xg6cus` (all workstreams merged; audited baseline `main` @ `7a76aea`)
> **Date:** 2026-09-26 · Required by Part 00 §0.9 and C §75. **Deployment checked: none.**
> Details: `docs/CURRENT_PRODUCT_STATUS.md` (canonical status), `docs/E2E_TEST_REPORT.md` (commands, counts),
> `docs/KNOWN_LIMITATIONS.md`, `docs/LIVE_PRODUCTION_VERIFICATION.md`.

## Zusammenfassung (Deutsch)

**Stand:** Der Code auf Commit `6303f1d` ist funktional weitgehend vollständig und wurde auf einem lokalen Stack im
Produktionsmodus durchgängig getestet (echtes PostgreSQL mit RLS, Redis, MinIO, echter ClamAV, Python-Analysedienst,
Next.js-Produktionsbuild). Alle automatisierten Tests sind grün: API 979, Web 233, Local Agent 10, Python 1169
(1 übersprungen, optionale Abhängigkeit), Python-E2E 267 — **0 fehlgeschlagen**. Alle Live-Suiten (u. a. API-Smoke
77/77, Enterprise 85/85, Integrations-UI 17/17) sind bestanden.

**Nicht geprüft:** Es wurde **nichts auf erppreflight.com deployt und nichts in Produktion verifiziert.** Die
GitHub-Workflows sind noch nie auf GitHub gelaufen. Stripe, E-Mail-Provider, KI-Anbieter, SAP Cloud ALM, Jira,
Azure DevOps, ServiceNow und ein OIDC-Identitätsanbieter wurden nur gegen Test-Doubles geprüft. Es gab keinen Lasttest,
keinen Lighthouse/axe-Audit und keinen Penetrationstest.

**Urteil:** Bereit für ein Deployment auf eine Staging- bzw. Produktionsumgebung mit anschließender Verifikation —
**noch nicht als „live verifiziert“ freigegeben.** Die Freigabe erfolgt erst nach den Schritten unten und dem
Produktions-Smoke-Test.

**Ihre Aufgaben (Reihenfolge):**
1. Den geleakten Coolify-API-Token (Präfix `13|wilw…`) in Coolify widerrufen — er steht in der öffentlichen Git-Historie.
2. Passwörter von `contact@erppreflight.com` und `demo.client@erppreflight.com` in der Produktionsdatenbank ändern oder die Konten sperren.
3. Produktionsvariablen in Coolify setzen (`JWT_SECRET`, `MASTER_ENCRYPTION_KEY`, S3-Schlüssel, `POSTGRES_PASSWORD`, Mail-Transport und Absender, `APP_PUBLIC_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_LEGAL_*`; optional Stripe, Sentry, OTel, `METRICS_TOKEN`).
4. In Coolify den Compose-Pfad `/docker-compose.coolify.yml` einstellen; VPS mit mindestens 16 GB RAM.
5. Nach dem Deployment: Knowledge-Sync einmal ausführen, danach die Prüfschritte aus `docs/LIVE_PRODUCTION_VERIFICATION.md` (Health, Readiness, Smoke-Tests, Rollback-Plan).
6. Rechtstexte (Impressum, Datenschutz, AGB, AVV) anwaltlich prüfen lassen.

## 1. Owner actions (before and after the next deploy)

1. **Rotate the leaked Coolify API token** (prefix `13|wilw…`), public in git history, grants server command execution.
2. **Change or disable** `contact@erppreflight.com` and `demo.client@erppreflight.com` in the production DB (old password public in history; bootstrap never modifies existing accounts).
3. **Set production variables** (`AI_AGENT_HANDOVER_AND_ARCHITECTURE.md` §4.4, `.env.coolify.example`): `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`, `S3_ACCESS_KEY`/`S3_SECRET_KEY`, `POSTGRES_PASSWORD`, `MAIL_TRANSPORT` + `MAIL_FROM` + provider credentials, `APP_PUBLIC_URL`, `NEXT_PUBLIC_API_URL` (build arg), `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_LEGAL_*`; optional `STRIPE_*`, `SENTRY_DSN`, `OTEL_*`, `METRICS_TOKEN`. The API refuses to start without the required secrets.
4. **Coolify compose path** must be `/docker-compose.coolify.yml` (the legacy `docker-compose.yaml` uses Postgres trust auth). VPS memory ≥ 16 GB (summed limits ~13 GB).
5. **After deploy:** run the Cloudification sync once, then `scripts/e2e-live-smoke.sh` against production (creates throwaway tenants; needs `MAIL_TRANSPORT=dev` + `MAIL_DEV_OUTBOX_TOKEN` during the run) or the production-safe manual subset — `docs/LIVE_PRODUCTION_VERIFICATION.md`.
6. **Legal texts** need lawyer review. Configure backup cron + off-site copy; enable branch protection.

## 2. What works end to end (verified on the local production-mode stack)

| Flow | Evidence |
|---|---|
| Sign up → e-mail verification → login → 2FA → reset → sessions/logout-all | `e2e-live-smoke.sh` 77/77, `e2e-account-ui-smoke.cjs` |
| Organisations: invitations, members/roles, org switch, ownership transfer, GDPR export/deletion | live + account UI smoke |
| Project → upload (magic bytes, ClamAV real clamd, archive limits, redaction, 100 MB → 413) → asynchronous analysis (BullMQ → Python) → findings with evidence (path, line, SHA-256) | live + UI + analyze (13) + findings (14) smoke |
| Finding lifecycle (status, suppress, accept risk, comments, assignment, attachments, work item) | findings smoke, integrations UI 17/17 |
| Reports: 6 types × PDF/XLSX/CSV/JSON/HTML/ZIP_ALL, reports hub, branding | commercial smoke (~64) + UI (17) |
| Plans, trial, 402 limits, usage, audit hash chain (1852 events / 104 orgs, 0 gaps), super admin, feature flags, support | commercial smoke + UI |
| Public site EN/DE, pricing, legal, knowledge, docs, 6 free tools, SAP object pages (quality gate), sitemap | public, tools (24), i18n (32 app + 5 public DE) |
| Knowledge graph: real Cloudification sync (13 files, 68,627 objects, 341,247 states, 10,160 successor edges, ~37 s; rerun NOOP); Clean Core on real ABAP flags MARA/BSEG/BAPI as VERIFIED with official successors | live runs |
| Tenant isolation: cross-tenant project/findings/lab/analysis/report/spoofed `X-Tenant-Id` → 403/404; 62 tenant tables FORCE RLS; runtime role NOBYPASSRLS | live smoke, migration check |
| Enterprise: connectors, work items, local agent, OIDC SSO (enforced org → 403 `SSO_REQUIRED`) + SCIM, partner mode, webhooks + replay, API reference, CLI | `e2e-enterprise-live.cjs` 85/85 (contract doubles) |
| Backup → drop → restore → verify drill | `scripts/ci-live-e2e.sh` |

## 3. What was not verified

- **Production:** no deployment, no production smoke, no TLS/header check on erppreflight.com.
- **CI on GitHub:** `ci.yml`, `security.yml`, `docker.yml`, `release.yml` never ran (actionlint clean; commands run locally).
- **Images:** API + web built with a sandbox CA; analysis image only without apt steps (mirrors blocked).
- **External services:** Stripe, SMTP/HTTP mail provider, OpenAI/Anthropic, Cloud ALM, Jira, Azure DevOps, ServiceNow, OIDC IdP — contract doubles only.
- **Quality audits:** no load test, no Lighthouse/axe, no penetration test; `pnpm exec playwright test` not run on the final tree.

## 4. Spec compliance — Part 00 §0.9 "Definition of finished"

| Requirement | Status | Evidence / gap |
|---|---|---|
| Public website works | Done (local) | `apps/web/src/app/[locale]/**`; public smoke EN/DE |
| Auth works | Done (local) | account flows above; no magic link/SAML |
| Organizations/tenants work | Done (local) | live denials, RLS 62/62 |
| Project creation works | Done (local) | UI + API smoke |
| File upload works | Done (local) | real ClamAV, redaction at rest |
| Core analyses run asynchronously | Done (local) | BullMQ → Python, SSE progress |
| Findings persist / evidence visible | Done (local) | findings smoke, evidence inspector |
| Reports export | Done (local) | 6 types × 6 formats |
| Admin console works | Done (local), gaps | `/admin` 9 tabs; no impersonation, rule/AI admin (`docs/SAAS_FEATURE_MATRIX.md`) |
| Billing plan abstractions work | Done (local) | entitlements, 402, trial; real Stripe not exercised |
| Localization EN + DE | Partial | public site complete; integrations UI, launcher strings, API errors, engine texts English |
| SEO pages SSR/static | Done (local) | knowledge, docs, tools, SAP object pages with gate (655 indexable locally) |
| All engines have real parsers, rules, fixtures | Done | 19 engines, 130 declared rules, input contracts (`ENGINE_CATALOG.md`) |
| Tests cover critical paths | Done | §2 and `docs/E2E_TEST_REPORT.md` |
| Local Docker environment from documented commands | Partial | infra from compose verified; full image builds not in sandbox |
| Production deployment documentation | Done | `DEPLOYMENT_GUIDE.md`, handover §4, `docs/LIVE_PRODUCTION_VERIFICATION.md`, runbooks |
| Monitoring / health endpoints | Done (local) | liveness, readiness (5 deps), token-protected metrics; no dashboards/alerts |
| Security checks in CI | Partial | gitleaks/Trivy/pip-audit/SBOM configured and reproduced locally; never run on GitHub |
| No broken links / empty primary screens | Done (local) | smoke suites incl. DE pages at 375/1440 px; no full link crawl |

## 5. Spec compliance — C §68–§74 Definitions of Done

| DoD | Done | Partial | Missing | Main gaps |
|---|---|---|---|---|
| §68 Security (14 items) | 13 | 0 | 1 | bearer token still in `localStorage` (`docs/SECURITY_HARDENING_REPORT.md`) |
| §69 Frontend (18 screens) | 16 | 2 | 0 | analysis detail has no own route; integrations UI partly English |
| §70 Backend (25 API areas) | 24 | 1 | 0 | rules: read-only engine/rule catalog, no rule admin API |
| §71 Product intelligence (12) | 7 | 5 | 0 | ROSA file import only; abaplint/oasdiff not bundled; abapGit overlay; Test Lab models not unified (`docs/KNOWLEDGE_GRAPH_STATUS.md`) |
| §72 Enterprise (10) | 6 | 4 | 0 | policy engine deferred (ADR-101); Cloud ALM unvalidated; no dashboards/alerts; no partner packs (`docs/ENTERPRISE_READINESS.md`) |
| §73 Growth (10) | 8 | 2 | 0 | app EN/DE gaps; API reference off in production unless enabled (`docs/SEO_READINESS_REPORT.md`) |
| §74 QA (13) | 8 | 4 | 1 | CI never run on GitHub; Playwright suite not run; docker builds partial; pnpm audit report-only; **live production smoke missing** |

§69 evidence (pages): `[locale]/page.tsx`, `login`, `signup`, `onboarding`, `dashboard`, `projects`, `projects/[id]`,
`artifacts`, `analyze`, `projects/[id]/findings`, `inspector` + `projects/[id]/objects`, `projects/[id]/lab`, `reports`,
`notifications`, `integrations`, `settings/*`, `settings/billing`, `admin`; `check:no-production-facades` passes.
§70 evidence: controllers under `apps/api/src/modules/*` (auth, organizations, invitations, projects, files, analyses,
findings incl. `:id/evidence`, lab, export/reports, notifications, billing incl. entitlements/usage, admin,
knowledge/knowledge-graph, release-intelligence watches, connectors, api-keys, webhooks, feature-flags, support,
changesets, agent-gate/agent-api).

Spec 13.12 hand-over documents: present except `ROADMAP_AFTER_V1.md`; `FINAL_IMPLEMENTATION_REPORT.md` is covered by
`docs/FINAL_REMEDIATION_REPORT.md`.

## 6. Verdict

The product loop and the SaaS, growth and enterprise surfaces work end to end on a local production-mode stack with
0 failing tests. The release is **not verified in production**: that requires the owner actions in §1 and the
procedure in `docs/LIVE_PRODUCTION_VERIFICATION.md`. Remaining limitations are listed in `docs/KNOWN_LIMITATIONS.md`;
none of them blocks a first deployment, but S1 (credential rotation) must be done before it.
