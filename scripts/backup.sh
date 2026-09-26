#!/usr/bin/env bash
# ==============================================================================
# ERP Preflight — Backup of PostgreSQL + MinIO for the docker-compose.coolify.yml stack
# (spec 12.7, 13.11 "working backups", 20.30 backup integrity).
#
# Produces   $BACKUP_ROOT/<UTC timestamp>/
#              postgres.dump            pg_dump custom format (all schema, data, RLS policies, grants)
#              postgres.dump.sha256
#              table_counts.tsv         exact row count per public table at backup time
#              minio/<bucket>/...       mirror of every bucket
#              minio_counts.tsv         object count + bytes per bucket
#              manifest.json            summary (what, when, sizes, hashes)
# and deletes backup directories older than $BACKUP_RETENTION_DAYS.
#
# Runs on the VPS host (cron / Coolify "Scheduled Task" on the server) with only `docker` and
# coreutils: pg_dump runs INSIDE the postgres container (local socket, no password on the command
# line) and the MinIO client `mc` runs from the MinIO image already used by the stack, so no
# database or S3 port has to be published.
#
# Environment (defaults match docker-compose.coolify.yml):
#   BACKUP_ROOT               [/var/backups/erppreflight]
#   BACKUP_RETENTION_DAYS     [14]
#   PG_CONTAINER              [erppreflight-postgres]
#   POSTGRES_USER             [erppreflight]
#   POSTGRES_DB               [erppreflight]
#   S3_ACCESS_KEY / S3_SECRET_KEY   MinIO credentials (required unless BACKUP_SKIP_S3=1)
#   S3_BUCKETS                ["erppreflight-quarantine erppreflight-clean erppreflight-reports"]
#   MC_IMAGE                  image providing `mc` [the digest-pinned elestio/minio image of docker-compose.coolify.yml]
#   MC_NETWORK                docker network to reach MinIO [erppreflight-network]
#   MC_ENDPOINT               MinIO URL inside that network [http://erppreflight-minio:9000]
#   BACKUP_SKIP_S3=1          database only
#
# Example crontab (daily 02:17 UTC, env file readable by root only):
#   17 2 * * * root set -a; . /opt/erppreflight/backup.env; set +a; /opt/erppreflight/scripts/backup.sh >> /var/log/erppreflight-backup.log 2>&1
# ==============================================================================
set -euo pipefail
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/erppreflight}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
PG_CONTAINER="${PG_CONTAINER:-erppreflight-postgres}"
PGU="${POSTGRES_USER:-erppreflight}"
PGD="${POSTGRES_DB:-erppreflight}"
BUCKETS="${S3_BUCKETS:-erppreflight-quarantine erppreflight-clean erppreflight-reports}"
MC_IMAGE="${MC_IMAGE:-elestio/minio:latest@sha256:25348a257f1ece1b192f25f6cd9854618fa86422ac87b494b5d4e629c556d4bd}"
MC_NETWORK="${MC_NETWORK:-erppreflight-network}"
MC_ENDPOINT="${MC_ENDPOINT:-http://erppreflight-minio:9000}"

log() { echo "[backup] $(date -u +%FT%TZ) $*"; }
die() { echo "[backup] ERROR: $*" >&2; exit 1; }

mkdir -p "$BACKUP_ROOT"
exec 9>"$BACKUP_ROOT/.lock"
flock -n 9 || die "another backup is running (lock $BACKUP_ROOT/.lock)"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
PARTIAL="$DEST.partial"
mkdir -p "$PARTIAL"
trap 'rm -rf "$PARTIAL"' EXIT

psql_c() { docker exec -i "$PG_CONTAINER" psql -U "$PGU" -d "$PGD" -v ON_ERROR_STOP=1 -qAt "$@"; }
# MC_HOST_<alias> URL with URL-encoded credentials (secrets may contain / @ : characters).
mc_host_url() {
  python3 -c 'import sys, urllib.parse as u
e, a, s = sys.argv[1:4]; scheme, rest = e.split("://", 1)
print(f"{scheme}://{u.quote(a, safe=str())}:{u.quote(s, safe=str())}@{rest}")' \
    "$MC_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
}

