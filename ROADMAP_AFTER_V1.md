# ERP Preflight — Roadmap after v1

> Spec 13.12 #10. Derived from `docs/KNOWN_LIMITATIONS.md` (IDs in brackets), `SECURITY_REVIEW.md` §5
> and ADR-101. Written 2026-09-26 on branch `claude/sharp-mendel-xg6cus` (wave 5).
> Scope: what is **still open after the wave-5 workstreams are merged**. Items those workstreams
> close — cookie-only sessions / CSRF / magic link (S2), analysis cancel / rerun / detail URL (P6, P8),
> tenant suspension / impersonation / IP allowlists, Rule / AI / knowledge / source admin (P4, P5),
> Gap Radar input rejection, MFS streaming, API baselines (E2–E4), app localisation (P1), Redis-backed
> rate limiters and metering (S3, P3), and the operations items of this workstream (alerts, image pins,
> migration job, CODEOWNERS, audit fixes, Playwright/axe suite) — are deliberately not listed.

Priorities: **P0** blocks a responsible production launch or is an owner action that only takes
minutes; **P1** needed for the first enterprise customers / an SLA; **P2** product growth.
Effort: S ≤ 3 days, M ≤ 2 weeks, L > 2 weeks.

## P0 — before or at go-live (mostly owner actions)

| # | Item | Why | Effort / owner |
|---|---|---|---|
| 1 | **Rotate the leaked credentials** in git history: Coolify API token, demo and super-admin passwords (S1) | Public history; anyone can use them until revoked | S · owner (`docs/runbooks/SECRET_ROTATION.md` §1) |
| 2 | **Unblock GitHub Actions** — every run fails within ~3 s without logs (account billing / spending limit / Actions disabled). Then apply the `main` ruleset (`.github/BRANCH_PROTECTION.md`) (V2, O8, S10) | None of the CI/security/docker gates protects `main` until Actions runs | S · owner |
| 3 | **Deploy v1 to production and run the post-deploy smoke** (V1). Production (Coolify on the Hostinger VPS) builds `main` but **does not auto-deploy on push**: decide whether to enable Coolify's automatic deployment/webhook or keep manual deploys with a release checklist | Every "verified" statement so far refers to local production-mode stacks | S · owner (`docs/runbooks/UPGRADE_FROM_V0.md`, `DEPLOYMENT_GUIDE.md` §2–§5) |
| 4 | **Off-site backup copy** configured and a restore drill on the VPS (O2) | Backups are local to the only host; a disk loss loses them too | S · owner (`DISASTER_RECOVERY.md` §1) |
| 5 | **Legal review** of imprint, privacy, terms, cookies, sub-processors, DPA (P9) | Templates filled from env; must be lawyer-approved for the EU market | S · owner/legal |
| 6 | **Start the observability profile** and route alerts (Alertmanager or Grafana alerting → e-mail/Slack/on-call) | Rules and dashboard ship (`infra/observability`), routing is deployment-specific | S · ops |

## P1 — first enterprise customers

