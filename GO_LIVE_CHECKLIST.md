# ERP Preflight — Go-Live Checklist

> Spec 13.11 "Definition of Done for public launch" + C §74 QA DoD. Commit `6303f1d`, 2026-09-26.
> **Deployment checked: none.** "✅" means verified on the local production-mode stack, not in production.
> Legend: ✅ done and verified locally · ⚠️ partial · ❌ missing · 🔑 owner action.

## Owner actions before launch (do these first)

1. 🔑 Revoke the leaked Coolify token (`13|wilw…`); change or disable `contact@erppreflight.com` and
   `demo.client@erppreflight.com` in the production DB (`docs/runbooks/SECRET_ROTATION.md` §1).
2. 🔑 Set production variables in Coolify (`AI_AGENT_HANDOVER_AND_ARCHITECTURE.md` §4.4, `.env.coolify.example`),
   including `MAIL_TRANSPORT`/`MAIL_FROM` + provider, `APP_PUBLIC_URL`, `NEXT_PUBLIC_API_URL` (build arg),
   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_LEGAL_*`; confirm compose path `/docker-compose.coolify.yml`.
3. 🔑 VPS ≥ 16 GB RAM (summed limits ~13 GB); backup cron + off-site copy; one restore drill on the VPS.
4. 🔑 Deploy, then follow `docs/LIVE_PRODUCTION_VERIFICATION.md` (health, knowledge sync, smoke, rollback).
5. 🔑 Lawyer review of the legal pages; Stripe live keys + webhook endpoint if billing goes live.
6. 🔑 Branch protection on `main` (required checks ci/security/docker), CODEOWNERS; push `v0.1.0-rc.1` to exercise `release.yml`.
7. 🔑 External uptime monitor on `/health/readiness` and certificate expiry.

## 13.11 Public launch

| Item | Status | Evidence / gap |
|---|---|---|
| No broken core navigation | ✅ | UI, account, i18n smoke (32 app + 5 public pages, 375/1440 px) |
| No dead primary CTA | ✅ | Public smoke (EN/DE); free tool results link to signup |
| No placeholder pricing | ✅ | `/en/pricing` from `GET /api/v1/billing/plans` (FREE 0 €, STARTER 490 €, PROFESSIONAL 1490 €, ENTERPRISE/PARTNER contact sales) |
| No unauthenticated data leak | ✅ | Invalid token → 401; presigned URLs ≤ 15 min; reports streamed after tenant check |
| No cross-tenant access | ✅ | Live denials (project, findings, lab, analysis, report download, spoofed `X-Tenant-Id`); 62/62 tenant tables with RLS |
| No public indexation of private routes | ✅ | `app/robots.ts` disallows private prefixes; private layouts `noindex`; `seo-routes.test.ts` |
| No critical failing test | ✅ | 0 failed across all suites (`docs/E2E_TEST_REPORT.md`) |
| Working backups | ⚠️ | Backup + verified restore drill locally; 🔑 VPS cron/off-site not configured |
| Working password/2FA flows | ✅ | Reset, change, TOTP + recovery codes (account UI smoke) |
| Working e-mail verification | ⚠️ | Verified with the dev mail transport; real provider not tested |
| Working billing lifecycle | ⚠️ | Checkout/portal/webhooks implemented; signed webhooks tested locally; no real Stripe account exercised |
| Working cancel / export / delete account | ✅ | Cancel via Stripe portal + `customer.subscription.deleted` → FREE; GDPR export; account and org deletion |
| Valid sitemap / robots / canonicals | ✅ | Sitemap index, robots, canonical + hreflang (`lib/seo.ts`) |
| Real SEO pages | ✅ | 7 knowledge articles EN/DE, 655 gate-passing SAP object pages after sync (local), docs, tools |
| Working analytics consent | ⚠️ | Consent banner works; no analytics vendor integrated |
| Production health check | ⚠️ | `/health/liveness`, `/health/readiness` verified locally; not in production |
| Admin incident visibility | ⚠️ | `/admin` incidents tab (`GET /api/v1/admin/incidents`); no alerting |

## C §74 QA Definition of Done

| Item | Status | Where |
|---|---|---|
| CI green | ⚠️ | Workflows actionlint-clean, all job commands reproduced locally; **never run on GitHub** |
| Typecheck / lint | ✅ | 13/13 packages 0 errors; lint pass |
| Vitest | ✅ | API 979, web 233, local-agent 10 |
| pytest | ✅ | 1169 passed + 1 skipped; e2e/redaction 267 |
| Playwright | ⚠️ | Chromium smoke scripts pass; `pnpm exec playwright test` not run on the final tree; no multi-browser live config |
| Docker builds | ⚠️ | API + web images built with sandbox CA; analysis image only without apt steps |
| Dependency checks | ⚠️ | `check:deps` pass; pip-audit blocking; pnpm audit report-only, not re-run on final tree |
| Secret scan | ✅ | gitleaks full history (workstream E run) |
| Vulnerability scan | ✅ | Trivy fs/config/image blocking; 0 fixable HIGH/CRITICAL in the last local run |
| SBOM | ✅ | CycloneDX in `docker.yml`, `release.yml`, `security.yml` |
| Restore drill | ✅ | Locally, and in every `ci-live-e2e.sh` run |
| Live production smoke | ❌ | Not run — no deployment (🔑 step 4) |
