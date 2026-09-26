# ERP Preflight — Known Limitations

> Spec 0.2, 13.12 #8, C §75 #10. Only limitations observed in the code or in a test run are listed; each names where
> it lives. Fixed items move to §7 with the commit or workstream that fixed them.

| Field | Value |
|---|---|
| Commit | `6303f1d` on `claude/sharp-mendel-xg6cus` |
| Date | 2026-09-26 |
| Deployment checked | **None** — production was not verified (`docs/LIVE_PRODUCTION_VERIFICATION.md`) |
| Test basis | API 979, web 233, local-agent 10, Python 1169 + 1 skipped, Python e2e 267, 0 failed; live suites in `docs/E2E_TEST_REPORT.md` |

## 1. Not verified (external systems, deployment)

| # | Limitation |
|---|---|
| V1 | No deployment to Hostinger/Coolify and no production smoke. Every "verified" statement refers to a local production-mode stack. |
| V2 | GitHub workflows (`ci.yml`, `security.yml`, `docker.yml`, `release.yml`) have never run on GitHub; they are actionlint-clean and their commands were run locally. |
| V3 | Full `docker build` of all images not done in the sandbox (Debian/Alpine mirrors blocked): API + web built with a sandbox CA, analysis image without its apt steps. |
| V4 | Stripe, SMTP/HTTP mail providers, OpenAI/Anthropic, SAP Cloud ALM, Jira, Azure DevOps, ServiceNow and OIDC IdPs were exercised only against contract doubles (`apps/api/test/doubles/`). |
| V5 | No load test, no Lighthouse or axe accessibility audit, no penetration test. |
| V6 | `pnpm exec playwright test` (`tests/e2e/*.spec.ts`) was not run on the final tree; browser coverage comes from the Chromium smoke scripts. No `playwright.live.config.ts` exists, so the multi-browser hook in `scripts/ci-live-e2e.sh` is skipped. |

## 2. Product and SaaS

| # | Limitation | Where |
|---|---|---|
| P1 | App localisation incomplete: `apps/web/src/app/integrations/**`, `components/integrations/**` and the analysis launcher / run history in `app/projects/[id]/page.tsx` contain English literals. API error messages not mapped in `src/i18n/validation.ts`, server-generated template/changelog content and engine rule titles/remediation (Python catalog) are English. | `AI_AGENT_HANDOVER_AND_ARCHITECTURE.md` §6.1 |
| P2 | Billing: no internal credits or tax ledger; coupons only via Stripe promotion codes; no global plan editor (plans are code in `packages/schemas/src/plans.ts`, per-tenant limit overrides only); no trial extension or tenant suspension in the admin API. Enforced plan checks (`@RequireEntitlement`) cover projects, analyses, landscapes, uploads/storage, exports and agent gate; the `teamMembers` and `aiTokensPerMonth` limits are reported in usage but not enforced when inviting members or calling the AI gateway (which has its own `token_budget_monthly`). The plan features `cloudAlmSync`, `airGappedExport` and `whatIfSimulation` are declared (`AIR_GAPPED_EXPORT`, `CLOUD_ALM_SYNC` cases exist in `checkEntitlement`) but no route requires them; only `reportBranding` and `agentGate` are enforced. | `apps/api/src/modules/admin`, `billing/entitlements.service.ts` |
| P3 | Usage metering: `ARTIFACT_BYTES` not recorded on the presigned-upload confirm path; connector requests and heavy-log processing are not metered. | `ingestion/files.controller.ts`, `packages/schemas/src/plans.ts` `UsageMetricEnum` |
| P4 | Super admin: no safe impersonation (spec 10.8), no Rule Admin (10.10), no AI Admin (10.11), no conversion/churn/AI-spend/infra-cost/gross-margin figures (MRR/ARR are estimates from list prices). Support ticket e-mails not implemented. | `admin.service.ts` |
| P5 | Knowledge article content workflow has an API only (`/api/v1/admin/knowledge`), no admin UI. Knowledge-graph sync and curation are API/CLI only. | `knowledge/admin-knowledge.controller.ts` |
| P6 | Test Lab: W2 generated tests (`tests` table) and W1 regression tests are separate models; lab runs do not create analysis records. No cancel/rerun endpoints for analyses. | `lab/`, `analyses.controller.ts` |
| P7 | Finding assignment emits an event but has no notification template. FormDoctor evidence shows the template default name. | `findings`, `notifications` |
| P8 | No dedicated analysis-detail URL; run progress and results are shown inside the project workspace and `/analyze`. | `apps/web/src/app/projects/[id]/page.tsx` |
| P9 | Legal texts (imprint, privacy, terms, cookies, subprocessors, DPA) are templates filled from `NEXT_PUBLIC_LEGAL_*`; they need lawyer review. | `apps/web/src/lib/legal.ts` |
| P10 | Authentication: no magic link, no social OAuth, no SAML, no IP allowlists. ABAC/Cerbos deferred (ADR-101); API authorization uses role guards, the permission map in `packages/auth` is not used by the API guards. | `ARCHITECTURE_DECISIONS.md` ADR-101 |
| P11 | Partner mode: no partner rule/knowledge packs; report branding is per organisation, not per partner. | `partners/` |

