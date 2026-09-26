# Security Hardening Report

> Spec C §75 #3. Records **what was hardened, how it was verified, and what remains**, per workstream.
> Current posture and open issues: `SECURITY_REVIEW.md`. Each section names the exact commit(s) and
> commands; the coordinator adds the other workstreams' sections and final merge commit.
>
> | Field | Value |
> |---|---|
> | Baseline audit | `RELEASE_READINESS_REPORT.md` (branch `claude/sharp-mendel-xg6cus`, 2026-09-25) |
> | This section | Workstream E — CI/CD, supply chain, containers, backups |
> | Branch / commits | `worktree-agent-ace1e348aa8f737f7` — see `git log b6af091..HEAD` (final hash in the hand-off) |
> | Merged commit on main | _to be filled by the coordinator_ |

## 1. Hardening done before this remediation round (2026-09-25, summary)

From RELEASE_READINESS_REPORT §3: tenant header honoured only after JWT + membership (`a242eb9`),
NOBYPASSRLS runtime role (migration 010), production refuses default secrets, Swagger/metrics locked,
SSRF DNS re-check, login status check + rate limit, legacy SHA-256 hashes removed, Coolify token and
admin password removed from code (`b08f142`, `1932f4d`), ClamAV reply parsing fixed and fail-closed,
redaction no longer corrupts XML (`5596c5b`), client-supplied S3 keys rejected (`e74478a`).

## 2. Workstream E (2026-09-26)

| Area | Change | Files | Verification (command → result) |
|---|---|---|---|
| Vulnerability gates | Trivy moved off `@master` to a SHA-pinned release; fs scan now **blocking** on fixable HIGH/CRITICAL (was `exit-code: 0`); new blocking Dockerfile config scan; secrets left to gitleaks | `.github/workflows/security.yml`, `.trivyignore` | `trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore --exit-code 1 .` → exit 0; `trivy config infra/docker` → 0 misconfigurations |
| Container image scan | New `docker.yml`: builds api/web/analysis on every PR (no push), asserts non-root user, start smoke for web/analysis, **blocking** Trivy image scan | `.github/workflows/docker.yml` | Local builds scanned with Trivy 0.74.0: api 0, web 0, analysis 0 fixable HIGH/CRITICAL |
| Runtime image hardening | Base images pinned by digest; npm/npx/yarn/corepack removed from node runtime stages (their bundled deps: brace-expansion, picomatch, pacote, sigstore, ip-address — 8 fixable HIGH in `node:22-alpine`); pip removed from the python runtime (vendored msgpack/setuptools — 2 fixable HIGH); healthchecks use `127.0.0.1:${PORT}` | `infra/docker/Dockerfile.{api,web,analysis}` | `trivy image node:22-alpine` → 8 HIGH, `python:3.13-slim` → 2 HIGH before; built images → 0. In containers: `id` → uid 1001; `command -v npm` / `pip` → absent. API image booted: migrations 10/10 applied by the entrypoint, liveness OK |
| Build context | `.dockerignore` excludes `.git`, `.agents`, `node_modules`, `.next`, `dist`, `*.tsbuildinfo`, `.env*`, tests, docs, the prompt zip | `.dockerignore` | Build context 1.7 MB; all COPY lines resolve (api + web images built) |
| Dependency audit | pip-audit **blocking** (clean); pnpm audit report-only with tracked advisories | `security.yml`, `SECURITY_REVIEW.md` S7 | `pip-audit -r services/analysis-python/requirements.txt` → no known vulnerabilities; `pnpm audit --prod --audit-level high` → 2 high (postcss via next) |
| SBOM | CycloneDX per image (PR + release) and per repository | `docker.yml`, `release.yml`, `security.yml` | `trivy image --format cyclonedx`: api 359, web 52, analysis 119 components |
| Release integrity | Tag-triggered GHCR push with BuildKit SLSA provenance (`mode=max`) + SBOM attestation, GitHub build-provenance attestation, **cosign keyless** sign + verify, Trivy re-scan of the pushed digest, release notes with digests | `.github/workflows/release.yml` | `actionlint` clean; not executed yet (needs a tag on GitHub) |
| Action pinning | Every third-party action pinned to a commit SHA (resolved with `git ls-remote`); Renovate keeps SHAs/digests current, majors behind approval | `.github/workflows/*.yml`, `renovate.json` | `actionlint` exit 0; `renovate-config-validator renovate.json` → valid |
| Migrations | Migration check: fresh apply, second run no-op, deterministic `pg_dump`, identical schema on a 2nd fresh DB, **every `organization_id` table has ENABLE+FORCE RLS and a policy**, runtime role not SUPERUSER/BYPASSRLS | `scripts/ci-migration-check.sh`, `ci.yml` `migration-check` | Local run: applied=10, then 0; 3472-line dump identical; 22/22 tenant tables protected |
| Live security regression | Production-mode stack in CI with 7 cross-tenant denials, invalid-token 401, ClamAV scan, redaction at rest on every PR | `scripts/ci-live-e2e.sh`, `ci.yml` `live-e2e` | Local run: 21/21 API checks, 7/7 browser steps |
| Backups | Backup + verified restore; drill on every live-e2e run | `scripts/backup.sh`, `scripts/restore.sh` | Drill: 26 tables/40 rows and 17 objects restored and verified; login + byte-identical download after restore |
| Secret handling in CI | No secret literals in workflows: live-e2e generates random per-run values and masks them | `ci.yml` | gitleaks config unchanged |

Findings raised to other workstreams during this work: BullMQ ignored `REDIS_URL` (fixed by the
coordinator in `c3f9b10`); engine behaviour on non-SAP input (KNOWN_LIMITATIONS E1/E2); upload size
limit, CSP, token revocation (SECURITY_REVIEW S2, S3, S12).

## 3. Remaining (owner / next round)

See `SECURITY_REVIEW.md` §5 — S1 (credential rotation, owner), S2 CSP, S3 upload limit, S4–S6, S7
dev-tool advisories, S9 compose image digests, S10 branch protection/CODEOWNERS, S11 first release run,
S12 token revocation.
