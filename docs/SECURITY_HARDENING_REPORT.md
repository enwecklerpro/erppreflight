# Security Hardening Report

> Spec C §68 / §75 #3. What was hardened, how it was verified, and what remains. Current posture with file references:
> `SECURITY_REVIEW.md`.

| Field | Value |
|---|---|
| Commit | `0aaa83d` on `claude/sharp-mendel-xg6cus` (baseline audited: `main` @ `7a76aea`) |
| Date | 2026-09-26 |
| Deployment checked | **None.** Production is not deployed with this code; no production security verification (headers, TLS, exposed ports) on erppreflight.com |
| Tests | API 1218, web 310, local-agent 10, Python 1665 + 1 skipped — 0 failed. Live: session-security 16/16, tenant-admin 37/37, admin-governance 44/44, platform-hardening 12/12, plus the 12 existing suites (cross-tenant denials, redaction at rest, auth flows); migration check 67 tenant tables FORCE RLS |
| Not performed | External penetration test, DAST, load/DoS testing; GitHub-hosted runs of `security.yml`/`docker.yml` (GitHub Actions fail at account level) |

## 1. C §68 Definition of Done — Security

| Item | Status | Evidence |
|---|---|---|
| Argon2id password hashing | Done | `apps/api/src/modules/auth/auth.service.ts` |
| No primary auth token in `localStorage` | **Done (live)** | Cookie-only browser sessions: `auth/session-cookie.ts` (HttpOnly `erppreflight_session` + readable `erp_csrf`), browser responses never contain the access token; `apps/web/src/lib/api/custom-instance.ts` sends `credentials: 'include'`, stores no token and purges legacy tokens; live suite checks web storage after UI login |
| CSRF protection | Done (live) | Global `auth/csrf.guard.ts`: signed double-submit (`X-CSRF-Token` = HMAC of the session id) + Origin/Referer check against `CORS_ORIGIN` + `APP_PUBLIC_URL`; Bearer/API-key, Stripe webhook, SCIM, agent device APIs exempt; 403 `CSRF_REJECTED` |
| Secure cookie / session | Done | `SESSION_COOKIE_DOMAIN/_SAMESITE/_SECURE` validated at boot; server-side `user_sessions` checked on every request (`jwt.strategy.ts`); host-only cookie leftovers cleared when a domain is configured (`3c2e758`) |
| E-mail verification, password reset, magic link | Done (live) | `auth/verify-email`, `auth/password/*`; magic link single use, SHA-256-hashed, 15 min, superseded by newer links, revoked on reset / password change / sign-out-everywhere (migration 025) |
| 2FA | Done (live) | TOTP + recovery codes, org-wide `require_2fa`; magic link continues into 2FA; 2FA failure budget shared through Redis |
| No Postgres trust auth | Done (production compose) | `docker-compose.coolify.yml` requires `POSTGRES_PASSWORD`; legacy `docker-compose.yaml` must not be deployed |
| No default production secrets | Done (code) | `apps/api/src/config/env.validation.ts` refuses missing/known secrets. **Operational gap:** the production `MASTER_ENCRYPTION_KEY` is a publicly documented example value and must be rotated (owner, §3) |
| Real malware scan | Done (live) | `ingestion/clamav.scanner.ts`, fail-closed |
| Upload defenses | Done (live) | Magic bytes, archive ratio/size/nesting/zip-slip, 100 MB cap → 413, redaction; abapGit member inflation byte-budgeted (`3de97d9`) |
| Tenant isolation | Done (live) | Membership-verified tenant, **67** tables ENABLE+FORCE RLS, runtime role NOBYPASSRLS; suspension (403 `TENANT_SUSPENDED`) and IP allowlist (403 `IP_NOT_ALLOWED`) also enforced for local-agent devices and SCIM (`993b5f5`) |
| API authorization | Done | Role guards, API-key scopes, super-admin guard; impersonation policy on case-folded paths, secrets always denied, `X-Api-Key` + impersonation refused |
| Audit | Done (live) | `@Audited` (76 call sites), per-tenant hash chain, `GET audit/verify`; append-only `platform_audit_events` for operator actions |
| Gitleaks / Trivy / SBOM / dependency audit | Done (locally reproduced) | `security.yml`, `docker.yml`, `release.yml`; `pnpm audit --prod` 0 advisories and blocking (`b933062`). Never run on GitHub |

