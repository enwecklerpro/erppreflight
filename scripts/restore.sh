#!/usr/bin/env bash
# ==============================================================================
# ERP Preflight — Restore a backup produced by scripts/backup.sh and VERIFY it
# (spec 12.7 restore drills, 20.30 "backups are not successful only because a job returned 0").
#
#   scripts/restore.sh <backup-dir>
#
# Steps: verify the dump's SHA-256 -> (re)create the target database -> pg_restore ->
# compare every table's row count with table_counts.tsv -> mirror the bucket copies back to
# MinIO -> compare object counts with minio_counts.tsv. Exits non-zero on any mismatch.
#
# DESTRUCTIVE: the target database is dropped and recreated. Stop the `api` service first
# (docker compose -f docker-compose.coolify.yml stop api web) so nothing writes meanwhile.
#
# Environment (defaults match docker-compose.coolify.yml / scripts/backup.sh):
#   CONFIRM_RESTORE=yes         required safety switch
#   RESTORE_DB                  target database [POSTGRES_DB or erppreflight]
#   PG_CONTAINER [erppreflight-postgres]   POSTGRES_USER [erppreflight]
#   RESTORE_BUCKET_SUFFIX       restore bucket <b> into <b><suffix> (e.g. "-restored") [none]
#   RESTORE_SKIP_S3=1           database only
#   S3_ACCESS_KEY / S3_SECRET_KEY, MC_IMAGE, MC_NETWORK, MC_ENDPOINT   as in backup.sh
# ==============================================================================
set -euo pipefail

SRC="${1:?usage: scripts/restore.sh <backup-dir>}"
[ -f "$SRC/postgres.dump" ] || { echo "not a backup directory: $SRC" >&2; exit 2; }
[ "${CONFIRM_RESTORE:-}" = "yes" ] || { echo "Refusing: set CONFIRM_RESTORE=yes (the target database is dropped)" >&2; exit 2; }

PG_CONTAINER="${PG_CONTAINER:-erppreflight-postgres}"
PGU="${POSTGRES_USER:-erppreflight}"
DB="${RESTORE_DB:-${POSTGRES_DB:-erppreflight}}"
SUFFIX="${RESTORE_BUCKET_SUFFIX:-}"
MC_IMAGE="${MC_IMAGE:-elestio/minio:latest}"
MC_NETWORK="${MC_NETWORK:-erppreflight-network}"
MC_ENDPOINT="${MC_ENDPOINT:-http://erppreflight-minio:9000}"
FAILS=0

log()  { echo "[restore] $(date -u +%FT%TZ) $*"; }
fail() { echo "[restore] MISMATCH: $*" >&2; FAILS=$((FAILS + 1)); }
psql_db() { docker exec -i "$PG_CONTAINER" psql -U "$PGU" -d "$1" -v ON_ERROR_STOP=1 -qAt "${@:2}"; }
mc_host_url() {
  python3 -c 'import sys, urllib.parse as u
e, a, s = sys.argv[1:4]; scheme, rest = e.split("://", 1)
print(f"{scheme}://{u.quote(a, safe=str())}:{u.quote(s, safe=str())}@{rest}")' \
    "$MC_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
}

# ---------------------------------------------------------------- integrity
(cd "$SRC" && sha256sum --check --quiet postgres.dump.sha256) || { echo "[restore] dump checksum mismatch — backup corrupted" >&2; exit 1; }
log "dump checksum OK ($(cut -c1-16 "$SRC/postgres.dump.sha256"))"

# ---------------------------------------------------------------- database
log "recreating database $DB (container $PG_CONTAINER)"
psql_db postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null
psql_db postgres -c "CREATE DATABASE \"$DB\"" >/dev/null
log "pg_restore -> $DB"
docker exec -i "$PG_CONTAINER" pg_restore -U "$PGU" -d "$DB" --exit-on-error --no-password < "$SRC/postgres.dump"

while IFS=$'\t' read -r table expected; do
  [ -n "$table" ] || continue
  actual=$(psql_db "$DB" -c "SELECT count(*) FROM public.\"$table\"")
  [ "$actual" = "$expected" ] || fail "table $table: backup $expected rows, restored $actual"
done < "$SRC/table_counts.tsv"
TABLES=$(wc -l < "$SRC/table_counts.tsv" | tr -d ' ')
ROWS=$(awk -F'\t' '{s+=$2} END {print s+0}' "$SRC/table_counts.tsv")
log "row counts verified for $TABLES tables ($ROWS rows)"

RLS=$(psql_db "$DB" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relforcerowsecurity")
POL=$(psql_db "$DB" -c "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")
log "restored RLS: $RLS tables with ENABLE+FORCE RLS, $POL policies"
[ "$RLS" -gt 0 ] || fail "no RLS-protected tables after restore"

# ---------------------------------------------------------------- object storage
if [ "${RESTORE_SKIP_S3:-0}" != "1" ] && [ -s "$SRC/minio_counts.tsv" ]; then
  : "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required (or RESTORE_SKIP_S3=1)}"
  : "${S3_SECRET_KEY:?S3_SECRET_KEY is required (or RESTORE_SKIP_S3=1)}"
  MC_HOST_URL="$(mc_host_url)"
  mc() { docker run --rm --network "$MC_NETWORK" -e "MC_HOST_dst=$MC_HOST_URL" -e HOME=/tmp \
           -v "$SRC/minio:/backup:ro" --entrypoint mc "$MC_IMAGE" --quiet "$@"; }
  while IFS=$'\t' read -r bucket objects _bytes; do
    [ -n "$bucket" ] || continue
    target="$bucket$SUFFIX"
    log "restoring bucket $bucket -> $target"
    mc mb --ignore-existing "dst/$target" >/dev/null
    [ "$objects" = 0 ] || mc mirror --overwrite "/backup/$bucket" "dst/$target" >/dev/null
    actual=$(mc ls --recursive "dst/$target" | wc -l | tr -d ' ')
    [ "$actual" -ge "$objects" ] || fail "bucket $target: backup $objects objects, restored $actual"
    log "  $target: $actual objects (backup: $objects)"
  done < "$SRC/minio_counts.tsv"
fi

if [ "$FAILS" -gt 0 ]; then
  echo "[restore] $FAILS verification(s) FAILED" >&2
  exit 1
fi
log "RESTORE VERIFIED: $SRC -> database $DB${SUFFIX:+, buckets *$SUFFIX}"
