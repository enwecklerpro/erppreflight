#!/usr/bin/env bash
# ==============================================================================
# ERP Preflight — Database migration check (spec 12.4 "DB migration check", 12.6)
#
# Verifies, against a real PostgreSQL 16 + pgvector server:
#   1. every migration in packages/database/migrations applies cleanly to a FRESH database
#      through the production runner (runMigrations from @erppreflight/database);
#   2. a second run is a no-op (applied=0, all skipped) — runner idempotency;
#   3. `pg_dump --schema-only` of the same database is byte-identical when taken twice;
#   4. a second, independent fresh database migrated the same way yields an identical
#      schema dump (no ordering / randomness drift between environments);
#   5. every table that carries an organization_id column has Row-Level Security
#      ENABLED and FORCED and at least one policy (AGENTS.md §4.4), and the RLS runtime
#      role erppreflight_app exists without BYPASSRLS/SUPERUSER.
#
# Requires: node (with packages/database built: `pnpm --filter @erppreflight/database build`),
#           psql, pg_dump (client major version >= server major version).
#
# Environment:
#   PG_ADMIN_URL   connection URL of a role that may CREATE/DROP DATABASE, WITHOUT a database
#                  path, e.g. postgres://erppreflight:secret@localhost:5432  (required)
#   MIGCHECK_DB_PREFIX  prefix for the throwaway databases (default erppreflight_migcheck)
#   MIGCHECK_KEEP=1     keep the throwaway databases afterwards (debugging)
#   MIGCHECK_OUT        directory for the schema dumps (default: mktemp)
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${PG_ADMIN_URL:?PG_ADMIN_URL is required (postgres://user:pass@host:port, no database)}"
PG_ADMIN_URL="${PG_ADMIN_URL%/}"
PREFIX="${MIGCHECK_DB_PREFIX:-erppreflight_migcheck}"
DB_A="${PREFIX}_a"
DB_B="${PREFIX}_b"
OUT="${MIGCHECK_OUT:-$(mktemp -d)}"
mkdir -p "$OUT"
MIGRATIONS_DIR="$ROOT/packages/database/migrations"
DB_DIST="$ROOT/packages/database/dist/index.js"
PG_DUMP="${PG_DUMP:-pg_dump}"
FAILS=0

log()  { echo "[migration-check] $*"; }
fail() { echo "[migration-check] FAIL: $*" >&2; FAILS=$((FAILS + 1)); }

[ -f "$DB_DIST" ] || { echo "packages/database is not built ($DB_DIST missing). Run: pnpm --filter @erppreflight/database build" >&2; exit 2; }

EXPECTED=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
log "migrations on disk: $EXPECTED ($MIGRATIONS_DIR)"

psql_admin() { psql "$PG_ADMIN_URL/postgres" -v ON_ERROR_STOP=1 -qAt "$@"; }

recreate_db() {
  psql_admin -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)"
  psql_admin -c "CREATE DATABASE \"$1\""
}

cleanup() {
  if [ "${MIGCHECK_KEEP:-0}" != "1" ]; then
    psql_admin -c "DROP DATABASE IF EXISTS \"$DB_A\" WITH (FORCE)" >/dev/null 2>&1 || true
    psql_admin -c "DROP DATABASE IF EXISTS \"$DB_B\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Runs the production migration runner; prints "applied=<n> skipped=<n>".
run_migrations() {
  node -e '
    const { runMigrations } = require(process.argv[1]);
    runMigrations(process.argv[2], process.argv[3])
      .then((r) => {
        if (!r.success) { console.error("runner reported success=false", r); process.exit(1); }
        console.log(`applied=${r.applied.length} skipped=${r.skipped.length}`);
        process.exit(0);
      })
      .catch((e) => { console.error("migration error:", e && e.message); process.exit(1); });
  ' "$DB_DIST" "$PG_ADMIN_URL/$1" "$MIGRATIONS_DIR"
}

# Schema-only dump with the random `\restrict` token (pg_dump >= 16.10) removed so that
# two dumps of the same schema are comparable.
dump_schema() {
  "$PG_DUMP" --schema-only --no-comments "$PG_ADMIN_URL/$1" \
    | grep -Ev '^\\(un)?restrict ' > "$2"
}

# --- 1. fresh apply ----------------------------------------------------------
recreate_db "$DB_A"
R1=$(run_migrations "$DB_A") || { fail "first migration run on fresh database failed"; exit 1; }
log "run 1 (fresh $DB_A): $R1"
[ "$R1" = "applied=$EXPECTED skipped=0" ] || fail "expected applied=$EXPECTED skipped=0 on a fresh database, got '$R1'"

# --- 2. second run is a no-op ------------------------------------------------
R2=$(run_migrations "$DB_A") || { fail "second migration run failed"; exit 1; }
log "run 2 (same db):   $R2"
[ "$R2" = "applied=0 skipped=$EXPECTED" ] || fail "second run must be a no-op, got '$R2'"

ROWS=$(psql "$PG_ADMIN_URL/$DB_A" -qAt -c "SELECT count(*) FROM _migrations")
[ "$ROWS" = "$EXPECTED" ] || fail "_migrations has $ROWS rows, expected $EXPECTED"

# --- 3. deterministic dump ---------------------------------------------------
dump_schema "$DB_A" "$OUT/schema_a1.sql"
dump_schema "$DB_A" "$OUT/schema_a2.sql"
if cmp -s "$OUT/schema_a1.sql" "$OUT/schema_a2.sql"; then
  log "pg_dump --schema-only is deterministic ($(wc -l < "$OUT/schema_a1.sql") lines, sha256 $(sha256sum "$OUT/schema_a1.sql" | cut -c1-16))"
else
  fail "two schema dumps of the same database differ"; diff "$OUT/schema_a1.sql" "$OUT/schema_a2.sql" | head -40 || true
fi

# --- 4. independent fresh database yields the identical schema ---------------
recreate_db "$DB_B"
RB=$(run_migrations "$DB_B") || { fail "migration run on second fresh database failed"; exit 1; }
log "run 3 (fresh $DB_B): $RB"
dump_schema "$DB_B" "$OUT/schema_b.sql"
if cmp -s "$OUT/schema_a1.sql" "$OUT/schema_b.sql"; then
  log "independent fresh databases produce identical schemas"
else
  fail "schema drift between two fresh migrations"; diff "$OUT/schema_a1.sql" "$OUT/schema_b.sql" | head -40 || true
fi

# --- 5. tenant tables are protected by FORCED RLS -----------------------------
UNPROTECTED=$(psql "$PG_ADMIN_URL/$DB_A" -qAt -F ' ' -c "
  SELECT c.relname,
         CASE WHEN c.relrowsecurity THEN 'rls=on' ELSE 'rls=OFF' END,
         CASE WHEN c.relforcerowsecurity THEN 'force=on' ELSE 'force=OFF' END,
         'policies=' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped)
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname))
   ORDER BY c.relname")
TENANT_TABLES=$(psql "$PG_ADMIN_URL/$DB_A" -qAt -c "
  SELECT count(DISTINCT c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')")
if [ -n "$UNPROTECTED" ]; then
  fail "tenant tables without ENABLE+FORCE RLS and a policy:"; echo "$UNPROTECTED" | sed 's/^/    /' >&2
else
  log "all $TENANT_TABLES tenant tables (organization_id) have ENABLE+FORCE RLS and >=1 policy"
fi

ROLE=$(psql "$PG_ADMIN_URL/$DB_A" -qAt -c "SELECT rolsuper::text || ',' || rolbypassrls::text FROM pg_roles WHERE rolname = 'erppreflight_app'")
[ "$ROLE" = "false,false" ] && log "runtime role erppreflight_app: NOSUPERUSER NOBYPASSRLS" \
  || fail "runtime role erppreflight_app missing or privileged (super,bypassrls=$ROLE)"

log "schema dumps kept in $OUT"
if [ "$FAILS" -gt 0 ]; then
  echo "[migration-check] $FAILS check(s) FAILED" >&2
  exit 1
fi
log "ALL MIGRATION CHECKS PASSED"
