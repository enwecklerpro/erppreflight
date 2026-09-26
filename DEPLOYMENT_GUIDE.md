# ERP Preflight — Deployment Guide

> Spec 13.12 #2, 12.7, 12.16, C §52–§56. Production target: one Hostinger VPS running Coolify v4,
> deploying `docker-compose.coolify.yml` from this repository. Architecture background and the full
> environment-variable table: `AI_AGENT_HANDOVER_AND_ARCHITECTURE.md` §4. Verified state:
> `RELEASE_READINESS_REPORT.md`, `docs/E2E_TEST_REPORT.md`.

## 1. What gets deployed

| Service | Image / build | Exposure |
|---|---|---|
| `web` | `infra/docker/Dockerfile.web` (Next.js standalone, non-root) | Traefik: `erppreflight.com`, `www.` |
| `db-backup` | `infra/docker/Dockerfile.db-backup` (one-shot: pre-migration `pg_dump`, then exits) | internal only |
| `migrate` | `infra/docker/Dockerfile.api`, command `migrate` (one-shot: applies pending migrations, then exits) | internal only |
| `api` | `infra/docker/Dockerfile.api` (NestJS, non-root; starts only after `migrate` exited 0) | Traefik: `api.erppreflight.com` |
| `analysis-python` | `infra/docker/Dockerfile.analysis` (FastAPI, non-root) | internal only |
| `postgres` | `pgvector/pgvector:0.8.6-pg16-bookworm` (digest-pinned) | internal only |
| `redis` | `redis:7.2.16-alpine3.21` (digest-pinned, AOF on) | internal only |
| `minio` | `elestio/minio` RELEASE.2025-09-07T16-13-09Z (pinned by digest; the vendor publishes only `latest`) | internal only |
| `clamav` | `clamav/clamav:1.5.4` (digest-pinned, 3 GB limit) | internal only |

Sizing: summed memory limits ≈ 13 GB; use a plan with **≥ 16 GB RAM** (8 GB plans risk OOM-kills of
ClamAV). Disk: DB + objects + ≥ 2 × that for local backups.

## 2. First deployment

1. **DNS** (Hostinger hPanel): `A @`, `A www`, `A api` → VPS IPv4.
2. **VPS**: Ubuntu 24.04, `ufw allow 22,80,443/tcp`, install Coolify
   (`curl -fsSL https://cdn.coolify.io/coolify/install.sh | bash`), secure the Coolify dashboard
   (strong admin password, 2FA, restrict port 8000 to your IP).
3. **Coolify resource**: Project → Environment → New Resource → GitHub repository
   `enwecklerpro/erppreflight`, branch `main`, build pack *Docker Compose*,
   compose path **`/docker-compose.coolify.yml`**.
4. **Environment variables** — copy `.env.coolify.example`; generate every secret fresh:
   ```bash
   openssl rand -hex 32        # POSTGRES_PASSWORD, S3_SECRET_KEY, MASTER_ENCRYPTION_KEY, METRICS_TOKEN
   openssl rand -base64 48     # JWT_SECRET
   ```
   Required (compose refuses to start without them, the API refuses known defaults):
   `POSTGRES_PASSWORD`, `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
   Also set `NEXT_PUBLIC_API_URL=https://api.erppreflight.com` (**build-time** for the web image),
   `CORS_ORIGIN=https://erppreflight.com,https://www.erppreflight.com`,
   `ADMIN_BOOTSTRAP_EMAIL`/`ADMIN_BOOTSTRAP_PASSWORD` (first deploy only), keep `CLAMAV_MOCK_MODE=false`,
   `STRICT_MIGRATIONS=true`, `DB_RUNTIME_ROLE=erppreflight_app`.
5. **Deploy**. Compose runs the one-shot jobs in order (§6a): `db-backup` dumps the database when
   the release ships pending migrations, `migrate` applies them strictly, and only then does the API
   start (`depends_on: service_completed_successfully`). A failed backup or migration stops the chain:
   the new API container is not started instead of serving a half-migrated schema.
6. **Verify** (§5), then remove `ADMIN_BOOTSTRAP_PASSWORD` from the environment.

