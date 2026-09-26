# ERP Preflight — Known Limitations

> Spec 0.2, 13.12 #8, C §75 #10. Only limitations observed in the code or in a test run are listed; each names where
> it lives. Fixed items move to §7 with the commit or workstream that fixed them.

| Field | Value |
|---|---|
| Commit | `0aaa83d` on `claude/sharp-mendel-xg6cus` (wave 5 merged; `main` carries the same content via PR #2) |
| Date | 2026-09-26 |
| Deployment checked | **None** — production is **not deployed** with this code (see V1) and was not verified (`docs/LIVE_PRODUCTION_VERIFICATION.md`) |
| Test basis | API 1218, web 310, local-agent 10, Python 1665 + 1 skipped, 0 failed; 12 existing + 6 new live suites, Playwright 13/13 + live config 9/9 (Chromium), upgrade drill 76/76 — `docs/E2E_TEST_REPORT.md` |

## 1. Not verified (external systems, deployment)

| # | Limitation |
|---|---|
| V1 | **Production not deployed.** Coolify did not auto-deploy when `main` was merged, and the Coolify API is not reachable from the build environment. The owner must click **Redeploy** in Coolify, or set the Coolify instance domain to `https://coolify.erppreflight.com` (DNS record already created) so the API becomes reachable. No production smoke; every "verified" statement refers to a local production-mode stack. |
| V2 | GitHub Actions jobs fail after ~3 s at **account level** (no job step runs), so `ci.yml`, `security.yml`, `docker.yml`, `release.yml` have never run on GitHub. Their commands were run locally (`.github/BRANCH_PROTECTION.md` records this owner item). |
| V3 | Full `docker build` of all images not re-verified in the sandbox (Debian/Alpine mirrors blocked). Base images are version + digest pinned (`427efe3`). |
| V4 | Stripe, SMTP/HTTP mail providers, OpenAI/Anthropic, SAP Cloud ALM, Jira, Azure DevOps, ServiceNow and OIDC IdPs were exercised only against contract doubles (`apps/api/test/doubles/`) or local stubs (OpenAI-compatible stub in the governance suite). |
| V5 | No load test, no Lighthouse audit, no penetration test. (The axe-core WCAG 2.2 AA audit now runs — see §7.) |
| V6 | Playwright ran on **Chromium only** (13/13 default config, 9/9 `playwright.live.config.ts`). Firefox and WebKit (`PW_BROWSERS=chromium,firefox,webkit`, set in CI) were not run. |
| V7 | The upgrade drill (from `main@7a76aea` with data, 76/76) ran in the sandbox, not on the production VPS. It found that the old `main` API cannot boot as committed and that uploads made on v0 were quarantined by the old ClamAV reply parser; they stay quarantined after the upgrade (`docs/runbooks/UPGRADE_FROM_V0.md` §0). |

## 2. Product and SaaS

| # | Limitation | Where |
|---|---|---|
| P1 | Localisation: notification e-mails are English except the finding-assignment e-mail (EN/DE per `users.preferred_locale`; the e-mail frame is localized, the text of `analysis.*`, `finding.critical`, `release_watch.changed` is English). Report exports (PDF/XLSX/CSV/JSON/HTML/ZIP) are English **by design** (audit evidence compared byte-for-byte). Free-text server messages without a specific error code show the English server detail (prefixed by a German summary). | `notifications/notification-renderer.ts`, handover §6.1 |
| P2 | Billing: no internal credits or tax ledger; coupons only via Stripe promotion codes; no global plan editor (plans are code in `packages/schemas/src/plans.ts`, per-tenant limit overrides only); no in-app plan switch (Stripe portal). | `apps/api/src/modules/billing` |
| P3 | Usage metering: API calls and heavy-log processing are not metered (`UsageMetricEnum` has no such metric). | `packages/schemas/src/plans.ts` |
| P4 | Super admin: no conversion, churn, infra-cost or gross-margin figures (MRR/ARR are estimates from list prices; AI spend is in `/admin/ai`). No credits grant. | `admin/admin.service.ts` |
| P5 | Knowledge-graph curation (`POST knowledge-graph/admin/curated-objects`, `objects/:id/review`) is API only; the admin knowledge-graph view (`/admin/knowledge`) is read-only. | `knowledge-graph/*.controller.ts`, `governance/knowledge-graph-admin-view.controller.ts` |
| P9 | Legal texts (imprint, privacy, terms, cookies, subprocessors, DPA) are templates filled from `NEXT_PUBLIC_LEGAL_*`; they need lawyer review. | `apps/web/src/lib/legal.ts` |
| P10 | Authentication: no social OAuth, no SAML. ABAC/Cerbos deferred (ADR-101); API authorization uses role guards, the permission map in `packages/auth` is not used by the API guards. | `ARCHITECTURE_DECISIONS.md` ADR-101 |
| P11 | Partner mode: no partner rule/knowledge packs; report branding is per organisation, not per partner. | `partners/` |

## 3. Engines and knowledge

| # | Limitation | Where |
|---|---|---|
| E1 | Clean Core: MODIFY/DELETE on a database table vs an internal table is decided by naming heuristics. abaplint is not bundled; external AST references are accepted as input. | `services/analysis-python/src/engines/clean_core.py` |
| E4 | Golden coverage gaps: 49 of 233 rule codes have no golden self-test case — the 8 new API Change Guard codes (`API_BREAKING_{FORMAT_CHANGED,KEY_CHANGED,NAVIGATION_REMOVED,PARAM_REMOVED,PARAM_RENAMED,RESPONSE_PROPERTY_REMOVED,RESPONSE_STATUS_REMOVED,SECURITY_CHANGED}`) and 41 others (38 runner input-validation codes, `API_ARCHIVE_REJECTED`, `API_PAYLOAD_TOO_LARGE`, `API_NON_BREAKING_ENUM_EXPANDED`, …). The Rule Admin **publish gate blocks** these rules until a golden case exists. The unit tests cover the new API Change Guard categories (`tests/unit/test_api_change_oasdiff.py`); oasdiff itself is not bundled (own implementation of its categories). | `src/selftest/golden/manifest.json` (157 cases), `GET /api/v1/rules/golden-coverage` |
| E5 | Five unregistered legacy modules remain (`fiori_403.py`, `iam_cost.py`, `safe_decommission.py`, `system_refresh.py`, `workflow_stuck.py`). | `ENGINE_CATALOG.md` last section |
| E6 | Knowledge objects carry no SAP descriptions (not in the source data). Cloudification data contains no transaction codes, so migration SEO pages exist only for development objects; `/sap/cloud/migration/va01` is 404 by design. | `docs/KNOWLEDGE_GRAPH_STATUS.md` |
| E7 | ROSA: file import only; live access needs a customer-hosted ROSA endpoint (public instance retired). | `knowledge-graph/sources/rosa-file-import.source.ts` |
| E8 | Cloud ALM adapter API paths need validation against a real tenant; test-case sync and process hierarchy are partial. | `connectors/adapters/cloud-alm.adapter.ts` |
| E9 | The XML field checker tool requires the updated analysis service to be deployed together with the API. | `public-tools` |
| E10 | Ingestion still loads each upload fully into API memory (multipart buffer; 100 MB upload cap `MAX_UPLOAD_SIZE_MB`, 500 MB uncompressed archive cap). Only the API → analysis hop streams large CSV/TXT logs for streaming engines. | `ingestion/files.controller.ts`, `archive-safety.guard.ts` |

## 4. Security

Full list with owners: `SECURITY_REVIEW.md` §5.

| # | Limitation |
|---|---|
| S1 | **Credential rotation (owner).** Leaked Coolify token and demo/super-admin passwords are in public git history. In addition, the owner shared secrets in plain text during the session; all must be rotated: the Coolify API token, the Hostinger API token and Hostinger mail API tokens, mailbox and admin passwords, the production `JWT_SECRET` (invalidates all sessions) and the production `MASTER_ENCRYPTION_KEY`, which is a publicly documented example value — rotate it by setting the new key as `MASTER_ENCRYPTION_KEY` and the old one as `MASTER_ENCRYPTION_KEY_PREVIOUS` (`connectors/credential-vault.ts` keeps old ciphertexts readable and re-encrypts on the next write). No value is recorded in this repository. |
| S6 | Webhook delivery to private-network receivers requires `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` (SSRF policy). |
| S7 | `pnpm audit --prod` reports 0 advisories (blocking in CI); the full audit keeps dev-only advisories of the vitest 2 / vite 5 family (report-only). |
| S13 | `TRUST_PROXY` must equal the real number of reverse-proxy hops and the API port must be reachable only through Traefik. Otherwise a spoofed `X-Forwarded-For` bypasses the Redis rate limits and the organisation IP allowlist (both key on `clientIpOf()`). |
| S14 | A cookie-authenticated unsafe request that carries **only** the impersonation cookie `erppreflight_impersonation` (no operator session cookie) passes `CsrfGuard` without `X-CSRF-Token` (decision `NO_COOKIE_SESSION`); it is still subject to the Origin/Referer check, `SameSite` (default `lax`), and impersonation is read-only unless a tenant support grant allows READ_WRITE. |

## 5. Operations

| # | Limitation | Where |
|---|---|---|
| O1 | Single VPS, no high availability; RPO = time since last backup. | `docker-compose.coolify.yml`, `DEPLOYMENT_GUIDE.md` §9 |
| O2 | Backups local unless the off-site copy is configured; no WAL archiving / PITR. The pre-migration `db-backup` job dumps only when migrations are pending. | `scripts/backup.sh`, `premigration-backup.sh` |
| O4 | Alert routing not configured: 14 Prometheus alert rules and a Grafana dashboard ship in `infra/observability` (opt-in profile), but no Alertmanager/receiver (e-mail, Slack, PagerDuty) is set up. | `infra/observability/prometheus/prometheus.yml`, `docs/runbooks/observability.md` §7 |
| O6 | ClamAV needs ~3 GB RAM and minutes to load signatures; summed container limits ~13 GB. | `docs/runbooks/CLAMAV_DOWN.md` |
| O8 | Repository cleanup (C §65) is proposed in `docs/REPO_CLEANUP_PROPOSAL.md`, not executed (deletions need owner approval). Branch protection is documented (`.github/BRANCH_PROTECTION.md`) but not verifiably applied. | — |

## 6. Spec deliverables missing

| Item | Status |
|---|---|
| `FINAL_IMPLEMENTATION_REPORT.md` (13.12 #1) | covered by `docs/FINAL_REMEDIATION_REPORT.md` |

## 7. Resolved

### 7.1 Resolved by wave 5 (merged into `0aaa83d`)

| Former item | Limitation | Resolved by |
|---|---|---|
| S2 | Web app read the bearer token from `localStorage` | **session-security** (`78878b5`, `d1a6ad8`): HttpOnly cookie-only browser sessions, global `CsrfGuard` (signed double-submit + Origin/Referer), legacy tokens purged on app start |
| P10 (part) | No magic link | **session-security**: `POST /auth/magic-link`, `/preview`, `/verify`, `/login/magic` (migration 025) |
| P6 | Test Lab models separate; lab runs created no analysis record; no cancel/rerun | **analysis-lifecycle** (`0047ebd`): `POST /analyses/:id/{cancel,rerun}`, lab runs recorded as `LAB_REGRESSION`/`LAB_SCENARIO` analyses, generated-test promotion (migration 020); one active rerun per source (`c96ee3a`) |
| P8 | No dedicated analysis-detail URL | **analysis-lifecycle** (`9ae3f0a`): `/projects/[id]/analyses/[analysisId]`, `GET /analyses/:id/detail` |
| P2 (part) | No trial extension or tenant suspension in the admin API | **tenant-access-admin** (`25dca9c`): suspend/unsuspend, bounded trial extension (migration 021) |
| P4 (part) | No safe impersonation; support ticket e-mails missing | **tenant-access-admin** (`25dca9c`, `d2a5e76`, `993b5f5`): read-only-by-default impersonation with per-request audit; ticket threads and e-mails to requester and support inbox |
| P10 (part) | No IP allowlists | **tenant-access-admin**: per-organisation IP allowlist (Enterprise, 403 `IP_NOT_ALLOWED`, lockout protection) |
| P4 (part) | No Rule Admin (10.10), no AI Admin (10.11) | **admin-governance** (`1938dad`, `8381177`, `c86d70a`, `4df5220`): `/admin/rules` with deterministic golden self-test and publish gate; `/admin/ai` per-task model config, provider kill switch, atomic monthly cost ceiling (migration 022) |
| P5 (part) | Knowledge article workflow had no admin UI; source sync had no UI or stale alert | **admin-governance**: `/admin/knowledge` (draft → review → publish), `/admin/sources` (freshness, errors, retry, hourly stale alerts) |
| P1 | Integrations UI, launcher/run history English; API errors unmapped; templates/changelog/connectors and engine rule texts English | **i18n-completion** (`aab5206`, `ab31272`, `98a9bf7`, `c404ec2`, `67993ff`): EN/DE app dictionaries, stable API error `code` on every error with EN/DE text, German server-authored content via `Accept-Language`, German rule catalog for all 233 codes with parity gates |
| E2 | Gap Radar accepted plain English text | **engines-completion** (`5532941`): input contract rejects non-SAP prose (`GAP_RADAR_INVALID_INPUT`) |
| E3 | MFS BlackBox had no streaming mode | **engines-completion**: bounded-memory streaming, `POST /api/v1/analyze/stream`, spool guards (`3de97d9`) |
| E4 (part) | No stored API baselines, no oasdiff-level comparison | **engines-completion**: per-project API baselines (migration 023, RLS, audited), oasdiff-level change categories with JSON pointer / XPath + SHA-256 evidence |
| E1 (part) | API-side snapshot overlay did not scan object names inside abapGit ZIPs | **engines-completion** (`5532941`, byte-budgeted inflation `3de97d9`) |
| S3 | Auth and 2FA-failure rate limiters in memory per API instance | **platform-hardening** (`d688b14`): Redis-backed `RateLimiterService` shared by all API instances (bounded in-memory fallback or fail-closed) |
| P3 (part) | `ARTIFACT_BYTES` not recorded on presigned confirm; connector requests not metered | **platform-hardening** (`d688b14`, `b825adb`): exactly-once upload metering on every path; `CONNECTOR_REQUEST` metric (migration 024) |
| P7 | Finding assignment had no notification; FormDoctor evidence showed the template default name | **platform-hardening** (`9518a51`, `dc34665`): in-app + e-mail (EN/DE) with deep link; real uploaded file names in evidence |
| O3 | Migrations ran at API container start without pre-migration backup | **ops-quality** (`427efe3`): compose jobs `db-backup` → `migrate`, API with `AUTO_MIGRATE=false` |
| O4 (part) | No dashboards or alert rules shipped | **ops-quality** (`fce1017`): 14 alert rules with promtool tests, Grafana dashboard, opt-in compose profile |
| O5 | Floating image tags (`elestio/minio:latest`, `clamav/clamav:latest`) | **ops-quality** (`427efe3`): every image pinned by version + digest |
| O7 | `pytest` shipped in the analysis image | **ops-quality** (`2f1fd98`): `requirements-dev.txt` |
| O8 (part) | No `.github/CODEOWNERS` | **ops-quality** (`6aaf3c5`): CODEOWNERS + branch protection recommendation |
| S7 (part) | Production `pnpm audit` advisories | **ops-quality** (`b933062`): 0 production advisories, CI step blocking |
| V5 (part), V6 (part) | No axe audit; Playwright not run; no `playwright.live.config.ts` | **ops-quality** (`b5fed57`): Playwright live suite + axe-core WCAG 2.2 AA audit, contrast defects fixed |
| §6 | `ROADMAP_AFTER_V1.md` not written | **ops-quality** (`b5fed57`) |
| — | v0 finding reviews lost on upgrade | Upgrade drill fix `c3729cb` (migration 026, legacy review import) |

### 7.2 Resolved before wave 5 (since the 2026-09-25 audit)

| Limitation | Resolved by |
|---|---|
| No public site, pricing, legal pages, SAP disclaimer; no EN/DE | Workstream A (`apps/web/src/app/[locale]/**`), W4 |
| No password reset, 2FA, e-mail verification, invitations, org switcher, GDPR export/delete | Workstream B (migration 011) |
| Audit trail not written for business events | Workstream C (`@Audited`, hash chain, `GET /audit/verify`) |
| No billing UI; `ZIP_ALL` export returned 400; PDF/XLSX/CSV only via API | Workstream C (`/settings/billing`, reports hub) |
| Engines answered empty/non-SAP input with COMPLETED or confident findings | Workstream D (declared input contracts; see `ENGINE_CATALOG.md` input probes) |
| Nested archives rejected instead of depth 2 | Workstream D (`archive-safety.guard.ts`) |
| No CSP; no upload size limit on the main upload endpoint | Workstream A (`apps/web/src/lib/csp.ts`), 100 MB cap (`files.controller.ts`) |
| No per-user token revocation | Workstream B (`user_sessions`, `jwt.strategy.ts` checks session + status) |
| Webhook secrets stored in plaintext | Encrypted with the credential vault (`webhooks.service.ts`; legacy rows still readable) |
| No OTel/Sentry | Workstream H (`apps/api/src/observability/`) |
| Password login possible for members of SSO-enforced organisations | `013fc6f` |
| `teamMembers`/`aiTokensPerMonth` limits and declared plan features not enforced | `6303f1d` |
| No live E2E, migration check, image scan, SBOM in CI; no backups | Workstream E |
| BullMQ ignored the `REDIS_URL` db index | `c3f9b10` |