## 3. Engines and knowledge

| # | Limitation | Where |
|---|---|---|
| E1 | Clean Core: MODIFY/DELETE on a database table vs an internal table is decided by naming heuristics; the API-side snapshot overlay does not scan object names inside abapGit ZIPs. abaplint is not bundled; external AST references are accepted as input. | `services/analysis-python/src/engines/clean_core.py` |
| E2 | Gap Radar accepts plain English text and answers with `GAP_RADAR_UNKNOWN_REQUIREMENT` (UNKNOWN) instead of rejecting it. | `engines/gap_radar.py` |
| E3 | MFS BlackBox has no streaming mode for multi-GB logs. | `engines/mfs_blackbox.py` |
| E4 | API Change Guard compares OpenAPI/EDMX itself; no oasdiff-level comparison and no stored baselines. | `engines/api_change.py` |
| E5 | Five unregistered legacy modules remain (`fiori_403.py`, `iam_cost.py`, `safe_decommission.py`, `system_refresh.py`, `workflow_stuck.py`). | `ENGINE_CATALOG.md` last section |
| E6 | Knowledge objects carry no SAP descriptions (not in the source data). Cloudification data contains no transaction codes, so migration SEO pages exist only for development objects; `/sap/cloud/migration/va01` is 404 by design. | `docs/KNOWLEDGE_GRAPH_STATUS.md` |
| E7 | ROSA: file import only; live access needs a customer-hosted ROSA endpoint (public instance retired). | `knowledge-graph/sources/rosa-file-import.source.ts` |
| E8 | Cloud ALM adapter API paths need validation against a real tenant; test-case sync and process hierarchy are partial. | `connectors/adapters/cloud-alm.adapter.ts` |
| E9 | The XML field checker tool requires the updated analysis service to be deployed together with the API. | `public-tools` |

## 4. Security

Full list with owners: `SECURITY_REVIEW.md` §5.

| # | Limitation |
|---|---|
| S1 | Leaked Coolify token and demo/super-admin passwords are in public git history; rotation is an **owner action**, not confirmed. |
| S2 | The web app reads the bearer token from `localStorage` (`apps/web/src/lib/api/custom-instance.ts`); the session cookie is HttpOnly/SameSite/Secure, but spec C §8.2/§68 asks for no primary token in `localStorage`. CSP (nonce-based) mitigates XSS but does not remove the exposure. |
| S3 | Auth and 2FA-failure rate limiters are in-memory per API instance. |
| S6 | Webhook delivery to private-network receivers requires `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` (SSRF policy). |
| S7 | `pnpm audit` advisories in dev/build tooling were tracked in `SECURITY_REVIEW.md` S7; not re-run on the final tree. |

## 5. Operations

| # | Limitation | Where |
|---|---|---|
| O1 | Single VPS, no high availability; RPO = time since last backup. | `docker-compose.coolify.yml`, `DEPLOYMENT_GUIDE.md` §9 |
| O2 | Backups local unless the off-site copy is configured; no WAL archiving / PITR. | `scripts/backup.sh` |
| O3 | Migrations run at API container start, not as a separate job with an automatic pre-migration backup. | `infra/docker/api-entrypoint.sh` |
| O4 | OTel tracing, Sentry-protocol error reporting and Prometheus metrics exist; no dashboards or alert rules are shipped (alert ideas only in `docs/runbooks/observability.md`). | `apps/api/src/observability/` |
| O5 | `elestio/minio:latest` and `clamav/clamav:latest` use floating tags. | `docker-compose.coolify.yml` |
| O6 | ClamAV needs ~3 GB RAM and minutes to load signatures; summed container limits ~13 GB. | `docs/runbooks/CLAMAV_DOWN.md` |
| O7 | `pytest`/`pytest-asyncio` are in `services/analysis-python/requirements.txt` and ship in the analysis image. | requirements.txt |
| O8 | Repository cleanup (C §65) is proposed in `docs/REPO_CLEANUP_PROPOSAL.md`, not executed (deletions need owner approval). No `.github/CODEOWNERS`, no branch protection evidence. | — |

## 6. Spec deliverables missing

| Item | Status |
|---|---|
| `ROADMAP_AFTER_V1.md` (spec 13.12 #10) | not written |
| `FINAL_IMPLEMENTATION_REPORT.md` (13.12 #1) | covered by `docs/FINAL_REMEDIATION_REPORT.md` |

## 7. Resolved since the 2026-09-25 audit

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
| Password login possible for members of SSO-enforced organisations | `6303f1d` |
| No live E2E, migration check, image scan, SBOM in CI; no backups | Workstream E |
| BullMQ ignored the `REDIS_URL` db index | `c3f9b10` |
