# ERP Preflight — Security Review

> **Status date:** 2026-09-26 · Spec 0.2, 10.18, 12.15, 13.12, 20.1–20.13.
> This document describes the security posture **of the code in this repository as it is**, with
> file references. It is not a penetration-test report — no external pentest has been performed
> (spec 20.11: do not claim one). Change history of the hardening work: `docs/SECURITY_HARDENING_REPORT.md`.

## 1. System and trust boundaries

```
Internet ──TLS (Traefik / Let's Encrypt)──► web  (Next.js, :3000)   ─┐
Internet ──TLS (Traefik / Let's Encrypt)──► api  (NestJS, :3001)  ◄──┘ browser calls api directly
                                             │
          internal docker network "erppreflight-network" (no published ports)
             ├── postgres  (RLS; schema owner + NOBYPASSRLS runtime role)
             ├── redis     (BullMQ queues)
             ├── minio     (quarantine / clean / reports buckets)
             ├── clamav    (clamd INSTREAM, fail-closed)
             └── analysis-python (stateless engines; trusts only the API)
```

Trust boundaries: (1) browser ↔ API (JWT bearer); (2) API ↔ tenant data (membership check + RLS);
(3) customer artifact ↔ parsers (hostile input); (4) API ↔ outbound network (SSRF);
(5) operators ↔ VPS / Coolify (host-level access, secrets); (6) CI/CD ↔ supply chain.

## 2. Threat model summary (spec 20.10)

| Area | Main threats | Primary controls (§3) | Residual risk |
|---|---|---|---|
| Multitenancy | Tenant A reads/modifies tenant B data via id guessing or a spoofed `X-Tenant-Id` | C1, C2, C3 | Controls verified live on every CI run (`live-e2e`); no fuzzing of all ~200 routes |
| File upload | Malware, zip bombs/zip slip, XXE, parser DoS, secrets in customer files stored or shown | C6–C10 | S3 (no multipart size limit), E1/E2 in KNOWN_LIMITATIONS (engines on garbage input) |
| Authentication | Credential stuffing, weak hashes, token theft | C4, C5 | S2 (JWT in localStorage, no CSP), S4 (per-instance rate limit), no 2FA |
| Object storage | Cross-tenant download, long-lived links, public buckets | C11 | Buckets are private; MinIO has no per-tenant IAM (API is the only client) |
| Outbound connectors / landscapes | SSRF into the internal network or cloud metadata | C12 | — |
| Webhooks | Forged deliveries, secret disclosure | C13 | S6 (secrets plaintext at rest) |
| Agent gate / MCP | Replayed or re-targeted execution tokens | C14 | S5 |
| AI gateway | Private data sent to providers; AI verdicts presented as facts | C15 | Providers need credentials; not exercised live |
| Admin | Privilege escalation, impersonation | C16 | No admin action audit trail for business events (P6) |
| Knowledge ingestion | Corrupted/poisoned knowledge snapshots | RFC 8785 snapshot hashing (`apps/api/src/modules/knowledge`) | No signed knowledge bundles (spec 20.4) |
| Local agent | Tampered updates | SHA-256 signature check (`apps/local-agent/src/updater.ts`) | No Sigstore signing of agent packages yet |
| Supply chain / CI | Malicious dependency or action, vulnerable images | C17–C20 | S7 (dev-tool advisories), compose images unpinned (O5) |
| Infrastructure | Exposed DB/Redis, leaked deploy credentials, data loss | C21–C23 | S1 (rotation pending), single VPS (O1) |

## 3. Controls implemented (with file references)

