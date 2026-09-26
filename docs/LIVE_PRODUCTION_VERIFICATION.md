# Live Production Verification

> Spec C §67 / §75 #4.

| Field | Value |
|---|---|
| Commit | `6303f1d` on `claude/sharp-mendel-xg6cus` |
| Date | 2026-09-26 |
| Deployment checked | **None.** |
| Result | **No production deployment was verified.** |

## 1. Status

**Nothing in this repository state has been deployed to erppreflight.com, and no check in this document has been run
against production.** The deployment currently running on the Hostinger VPS (if any) predates this branch and has not
been inspected. All verification to date ran on a local production-mode stack (`docs/E2E_TEST_REPORT.md`).

The C §67 checklist below is therefore open. The owner runs the procedure after the next deployment and records
the results in §6.

## 2. Before deploying (owner)

1. Rotate the leaked Coolify API token (prefix `13|wilw…`) and change or disable the passwords of
   `contact@erppreflight.com` and `demo.client@erppreflight.com` (`docs/runbooks/SECRET_ROTATION.md` §1).
2. In Coolify, set compose path `/docker-compose.coolify.yml` and the required variables
   (`AI_AGENT_HANDOVER_AND_ARCHITECTURE.md` §4.4, `.env.coolify.example`): `POSTGRES_PASSWORD`, `JWT_SECRET`,
   `MASTER_ENCRYPTION_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `MAIL_TRANSPORT`, `MAIL_FROM` + provider credentials,
   `APP_PUBLIC_URL`, `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL` (web **build arg**), `NEXT_PUBLIC_APP_URL`,
   `NEXT_PUBLIC_LEGAL_*`. Optional: `STRIPE_*`, `SENTRY_DSN`, `OTEL_*`, `METRICS_TOKEN`, `ENABLE_API_REFERENCE`.
   The API refuses to start in production when a required secret is missing or a known default.
3. Take a backup if a deployment already exists: `scripts/backup.sh` on the VPS (`docs/runbooks/DISASTER_RECOVERY.md`).
   Migrations 011–019 are new relative to `main`; they are forward-only.
4. Check VPS memory: summed container limits are about 13 GB (ClamAV alone 3 GB).

## 3. Procedure after deploying

Set `WEB=https://erppreflight.com` and `API=https://api.erppreflight.com`.

### 3.1 Public site

```bash
curl -sI http://erppreflight.com | head -3            # expect 301/308 to https://
curl -sI $WEB/ | grep -i -E '^(HTTP|location)'        # expect redirect to /en or /de
curl -s -o /dev/null -w '%{http_code}\n' $WEB/en      # 200
curl -s -o /dev/null -w '%{http_code}\n' $WEB/de      # 200
curl -s $WEB/robots.txt                               # disallows private app routes, lists the sitemap
curl -s $WEB/sitemap.xml | head -20                   # sitemap index: pages.xml, knowledge.xml, sap-objects-N.xml
curl -s $WEB/api/health                               # web health
curl -sI $WEB/en | grep -i content-security-policy    # nonce-based CSP present
```

### 3.2 API health

```bash
curl -s $API/health/liveness
# {"status":"ok","service":"erppreflight-api","version":"1.0.0","timestamp":"…"}
curl -s -w '\nHTTP %{http_code}\n' $API/health/readiness
```

Expected readiness body (HTTP 200):

```json
{ "status": "healthy",
  "dependencies": {
    "postgres": { "status": "up" }, "redis": { "status": "up" }, "minio": { "status": "up" },
    "analysis": { "status": "up", "engines": 19 }, "clamav": { "status": "up" } } }
```

- `"degraded"` (HTTP 200): Postgres and Redis are up but MinIO, analysis or ClamAV is down. After a restart ClamAV
  needs several minutes to load signatures; uploads fail closed (503) meanwhile (`docs/runbooks/CLAMAV_DOWN.md`).
- `"unhealthy"` (HTTP 503): Postgres or Redis is down.
- `clamav.status` must never be `"mock_mode"` in production.
- OpenAPI: `curl -s -o /dev/null -w '%{http_code}\n' $API/api/v1/openapi.json` returns 200 only when
  `ENABLE_API_REFERENCE=true` (or `ENABLE_SWAGGER=true`); otherwise 404 by design.
