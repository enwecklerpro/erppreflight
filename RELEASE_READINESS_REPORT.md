# ERP Preflight — Release Readiness Report

> **Commit:** `0aaa83d` · **Branch:** `claude/sharp-mendel-xg6cus` (wave 5 merged; `main` carries the same content via PR #2;
> audited baseline `main` @ `7a76aea`, 161 commits earlier)
> **Date:** 2026-09-26 · Required by Part 00 §0.9 and C §75. **Deployment checked: none — production is not deployed with this code.**
> Details: `docs/CURRENT_PRODUCT_STATUS.md` (canonical status), `docs/E2E_TEST_REPORT.md` (commands, counts),
> `docs/KNOWN_LIMITATIONS.md`, `docs/LIVE_PRODUCTION_VERIFICATION.md`, `docs/runbooks/UPGRADE_FROM_V0.md`.

## Zusammenfassung (Deutsch)

**Stand:** Der Code auf Commit `0aaa83d` enthält alle Arbeitspakete der fünften Welle (Session-Sicherheit mit
Cookie-only-Anmeldung, CSRF-Schutz und Magic Link; Analyse-Lebenszyklus mit Detailseite, Abbrechen und erneutem Lauf;
Mandanten-Administration mit Sperre, Trial-Verlängerung, sicherer Impersonation und IP-Allowlist; Plattform-Governance
mit Regel-, KI-, Wissens- und Quellen-Admin; vollständige EN/DE-Lokalisierung; Engine-Ergänzungen; Plattform-Härtung
mit Redis-Rate-Limits und exakt einmaliger Upload-Abrechnung; Betriebsqualität mit Playwright/axe, Alerting-Regeln,
gepinnten Images und Migrationsjob mit Backup). Auf einem lokalen Stack im Produktionsmodus ist alles grün:
API 1218, Web 310, Local Agent 10, Python 1665 (1 übersprungen) Tests — **0 fehlgeschlagen**; Typecheck, Lint, Build,
Boot-Test, alle `check:*`-Prüfungen und der Migrations-Check (26 Migrationen, 67 Mandantentabellen mit FORCE RLS) sind
bestanden; 12 bestehende und 6 neue Live-Suiten bestanden (Session-Security 16, Analyse-Lebenszyklus 16,
Mandanten-Admin 37, Governance 44, Engines 16, Plattform-Härtung 12); Playwright 13/13 und Live-Konfiguration 9/9
(nur Chromium). Der Upgrade-Probelauf von `main@7a76aea` mit Bestandsdaten bestand 76/76.

**Nicht geprüft / nicht erledigt:**
- **Produktion ist nicht deployt.** Coolify hat beim Merge nicht automatisch deployt; die Coolify-API ist aus der
  Build-Umgebung nicht erreichbar.
- GitHub-Actions-Jobs scheitern nach ca. 3 Sekunden auf Kontoebene — kein Workflow ist je auf GitHub gelaufen.
- Stripe, E-Mail-Provider, KI-Anbieter, SAP Cloud ALM, Jira, Azure DevOps, ServiceNow und OIDC-IdP nur gegen
  Test-Doubles. Kein Lasttest, kein Penetrationstest, Firefox/WebKit nicht getestet, Alert-Routing nicht eingerichtet.

**Urteil:** Bereit zum Deployment mit anschließender Verifikation — **noch nicht als „live verifiziert“ freigegeben.**

**Ihre Aufgaben (Reihenfolge):**
1. **Alle im Klartext geteilten Geheimnisse rotieren:** Coolify-API-Token, Hostinger-API-Token und Hostinger-Mail-Tokens,
   Postfach- und Admin-Passwörter, das Produktions-`JWT_SECRET` (meldet alle Sitzungen ab) und den
   Produktions-`MASTER_ENCRYPTION_KEY` (derzeit ein öffentlich dokumentierter Beispielwert): neuen Schlüssel als
   `MASTER_ENCRYPTION_KEY`, den alten als `MASTER_ENCRYPTION_KEY_PREVIOUS` setzen. Außerdem den geleakten alten
   Coolify-Token und die Passwörter von `contact@` / `demo.client@erppreflight.com` aus der Git-Historie.
2. **Deployen:** In Coolify **Redeploy** klicken — oder die Coolify-Instanz-Domain auf `https://coolify.erppreflight.com`
   setzen (DNS-Eintrag existiert bereits), damit die API erreichbar wird. Vorher `docs/runbooks/UPGRADE_FROM_V0.md` lesen
   (neue Pflichtvariablen `MAIL_TRANSPORT`/`MAIL_FROM`, Backup vor Migration, Rollback-Ziel).
3. Produktionsvariablen prüfen, insbesondere `TRUST_PROXY` = tatsächliche Anzahl Proxy-Hops; die API darf nur über
   Traefik erreichbar sein.
