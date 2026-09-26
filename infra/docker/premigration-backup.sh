#!/bin/sh
# ==============================================================================
# ERP Preflight — automatic pre-migration backup (one-shot compose service `db-backup`)
#
# Runs before the `migrate` service on every deployment (docker-compose.coolify.yml):
#   postgres (healthy) -> db-backup (this script, exit 0) -> migrate (exit 0) -> api
#
# 1. Compares the migration files shipped with this release (/opt/erppreflight/migrations,
#    copied from packages/database/migrations at image build time) with the `_migrations`
#    table of the target database.
# 2. When at least one migration is pending on a database that already holds data, it writes
#      $PREMIGRATION_BACKUP_DIR/<UTC stamp>/postgres.dump       pg_dump custom format
#                                         /postgres.dump.sha256
#                                         /table_counts.tsv     exact row counts per public table
#                                         /pending.txt          migrations about to be applied
#                                         /manifest.json
#    The dump is accepted only when `pg_restore --list` can read it; any failure exits non-zero,
#    so `migrate` (depends_on: service_completed_successfully) and therefore the API never start
#    on a database that could not be backed up (fail closed).
# 3. Keeps the newest $PREMIGRATION_BACKUP_KEEP backups and deletes older ones.
#
# A fresh database (no `_migrations` table) and a deployment without pending migrations need no
# backup; the script logs that and exits 0. Restore: docs/runbooks/DISASTER_RECOVERY.md §3a.
#
# Environment:
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE   libpq connection (schema owner)
#   PREMIGRATION_BACKUP          auto | always | off   [auto]
#                                auto = only when migrations are pending; off = skip (logged as WARNING)
#   PREMIGRATION_BACKUP_DIR      [/backups]
#   PREMIGRATION_BACKUP_KEEP     number of backups to keep [10]
#   MIGRATIONS_DIR               [/opt/erppreflight/migrations]
#   PG_WAIT_SECONDS              wait for the server [120]
# ==============================================================================
set -eu
umask 077

MODE="${PREMIGRATION_BACKUP:-auto}"
DIR="${PREMIGRATION_BACKUP_DIR:-/backups}"
KEEP="${PREMIGRATION_BACKUP_KEEP:-10}"
MIG_DIR="${MIGRATIONS_DIR:-/opt/erppreflight/migrations}"
WAIT="${PG_WAIT_SECONDS:-120}"

log() { echo "[premigration-backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
die() { echo "[premigration-backup] ERROR: $*" >&2; exit 1; }

case "$MODE" in auto | always | off) ;; *) die "PREMIGRATION_BACKUP must be auto, always or off (got '$MODE')" ;; esac
case "$KEEP" in '' | *[!0-9]*) die "PREMIGRATION_BACKUP_KEEP must be a positive integer" ;; esac
[ "$KEEP" -ge 1 ] || die "PREMIGRATION_BACKUP_KEEP must be >= 1"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

if [ "$MODE" = off ]; then
  log "WARNING: PREMIGRATION_BACKUP=off — migrations will run WITHOUT a pre-migration backup"
  exit 0
fi
[ -d "$MIG_DIR" ] || die "migrations directory $MIG_DIR not found"

i=0
until pg_isready -q -t 2; do
  i=$((i + 2)); [ "$i" -ge "$WAIT" ] && die "PostgreSQL at ${PGHOST:-local socket}:${PGPORT:-5432} not ready after ${WAIT}s"
  sleep 2
done

q() { psql -v ON_ERROR_STOP=1 -qAtX "$@"; }

HAS_TABLE=$(q -c "SELECT to_regclass('public._migrations') IS NOT NULL")
if [ "$HAS_TABLE" != "t" ]; then
  log "database $PGDATABASE has no _migrations table (fresh install) — nothing to back up"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ls -1 "$MIG_DIR" | grep '\.sql$' | LC_ALL=C sort > "$WORK/shipped"
q -c "SELECT name FROM _migrations" | LC_ALL=C sort > "$WORK/applied"
LC_ALL=C comm -23 "$WORK/shipped" "$WORK/applied" > "$WORK/pending"
LC_ALL=C comm -13 "$WORK/shipped" "$WORK/applied" > "$WORK/unknown"
PENDING=$(wc -l < "$WORK/pending" | tr -d ' ')
if [ -s "$WORK/unknown" ]; then
  log "WARNING: the database has applied migrations this release does not ship (newer schema?): $(tr '\n' ' ' < "$WORK/unknown")"
fi

if [ "$PENDING" -eq 0 ] && [ "$MODE" = auto ]; then
  log "no pending migrations ($(wc -l < "$WORK/applied" | tr -d ' ') applied) — no backup needed"
  exit 0
fi
log "$PENDING pending migration(s): $(tr '\n' ' ' < "$WORK/pending")"

mkdir -p "$DIR" || die "cannot create $DIR"
[ -w "$DIR" ] || die "$DIR is not writable by uid $(id -u)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$DIR/$STAMP"
PARTIAL="$DIR/.$STAMP.partial"
rm -rf "$PARTIAL"
mkdir -p "$PARTIAL"

log "pg_dump $PGDATABASE -> $DEST/postgres.dump"
pg_dump --format=custom --compress=6 --file="$PARTIAL/postgres.dump" || { rm -rf "$PARTIAL"; die "pg_dump failed"; }
[ -s "$PARTIAL/postgres.dump" ] || { rm -rf "$PARTIAL"; die "pg_dump produced an empty file"; }
pg_restore --list "$PARTIAL/postgres.dump" > "$PARTIAL/postgres.toc" || { rm -rf "$PARTIAL"; die "pg_restore cannot read the dump"; }
(cd "$PARTIAL" && sha256sum postgres.dump > postgres.dump.sha256)

# Row counts for the restore verification (scripts/restore.sh reads table_counts.tsv).
: > "$PARTIAL/table_counts.tsv"
for t in $(q -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"); do
  printf '%s\t%s\n' "$t" "$(q -c "SELECT count(*) FROM public.\"$t\"")" >> "$PARTIAL/table_counts.tsv"
done
cp "$WORK/pending" "$PARTIAL/pending.txt"

SIZE=$(wc -c < "$PARTIAL/postgres.dump" | tr -d ' ')
SHA=$(cut -d' ' -f1 < "$PARTIAL/postgres.dump.sha256")
TABLES=$(wc -l < "$PARTIAL/table_counts.tsv" | tr -d ' ')
SERVER=$(q -c "SHOW server_version")
FIRST=$(head -n 1 "$WORK/pending")
cat > "$PARTIAL/manifest.json" <<EOF
{
  "kind": "pre-migration",
  "createdAt": "$STAMP",
  "database": "$PGDATABASE",
  "serverVersion": "$SERVER",
  "pgDump": "$(pg_dump --version | sed 's/"/\\"/g')",
  "mode": "$MODE",
  "pendingMigrations": $PENDING,
  "firstPendingMigration": "$FIRST",
  "postgresDump": { "file": "postgres.dump", "bytes": $SIZE, "sha256": "$SHA" },
  "tables": $TABLES
}
EOF
mv "$PARTIAL" "$DEST"
log "backup OK: $DEST ($SIZE bytes, sha256 $SHA, $TABLES tables)"

# Retention: keep the newest $KEEP backup directories (names sort chronologically).
COUNT=0
for d in $(ls -1 "$DIR" | grep -E '^[0-9]{8}T[0-9]{6}Z$' | LC_ALL=C sort -r); do
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -gt "$KEEP" ]; then
    rm -rf "${DIR:?}/$d"
    log "retention: removed $d (keeping $KEEP)"
  fi
done
exit 0