| ID | Control | Implementation | Verified by |
|---|---|---|---|
| C1 | Tenant resolved **only after** JWT validation and an `organization_members` lookup; a spoofed `X-Tenant-Id` returns 403 | `apps/api/src/modules/tenancy/tenancy.guard.ts` | `tenancy.guard.spec.ts`; live smoke checks 13–19 |
| C2 | PostgreSQL RLS on every table with `organization_id`: `ENABLE` + `FORCE` + policy on `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` | `packages/database/migrations/*.sql` | `scripts/ci-migration-check.sh` fails if any tenant table lacks ENABLE+FORCE RLS or a policy (22/22 today) |
| C3 | Tenant transactions `SET LOCAL ROLE erppreflight_app` (NOSUPERUSER, NOBYPASSRLS, not table owner) so RLS applies even though the login user owns the schema | `packages/database/migrations/010_app_runtime_role.sql`, `apps/api/src/modules/database/database.service.ts` | migration check asserts the role attributes; live-e2e runs with `DB_RUNTIME_ROLE=erppreflight_app` |
| C4 | Argon2id password hashing; legacy SHA-256 and trimmed-password matching removed; account status checked at login | `apps/api/src/modules/auth/auth.service.ts` | `auth.service.spec.ts`; smoke "wrong password → 401" |
| C5 | Login/register rate limiting | `apps/api/src/modules/auth/guards/auth-rate-limit.guard.ts` | unit tests |
| C6 | Magic-byte file-type validation (extensions not trusted) | `apps/api/src/modules/ingestion/mime-magic.validator.ts` | unit tests |
| C7 | ClamAV INSTREAM scan, **fail-closed** in production (`CLAMAV_MOCK_MODE` must be false) | `apps/api/src/modules/ingestion/clamav.scanner.ts`, `apps/api/src/config/env.validation.ts` | live smoke "file scanned by ClamAV and CLEAN" against real clamd |
| C8 | Archive safety: 100:1 ratio, 500 MB total, 10 000 entries, nesting limit, zip-slip rejection | `apps/api/src/modules/ingestion/archive-safety.guard.ts`; Python `src/parsers` safe ZIP reader | unit + adversarial tests |
| C9 | XML parsed with defusedxml (no DTD/external entities) | `services/analysis-python/src/parsers/safe_xml.py` | `tests/unit/test_safe_xml.py` |
| C10 | Secret redaction (regex + Shannon entropy) before storage; masks are HMAC-keyed with `MASTER_ENCRYPTION_KEY`; XML structure preserved; evidence snippets redacted | `apps/api/src/modules/redaction/secret-redactor.service.ts`, `services/analysis-python/src/platform/redaction.py` | live smoke "secret redacted at rest"; `tests/empirical_redaction_stress.py` |
| C11 | Storage keys `tenants/{org}/projects/{project}/…`; presigned URLs ≤ 900 s; report downloads streamed through the API after tenant check; clients cannot pass S3 keys to `POST /analyses` | `apps/api/src/modules/storage`, `apps/api/src/modules/ingestion`, `apps/api/src/modules/analyses` | live smoke "tenant B download A report → 404" |
| C12 | SSRF protection: every resolved address must be public; re-checked in the socket `lookup` hook (DNS rebinding) | `apps/api/src/common/security/outbound-request.ts` | unit tests |
| C13 | Webhook deliveries signed with HMAC-SHA256 | `apps/api/src/modules/webhooks/webhooks.service.ts` | unit tests |
| C14 | Agent-gate execution tokens HMAC-signed, 15-minute lifetime, role checks on approval routes | `apps/api/src/modules/agent-gate/agent-gate.service.ts` | unit tests |
| C15 | AI confidence ceiling (INFERRED ≤ 0.60) and demotion to UNKNOWN without verifiable evidence | `services/analysis-python/src/platform/confidence.py`, `src/core/runner.py` | python tests |
| C16 | Admin API restricted to `SUPER_ADMIN` (`SuperAdminGuard`); one-time bootstrap admin that never resets existing accounts | `apps/api/src/modules/admin`, `apps/api/src/modules/auth` | unit tests |
| C17 | Production refuses to start with missing or well-known secrets; Swagger off and `/metrics` token-protected in production; CORS allow-list | `apps/api/src/config/env.validation.ts`, `apps/api/src/main.ts`, `apps/api/src/modules/telemetry/metrics-access.guard.ts` | `test:boot`; live-e2e runs in `NODE_ENV=production` |
| C18 | Secret scanning of the full history (gitleaks, allow-list limited to synthetic test secrets) | `.github/workflows/security.yml`, `.gitleaks.toml` | CI |
| C19 | Blocking vulnerability gates: Trivy fs on lockfiles, Trivy config on Dockerfiles, Trivy image scan of all three images (fixable HIGH/CRITICAL), pip-audit | `.github/workflows/security.yml`, `.github/workflows/docker.yml` | reproduced locally 2026-09-26: 0 findings after the image hardening below |
| C20 | Supply chain: third-party actions pinned to commit SHAs, base images pinned by digest, Renovate for updates, CycloneDX SBOM per image and per repository, release images pushed with SLSA provenance, GitHub attestation and cosign keyless signatures | `.github/workflows/*.yml`, `renovate.json`, `infra/docker/Dockerfile.*` | actionlint clean; SBOMs generated locally |
| C21 | Container hardening: non-root users (UID 1001), no npm/yarn/corepack in node runtime images, no pip in the python runtime image, healthchecks, memory/CPU limits in compose | `infra/docker/Dockerfile.*`, `docker-compose.coolify.yml` | images built and inspected locally (`id`, `command -v npm/pip`) |
| C22 | No published DB/Redis/MinIO/ClamAV ports in production compose; `POSTGRES_PASSWORD`, `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`, S3 keys required (`${VAR:?}`) | `docker-compose.coolify.yml`, `scripts/check-no-production-facades.mjs` | CI facade gate |
| C23 | Backups with integrity data and a verified restore (checksum, per-table row counts, RLS policies, object counts, application-level login + byte-identical file) | `scripts/backup.sh`, `scripts/restore.sh`, drill in `scripts/ci-live-e2e.sh` | drill passed locally 2026-09-26 (`docs/E2E_TEST_REPORT.md`) |