- Metrics: `curl -s -H "Authorization: Bearer $METRICS_TOKEN" $API/api/v1/metrics | head` (404 without token in production).

### 3.3 Knowledge sync (once after the first deploy)

Either as super admin through the API:

```bash
curl -s -X POST $API/api/v1/knowledge-graph/admin/sync -H "Authorization: Bearer $SUPER_ADMIN_JWT"
curl -s $API/api/v1/knowledge-graph/admin/sync-runs -H "Authorization: Bearer $SUPER_ADMIN_JWT" | head -c 600
```

or inside the API container (schema-owner `DATABASE_URL`, which the container already has):

```bash
docker exec erppreflight-api node apps/api/dist/src/modules/knowledge-graph/cli/knowledge-sync.cli.js --json
```

Expected (local reference run): 13 files, 68,627 objects, 341,247 release states, 10,160 successor edges, about 37 s;
a second run is recorded as NOOP. Afterwards `curl -s "$WEB/sitemap.xml"` lists `sap-objects-N.xml` children
(655 SEO-gate-passing objects in the local run). The weekly job `knowledge-sync-weekly` (`KNOWLEDGE_SYNC_CRON`,
default `17 3 * * 1` UTC) keeps it current.

### 3.4 Functional smoke

`scripts/e2e-live-smoke.sh` creates two throwaway tenants and reads verification/reset/invitation mails from the
dev mailbox. It needs, for the duration of the run, `MAIL_TRANSPORT=dev` and `MAIL_DEV_OUTBOX_TOKEN` (≥ 24 chars) on
the production API. Set them, redeploy the API, then:

```bash
API_BASE_URL=$API MAIL_DEV_OUTBOX_TOKEN=<token> bash scripts/e2e-live-smoke.sh     # expect 77/77, "ALL CHECKS PASSED"
WEB_URL=$WEB API_URL=$API MAIL_DEV_OUTBOX_TOKEN=<token> node scripts/e2e-ui-smoke.cjs
WEB_URL=$WEB node scripts/e2e-public-smoke.cjs
WEB_URL=$WEB API_BASE_URL=$API node scripts/e2e-tools-smoke.cjs
```

Then restore the real `MAIL_TRANSPORT` and remove `MAIL_DEV_OUTBOX_TOKEN`. If switching the mail transport is not
acceptable, run the production-safe subset by hand with a real mailbox: sign up, click the verification mail, log in,
enable 2FA, create a project, upload `tests/fixtures/known_bad_billing_opd.xml`, run OPD Guard (expect exactly the
finding `OPD_DETERMINATION_STEP_MISSING`), open the finding (evidence with
SHA-256), export PDF, log out; with a second account confirm `GET $API/api/v1/projects/<A's id>` → 403/404.

Clean up the throwaway tenants afterwards (super admin console or `DELETE /api/v1/organizations/current` as each
test owner).

### 3.5 Failure behaviour (C §67 "Failure")

`docker stop erppreflight-api`, reload `$WEB/dashboard`: the page must show an error state with a retry action, never
data or a success message. `docker start erppreflight-api`, confirm readiness returns to `healthy`.

## 4. Rollback

1. Redeploy the previous commit/tag in Coolify.
2. Migrations are forward-only. If the previous version cannot run on the migrated schema, restore the pre-deploy
   backup: `scripts/restore.sh` (`docs/runbooks/DISASTER_RECOVERY.md`), then redeploy the previous tag.
3. Re-run §3.2.

## 5. C §67 checklist

| Area | Checks | Status |
|---|---|---|
| Public | HTTPS, redirect, homepage, robots, sitemap | not run |
| API | health, readiness, OpenAPI | not run |
| Auth | signup, verify, login, logout, reset, 2FA | not run |
| Project | create, edit, invite member | not run |
| Artifact | upload, scan, redact, parse | not run |
| Analysis | submit, queue, Python, persist, display finding | not run |
| Report | generate, download | not run |
| Tenant | tenant A cannot read tenant B | not run |
| Failure | API stopped → frontend shows error, never mock success | not run |

## 6. Results (owner fills in after deploy)

| Date | Commit deployed | Readiness | Smoke results | Notes |
|---|---|---|---|---|
| | | | | |