## 2. Hardening by workstream

| Area | Change | Verification |
|---|---|---|
| Tenancy (audit fix `a242eb9`) | Tenant header honoured only after JWT + membership; migration 010 runtime role; API-key scopes | `tenancy.guard.spec.ts`; migration check; live denials |
| Ingestion (`e74478a`, `5596c5b`) | ClamAV reply parsing, raw file never overwrites clean copy, client S3 keys rejected | live smoke "redacted at rest, XML intact" |
| Secrets (`b08f142`, `1932f4d`) | Coolify token and admin password removed from code | gitleaks; **rotation pending (owner)** |
| B — accounts | Server-side sessions + revocation, verification, reset, TOTP, recovery codes | account UI smoke, live smoke |
| A — web | Nonce-based CSP per request, route guard, noindex for private routes | `seo-routes.test.ts`; public smoke |
| C — audit | Hash chain per tenant, verify endpoint | commercial smoke |
| D — engines/parsers | Input contracts, safe ZIP, defused XML, redacted evidence snippets, Hypothesis property tests | pytest |
| E — supply chain | SHA-pinned actions, digest-pinned images, no npm/pip in runtime images, blocking Trivy, SBOM, cosign | local Trivy |
| H — integrations | Credential vault (with `MASTER_ENCRYPTION_KEY_PREVIOUS` rotation), SSRF policy, signed agent jobs, SCIM tokens | enterprise live suite |
| Final (`013fc6f`, `6303f1d`) | SSO-enforced orgs block password login; constant-time agent-gate signature | live check |
| **session-security** | Cookie-only sessions, CSRF guard, magic link, magic-link revocation on credential reset | `test/session_security.spec.ts`, web `session-security.test.tsx`, live 16/16 |
| **tenant-access-admin** | Impersonation: distinct token/claims, HttpOnly cookie, read-only default, per-request session check, fail-closed auditing (503), case-folded path policy; suspension incl. machine credentials; IP allowlist with lockout protection | live 37/37 |
| **admin-governance** | SUPER_ADMIN-only governance, audited mutations, AI provider kill switch, atomic cost-ceiling reservation, race-free publish gate (`4df5220`) | live 44/44 |
| **platform-hardening** | Redis rate limits shared by all API instances (auth, 2FA, SSO, public tools, connectors), keyed by the same `clientIpOf()` as the IP allowlist; exactly-once upload metering | live 12/12 (two API processes) |
| **engines-completion** | Stream endpoint guards: 413 above `MAX_STREAM_SIZE_MB`, `MAX_CONCURRENT_STREAMS`, 507 before `STREAM_MIN_FREE_DISK_MB`; entropy masking exemption limited to OData metadata (`3de97d9`) | pytest, engines 16/16 |
| **ops-quality** | Digest-pinned images, pre-migration backup job, `pytest` out of the runtime image, CODEOWNERS | migration + backup drill |

## 3. Remaining (open)

| ID | Issue | Owner |
|---|---|---|
| S1 | Rotate every secret shared in plain text: Coolify API token, Hostinger API + mail tokens, mailbox and admin passwords, production `JWT_SECRET`, production `MASTER_ENCRYPTION_KEY` (public example value; rotate via `MASTER_ENCRYPTION_KEY_PREVIOUS`); plus the old leaked Coolify token and `contact@` / `demo.client@` passwords in git history. No values are recorded in the repository | **Owner** |
| — | `TRUST_PROXY` must equal the real proxy hop count and the API port must only be reachable via Traefik; otherwise `X-Forwarded-For` spoofing bypasses rate limits and IP allowlists | Owner/Ops |
| — | A request carrying only the impersonation cookie (no operator session cookie) passes `CsrfGuard` without a CSRF token (`NO_COOKIE_SESSION`); mitigated by the Origin/Referer check, `SameSite`, and read-only impersonation by default | API |
| S7 | Full `pnpm audit`: dev-only vitest 2 / vite 5 advisories (report-only) | Web/API |
| S8, S10, S11 | Licence review; branch protection not verifiably applied; release/docker workflows never run on GitHub (Actions fail at account level) | Owner/Ops |
| — | No penetration test | Owner |

Full table with targets: `SECURITY_REVIEW.md` §5.
