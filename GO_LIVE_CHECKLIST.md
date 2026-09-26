# ERP Preflight — Go-Live Checklist

> Spec 13.11 "Definition of Done for public launch" + C §74 QA DoD. Status as of 2026-09-26 on the
> remediation branches; the coordinator updates it after merging workstreams A–D.
> Legend: ✅ done and verified · ⚠️ partial · ❌ missing · 🔑 owner action.

## 13.11 Public launch

| Item | Status | Evidence / gap |
|---|---|---|
| No broken core navigation | ✅ | UI smoke journey passes (signup → project → upload → run → finding) — `docs/E2E_TEST_REPORT.md` |
| No dead primary CTA | ⚠️ | Core CTAs work; no public marketing site with CTAs exists (P1) |
| No placeholder pricing | ❌ | No pricing page at all (P1, P4) |
| No unauthenticated data leak | ✅ | Invalid token → 401; presigned URLs ≤ 15 min; reports streamed after tenant check |
| No cross-tenant access | ✅ | 7 cross-tenant denial checks pass live on every `live-e2e` run; RLS coverage checked by the migration job (22/22 tenant tables) |
| No public indexation of private routes | ✅ | robots/sitemap/noindex fixed (RELEASE_READINESS_REPORT §3) |
| No critical failing test | ✅ | All suites green (RELEASE_READINESS_REPORT §2.1, E2E report) |
| Working backups | ✅ | `scripts/backup.sh` + verified restore drill (DEPLOYMENT_GUIDE §6.1); 🔑 cron + off-site copy must be configured on the VPS |
| Working password reset / 2FA | ❌ | Not implemented (P3) |
| Working e-mail verification | ❌ | Not implemented (P3) |
| Working billing lifecycle | ❌ | Stripe abstraction only, no UI (P4) |
| Working cancel / export / delete account | ❌ | Not implemented |
| Valid sitemap / robots / canonicals | ⚠️ | Sitemap/robots valid; no per-page canonical metadata |
| Real SEO pages | ❌ | Knowledge pages not available (P8) |
| Working analytics consent | ❌ | No analytics / consent banner |
| Production health check | ✅ | `/health/liveness`, `/health/readiness` (5 dependencies) |
| Admin incident visibility | ⚠️ | Admin console shows tenants, users, engines, queue counts; no alerting (O4) |

## C §74 QA Definition of Done

| Item | Status | Where |
|---|---|---|
| CI green | ⚠️ | Workflows written and linted (actionlint) and every job's commands reproduced locally; first run on GitHub pending (S11) |
| Typecheck / lint / Vitest / pytest | ✅ | `ci.yml` jobs `validate`, `test-node`, `test-python` |
| Playwright | ⚠️ | Chromium journey `scripts/e2e-ui-smoke.cjs` in `live-e2e`; multi-browser real-stack suite runs when `playwright.live.config.ts` exists (C §50, other workstream) |
| Docker builds | ✅ | `docker.yml`; api + web images built locally, analysis image built except apt steps (sandbox) |
| Dependency checks | ⚠️ | pip-audit blocking and clean; pnpm audit report-only (S7) |
| Secret scan | ✅ | gitleaks full history |
| Vulnerability scan | ✅ | Trivy fs/config/image blocking; 0 fixable HIGH/CRITICAL after hardening (postcss risk-accepted until 2026-12-31) |
| SBOM | ✅ | CycloneDX per image (docker.yml, release.yml) + repository SBOM (security.yml) |
| Restore drill | ✅ | Executed 2026-09-26 and on every `live-e2e` run |
| Live production smoke | 🔑 | After the next deploy: `API_BASE_URL=https://api.erppreflight.com bash scripts/e2e-live-smoke.sh` |

## Owner actions before launch

1. 🔑 Revoke the leaked Coolify token; change/disable the historical accounts (`docs/runbooks/SECRET_ROTATION.md` §1).
2. 🔑 Set production variables in Coolify (DEPLOYMENT_GUIDE §2.4); confirm compose path `/docker-compose.coolify.yml`.
3. 🔑 VPS ≥ 16 GB RAM (or reduce limits); configure backup cron + off-site copy; run one restore drill on the VPS.
4. 🔑 Enable branch protection on `main` (required checks: CI, Security, Docker; 1 review) and add CODEOWNERS (S10).
5. 🔑 Push a pre-release tag (`v0.1.0-rc.1`) to exercise `release.yml`; verify the cosign signature.
6. 🔑 External uptime monitor on `/health/readiness` and certificate expiry.
