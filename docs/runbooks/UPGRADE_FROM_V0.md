# Runbook: production upgrade from v0 (`main@7a76aea`) on Coolify

> Scope: the first deploy of this branch over the production stack that Coolify built
> from `main@7a76aea` (`docker-compose.coolify.yml`), which already holds real data
> (organizations, users, projects, files, findings, reports, audit events).
> Migrations 001–009 are identical in both versions. The upgrade applies **010–019 and 026**
> once, at the first start of the new API container. Migrations are forward-only.
>
> The procedure was rehearsed end to end (old stack populated through the old API, then
> upgraded in place). Results are in section 9.

---

## 0. Read first: what production is actually running

`main@7a76aea` does **not** run as committed. The rehearsal showed two defects in that
commit:

1. The API does not start. Nest cannot resolve `EntitlementsService` for the
   `EntitlementGuard` used in `LandscapesModule`, `ProjectsModule`, `AnalysesModule` and
   `AgentGateModule`, because those modules do not import `BillingModule`.
2. With (1) patched, the first HTTP request crashes the process. The telemetry middleware
   calls `TenancyContext.getTenantId()` in a `res.on('finish')` listener, that call throws
   outside a tenant context, and nothing catches it. The container health check alone
   triggers this.

With the default `CLAMAV_MOCK_MODE=false`, the v0 ClamAV client also rejects the
NUL-terminated `stream: OK` reply from a real clamd. As a result every v0 upload was stored
as `QUARANTINED` (`SCAN_FAILED_UNRECOGNIZED_RESPONSE`).

The containers running today were therefore probably built from an **earlier** commit, or
the API is crash-looping. Before you start:

```bash
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep -i erppreflight
docker logs --tail 80 erppreflight-api 2>&1 | grep -Ei "Nest can't resolve|TenantContextMissing|listening on port"
```

Note the commit or image of the last **working** deployment in Coolify (Project →
Deployments). That deployment is your rollback target, not `7a76aea` (see section 8).
Count the uploads that were quarantined by the scanner bug. They stay quarantined after
the upgrade and must be uploaded again:

```bash
docker exec erppreflight-postgres psql -U erppreflight -d erppreflight -c \
  "SELECT count(*) FROM uploaded_files WHERE quarantine_status = 'QUARANTINED'"
```

---

## 1. Environment variables (Coolify → resource → Environment Variables)

### 1.1 New and required: the deploy fails if these are missing

`docker-compose.coolify.yml` now uses `${VAR:?}` for them, so Coolify stops at compose
rendering and the running containers stay in place.

| Variable | Production value |
|---|---|
| `MAIL_TRANSPORT` | `smtp` |
| `MAIL_FROM` | `"ERP Preflight <noreply@erppreflight.com>"` |

### 1.2 New and needed for a working product (e-mail verification, password reset, invitations)

Hostinger Business Email: create the mailbox `noreply@erppreflight.com` in hPanel first.

```dotenv
MAIL_TRANSPORT=smtp
MAIL_FROM="ERP Preflight <noreply@erppreflight.com>"
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=tls                 # implicit TLS on 465 (the default for port 465)
SMTP_USER=noreply@erppreflight.com
SMTP_PASSWORD=<mailbox password>
SMTP_TLS_REJECT_UNAUTHORIZED=true
SMTP_TIMEOUT_MS=20000
APP_PUBLIC_URL=https://erppreflight.com      # links in e-mails; must be https in production
EMAIL_VERIFICATION_REQUIRED=true
```

Do **not** use `MAIL_TRANSPORT=dev` in production. It delivers nothing, and the API
refuses it unless `MAIL_DEV_OUTBOX_TOKEN` (24 or more characters) is also set. Add SPF,
DKIM and DMARC for erppreflight.com as hPanel suggests; otherwise verification mails land
in spam.

### 1.3 New, with safe defaults (set them explicitly so you can see them)