## 4. Secret inventory and rotation

| Secret | Used for | Rotation consequence | Runbook |
|---|---|---|---|
| `JWT_SECRET` | Signing user JWTs **and** agent-gate execution tokens | All sessions end (users log in again); outstanding agent-gate execution tokens become invalid | `docs/runbooks/SECRET_ROTATION.md` §2 |
| `MASTER_ENCRYPTION_KEY` | HMAC key of redaction masks (`[REDACTED:SECRET:<hmac>]`) — not used for encryption at rest | New uploads get different mask tokens for the same secret, so masks can no longer be correlated across the rotation boundary; stored data stays readable | §3 |
| `POSTGRES_PASSWORD` | Schema-owner login (migrations + runtime pool) | API/backup jobs must get the new value at the same time | §4 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO root credentials used by the API and backups | Presigned URLs issued before the change stop working | §5 |
| `METRICS_TOKEN` | Prometheus scrape | Update the scraper | §6 |
| `STRIPE_*` | Billing | Rotate in Stripe dashboard, update env | §6 |
| Coolify API token (`COOLIFY_API_TOKEN`) | Deploy helper scripts (`scripts/*coolify*.py`, `server-exec.py`) | Grants command execution on the server — treat as root credential | §1 |

**History note.** Before commit `b08f142` a Coolify API token was committed in four helper scripts,
and before `a242eb9`/`1932f4d` the password of the super-admin and demo accounts appeared in the
login page source. The values remain in the **public git history**. They have been removed from
the code; revocation of the token and change of the passwords are **owner actions that have not
been confirmed** (status OPEN below). No secret values are reproduced in this repository.

## 5. Open issues (owner, target)

