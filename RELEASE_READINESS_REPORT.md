# ERP Preflight — Release Readiness Report

> **Date:** 2026-09-25 · **Branch:** `claude/sharp-mendel-xg6cus` (based on `main` @ `7a76aea`)
> **Scope:** Audit of the implementation against the original build specification
> (`ERP_Preflight_Astra_Ultra_Prompt_Package_v5.zip`, parts 00–20; parts 14–20 are also in the repo root),
> repair of every defect that blocked the core product flow or tenant security, and live end-to-end verification.
> Part 00 §0.9 requires this report: *what was tested, what passed, what requires external credentials, what remains limited.*

---

## 1. Verdict

| Area | Before this pass (`main` @ 7a76aea) | Now |
|---|---|---|
| API boots | **No** — crashed on startup (`EntitlementGuard` dependency missing) | Yes; the boot smoke test in CI guards it |
| Upload → analysis → findings | **Broken** — uploaded files were never analysed. ClamAV flagged every file as infected. Redaction corrupted XML, and the clean copy was overwritten by the raw file | **Works, verified live** |
| Engine verdicts on empty input | Invented "VERIFIED" verdicts, e.g. *"User BATCH_ADMIN safe to decommission"* | `*_INSUFFICIENT_INPUT` at `UNKNOWN`, status FAILED |
| Tenant isolation | **Broken** — any user could read other tenants via `X-Tenant-Id`. The app ran as a Postgres superuser, so RLS never applied | Membership-verified tenant and a NOBYPASSRLS runtime role, verified live |
| Secrets in public repo | Coolify API token (4 scripts) and super-admin password (login page) were committed | Removed from code. **Rotation still required — see §5** |
| Browser → API in production | **Broken** — `NEXT_PUBLIC_API_URL` was missing at image build time | Passed as a build arg |
| Report downloads in production | Presigned URLs pointed at the Docker-internal MinIO host | Streamed through `GET /api/v1/reports/:id/file` |

**The core product loop now works end to end.** The loop is sign up → create project → upload → scan and redact → asynchronous deterministic analysis → findings with evidence → report export, and it is verified in a real browser.

**The product is not launch-complete against the specification.** See §4. The largest gaps are: no public marketing, pricing or legal site; no EN/DE localisation; no password reset, 2FA or e-mail verification; no billing UI; and the audit trail is not wired to business events.

---

## 2. What was tested and how

### 2.1 Automated suites (all green on the final commit)

| Command | Result |
|---|---|
| `pnpm run typecheck` | 13/13 packages, 0 errors |
| `pnpm run lint` | pass |
| `pnpm run test` | API **678**, Web **155**, local-agent **5**: all passed |
| `pnpm run test:python` | **548** passed (was 501) |
| `python -m pytest tests/e2e tests/empirical_redaction_stress.py` | **267** passed (the suite could not run before because of hardcoded `H:/` paths) |
| `pnpm run check:deps` / `check:no-production-facades` / `check:production-truth` | pass |
| `pnpm run build` | pass (API, web with 27 routes, packages) |
| `pnpm --filter @erppreflight/api run test:boot` | AppModule DI graph resolves. The check fails on the pre-fix code, so it would have caught the startup crash |
| gitleaks (full git history, `.gitleaks.toml`) | no leaks (allowlist covers synthetic test secrets only) |

### 2.2 Live end-to-end (real services, no mocks)

**Stack.** Postgres 16 with pgvector, Redis 7.2, MinIO and ClamAV ran as containers from `docker-compose.coolify.yml`. The API ran with `NODE_ENV=production`, the RLS runtime role and ClamAV fail-closed. The Python analysis service and the Next.js production build also ran.

**`pnpm smoke:live` (`scripts/e2e-live-smoke.sh`): 21/21 PASS.**
- Register two tenants; login; a wrong password returns 401.
- Create a project.
- Upload the golden fixture, which ClamAV scans (real clamd) and marks CLEAN.
- Run the analysis (BullMQ queue, then the Python OPD Guard) to COMPLETED. It produces exactly **1** finding: `OPD_DETERMINATION_STEP_MISSING` at table *Channel*, line 23, with a SHA-256-bound evidence snippet. That is the defect the fixture contains; before the fixes the same file produced 25 junk findings.
- Export PDF, JSON_BUNDLE, XLSX, CSV and HTML_OFFLINE. Each downloads as a real file of the right type. An unknown format returns 400.
- Tenant B is denied project read (404), a spoofed `X-Tenant-Id` (403), findings (403), the lab (403), analysis of A's file (404) and A's report download (404). An invalid token returns 401.
- A secret uploaded in XML is masked at rest (`[REDACTED:SECRET:<hmac>]`) while the XML structure stays intact.

