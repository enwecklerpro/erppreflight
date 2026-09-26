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
#      role erppreflight_app exists without BYPASSRLS/SUPERUSER;
#   6. upgrade path from v0 (main@7a76aea, migrations 001-009): a database at the v0 schema
#      seeded with v0-shaped data upgrades to head without losing rows, legacy users stay
#      verified (no lock-out), audit chain_seq is backfilled, legacy finding provenance is
#      backfilled (026). See docs/runbooks/UPGRADE_FROM_V0.md.
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
DB_C="${PREFIX}_c"
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
    psql_admin -c "DROP DATABASE IF EXISTS \"$DB_C\" WITH (FORCE)" >/dev/null 2>&1 || true
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

# --- 6. upgrade path from v0 (main@7a76aea deployed migrations 001-009) --------------
#     Seeds a database migrated to the v0 schema with the data shapes v0 wrote (owner and
#     legacy MEMBER memberships, uploaded file, analysis, findings whose evidence points at
#     the object-storage key, a v0 review, interleaved per-tenant audit events), applies all
#     remaining migrations and asserts the data-preserving upgrade invariants.
V0_LAST="${V0_LAST_MIGRATION:-009}"
V0_DIR="$OUT/v0-migrations"
mkdir -p "$V0_DIR"
for f in "$MIGRATIONS_DIR"/*.sql; do
  b=$(basename "$f")
  [[ "$b" < "${V0_LAST}_~" ]] && cp "$f" "$V0_DIR/"
done
V0_COUNT=$(find "$V0_DIR" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
recreate_db "$DB_C"
R0=$(node -e '
  const { runMigrations } = require(process.argv[1]);
  runMigrations(process.argv[2], process.argv[3]).then((r) => { console.log(`applied=${r.applied.length}`); process.exit(0); })
    .catch((e) => { console.error(e && e.message); process.exit(1); });
' "$DB_DIST" "$PG_ADMIN_URL/$DB_C" "$V0_DIR") || { fail "v0 migrations (001-$V0_LAST) failed"; exit 1; }
log "run 4 (v0 schema $DB_C, migrations <= $V0_LAST): $R0"
psql "$PG_ADMIN_URL/$DB_C" -v ON_ERROR_STOP=1 -q -o /dev/null <<'SQL'
INSERT INTO organizations (id, name, slug, plan_tier) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Legacy Org A', 'legacy-a', 'ENTERPRISE'),
  ('a0000000-0000-4000-8000-000000000002', 'Legacy Org B', 'legacy-b', 'FREE');
INSERT INTO users (id, email, password_hash, full_name, system_role) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'owner-a@legacy.example', '$argon2id$v=19$m=19456,t=2,p=1$legacy$legacy', 'Owner A', 'USER'),
  ('b0000000-0000-4000-8000-000000000002', 'member-a@legacy.example', '$argon2id$v=19$m=19456,t=2,p=1$legacy$legacy', 'Member A', 'USER'),
  ('b0000000-0000-4000-8000-000000000003', 'owner-b@legacy.example', '$argon2id$v=19$m=19456,t=2,p=1$legacy$legacy', 'Owner B', 'SUPER_ADMIN');
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'ORGANIZATION_OWNER'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'ORGANIZATION_OWNER');
INSERT INTO organization_members (organization_id, user_id) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002');
SELECT set_config('app.current_tenant_id', 'a0000000-0000-4000-8000-000000000001', false);
INSERT INTO projects (id, organization_id, name, slug) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Legacy project', 'legacy-project');
INSERT INTO uploaded_files (id, organization_id, project_id, file_name, file_size, mime_type, storage_path, checksum_sha256, quarantine_status, redaction_status) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'legacy.abap', 10, 'application/octet-stream',
   'tenants/a0000000-0000-4000-8000-000000000001/projects/c0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000001/legacy.abap',
   repeat('a', 64), 'CLEAN', 'PASSED');
INSERT INTO analyses (id, organization_id, project_id, status, engine_types, target_release) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'COMPLETED', '["CLEAN_CORE_OBJECT_GUARD"]', 'S4H_2023');
INSERT INTO findings (id, organization_id, project_id, analysis_id, engine, rule_id, severity, category, title, description, confidence_class, fingerprint, affected_objects, technical_details) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'CLEAN_CORE_OBJECT_GUARD', 'CLEAN_CORE_DIRECT_DB_ACCESS', 'CRITICAL', 'CLEAN_CORE', 't', 'd', 'VERIFIED', repeat('1', 64), '[{"name":"MARA"}]',
   '{"review":{"status":"ACCEPTED_RISK","justification":"legacy","reviewedBy":"b0000000-0000-4000-8000-000000000001","reviewedAt":"2025-11-03T10:00:00.000Z"}}'),
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'API_CHANGE_GUARD', 'API_REMOVED', 'MAJOR', 'API', 't', 'd', 'VERIFIED', repeat('2', 64), '[]', '{}');
INSERT INTO evidence (organization_id, finding_id, artifact_path, sha256) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'tenants/a0000000-0000-4000-8000-000000000001/projects/c0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000001/legacy.abap', repeat('a', 64)),
  ('a0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'request_payload', repeat('b', 64));
INSERT INTO audit_events (organization_id, action, target_type, prev_hash, current_hash) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'LEGACY_1', 'PROJECT', repeat('0', 64), repeat('3', 64));
SELECT set_config('app.current_tenant_id', 'a0000000-0000-4000-8000-000000000002', false);
INSERT INTO audit_events (organization_id, action, target_type, prev_hash, current_hash) VALUES
  ('a0000000-0000-4000-8000-000000000002', 'LEGACY_1', 'PROJECT', repeat('0', 64), repeat('4', 64));
SELECT set_config('app.current_tenant_id', 'a0000000-0000-4000-8000-000000000001', false);
INSERT INTO audit_events (organization_id, action, target_type, prev_hash, current_hash) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'LEGACY_2', 'PROJECT', repeat('3', 64), repeat('5', 64));
SQL
count_legacy() {
  psql "$PG_ADMIN_URL/$DB_C" -qAt -c "SELECT string_agg(t || '=' || n, ',' ORDER BY t) FROM (
    SELECT 'organizations' t, count(*) n FROM organizations UNION ALL SELECT 'users', count(*) FROM users
    UNION ALL SELECT 'organization_members', count(*) FROM organization_members UNION ALL SELECT 'projects', count(*) FROM projects
    UNION ALL SELECT 'uploaded_files', count(*) FROM uploaded_files UNION ALL SELECT 'analyses', count(*) FROM analyses
    UNION ALL SELECT 'findings', count(*) FROM findings UNION ALL SELECT 'evidence', count(*) FROM evidence
    UNION ALL SELECT 'audit_events', count(*) FROM audit_events) s"
}
BEFORE_COUNTS=$(count_legacy)
RU=$(run_migrations "$DB_C") || { fail "upgrade from the v0 schema failed"; exit 1; }
log "run 5 (upgrade v0 -> head on $DB_C): $RU"
[ "$RU" = "applied=$((EXPECTED - V0_COUNT)) skipped=$V0_COUNT" ] || fail "upgrade expected applied=$((EXPECTED - V0_COUNT)) skipped=$V0_COUNT, got '$RU'"
AFTER_COUNTS=$(count_legacy)
[ "$BEFORE_COUNTS" = "$AFTER_COUNTS" ] && log "upgrade kept every legacy row ($AFTER_COUNTS)" \
  || fail "legacy row counts changed by the upgrade: before=$BEFORE_COUNTS after=$AFTER_COUNTS"
q() { psql "$PG_ADMIN_URL/$DB_C" -qAt -c "$1"; }
[ "$(q "SELECT count(*) FROM users WHERE email_verified_at IS NULL")" = "0" ] \
  && log "legacy users are grandfathered as e-mail verified (no verification lock-out)" \
  || fail "legacy users left unverified after the upgrade"
[ "$(q "SELECT count(*) FROM users WHERE totp_enabled_at IS NOT NULL OR token_version <> 0")" = "0" ] \
  || fail "legacy users got 2FA / token_version state they never had"
[ "$(q "SELECT count(*) FROM organizations WHERE require_2fa OR subscription_status <> 'NONE'")" = "0" ] \
  || fail "legacy organizations got an enforced 2FA policy or a subscription status"
GAPS=$(q "SELECT count(*) FROM (SELECT chain_seq, row_number() OVER (PARTITION BY organization_id ORDER BY sequence_num) rn FROM audit_events) s WHERE chain_seq IS DISTINCT FROM rn")
[ "$GAPS" = "0" ] && log "audit chain_seq backfilled contiguously per tenant for legacy events" \
  || fail "legacy audit events without a contiguous per-tenant chain_seq ($GAPS rows)"
SRC=$(q "SELECT coalesce(string_agg(id::text || ':' || coalesce(source_file_name, '-'), ',' ORDER BY id), '') FROM findings")
[ "$SRC" = "f0000000-0000-4000-8000-000000000001:legacy.abap,f0000000-0000-4000-8000-000000000002:-" ] \
  && log "legacy finding provenance backfilled from evidence -> uploaded file (026)" \
  || fail "legacy finding source backfill unexpected: $SRC"
[ "$(q "SELECT technical_details->'review'->>'status' FROM findings WHERE id = 'f0000000-0000-4000-8000-000000000001'")" = "ACCEPTED_RISK" ] \
  || fail "legacy review record lost by the upgrade"

log "schema dumps kept in $OUT"
if [ "$FAILS" -gt 0 ]; then
  echo "[migration-check] $FAILS check(s) FAILED" >&2
  exit 1
fi
log "ALL MIGRATION CHECKS PASSED"