| Variable | Value | Notes |
|---|---|---|
| `DB_RUNTIME_ROLE` | `erppreflight_app` | Tenant transactions `SET LOCAL ROLE` to this NOBYPASSRLS role (created by 010). Keep it. |
| `APP_DATABASE_URL` | *(empty)* | Optional dedicated runtime login. Empty = reuse `DATABASE_URL`. |
| `AUTO_MIGRATE` | *(unset → `false`)* | Migrations run in the one-shot `migrate` job before the API starts (`DEPLOYMENT_GUIDE.md` §6a). Setting `true` is harmless (the API finds nothing pending). |
| `PREMIGRATION_BACKUP` | `auto` | The `db-backup` job dumps the database before the upgrade migrations run. It does not replace the manual backup in section 2 (MinIO objects). |
| `STRICT_MIGRATIONS` | `true` | With `true`, a failed migration stops the container instead of running on a half-migrated schema. |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | leave empty | **Semantics changed.** v0 reset five hard-coded accounts to `ADMIN_BOOTSTRAP_PASSWORD` on every start. The new code only *creates* one SUPER_ADMIN if the address does not exist and never touches existing accounts. The rehearsal confirmed this: a different bootstrap password was rejected for the existing `contact@erppreflight.com`. |
| `API_PUBLIC_URL` | `https://api.erppreflight.com` | OIDC redirect, CLI/agent instructions. |
| `CORS_ORIGIN` | `https://erppreflight.com,https://www.erppreflight.com` | The default no longer includes the `http://` origins or localhost. |
| `NEXT_PUBLIC_APP_URL` | `https://erppreflight.com` | Web build argument and runtime. |
| `API_INTERNAL_URL` | `http://api:3001` | Web SSR → API inside the Docker network. |
| `NEXT_PUBLIC_LEGAL_COMPANY_NAME`, `…_ADDRESS`, `…_REPRESENTATIVE`, `…_REGISTER`, `…_VAT_ID`, `…_EMAIL`, `…_PHONE`, `…_RESPONSIBLE_PERSON`, `…_SUBPROCESSORS` | your legal data | The Impressum and privacy pages show "not configured" without them. These are build-time variables, so rebuild the web service after changing them. |
| `METRICS_TOKEN` | 16 or more random chars, or empty | Prometheus scrape token for `/api/v1/metrics`. |
| `ENABLE_SWAGGER`, `ENABLE_API_REFERENCE` | `false` | |
| `LOG_LEVEL` | `info` | |
| `KNOWLEDGE_SYNC_CRON` | `17 3 * * 1` | Weekly SAP knowledge sync (UTC). Set `off` to disable. |
| `OTEL_*`, `SENTRY_*`, `STRIPE_*`, `AGENT_*`, `SSO_*`, `MASTER_ENCRYPTION_KEY_PREVIOUS`, `*_ALLOW_PRIVATE_NETWORKS` | empty / `false` | Optional integrations. See `.env.coolify.example`. |

### 1.4 Must NOT change during the upgrade

| Variable | Why |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | The existing volume `erppreflight_postgres_data_v2` was initialized with them. Migrations run as this owner, and 010 grants `erppreflight_app` to it. |
| `JWT_SECRET` | Existing sessions stay valid only with the same secret. A change logs everyone out, but no data is lost. |
| `MASTER_ENCRYPTION_KEY` | Decrypts every stored credential (landscapes, connectors, TOTP, webhook secrets). A new key needs the `MASTER_ENCRYPTION_KEY_PREVIOUS` rotation procedure (`SECRET_ROTATION.md`), never a plain swap. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Root credentials of the existing MinIO volume. |
| `S3_BUCKET_QUARANTINE`, `S3_BUCKET_CLEAN`, `S3_BUCKET_REPORTS` (if set) | The stored object keys point into these buckets. |

The new API refuses to start in production when `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`,
`S3_ACCESS_KEY` or `S3_SECRET_KEY` holds a publicly known default (`minioadmin`, the
AGENTS.md sample JWT secret and similar). If production uses one of those, rotate it
**before** the upgrade, following `SECRET_ROTATION.md`. Do not change it as part of the
upgrade itself.

---

## 2. Pre-upgrade backup (mandatory)

Run on the VPS (as root) right before the deploy.

```bash
mkdir -p /var/backups/erppreflight/pre-upgrade && cd /var/backups/erppreflight/pre-upgrade
# 1. PostgreSQL (custom format, includes roles' grants on objects, not the roles themselves)
docker exec erppreflight-postgres pg_dump -U erppreflight -d erppreflight -Fc > erppreflight-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec erppreflight-postgres psql -U erppreflight -d erppreflight -Atc \
  "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 1" > rowcounts-before.txt
# 2. MinIO objects (whole volume, consistent enough for a short maintenance window)
docker run --rm -v erppreflight_minio_data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/minio-data-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /data .
ls -la
```

Alternatively, copy `scripts/backup.sh` and `scripts/restore.sh` from this branch to the
VPS and run `backup.sh` (see `DISASTER_RECOVERY.md`). They work against the v0 stack
because they only use `docker exec`. A Hostinger VPS snapshot (hPanel → VPS → Snapshots)
on top of this is recommended.

---

## 3. Deploy

1. In Coolify, set all variables from sections 1.1–1.3 and double-check the values in 1.4.
2. Point the resource at the new commit or branch and click **Deploy**. Images are rebuilt
   (api, web with the new build arguments, analysis-python). ClamAV gets a new volume,
   `erppreflight_clamav_db`.