**`pnpm smoke:ui` (`scripts/e2e-ui-smoke.cjs`, Chromium): 7/7 PASS.** The steps are: sign up, create project, open workspace, upload via the dropzone, select the CLEAN file and launch the run, see the findings count, then open the finding. The finding shows remediation, the evidence snippet, the SHA-256 and the provenance chain.

### 2.3 What was **not** verified here
- **Building the production Docker images.** The sandbox blocks Debian/Alpine package mirrors. A separate agent reproduced every Dockerfile step manually on a clean `git archive`, and compose validates with `docker compose config`, but a real `docker build` must happen on the VPS or CI.
- **Deployment to the Hostinger VPS / Coolify.** Nothing was deployed.
- **Stripe, OpenAI and Anthropic calls.** These need credentials.
- **Load tests, restore drill, Lighthouse/axe audits** (spec part 13.9).

---

## 3. Defects fixed in this pass (by commit)

| Commit | Fix |
|---|---|
| `dbd9e7c`, `b08f142` | Handover doc corrected. Coolify token removed from `scripts/*.py`, which now read it from env. The duplicate compose file that published DB, Redis and MinIO ports on the host was removed. Python test paths fixed (fixture path bug and hardcoded `H:/erppreflight`). `test:python` made cross-platform. `.env.coolify.example` completed. |
| `ea0df87` | API startup crash fixed (BillingModule import). Readiness now reports the real ClamAV and engine status. |
| `bd74672` | CI: API boot smoke test and gitleaks allowlist. |
| `e74478a` | **Pipeline.** `POST /analyses` takes `fileIds` resolved server-side per tenant and project, and client S3 keys are rejected (this closed a cross-tenant file read). Python FAILED/PARTIAL is no longer recorded as success. S3 errors fail the run. Binary artifacts are sent as base64. ClamAV NUL-terminated replies are parsed (every file used to be flagged infected). The raw file no longer overwrites the redacted clean copy. WSDL, XSD and EDMX are now redacted. Presigned URLs last at most 900 s. Keys follow `tenants/{org}/projects/{project}/`. Projects and evidence are returned in camelCase. The diagnostic bundle no longer queries a table that does not exist. Scheduled preflights are processed. |
| `1932f4d` | **Web.** The hardcoded super-admin credentials were removed from the login page. `NEXT_PUBLIC_API_URL` is a build arg. The analysis launcher selects files and polls status. Server-side pagination was added, and errors are surfaced instead of shown as empty states. Wrong endpoints fixed: agent gate, demo, status, knowledge. Downloads are authenticated. Logout clears token and cache. The simulation page no longer writes demo data on load. Sitemap/robots/noindex fixed. Fabricated metrics and claims removed. |
| `ba81563` | **Engines.** Invented default identities (BATCH_ADMIN, QAS, MATMAS) removed, and requests without input are rejected. Fake "line 1" evidence removed, and findings without valid path, line and SHA-256 are demoted to UNKNOWN. Evidence snippets are redacted. A zip-bomb/zip-slip-safe reader was added. Finding ids are deterministic, so reruns are byte-identical. Parse errors produce `*_PARSE_ERROR` findings. `max_findings` and the payload cap are enforced. |
| `a242eb9` | **Security.** Migration 010 adds the RLS runtime role. The tenant header is honoured only after JWT and membership checks. Missing guards were added on 8 controllers. Feedback is scoped per org. Production requires real secrets, and the embedded DB password was removed. Bootstrap creates one admin and never resets accounts. API key scopes are enforced. Role checks were added on destructive and approval routes. SSRF protection now resolves DNS and re-checks at connect time. Login checks account status and is rate-limited; legacy SHA-256 hashes and trimmed-password matching are gone. `/metrics` and Swagger are locked in production. CORS is https-only. The Stripe raw-body signature is verified. **Audit trail inserts were failing on every call** (wrong column names), which is fixed. ClamAV compose: 3 GB memory, signature volume, real healthcheck. |
| `5596c5b` | The secret redactor was **masking XML closing tags and e-mail addresses** as secrets and corrupting every uploaded SAP XML. OPD Guard marked a correct analysis of a broken configuration as PARTIAL. Reports now stream through the API. Export format is validated. `scripts/e2e-live-smoke.sh` added. |
| `8961fb7` | The Clean Core Index showed "100% Target Met" for projects that were never analysed; it is now "—". A `[object Object]` rendering bug and table clipping were fixed. `scripts/e2e-ui-smoke.cjs` added. |

---

## 4. Specification compliance — Part 00 §0.9 "Definition of finished"