4. GitHub-Actions-Sperre auf Kontoebene klären (Abrechnung/Limits des Kontos), danach Branch-Protection gemäß
   `.github/BRANCH_PROTECTION.md` aktivieren.
5. Nach dem Deployment: Knowledge-Sync ausführen, Prüfschritte aus `docs/LIVE_PRODUCTION_VERIFICATION.md`; Anzahl der
   von v0 quarantänierten Uploads prüfen (Runbook §0).
6. Alert-Routing (Alertmanager/E-Mail) einrichten, Off-site-Backup konfigurieren, Rechtstexte anwaltlich prüfen lassen.

## 1. Owner actions (before and after the next deploy)

1. **Rotate every secret that was shared in plain text** (no values are recorded here): Coolify API token, Hostinger API
   token and Hostinger mail API tokens, mailbox and admin passwords, production `JWT_SECRET`, production
   `MASTER_ENCRYPTION_KEY` (a publicly documented example value; rotate via `MASTER_ENCRYPTION_KEY_PREVIOUS`, see
   `apps/api/src/modules/connectors/credential-vault.ts`). Also the old leaked Coolify token and the passwords of
   `contact@erppreflight.com` / `demo.client@erppreflight.com` (public in git history).
2. **Deploy:** Coolify did not auto-deploy the merge of `main`, and its API is unreachable from the build environment.
   Click **Redeploy** in Coolify, or set the Coolify instance domain `https://coolify.erppreflight.com` (DNS record
   already created). Follow `docs/runbooks/UPGRADE_FROM_V0.md` (env diff, pre-upgrade backup, `db-backup` → `migrate`
   jobs, rollback target = last working deployment, because plain `7a76aea` does not boot).
3. **Proxy topology:** `TRUST_PROXY` must equal the real proxy hop count and the API port must be reachable only through
   Traefik, otherwise `X-Forwarded-For` spoofing bypasses rate limits and IP allowlists (`DEPLOYMENT_GUIDE.md`).
4. **GitHub Actions** fail in ~3 s at account level; resolve on the GitHub account, then apply `.github/BRANCH_PROTECTION.md`.
5. **After deploy:** Cloudification sync once, then `docs/LIVE_PRODUCTION_VERIFICATION.md`.
6. Configure alert routing (Alertmanager receiver), off-site backup copy, VPS memory ≥ 16 GB; lawyer review of legal texts.

## 2. What works end to end (verified on the local production-mode stack, `0aaa83d`)

| Flow | Evidence |
|---|---|
| Sign up → e-mail verification → login → 2FA → reset → sessions/logout-all | `e2e-live-smoke.sh`, `e2e-account-ui-smoke.cjs` |
| Cookie-only browser sessions (no JWT in web storage), CSRF 403/2xx, magic link end to end | `e2e-session-security-smoke.cjs` 16/16 |
| Organisations: invitations, members/roles, org switch, ownership transfer, GDPR export/deletion | live + account UI smoke |
| Project → upload (magic bytes, real ClamAV, archive limits, redaction, 100 MB → 413) → async analysis → findings with evidence | live, UI, analyze, findings smoke; Playwright live pipeline |
| Analysis run lifecycle: detail page, cancel queued/running, rerun with identical inputs, Test Lab runs as analyses | `e2e-analysis-lifecycle-smoke.cjs` 16/16 |
| Tenant administration: suspension, trial extension, impersonation (read-only, audited), IP allowlist, support e-mails | `e2e-tenant-admin-smoke.cjs` 37/37 |
| Platform governance: rule self-test + publish gate, AI kill switch + cost ceiling, knowledge workflow, stale source alerts | `e2e-admin-governance-smoke.cjs` 44/44 |
| Gap Radar contract, API Change Guard baselines, MFS log streaming | `e2e-engines-smoke.cjs` 16/16 |
| Shared Redis rate limit across two API processes, exactly-once upload metering, assignment notification (DE e-mail) | `e2e-platform-hardening-smoke.cjs` 12/12 |
| Reports, plans/trial/402, audit hash chain, super admin, flags, support | commercial smoke + UI |
| Public site EN/DE, tools, SEO pages; app EN/DE incl. integrations, findings, lab, launcher | public, tools, i18n smoke |
| Accessibility: axe-core WCAG 2.2 AA on public home EN/DE, login, projects, workspace, findings, finding detail, analyze, settings | `tests/e2e/accessibility.live.spec.ts` (Chromium) |
| Tenant isolation: cross-tenant denials; 67 tenant tables ENABLE+FORCE RLS; runtime role NOBYPASSRLS | live smoke, migration check |
| Enterprise: connectors, work items, local agent, OIDC SSO + SCIM, partner mode, webhooks | `e2e-enterprise-live.cjs`, `e2e-integrations-ui.cjs` (contract doubles) |
| Upgrade from `main@7a76aea` with data | drill 76/76; migration check step 6 |
| Backup → drop → restore → verify drill | `scripts/ci-live-e2e.sh` |

