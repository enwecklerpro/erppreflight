# Runbook — Disaster Recovery (PostgreSQL + MinIO restore)

> Spec 12.7, 13.11 "working backups", 20.30, C §55. Tools: `scripts/backup.sh`, `scripts/restore.sh`.
> A backup counts as working only after a restore of it was verified. The `live-e2e` CI job
> performs a full drill on every run (backup → drop DB + empty buckets → restore → verify →
> API login + byte-identical file download); see `docs/E2E_TEST_REPORT.md` for the last result.

## 0. Targets

| | Value | Notes |
|---|---|---|
| RPO | ≤ 24 h (daily backup) | Lower it with a more frequent cron; there is no WAL archiving / PITR yet (KNOWN_LIMITATIONS O2) |
| RTO | ≈ 30–60 min on the same VPS | Dominated by ClamAV start (3–8 min) and image pulls on a new host |
| Scope | Postgres database (schema, data, RLS policies, grants), MinIO buckets `erppreflight-quarantine`, `-clean`, `-reports` | Redis is **not** backed up: it only holds BullMQ jobs; runs that were in flight must be re-launched |

## 1. Scheduled backups (set up once on the VPS)

```bash
sudo mkdir -p /var/backups/erppreflight && sudo chmod 700 /var/backups/erppreflight
sudo install -m 600 /dev/null /opt/erppreflight/backup.env
sudo tee /opt/erppreflight/backup.env >/dev/null <<'EOF'
POSTGRES_USER=erppreflight
POSTGRES_DB=erppreflight
S3_ACCESS_KEY=<same value as in Coolify>
S3_SECRET_KEY=<same value as in Coolify>
BACKUP_ROOT=/var/backups/erppreflight
BACKUP_RETENTION_DAYS=14
EOF
# daily at 02:17 UTC
echo '17 2 * * * root set -a; . /opt/erppreflight/backup.env; set +a; /opt/erppreflight/scripts/backup.sh >> /var/log/erppreflight-backup.log 2>&1' \
  | sudo tee /etc/cron.d/erppreflight-backup
```

With Coolify you can instead create a **Scheduled Task** on the server running the same command.
`/opt/erppreflight` is a checkout of this repository (only `scripts/` is needed).

Off-site copy (required for real disaster recovery — the VPS is a single point of failure):

```bash
# example with rclone to any S3-compatible bucket (encrypted remote recommended: rclone crypt)
rclone sync /var/backups/erppreflight offsite-crypt:erppreflight-backups --transfers 4
```

Check the last backup: `ls -1 /var/backups/erppreflight | tail -3` and `cat <dir>/manifest.json`.

## 2. Decide what happened

| Situation | Action |
|---|---|
| Accidental data change in one tenant | Restore into a **separate** database (`RESTORE_DB=erppreflight_restore`) and copy the rows back with SQL — do not overwrite production |
| Database lost/corrupted, MinIO fine | §3 with `RESTORE_SKIP_S3=1` |
| Both lost / new VPS | §4 |

## 3. Restore on the existing host

```bash
cd /opt/erppreflight
docker compose -f docker-compose.coolify.yml stop api web        # stop writers (or stop them in Coolify)
set -a; . /opt/erppreflight/backup.env; set +a
BK=$(ls -1d /var/backups/erppreflight/20*Z | tail -1); echo "$BK"; cat "$BK/manifest.json"
CONFIRM_RESTORE=yes RESTORE_DB=erppreflight scripts/restore.sh "$BK"
docker compose -f docker-compose.coolify.yml start api web
```

`restore.sh` exits non-zero unless: the dump SHA-256 matches, `pg_restore` succeeds, **every
table's row count equals the count recorded at backup time**, RLS tables/policies exist, and each
bucket has at least the backed-up number of objects.

After the API is up:

```bash
curl -s https://api.erppreflight.com/health/readiness            # all dependencies "up"
API_BASE_URL=https://api.erppreflight.com bash scripts/e2e-live-smoke.sh   # creates 2 throwaway tenants
```

## 4. Restore on a new host

1. Provision the VPS, install Docker + Coolify, restore DNS (DEPLOYMENT_GUIDE.md §2).
2. Deploy the stack with the **same secrets** as before (`JWT_SECRET` can change — users log in again;
   `MASTER_ENCRYPTION_KEY` should stay the same so redaction masks stay consistent).
3. Wait until `postgres` and `minio` are healthy, stop `api` and `web`.
4. Copy the backup directory from the off-site store and run §3.

## 5. Manual equivalent (no scripts)

```bash
# backup
docker exec erppreflight-postgres pg_dump -U erppreflight -d erppreflight -Fc > erppreflight.dump
sha256sum erppreflight.dump > erppreflight.dump.sha256
# row counts to compare later
docker exec erppreflight-postgres psql -U erppreflight -d erppreflight -Atc \
  "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 1"   # estimate; use count(*) for exact
# restore
sha256sum -c erppreflight.dump.sha256
docker exec erppreflight-postgres psql -U erppreflight -d postgres -c 'DROP DATABASE erppreflight WITH (FORCE)'
docker exec erppreflight-postgres psql -U erppreflight -d postgres -c 'CREATE DATABASE erppreflight'
docker exec -i erppreflight-postgres pg_restore -U erppreflight -d erppreflight --exit-on-error < erppreflight.dump
# MinIO (mc ships in the MinIO image used by the stack)
docker run --rm --network erppreflight-network -e MC_HOST_s=http://<AK>:<SK>@erppreflight-minio:9000 \
  -v "$PWD/minio:/backup" --entrypoint mc elestio/minio:latest mirror --overwrite s/erppreflight-clean /backup/erppreflight-clean
```

## 6. Drill record

Record every drill (date, backup dir, tables/rows verified, objects verified, result) in
`docs/E2E_TEST_REPORT.md` §4. Minimum cadence: monthly on the VPS against a scratch database
(`RESTORE_DB=erppreflight_drill RESTORE_BUCKET_SUFFIX=-drill`), plus the automatic CI drill.
Remove the scratch database and `*-drill` buckets afterwards.