| Requirement | Status | Evidence / gap |
|---|---|---|
| Public website works | ❌ **Missing** | `/` is the authenticated dashboard. There is no marketing, pricing, security or legal site and no SAP independence disclaimer page (§0.8, part 02, 13.11). |
| Auth works | ⚠️ Partial | Register, login, logout, rate limiting and account status checks work. **No password reset, 2FA or e-mail verification** (13.11). |
| Organizations / tenants work | ✅ / ⚠️ | Isolation verified live. No organisation-switcher UI. |
| Project creation works | ✅ | Verified live (API and UI). |
| File upload works | ✅ | Magic bytes, ClamAV, redaction and tenant-scoped storage verified live. |
| Core analyses run asynchronously | ✅ | BullMQ → Python, verified live. |
| Findings persist / evidence visible | ✅ | Verified live, including the evidence UI. |
| Reports export | ✅ / ⚠️ | 5 formats verified through the API. The workspace UI offers offline HTML and the reproducibility bundle; there is no UI button yet for PDF, XLSX or CSV. `ZIP_ALL` is not implemented (returns 400). |
| Admin console works | ⚠️ Not verified live | The page exists. |
| Billing plan abstractions work | ⚠️ Partial | Entitlements and guards exist. The Stripe flow needs keys, and **there is no billing UI**. |
| Localization EN + DE | ❌ **Missing** | No i18n framework and no `/de` routes. |
| SEO pages SSR/static | ❌ Mostly missing | Sitemap and robots are now correct. There are no knowledge articles (the API has no article endpoint) and no per-page metadata. |
| All engines have real parsers, rule logic and fixtures | ⚠️ | All 19 are registered with fixtures. After this pass, 5 engines reject garbage input. **Other engines still turn garbage into COMPLETED with 0 findings** (EXTENSION_IMPACT, SPRO/ECC, FORM, TR, WF, IAM, ACCT). Clean Core Guard is regex-based, while spec 07 §7.5 asks for AST analysis. |
| Tests cover critical paths | ✅ | See §2, plus the live smoke scripts. |
| Local Docker environment from documented commands | ⚠️ | Infrastructure services run from compose. App image builds could not be tested here (§2.3). |
| Production deployment documentation | ✅ | `AI_AGENT_HANDOVER_AND_ARCHITECTURE.md` §4. |
| Monitoring / health endpoints | ✅ | `/health/liveness`, `/health/readiness` (all 5 dependencies) and token-protected `/metrics`. |
| Security checks in CI | ⚠️ | Gitleaks now passes. Trivy runs with `exit-code: 0` (never blocks) on `@master`. There is no image scan and no SBOM. |
| No broken links or empty primary screens | ✅ mostly | Dead links removed. Knowledge articles show a "not available" page. |

### Other gaps observed
- **The audit trail is not wired to business events.** Only the audit module writes to `audit_events`; domain events go to the outbox. Spec 13.10 #14 requires an audit event for each engine run and action.
- The auth rate limiter is in-memory, per API instance.
- The Orval-generated client is unused; the web uses hand-written `customInstance` calls, against AGENTS.md §2.2.
- Several forms use React state plus Zod rather than TanStack Form (Axiom 1.7).
- `decommission_audit` falls back to `date.today()`, which makes it non-deterministic when no evaluation date is given.
- Nested archives are rejected rather than supported to depth 2.
- The agent-gate execution token is not bound to the proposal id, and its signature compare is not constant-time.
- CI has no Playwright live job and no migration check (spec 12).
- The existing `docs/PRODUCTION_READINESS_MATRIX.md` and `IMPLEMENTATION_STATUS.md` were written before this audit and overstate completeness. Treat this report as authoritative.

---

## 5. Actions only the owner can take (before or at the next deploy)

1. **Rotate the leaked Coolify API token** (prefix `13|wilw…`) in Coolify → Keys & Tokens. It is in the public git history and allows server command execution.
2. **Change the passwords of `contact@erppreflight.com` and `demo.client@erppreflight.com`**, or disable those accounts, in the production database. The old password is in the public git history. The new bootstrap logic never modifies existing accounts, so they keep that password until changed.
3. **Set the required production variables in Coolify** (`AI_AGENT_HANDOVER_AND_ARCHITECTURE.md` §4.4). The API now **refuses to start** without real `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`, `S3_ACCESS_KEY`/`S3_SECRET_KEY` and `POSTGRES_PASSWORD`.
4. **Check that Coolify's compose location is `/docker-compose.coolify.yml`**, not `/docker-compose.yaml`. The legacy file uses `POSTGRES_HOST_AUTH_METHOD: trust` and has no ClamAV.
5. **Check the VPS memory.** The summed container limits are about 13 GB (ClamAV alone is now 3 GB); 8 GB plans risk OOM.
6. After deploy, run `API_BASE_URL=https://api.erppreflight.com pnpm smoke:live` from any machine. It creates two throwaway tenants.