Without Coolify: `docker network create coolify; docker compose -f docker-compose.coolify.yml up -d --build`
behind your own reverse proxy (the file joins the external `coolify` network).

## 3. Releases and updates (spec 12.16)

1. Merge to `main` only with green `CI`, `Security` and `Docker` workflows (branch protection).
2. Tag: `git tag v1.4.0 && git push origin v1.4.0` → `release.yml` builds the three images, pushes
   them to `ghcr.io/enwecklerpro/erppreflight/{api,web,analysis}`, attaches SLSA provenance + SBOM,
   signs the digests with cosign (keyless) and publishes a GitHub Release with changelog, digests and
   CycloneDX SBOMs.
3. Verify before deploying:
   ```bash
   cosign verify ghcr.io/enwecklerpro/erppreflight/api@sha256:<digest> \
     --certificate-identity-regexp 'https://github.com/enwecklerpro/erppreflight/.github/workflows/release.yml@refs/tags/v.*' \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com
   ```
4. **Backups**: the `db-backup` job dumps the database automatically before pending migrations are
   applied (§6a). It does not copy MinIO objects, so for releases with migrations also run
   `scripts/backup.sh` on the VPS (§6) or take a Hostinger VPS snapshot.
5. Deploy: today Coolify builds from the tagged commit (set the resource's branch/commit to the tag).
   **Production does not auto-deploy on push** (owner decision, verified 2026-09-26): after a merge to
   `main` someone has to press *Deploy* in Coolify (or call the Coolify deploy webhook). Turning on
   Coolify's *Automatic deployment* / GitHub webhook is an owner item (`ROADMAP_AFTER_V1.md`).
   Deploying the signed GHCR digests instead requires replacing `build:` with `image: …@sha256:` in a
   Coolify-specific compose override — recommended next step (KNOWN_LIMITATIONS O3/O9).
6. Verify (§5). **Rollback:** redeploy the previous tag. Migrations are forward-only; if a migration
   must be undone, restore the pre-migration backup (§6a, `docs/runbooks/DISASTER_RECOVERY.md` §3a).

> **GitHub Actions status (owner item).** On 2026-09-26 every workflow run in this repository failed
> within about 3 s without any job log — the pattern of an account-level block (billing / spending
> limit or Actions disabled for the account), not of a workflow error. Until the owner fixes this
> under GitHub → Settings → Billing and plans / Actions, the gates in step 1 cannot run on GitHub;
> run them locally (`AGENTS.md` §5.1, `scripts/ci-live-e2e.sh`) before merging.

## 4. Configuration reference

`.env.coolify.example` documents every variable read by the compose file; the API validates them in
`apps/api/src/config/env.validation.ts`. Secret rotation: `docs/runbooks/SECRET_ROTATION.md`.

### 4.1 Browser sessions, cookies and CSRF (web and API on different hosts)

Browsers authenticate only with the HttpOnly cookie `erppreflight_session` issued by the API; the web
app never stores a token (spec C §8.2/§68). The production topology puts the web app on
`erppreflight.com` and the API on `api.erppreflight.com`. Both belong to the same site
(`erppreflight.com`), so the default cookie — host-only on the API host, `SameSite=Lax`, `Secure` —
is sent with the web app's credentialed `fetch` calls without further configuration. Requirements:

- `CORS_ORIGIN` lists exactly the web origins (https). CORS allows credentials only for them, and the
  CSRF guard accepts cookie-authenticated `POST/PUT/PATCH/DELETE` only from these origins (plus
  `APP_PUBLIC_URL`) and only with a valid `X-CSRF-Token` (signed double-submit token bound to the
  session; the web app reads it from the `erp_csrf` cookie, the login response or `GET /api/v1/auth/csrf`).
  Violations return 403 `CSRF_REJECTED`.
- `TRUST_PROXY` must equal the real number of reverse-proxy hops in front of the API (production
  default `1` = Traefik only; `2` with an additional CDN / load balancer), never higher. It is the one
  setting that decides the client address for `Secure` cookies, the Redis-backed auth rate limits,
  organization IP allowlists and audit IPs. **The API port must only be reachable through Traefik**
  (the compose file only `expose`s 3001; never publish it with `ports:` or route around the proxy):
  otherwise, or with a hop count set too high, a forged `X-Forwarded-For` header chooses the client
  address and bypasses rate limits and IP allowlists.
- Optional `SESSION_COOKIE_DOMAIN=erppreflight.com` scopes both cookies to the parent domain (the web
  server then sees the real session cookie; script can read `erp_csrf` directly). Leave it empty unless
  needed. A web app on a *different* site (e.g. an `sslip.io` test host) would need
  `SESSION_COOKIE_SAMESITE=none` and still fails in browsers that block third-party cookies — use a
  subdomain of the same registrable domain instead.
- CLI, local agent and scripts keep using `Authorization: Bearer` (the login response contains
  `accessToken` only for non-browser callers) or `X-Api-Key`; they are exempt from the CSRF check.

## 5. Post-deploy verification

```bash
curl -s https://api.erppreflight.com/health/liveness
curl -s https://api.erppreflight.com/health/readiness | jq .   # postgres, redis, minio, analysis (19 engines), clamav: all "up"
curl -s -o /dev/null -w '%{http_code}\n' https://erppreflight.com/api/health
API_BASE_URL=https://api.erppreflight.com bash scripts/e2e-live-smoke.sh      # 21 checks, 2 throwaway tenants
WEB_URL=https://erppreflight.com node scripts/e2e-ui-smoke.cjs                # Chromium journey (needs `pnpm install`)
WEB_URL=https://erppreflight.com API_BASE_URL=https://api.erppreflight.com \
  node scripts/e2e-session-security-smoke.cjs   # cookie session + CSRF + magic link (needs the dev mailbox, i.e. staging only)
```

The smoke tests create tenants named `Org A <n>` / `Org B <n>` with `@e2e.local` addresses; delete
them afterwards if the production database must stay clean.

## 6. Backups (spec 12.7, 13.11 "working backups")

`scripts/backup.sh` (run on the VPS host, daily via cron or a Coolify scheduled task):

- `pg_dump -Fc` **inside** the postgres container (no DB port exposure, no password on the command
  line), validated with `pg_restore --list`, SHA-256 recorded;
- exact row count of every table (`table_counts.tsv`) for restore verification;
- `mc mirror` of the `erppreflight-quarantine`, `-clean` and `-reports` buckets using the MinIO image
  already on the host;
- `manifest.json`, `umask 077`, lock file, retention (`BACKUP_RETENTION_DAYS`, default 14).

Set-up commands, off-site copy and the restore procedure: `docs/runbooks/DISASTER_RECOVERY.md`.
`scripts/restore.sh` verifies checksum, per-table row counts, RLS policies and object counts and exits
non-zero on any mismatch.

### 6.1 Restore drill executed (2026-09-26, shared local infrastructure, workstream-E database)

Command: `scripts/ci-live-e2e.sh` (drill phase), same scripts as production, against the shared
Postgres 16/pgvector + MinIO containers, database `erppreflight_ws_e`, buckets `erppreflight-ws-e-*`:

| Step | Result |
|---|---|
| Seed via API: register tenant, create project "Restore Drill", upload fixture (ClamAV CLEAN) | object sha256 `9724d499…` |
| `scripts/backup.sh` | 26 tables / 40 rows, dump 159 316 bytes (sha256 `bc17c8a3…`), clean bucket 7 objects, reports bucket 10 objects |
| Disaster | `DROP DATABASE erppreflight_ws_e`, all objects deleted from the three buckets |
| `scripts/restore.sh` | checksum OK; row counts verified for 26 tables (40 rows); 22 tables with ENABLE+FORCE RLS, 22 policies; 7 + 10 objects restored |
| API restarted on restored data | login of the drill user OK, project readable, downloaded file **byte-identical** (sha256 `9724d499…`) |

The CI `live-e2e` job repeats this drill on every run.

## 6a. Migration job with automatic pre-migration backup

Every deployment runs two one-shot containers before the API:

```
postgres (healthy) -> db-backup (exit 0) -> migrate (exit 0) -> api
```

| Job | What it does | Fails when |
|---|---|---|
| `db-backup` (`infra/docker/premigration-backup.sh` in an image built FROM the pinned postgres image, so `pg_dump` matches the server) | Compares the release's migration files with `_migrations`. If migrations are pending on a non-empty database: `pg_dump -Fc` to the volume `erppreflight_premigration_backups` (`/backups/<UTC stamp>/`: `postgres.dump`, `.sha256`, `table_counts.tsv`, `pending.txt`, `manifest.json`), verified with `pg_restore --list`; keeps the newest `PREMIGRATION_BACKUP_KEEP` (10). Fresh database or nothing pending: logs and exits 0. | database unreachable, dump empty/unreadable, volume not writable |
| `migrate` (API image, `api-entrypoint.sh migrate`) | Applies pending migrations strictly (each file in its own transaction) and exits. | any migration error |
| `api` | Starts with `AUTO_MIGRATE=false`. | — |

Settings: `PREMIGRATION_BACKUP=auto|always|off` (default `auto`), `PREMIGRATION_BACKUP_KEEP`.
`AUTO_MIGRATE=true` on the API is the **fallback** for runtimes without compose `depends_on`
conditions (the API then migrates at start, idempotently, without the automatic backup).

Logs: `docker logs erppreflight-db-backup`, `docker logs erppreflight-migrate`. In Coolify both
containers show as *Exited (0)* after a successful deployment — that is their normal final state
(optionally exclude them from Coolify's health status). If the new API does not start after a
deploy, read these two logs first.

List / copy / restore a pre-migration backup (restore procedure: `docs/runbooks/DISASTER_RECOVERY.md` §3a):

```bash
docker run --rm -v erppreflight_premigration_backups:/b alpine ls -l /b
docker run --rm -v erppreflight_premigration_backups:/b -v /var/backups/erppreflight/premigration:/out alpine cp -r /b/. /out/
```

The pre-migration dump covers PostgreSQL only; `scripts/backup.sh` (§6) remains the full daily
backup including MinIO objects and the off-site copy.

## 7. Monitoring

- Health: `/health/liveness`, `/health/readiness` (use readiness for uptime monitoring).
- Metrics: `GET /api/v1/metrics` with `Authorization: Bearer $METRICS_TOKEN` (Prometheus format).
- Alerts + dashboard: `infra/observability/` ships Prometheus alert rules (validated with
  `promtool`), a Grafana dashboard and an opt-in compose profile `observability`
  (`docs/runbooks/observability.md` §7). Also keep an external uptime check on `/health/readiness`
  and on certificate expiry (`docs/runbooks/CERTIFICATE_RENEWAL.md`).
- Tracing / error reporting: `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN` (`docs/runbooks/observability.md`).
- Logs: `docker logs erppreflight-<service>` / Coolify log view; the API logs JSON with `X-Request-ID`.

## 8. Runbooks

`docs/runbooks/`: `INCIDENT_RESPONSE.md`, `CLAMAV_DOWN.md`, `QUEUE_BACKLOG.md`, `DISASTER_RECOVERY.md`,
`SECRET_ROTATION.md`, `CERTIFICATE_RENEWAL.md`, `HOSTINGER_COOLIFY_DEPLOYMENT.md` (historical walkthrough).

## 9. Single-VPS limitation and migration path (spec C §56)

The current layout is **not highly available**: one host runs every service; a host, disk or
provider failure is a full outage, and data written since the last off-site backup is lost.
Acceptable for an initial launch with a documented RPO/RTO (DISASTER_RECOVERY §0), not for
enterprise SLAs. Migration path, in order of value:

1. **Managed PostgreSQL** with PITR (point `DATABASE_URL` at it; keep the RLS runtime role — create
   `erppreflight_app` and a login user that is a member of it; migrations run unchanged).
2. **External S3** (any S3-compatible service: set `S3_ENDPOINT`, keys and bucket names; enable
   versioning and object lock on the buckets).
3. **Managed/replicated Redis** (`REDIS_URL` with TLS `rediss://`).
4. **Separate worker processes**: the BullMQ worker currently runs inside the API container; split it
   so analysis load scales independently; run ≥ 2 API replicas behind the proxy (move the auth rate
   limiter to Redis first — SECURITY_REVIEW S4).
5. **CDN/WAF** in front of `web` and `api` (also adds DDoS protection and edge TLS).
6. ClamAV as a separate, horizontally scaled scanning service.
