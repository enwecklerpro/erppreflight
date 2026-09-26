# ERP Preflight — Current Product Status (canonical)

> Spec C §64. **This file is the canonical status.** No marketing terms. Status date 2026-09-26.
> Baseline evidence: `RELEASE_READINESS_REPORT.md` (live audit 2026-09-25) and `docs/E2E_TEST_REPORT.md`.
> The previous version of this file overstated completeness and is archived at
> `docs/archive/audits/CURRENT_PRODUCT_STATUS.superseded-2026-09-25.md`.
> Parallel workstreams (A–D) may change rows; the coordinator updates this file after merging them.

Status values:

| Value | Meaning |
|---|---|
| `VERIFIED_PRODUCTION` | Verified on the production deployment (erppreflight.com) |
| `COMPLETE_NOT_DEPLOYED` | Implemented and verified against a live local stack (real Postgres/Redis/MinIO/ClamAV, production mode), not yet verified in production |
| `PARTIAL` | Works in part; the gap is named |
| `NOT_IMPLEMENTED` | Absent |
| `BLOCKED` | Needs an external credential or an owner action |

No capability is `VERIFIED_PRODUCTION` yet: nothing from the remediation branches has been deployed
and smoke-tested in production.

## Core product loop

| Capability | Status | Evidence / gap |
|---|---|---|
| Sign up, log in, log out | COMPLETE_NOT_DEPLOYED | Live API + browser smoke |
| Password reset, 2FA, e-mail verification | NOT_IMPLEMENTED | KNOWN_LIMITATIONS P3 |
| Organisations / tenant isolation | COMPLETE_NOT_DEPLOYED | 7 cross-tenant denials live; RLS on 22/22 tenant tables (migration check) |
| Organisation switcher, invitations | NOT_IMPLEMENTED | P7 |
| Projects | COMPLETE_NOT_DEPLOYED | API + UI smoke |
| Upload (magic bytes, archive safety, ClamAV fail-closed, redaction) | COMPLETE_NOT_DEPLOYED | Live smoke with real clamd; redaction at rest verified |
| Asynchronous analysis (BullMQ → Python engines) | COMPLETE_NOT_DEPLOYED | Live smoke: OPD Guard run COMPLETED with exactly the expected finding |
| Findings with evidence (file, line, SHA-256, provenance) | COMPLETE_NOT_DEPLOYED | Live smoke + UI finding detail |
| Report export PDF / XLSX / CSV / HTML / JSON bundle | PARTIAL | All five via API (live); UI buttons only for HTML and bundle; `ZIP_ALL` → 400 (P5) |
| Audit trail for business events | NOT_IMPLEMENTED | P6 |

## Engines

| Capability | Status | Evidence / gap |
|---|---|---|
| 19 engines registered with parsers, rules, fixtures, tests | PARTIAL | `ENGINE_CATALOG.md` (generated from the registry). Input probes show 6 engines return COMPLETED/0 findings and 4 emit findings on non-SAP text (E1, E2) |
| Clean Core AST analysis (abaplint) | NOT_IMPLEMENTED | Regex-based (E3) |
| AI assistance (router, explanations) | BLOCKED | Needs provider credentials; confidence ceiling enforced in code |

## SaaS

| Capability | Status | Evidence / gap |
|---|---|---|
| Admin console (tenants, users, roles, engines, queues) | PARTIAL | Endpoints SUPER_ADMIN-guarded; page not verified live in the browser |
| Billing / plans | BLOCKED | Entitlement guards exist; Stripe keys missing; no billing UI (P4) |
| API keys, webhooks | PARTIAL | Implemented; webhook secrets stored in plaintext (S6) |
| Public website, pricing, legal, SEO pages | NOT_IMPLEMENTED | P1, P8 |
| EN/DE localisation | NOT_IMPLEMENTED | P2 |

## Operations, security and delivery

| Capability | Status | Evidence / gap |
|---|---|---|
| Health endpoints (liveness, readiness with 5 dependencies) | COMPLETE_NOT_DEPLOYED | live-e2e readiness `healthy` |
| Metrics (Prometheus, token-protected) | COMPLETE_NOT_DEPLOYED | — |
| Tracing, error tracking, dashboards, alerting | NOT_IMPLEMENTED | O4 |
| CI: lint, typecheck, unit tests, pytest, build, API boot | COMPLETE_NOT_DEPLOYED | `ci.yml`; commands green locally; first GitHub run pending |
| CI: live E2E (real infra, production-mode API, Chromium) | COMPLETE_NOT_DEPLOYED | `ci.yml` `live-e2e` ↔ `scripts/ci-live-e2e.sh`, passed locally |
| CI: migration check (fresh, idempotent, deterministic, RLS coverage) | COMPLETE_NOT_DEPLOYED | `scripts/ci-migration-check.sh`, passed locally |
| Security CI: gitleaks, Trivy fs/config/image, pip-audit, SBOM | COMPLETE_NOT_DEPLOYED | `security.yml`, `docker.yml`; reproduced locally with 0 blocking findings |
| Node dependency audit | PARTIAL | Report-only: open dev-tool advisories (S7) |
| Signed releases with provenance (GHCR, cosign, SBOM) | PARTIAL | `release.yml` written and linted; never executed (S11) |
| Backups + verified restore | COMPLETE_NOT_DEPLOYED | `scripts/backup.sh`/`restore.sh`; drill passed locally and in every live-e2e run; VPS cron/off-site not configured (owner) |
| Production deployment documentation | COMPLETE_NOT_DEPLOYED | `DEPLOYMENT_GUIDE.md`, `docs/runbooks/` |
| High availability | NOT_IMPLEMENTED | Single VPS (O1); migration path in DEPLOYMENT_GUIDE §9 |
| Leaked-credential rotation | BLOCKED | Owner action (S1) |