## 3. What was not verified

- **Production:** not deployed; no production smoke, no TLS/header check on erppreflight.com.
- **CI on GitHub:** jobs fail at account level after ~3 s; no workflow has run on GitHub.
- **Images:** full image builds not re-verified in the sandbox (mirrors blocked); images are digest-pinned.
- **External services:** Stripe, mail provider, OpenAI/Anthropic, Cloud ALM, Jira, Azure DevOps, ServiceNow, OIDC IdP — doubles only.
- **Quality audits:** no load test, no Lighthouse, no penetration test; Playwright on Chromium only (Firefox/WebKit not run).

## 4. Spec compliance — Part 00 §0.9 "Definition of finished"

| Requirement | Status | Evidence / gap |
|---|---|---|
| Public website works | Done (local) | `apps/web/src/app/[locale]/**`; public smoke EN/DE |
| Auth works | Done (local) | account flows, cookie-only sessions, CSRF, magic link; no SAML |
| Organizations/tenants work | Done (local) | live denials, RLS 67/67, suspension, IP allowlist |
| Project creation works | Done (local) | UI + API smoke |
| File upload works | Done (local) | real ClamAV, redaction at rest, exactly-once metering |
| Core analyses run asynchronously | Done (local) | BullMQ → Python, SSE progress, cancel/rerun |
| Findings persist / evidence visible | Done (local) | findings smoke, analysis detail page |
| Reports export | Done (local) | 6 types × 6 formats (English by design) |
| Admin console works | Done (local) | `/admin` + `/admin/{rules,ai,knowledge,sources}`, tenant access actions |
| Billing plan abstractions work | Done (local) | entitlements, 402, trial; real Stripe not exercised |
| Localization EN + DE | Done (local), gaps | app, API errors, rule catalog, server content in DE; notification e-mails English except assignment; exports English by design |
| SEO pages SSR/static | Done (local) | knowledge, docs, tools, SAP object pages with quality gate |
| All engines have real parsers, rules, fixtures | Done, gap | 19 engines, 138 finding rules (233 codes incl. input validation); 49 codes without golden self-test case (publish gate blocks them) |
| Tests cover critical paths | Done | §2 and `docs/E2E_TEST_REPORT.md` |
| Local Docker environment from documented commands | Partial | infra from compose verified; full image builds not in sandbox |
| Production deployment documentation | Done | `DEPLOYMENT_GUIDE.md`, handover §4, upgrade runbook, `docs/LIVE_PRODUCTION_VERIFICATION.md` |
| Monitoring / health endpoints | Done (local) | liveness, readiness, token-protected metrics, 14 alert rules + dashboard; alert routing not configured |
| Security checks in CI | Partial | gitleaks/Trivy/pip-audit/SBOM/`pnpm audit --prod` configured; CI blocked at account level |
| No broken links / empty primary screens | Done (local) | smoke suites incl. DE pages at 375/1440 px; no full link crawl |

## 5. Spec compliance — C §68–§74 Definitions of Done

| DoD | Done | Partial | Missing | Main gaps |
|---|---|---|---|---|
| §68 Security (14 items) | 14 | 0 | 0 | token no longer in `localStorage` (session-security); secret rotation is an owner action |
| §69 Frontend (18 screens) | 18 | 0 | 0 | analysis detail route and localized integrations UI added in wave 5 |
| §70 Backend (25 API areas) | 25 | 0 | 0 | rule admin API added (`/admin/rules`) |
| §71 Product intelligence (12) | 9 | 3 | 0 | ROSA file import only; abaplint/oasdiff not bundled (own oasdiff-level categories); golden coverage gaps |
| §72 Enterprise (10) | 7 | 3 | 0 | policy engine deferred (ADR-101); Cloud ALM unvalidated; no partner packs (`docs/ENTERPRISE_READINESS.md`) |
| §73 Growth (10) | 9 | 1 | 0 | API reference off in production unless enabled (`docs/SEO_READINESS_REPORT.md`) |
| §74 QA (13) | 9 | 3 | 1 | CI never run on GitHub; docker builds partial; Firefox/WebKit not run; **live production smoke missing** |

Spec 13.12 hand-over documents: all present (`ROADMAP_AFTER_V1.md` added in wave 5); `FINAL_IMPLEMENTATION_REPORT.md`
is covered by `docs/FINAL_REMEDIATION_REPORT.md`.

## 6. Verdict

The product loop and the SaaS, governance, growth and enterprise surfaces work end to end on a local production-mode
stack with 0 failing tests, and the upgrade from the running v0 with its data was rehearsed. The release is **not
deployed and not verified in production**: that requires the owner actions in §1 (secret rotation first) and the
procedure in `docs/LIVE_PRODUCTION_VERIFICATION.md`. Remaining limitations: `docs/KNOWN_LIMITATIONS.md`.
