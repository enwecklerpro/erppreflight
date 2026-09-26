# Security Hardening Report

> Spec C §68 / §75 #3. What was hardened, how it was verified, and what remains. Current posture with file references:
> `SECURITY_REVIEW.md`.

| Field | Value |
|---|---|
| Commit | `6303f1d` on `claude/sharp-mendel-xg6cus` (baseline audited: `main` @ `7a76aea`) |
| Date | 2026-09-26 |
| Deployment checked | **None.** No production security verification (headers, TLS, exposed ports) was performed on erppreflight.com |
| Tests | API 979, web 233, local-agent 10, Python 1169 + 1 skipped, Python e2e/redaction 267 — 0 failed. Live: `e2e-live-smoke.sh` 77/77 (cross-tenant denials, redaction at rest, auth flows) |
| Not performed | External penetration test, DAST, load/DoS testing; GitHub-hosted runs of `security.yml`/`docker.yml` |

## 1. C §68 Definition of Done — Security

| Item | Status | Evidence |
|---|---|---|
| Argon2id password hashing | Done | `apps/api/src/modules/auth/auth.service.ts`; legacy SHA-256 and trimmed-password matching removed |
| No primary auth token in `localStorage` | **Not met** | `apps/web/src/lib/api/custom-instance.ts` stores and reads the bearer token from `localStorage` |
| Secure cookie / session | Done | Session cookie `httpOnly`, `sameSite: 'lax'`, `secure` in production (`auth.controller.ts`); server-side `user_sessions` checked on every request (`auth/strategies/jwt.strategy.ts`: session not revoked/expired, user status, token version) |
| E-mail verification | Done (live) | `POST auth/verify-email`; unverified users get 403 `EMAIL_NOT_VERIFIED` for analyses, exports, API keys, invites |
| Password reset | Done (live) | `auth/password/{forgot,reset/validate,reset,change}`; single-use links |
| 2FA | Done (live) | TOTP + recovery codes (`auth/2fa/*`), org-wide `require_2fa` (`tenancy.middleware.ts`) |
| No Postgres trust auth | Done (production compose) | `docker-compose.coolify.yml` requires `POSTGRES_PASSWORD`; the legacy `docker-compose.yaml` still has `POSTGRES_HOST_AUTH_METHOD: trust` and must not be deployed (cleanup proposed in `docs/REPO_CLEANUP_PROPOSAL.md`) |
| No default production secrets | Done | `apps/api/src/config/env.validation.ts` refuses to start with missing/known secrets; `${VAR:?}` in compose; `check:no-production-facades` |
| Real malware scan | Done (live) | `ingestion/clamav.scanner.ts`, fail-closed; live run against real clamd |
| Upload defenses | Done (live) | Magic bytes, archive ratio/size/nesting (depth 2)/zip-slip, 100 MB cap → 413 on artifact and `sap-import` uploads (`MAX_UPLOAD_SIZE_MB`), redaction |
| Tenant isolation | Done (live) | Membership-verified tenant (`tenancy.guard.ts`), 62 tables ENABLE+FORCE RLS, runtime role NOBYPASSRLS; live denials 403/404 |
| API authorization | Done | Guards on all controllers, API-key scopes, role checks on destructive routes, super-admin guard; SSO-enforced orgs block password login (`6303f1d`) |
| Audit | Done (live) | `@Audited`, per-tenant hash chain, `GET audit/verify` (1852 events / 104 orgs, 0 gaps) |
| Gitleaks / Trivy / SBOM | Done (locally reproduced) | `security.yml` (gitleaks full history, Trivy fs + config blocking, pip-audit blocking), `docker.yml` (Trivy image blocking, CycloneDX SBOM), `release.yml` (SBOM, provenance, cosign). Never run on GitHub |

## 2. Hardening by workstream

| Area | Change | Verification |
|---|---|---|
| Tenancy (audit fix `a242eb9`) | Tenant header honoured only after JWT + membership; migration 010 runtime role; guards on 8 controllers; API-key scopes | `tenancy.guard.spec.ts`; migration check; live denials |
| Ingestion (`e74478a`, `5596c5b`) | ClamAV reply parsing, raw file never overwrites clean copy, client S3 keys rejected, redactor no longer masks XML closing tags | live smoke "redacted at rest, XML intact" |
| Secrets (`b08f142`, `1932f4d`) | Coolify token and admin password removed from code | gitleaks; **rotation pending (owner)** |
| B — accounts | Server-side sessions + revocation, verification, reset, TOTP, recovery codes, 2FA-failure rate limit | account UI smoke, live smoke |
| A — web | Nonce-based CSP per request (`apps/web/src/lib/csp.ts`, `middleware.ts`), route guard, noindex for private routes | `seo-routes.test.ts`; public smoke |
| C — audit | Hash chain per tenant, verify endpoint, audit on billing/admin/export/security events | commercial smoke; chain check |
| D — engines/parsers | Input contracts reject garbage, safe ZIP (depth 2), defused XML, evidence snippets redacted, Hypothesis property tests | pytest 1169 |
| E — supply chain | SHA-pinned actions, digest-pinned base images, no npm/pip in runtime images, blocking Trivy, SBOM, cosign | local Trivy: 0 fixable HIGH/CRITICAL in all three images (2026-09-26) |
| H — integrations | Credential vault (encrypted connector credentials and webhook secrets), SSRF policy with DNS re-check, signed agent jobs, SCIM bearer tokens, circuit breaker | enterprise live suite 85/85 |
| Final | Password login → 403 `SSO_REQUIRED` for SSO-enforced orgs | live check |

## 3. Remaining (open)

| ID | Issue | Owner |
|---|---|---|
| S1 | Leaked Coolify token (`13\|wilw…`) and passwords of `contact@` / `demo.client@erppreflight.com` in public history — rotate/disable | **Owner** |
| — | Bearer token in `localStorage` (C §68 item not met) | Web |
| — | Auth and 2FA rate limiters in memory per instance | API |
| S7 | `pnpm audit` dev-tool advisories (not re-run on the final tree) | Web/API |
| S8–S11 | Licence review, floating compose infra tags, no CODEOWNERS/branch protection, release workflow never run | Owner/Ops |
| — | No penetration test | Owner |

Full table with targets: `SECURITY_REVIEW.md` §5.