3. Watch the deployment jobs, then the API log:
   ```bash
   docker logs erppreflight-db-backup      # "11 pending migration(s): 010_… 026_…" then "backup OK: /backups/<stamp>"
   docker logs erppreflight-migrate        # "Migrations complete: applied=11, skipped=9", "Migration job finished successfully."
   docker logs -f erppreflight-api 2>&1 | grep -E "Migration|migrat|Legacy finding|listening|ERROR"
   ```

### What happens at the first start

The rehearsal was run with production settings (`NODE_ENV=production`,
`STRICT_MIGRATIONS=true`, `DB_RUNTIME_ROLE=erppreflight_app`, superuser owner login as on
Coolify). The first start does the following:

1. The `db-backup` job dumps the v0 database (9 applied, 11 pending migrations) to the volume
   `erppreflight_premigration_backups`. Then the `migrate` job (`infra/docker/api-entrypoint.sh migrate`)
   runs the migration runner as the schema owner (`DATABASE_URL`). The rehearsal below ran the same
   runner inside the API container; the job uses the identical code path. Each file runs in its own transaction. Expected log:
   `Migrations complete: applied=11, skipped=9` followed by
   `Newly applied migrations: 010_app_runtime_role.sql, … 019_knowledge_content_workflow.sql, 026_legacy_finding_source_backfill.sql`.
   - 010 creates the NOLOGIN, NOSUPERUSER, NOBYPASSRLS role `erppreflight_app` and grants it to the owner.
   - 011 adds account lifecycle columns and **grandfathers every existing user as e-mail verified** (`email_verified_at = created_at`). Nobody is locked out by verification, and there is no 2FA enforcement (`require_2fa=false`).
   - 012 adds plan and usage columns and backfills the per-tenant audit `chain_seq` for every existing audit event (this fixes v0's false `GAP_DETECTED` verification).
   - 017 adds finding lifecycle tables. 026 backfills `source_file_id`/`source_file_name` of pre-017 findings from their evidence, so decisions carry over into later analyses.
   - All other changes are additive (new tables with RLS, new nullable or defaulted columns).
2. The API starts only after `migrate` exited 0. With `AUTO_MIGRATE=true` (optional fallback) `main.js` runs the runner again and logs `applied=0, skipped=20`.
3. Bootstrap hooks run:
   - A one-time import of **v0 finding reviews** (`technical_details.review`: accepted risk, false positive, verified) into the lifecycle. Log line: `Legacy finding reviews: N imported into lifecycles`. It is idempotent and does not run again on later starts.
   - Knowledge articles are seeded (14).
   - The super-admin bootstrap leaves existing accounts unchanged.
4. The first `GET` on billing or entitlements of a FREE organization materializes the trial
   window anchored at the organization's **creation** date (14 days). Organizations older
   than 14 days show the trial as expired and stay FREE, exactly as in v0. No data is
   purged: retention only applies to organizations with an explicit retention setting.

Measured duration on the rehearsal data set (6 organizations, 9 users, 9 analyses,
17 findings, 18 audit events, 12 reports):

- 010–026 applied in about 0.45 s inside the runner. Per file, via psql: 010 63 ms,
  011 78 ms, 012 114 ms, 013 56 ms, 014 149 ms, 015 117 ms, 016 41 ms, 017 117 ms,
  018 66 ms, 019 46 ms, 026 39 ms.
- The container was healthy about 3 s after start.

The only statements that scale with data are the UPDATEs over `users` (011), `audit_events`
(012) and `findings`/`evidence` (026). Expect seconds, not minutes, at production size.
The health check `start_period` (30 s) covers this.

### What users notice

- Everyone logs in with the **same password**. Existing browser sessions (v0 JWTs, 7-day
  expiry) stay valid, because they are checked against `token_version` and can be revoked
  with "log out everywhere".
- The v0 bootstrap accounts (`contact@`, `admin@`, `noreplay@`, `demo.client@`,
  `client@erppreflight.com`) keep the password that v0 last set from
  `ADMIN_BOOTSTRAP_PASSWORD`. Rotate these passwords and deactivate the accounts you do not
  need (`noreplay@` is a typo account) after the upgrade.
- Organization memberships with the v0 role strings `ADMIN` or `MEMBER` (only possible
  through manual SQL in v0) still work for reading. Endpoints protected by the new role
  model (`ORGANIZATION_OWNER`, `SECURITY_ADMIN`, …) deny them. Assign a new role under
  Organization → Members.
- v0 webhooks keep their plaintext secrets. The new code reads both formats and starts
  delivering signed events again.

---

## 4. Post-deploy checks

```bash
API=https://api.erppreflight.com
curl -fsS $API/health/readiness | jq .      # status healthy; postgres/redis/minio/analysis/clamav up
docker exec erppreflight-postgres psql -U erppreflight -d erppreflight -Atc "
  SELECT 'migrations', count(*) FROM _migrations
  UNION ALL SELECT 'unverified users', count(*) FROM users WHERE email_verified_at IS NULL AND created_at < now() - interval '1 hour'
  UNION ALL SELECT 'audit rows without chain_seq', count(*) FROM audit_events WHERE chain_seq IS NULL
  UNION ALL SELECT 'runtime role privileged', count(*) FROM pg_roles WHERE rolname='erppreflight_app' AND (rolsuper OR rolbypassrls)"
# expected: migrations 20, all other counts 0
docker exec erppreflight-postgres psql -U erppreflight -d erppreflight -Atc \
  "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 1" > /tmp/rowcounts-after.txt
join -t '|' <(sort /var/backups/erppreflight/pre-upgrade/rowcounts-before.txt) <(sort /tmp/rowcounts-after.txt) | awk -F'|' '$3 < $2'
# must print nothing: no v0 table may have fewer rows (n_live_tup is an estimate; use count(*) if in doubt)
```

In the web app:

1. Log in as an existing owner with the old password.
2. Check projects, files (download one), analyses, findings with evidence and reports.
3. Open Audit → Verify. It must say valid.
4. Open Billing / Usage.
5. Run one analysis on an existing project.
6. Sign up a test account and confirm the verification mail arrives from
   `noreply@erppreflight.com`.
7. Confirm a second restart of the API logs `applied=0, skipped=20` and no further legacy
   import.

---

## 5. Rollback

Migrations are **forward-only**; there are no down scripts.

**A. Full rollback (preferred):**

1. Stop the api and web services in Coolify.
2. Restore the pre-upgrade backup:
   ```bash
   docker exec -i erppreflight-postgres psql -U erppreflight -d postgres -c "DROP DATABASE erppreflight WITH (FORCE)" -c "CREATE DATABASE erppreflight"
   docker exec -i erppreflight-postgres pg_restore -U erppreflight -d erppreflight --no-owner --exit-on-error < /var/backups/erppreflight/pre-upgrade/erppreflight-<ts>.dump
   ```
   The `erppreflight_app` role survives the restore. That is harmless: v0 never uses it.
3. Redeploy the **last working deployment** recorded in section 0. Plain `7a76aea` does not
   start (section 0).
4. MinIO objects written after the upgrade (new uploads and reports) remain as unreferenced
   objects. Restore `minio-data-<ts>.tgz` only if a clean bucket state is required.

The rehearsal restored the pre-upgrade dump into a fresh database: row counts were
identical, and the v0 API logged in, listed projects and findings, and served downloads.

**B. Application-only rollback (emergency, no restore):**

The v0 code also starts on the upgraded schema. The rehearsal verified login, project and
finding lists and file download. Everything written by the new version stays in the new
tables. The limitations are:

- Users who sign up while v0 runs have no `email_verified_at` and must verify after the
  next upgrade.
- v0 again resets the five bootstrap accounts to `ADMIN_BOOTSTRAP_PASSWORD` if it is set.

---

## 6. Rehearsal evidence (2026-09-26, sandbox, production settings)

- **Old stack**: `main@7a76aea` with two sandbox-only patches that make it runnable (see
  section 0): `@Global()` on `BillingModule` and a try/catch in the telemetry middleware.
  A third patch lets it use an isolated Redis database. The stack ran against an empty
  database. `CLAMAV_MOCK_MODE=true` was used so that uploads were not all quarantined.
- **Data created through the v0 API**:
  - 6 organizations (ENTERPRISE and FREE) and 9 users, including the v0 bootstrap accounts
    and a mixed-case e-mail address.
  - Legacy memberships with the roles `ADMIN` and `MEMBER`.
  - 4 projects (1 deleted), 10 uploads (1 EICAR, quarantined), 9 completed analyses with
    17 findings and 17 evidence rows.
  - 2 v0 reviews, 1 work item, 1 baseline, 12 reports (JSON, CSV, PDF), 2 API keys,
    2 webhooks, a landscape, a template, feedback, an SAP object, a change set and an agent.
  - 18 hash-chained audit events, written with the v0 algorithm because v0 exposes no route
    that writes them.
- **Upgrade**:
  - `applied=11, skipped=9`.
  - Every value in every pre-existing column was identical before and after the migration
    and first boot (MD5 per table), and every row count was unchanged.
- **Verification**: 76 of 76 API checks and 14 of 14 database checks passed. Details:
  - Every user logged in with the old password, with no verification or 2FA prompt.
  - Files and reports were byte-identical, and each tenant saw only its own data.
    Cross-tenant access returned 403 or 404.
  - `/audit/verify` returned `isValid` for the old and new events of every tenant.
  - The v0 reviews show up in the lifecycle, and carry-over into a new analysis kept them.
  - Billing, usage and entitlements work for old organizations.
  - Tenant writes run as `erppreflight_app`, and a second restart applied nothing.