| # | Item | Rationale | Effort |
|---|---|---|---|
| 7 | **High availability and point-in-time recovery** (O1, O2): managed PostgreSQL with PITR (or WAL archiving with pgBackRest to object storage), external S3 with versioning/object lock, replicated Redis; split the BullMQ worker from the API and run ≥ 2 API replicas | Single VPS = full outage on host failure; RPO today is "time since last backup". Order and details: `DEPLOYMENT_GUIDE.md` §9 | L |
| 8 | **Load and soak testing** (V5): k6 scenarios for upload → scan → analysis → export at realistic artifact sizes, queue saturation, 24 h soak; publish capacity numbers and tune pool/queue concurrency | No measured capacity; alert thresholds (latency, queue backlog) are educated defaults | M |
| 9 | **External penetration test** (V5, S10) of web, API, file ingestion and tenant isolation, plus a Lighthouse/performance budget run | Required by enterprise security questionnaires; internal reviews are not independent | M · external |
| 10 | **Validate enterprise adapters against real tenants** (V4, E8): Stripe, SMTP/HTTP mail, OpenAI/Anthropic gateway, SAP Cloud ALM (API paths, test-case sync, process hierarchy), Jira, Azure DevOps, ServiceNow, OIDC IdPs | Only exercised against contract doubles; vendor docs and real APIs differ | M |
| 11 | **Deploy signed release images** instead of building on the VPS: a Coolify override with `image: ghcr.io/…@sha256:` from `release.yml`, `cosign verify` in the deploy step (DEPLOYMENT_GUIDE §3.5) | Build-on-host means what runs is not the scanned, signed artefact | S |
| 12 | **ClamAV footprint** (O6): move clamd to its own host/service or use a scanning service; lets the app run on an 8 GB plan | ~3 GB RAM and minutes of signature loading dominate the VPS sizing | M |
| 13 | **Dev-tooling advisories** (S7 residual): upgrade vitest 2 → ≥ 4.1.11 (brings vite/esbuild fixes) in api, web and local-agent, then make the full `pnpm audit` CI step blocking | Only dev-time exposure today, but it keeps the audit red | S–M |
| 14 | **Multi-browser live suite in CI**: first green `playwright.live.config.ts` run with Firefox and WebKit (only Chromium was run in the sandbox) and an axe audit of the remaining pages (admin, billing, integrations, reports) | Gate 6 coverage currently = 9 key pages in Chromium | S |
| 15 | **Repository cleanup** proposed in `docs/REPO_CLEANUP_PROPOSAL.md` (O8, C §65) and removal of the five unregistered legacy engine modules (E5) | Dead files confuse contributors and agents; deletions need owner approval | S |

## P2 — product growth

| # | Item | Rationale | Effort |
|---|---|---|---|
| 16 | **SAML 2.0 SSO** and optional social OAuth (P10) | Many SAP customers standardise on SAML IdPs (ADFS, SAP IAS); OIDC + SCIM exist | M |
| 17 | **ABAC / Cerbos** per ADR-101 — only when its triggers occur: customer-defined attribute policies per project/landscape, or more than three services sharing authorization decisions. Migration path in ADR-101 (roles as principal attributes, PDP sidecar, fail-closed); also wire the `packages/auth` permission map into the API guards | RBAC + RLS is sufficient today; a PDP adds an operational service | L |
| 18 | **Billing depth** (P2): internal credits and tax ledger, coupons beyond Stripe promotion codes, a global plan editor instead of plans-as-code, trial extension; enforce `teamMembers` and `aiTokensPerMonth`; wire the declared `cloudAlmSync`, `airGappedExport`, `whatIfSimulation` features to routes | Plans are sold on limits that are partly only reported | M |
| 19 | **Business analytics for super admins** (P4): conversion, churn, AI spend, infrastructure cost and gross margin (MRR/ARR are list-price estimates today); support-ticket e-mails | Needed to run the SaaS commercially | M |
| 20 | **Partner packs** (P11): partner-owned rule and knowledge packs, report branding per partner across customer tenants | SI channel is a primary go-to-market for SAP tooling | M |
| 21 | **Engine depth** (E1, E6, E7, E9): Clean Core MODIFY/DELETE classification from dictionary metadata instead of naming heuristics, object-name scan inside abapGit ZIPs, optional bundled abaplint; SAP object descriptions and transaction codes from a licensed source; live ROSA via a customer-hosted endpoint; version handshake so API and analysis service can be deployed independently | Raises finding precision and removes deployment coupling | L |
| 22 | **Test Lab model unification** (P6 remainder): one model for generated (W2) and regression (W1) tests; lab runs as analysis records | Two parallel models double maintenance | M |
| 23 | **Finding assignment notifications** (P7): template for `finding.assigned`; FormDoctor evidence with the real template name | Small UX gaps reported in the audit | S |

## How to use this file

- Move an item to `docs/KNOWN_LIMITATIONS.md` §7 ("Resolved") with the commit when it is done.
- Anything that changes the approved stack (Part 21, AGENTS.md §4.2) — Cerbos, a managed queue,
  a different mail provider — needs an ADR in `ARCHITECTURE_DECISIONS.md` first.