| ID | Issue | Severity | Owner | Target / TODO |
|---|---|---|---|---|
| S1 | Leaked Coolify token + demo/super-admin passwords in git history not confirmed rotated | Critical | Owner | Before next deploy: revoke token in Coolify → Keys & Tokens; change or disable `contact@…` and `demo.client@…` accounts (`docs/runbooks/SECRET_ROTATION.md` §1) |
| S2 | No CSP / security headers on web; JWT in `localStorage` | High | Web | Add `headers()` in `apps/web/next.config.ts` (CSP, HSTS, frame-ancestors, referrer policy); consider HttpOnly cookie session |
| S3 | Upload endpoint without multipart size limit (`FileInterceptor('file')`) | High | API | Set `limits: { fileSize }` + reject by `Content-Length`; add test |
| S4 | In-memory auth rate limiter per instance | Medium | API | Move counters to Redis |
| S5 | Agent-gate token not bound to proposal id; non-constant-time compare | Medium | API | Bind `proposalId` in the HMAC payload; `crypto.timingSafeEqual` |
| S6 | Webhook secrets stored in plaintext (also in backups) | Medium | API | Encrypt at rest (envelope key); until then protect backups (`chmod 700`, encrypted off-site copy) |
| S7 | `pnpm audit`: 1 critical + 7 high advisories (all levels, 2026-09-26): vitest <3.2.6 (critical, dev), vite/esbuild (dev), orval → @scalar/json-magic → undici 7.x (high, dev codegen), next → postcss 8.4.31 (high, build-time; CVE-2026-45623, CVE-2026-73646). `--prod` view: 2 high (postcss). | High (dev) / Medium (prod) | Web + API | Upgrade vitest ≥ 4.1.11 in api/web, orval to a release with undici ≥ 7.29, next once it ships postcss ≥ 8.5.18 (or pnpm override `next>postcss`). postcss CVEs are risk-accepted in `.trivyignore` until **2026-12-31**. Then set `continue-on-error: false` on the `pnpm-audit` job |
| S8 | Licenses needing review: `@img/sharp-libvips-*` (LGPL-3.0-or-later, dynamically linked native lib), `elkjs` (EPL-2.0 OR GPL-3.0), `jszip` (MIT OR GPL-3.0 → use MIT), `certifi` (MPL-2.0), two packages with undeclared license (`buffers`, `pause`) | Low | Owner/legal | Confirm LGPL/EPL obligations (notice + relinking for sharp; EPL notice for elkjs); see `THIRD_PARTY_NOTICES.md` |
| S9 | Compose infrastructure images on floating tags (`elestio/minio:latest`, `clamav/clamav:latest`) | Medium | Ops | Pin by digest after verifying on the VPS (Renovate proposes them behind dashboard approval) |
| S10 | No external penetration test, no CODEOWNERS / branch protection evidence in repo (spec 20.1/20.2) | Medium | Owner | Enable branch protection on `main` requiring `ci`, `security`, `docker` checks and one review; add `.github/CODEOWNERS` for `apps/api/src/modules/{auth,tenancy,ingestion}`, `packages/database/migrations`, `infra/`, `.github/` |
| S12 | No per-user token revocation: `JwtStrategy.validate` does not re-check `users.status` or membership, so a suspended user keeps API access until the JWT expires (default 7 days); only a `JWT_SECRET` rotation (global logout) cuts it | Medium | API | Check status on each request (cached) or shorten `JWT_EXPIRES_IN` + refresh tokens; `apps/api/src/modules/auth/strategies/` |
| S11 | Not built/verified on GitHub-hosted runners yet: `release.yml` (GHCR push, cosign) and `docker.yml` image builds | Low | Owner | First tag `v0.1.0-rc.1` exercises it; check the signature with the `cosign verify` command in `release.yml` |

## 6. How to re-run the security checks locally

```bash
pnpm audit --prod --audit-level high                       # report
pip install pip-audit && pip-audit -r services/analysis-python/requirements.txt
trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore --exit-code 1 .
trivy config --severity HIGH,CRITICAL --exit-code 1 infra/docker
docker build -f infra/docker/Dockerfile.api -t erppreflight-api:local .
trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore --exit-code 1 erppreflight-api:local
gitleaks detect --config .gitleaks.toml
PG_ADMIN_URL=postgres://<user>:<pw>@localhost:5432 bash scripts/ci-migration-check.sh   # RLS coverage
```