# ---------------------------------------------------------------- PostgreSQL
log "pg_dump $PGD from container $PG_CONTAINER"
docker exec "$PG_CONTAINER" pg_dump -U "$PGU" -d "$PGD" --format=custom --compress=6 > "$PARTIAL/postgres.dump"
[ -s "$PARTIAL/postgres.dump" ] || die "pg_dump produced an empty file"
# A dump is only accepted if pg_restore can read its table of contents.
docker exec -i "$PG_CONTAINER" pg_restore --list < "$PARTIAL/postgres.dump" > "$PARTIAL/postgres.toc" \
  || die "pg_restore cannot read the dump"
(cd "$PARTIAL" && sha256sum postgres.dump > postgres.dump.sha256)

# Exact row counts (the restore drill compares against these). The dump is a consistent
# snapshot; counts are taken right after it, so on a live system writes in between can make
# them differ slightly — the drill runs against a quiesced copy.
TABLES=$(psql_c -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
: > "$PARTIAL/table_counts.tsv"
for t in $TABLES; do
  printf '%s\t%s\n' "$t" "$(psql_c -c "SELECT count(*) FROM public.\"$t\"")" >> "$PARTIAL/table_counts.tsv"
done
log "postgres: $(wc -l < "$PARTIAL/table_counts.tsv") tables, $(awk -F'\t' '{s+=$2} END {print s+0}' "$PARTIAL/table_counts.tsv") rows, dump $(stat -c %s "$PARTIAL/postgres.dump") bytes"

# ---------------------------------------------------------------- MinIO
: > "$PARTIAL/minio_counts.tsv"
if [ "${BACKUP_SKIP_S3:-0}" != "1" ]; then
  : "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required (or BACKUP_SKIP_S3=1)}"
  : "${S3_SECRET_KEY:?S3_SECRET_KEY is required (or BACKUP_SKIP_S3=1)}"
  mkdir -p "$PARTIAL/minio"
  # Credentials travel as an env var of a short-lived container, never on a command line.
  MC_HOST_URL="$(mc_host_url)"
  for b in $BUCKETS; do
    mkdir -p "$PARTIAL/minio/$b"
    log "mirroring bucket $b"
    docker run --rm --network "$MC_NETWORK" -e "MC_HOST_src=$MC_HOST_URL" \
      -v "$PARTIAL/minio:/backup" --user "$(id -u):$(id -g)" -e HOME=/tmp \
      --entrypoint mc "$MC_IMAGE" --quiet mirror --overwrite "src/$b" "/backup/$b" >/dev/null
    n=$(find "$PARTIAL/minio/$b" -type f | wc -l | tr -d ' ')
    bytes=$(find "$PARTIAL/minio/$b" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')
    printf '%s\t%s\t%s\n' "$b" "$n" "$bytes" >> "$PARTIAL/minio_counts.tsv"
    log "  $b: $n objects, $bytes bytes"
  done
fi

# ---------------------------------------------------------------- manifest
python3 - "$PARTIAL" "$STAMP" "$PGD" <<'PY' 2>/dev/null || true
import json, sys, pathlib
d = pathlib.Path(sys.argv[1])
tables = [l.split('\t') for l in (d / 'table_counts.tsv').read_text().splitlines() if l]
buckets = [l.split('\t') for l in (d / 'minio_counts.tsv').read_text().splitlines() if l]
json.dump({
    'created_utc': sys.argv[2], 'database': sys.argv[3],
    'postgres_dump_sha256': (d / 'postgres.dump.sha256').read_text().split()[0],
    'postgres_dump_bytes': (d / 'postgres.dump').stat().st_size,
    'table_rows': {t: int(n) for t, n in tables},
    'buckets': {b: {'objects': int(n), 'bytes': int(s)} for b, n, s in buckets},
}, open(d / 'manifest.json', 'w'), indent=2, sort_keys=True)
PY

mv "$PARTIAL" "$DEST"
trap - EXIT
log "backup complete: $DEST"

# ---------------------------------------------------------------- retention
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime "+$RETENTION" -print0 \
  | while IFS= read -r -d '' old; do log "retention: removing $old"; rm -rf "$old"; done
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mmin +720 -exec rm -rf {} + 2>/dev/null || true
echo "$DEST"
