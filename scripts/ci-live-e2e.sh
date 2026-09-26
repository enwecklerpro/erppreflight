#!/usr/bin/env bash
# ==============================================================================
# ERP Preflight — Live end-to-end job (CI `live-e2e`, spec 12.4 "E2E smoke")
#
# Runs the real product loop against real infrastructure, with NO mocks:
#   Postgres 16 + pgvector, Redis 7.2, MinIO, ClamAV (real clamd)
#   -> analysis-python (uvicorn)  -> API (NODE_ENV=production, RLS runtime role,
#      ClamAV fail-closed, auto-migrations)  -> web (Next.js standalone server, exactly
#      as infra/docker/Dockerfile.web runs it)
#   -> scripts/e2e-live-smoke.sh (API: upload, scan, analysis, findings, exports,
#      tenant isolation, redaction at rest)
#   -> scripts/e2e-ui-smoke.cjs (Chromium: signup -> project -> upload -> run -> finding)
#   -> backup/restore drill: scripts/backup.sh -> drop DB + empty buckets -> scripts/restore.sh
#      (checksum + row-count verification) -> API restarted on restored data -> login + file
#      download byte-identical to the pre-backup object
#
# The GitHub Actions job calls this script with E2E_START_INFRA=1; locally it is run against
# already-running infrastructure with different ports. Same commands in both places.
#
# Environment (defaults in brackets):
#   E2E_START_INFRA   1 = start postgres/redis/minio/clamav from docker-compose.coolify.yml
#                     + tests/ci/compose.ci.yml and wait for health [0]
#   E2E_SKIP_BUILD    1 = reuse existing builds (dist/, .next/standalone) [0]
#   E2E_API_PORT [3001]  E2E_WEB_PORT [3000]  E2E_PY_PORT [8000]
#   PG_ADMIN_URL      postgres://user:pass@host:port (role that can create databases) [required]
#   E2E_DB_NAME       database to (re)create for this run [erppreflight_e2e]
#   E2E_REDIS_URL     [redis://localhost:6379/0]   (use a dedicated logical DB when sharing Redis)
#   S3_ENDPOINT [http://localhost:9000]  S3_ACCESS_KEY / S3_SECRET_KEY [required]
#   E2E_BUCKET_PREFIX bucket name prefix [erppreflight]
#   CLAMAV_HOST [localhost]  CLAMAV_PORT [3310]
#   JWT_SECRET / MASTER_ENCRYPTION_KEY  test secrets (random per run when unset)
#   PYTHON            interpreter with services/analysis-python requirements [python3]
#   CHROMIUM_PATH     Chromium executable for the UI smoke (default: Playwright's own)
#   E2E_ARTIFACTS     directory for logs + screenshots [./e2e-artifacts]
#   E2E_CLAMAV_TIMEOUT seconds to wait for clamd PONG when starting infra [900]
#   E2E_BACKUP_DRILL  1 = run the backup/restore drill after the smoke tests [1]
#   E2E_PG_CONTAINER [erppreflight-postgres]  E2E_PG_USER [erppreflight]   (drill: pg_dump runs in it)
#   E2E_MC_NETWORK [erppreflight-network]  E2E_MC_ENDPOINT [http://erppreflight-minio:9000]
#                     docker network + MinIO URL for the `mc` container (local: host / http://localhost:9000)
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_PORT="${E2E_API_PORT:-3001}"
WEB_PORT="${E2E_WEB_PORT:-3000}"
PY_PORT="${E2E_PY_PORT:-8000}"
: "${PG_ADMIN_URL:?PG_ADMIN_URL is required (postgres://user:pass@host:port)}"
PG_ADMIN_URL="${PG_ADMIN_URL%/}"
DB_NAME="${E2E_DB_NAME:-erppreflight_e2e}"
REDIS_URL_E2E="${E2E_REDIS_URL:-redis://localhost:6379/0}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
BUCKET_PREFIX="${E2E_BUCKET_PREFIX:-erppreflight}"
CLAMAV_HOST="${CLAMAV_HOST:-localhost}"
CLAMAV_PORT="${CLAMAV_PORT:-3310}"
PYTHON="${PYTHON:-python3}"
ART="$(mkdir -p "${E2E_ARTIFACTS:-$ROOT/e2e-artifacts}" && cd "${E2E_ARTIFACTS:-$ROOT/e2e-artifacts}" && pwd)"
mkdir -p "$ART/screenshots"
# Test-only secrets: random per run unless the workflow provides them. Never production values.
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
MASTER_ENCRYPTION_KEY="${MASTER_ENCRYPTION_KEY:-$(openssl rand -hex 32)}"

PIDS=()
log() { echo "[live-e2e] $(date -u +%H:%M:%S) $*"; }
cleanup() {
  local code=$?
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  if [ "$code" -ne 0 ]; then
    log "FAILED (exit $code) — last log lines:"
    for f in api api-restored python web; do [ -f "$ART/$f.log" ] && { echo "----- $f.log -----"; tail -n 40 "$ART/$f.log"; }; done
  fi
  exit "$code"
}
trap cleanup EXIT

port_free() { ! (echo > "/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
wait_http() { # url timeout_s name
  local i
  for i in $(seq 1 "$2"); do curl -fsS -o /dev/null "$1" 2>/dev/null && { log "$3 is up ($1)"; return 0; }; sleep 1; done
  log "$3 did not become healthy within $2s ($1)"; return 1
}
clamd_ping() { # prints PONG when clamd answers
  (exec 3<>"/dev/tcp/$CLAMAV_HOST/$CLAMAV_PORT" && printf 'zPING\0' >&3 && timeout 5 head -c 4 <&3) 2>/dev/null || true
}

for p in "$API_PORT" "$WEB_PORT" "$PY_PORT"; do
  port_free "$p" || { log "port $p is already in use — refusing to start"; exit 1; }
done

# ---------------------------------------------------------------- infrastructure
if [ "${E2E_START_INFRA:-0}" = "1" ]; then
  log "starting infrastructure from docker-compose.coolify.yml (postgres redis minio clamav)"
  docker network inspect coolify >/dev/null 2>&1 || docker network create coolify >/dev/null
  COMPOSE=(docker compose -f docker-compose.coolify.yml -f tests/ci/compose.ci.yml)
  "${COMPOSE[@]}" up -d postgres redis minio clamav
  for svc in postgres redis minio; do
    for i in $(seq 1 60); do
      st=$(docker inspect -f '{{.State.Health.Status}}' "erppreflight-$svc" 2>/dev/null || echo none)
      [ "$st" = healthy ] && break; sleep 2
    done
    [ "$st" = healthy ] || { log "$svc not healthy ($st)"; "${COMPOSE[@]}" logs "$svc" | tail -50; exit 1; }
    log "$svc healthy"
  done
fi
# ClamAV downloads ~300 MB of signatures on first start; uploads fail closed until clamd answers.
CLAM_TIMEOUT="${E2E_CLAMAV_TIMEOUT:-900}"
for i in $(seq 1 $((CLAM_TIMEOUT / 5))); do
  [ "$(clamd_ping)" = PONG ] && break; sleep 5
done
[ "$(clamd_ping)" = PONG ] || { log "clamd at $CLAMAV_HOST:$CLAMAV_PORT did not answer PING within ${CLAM_TIMEOUT}s"; exit 1; }
log "clamd answers PONG"

# ---------------------------------------------------------------- fresh database
log "recreating database $DB_NAME"
psql "$PG_ADMIN_URL/postgres" -v ON_ERROR_STOP=1 -qAt -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" >/dev/null
psql "$PG_ADMIN_URL/postgres" -v ON_ERROR_STOP=1 -qAt -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null

# ---------------------------------------------------------------- build
if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then
  log "building packages + API"
  pnpm --filter "./packages/*" build > "$ART/build.log" 2>&1
  pnpm --filter @erppreflight/api build >> "$ART/build.log" 2>&1
  log "building web (standalone, NEXT_PUBLIC_API_URL=http://localhost:$API_PORT)"
  NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" DOCKER_BUILD=1 NEXT_TELEMETRY_DISABLED=1 \
    pnpm --filter @erppreflight/web build >> "$ART/build.log" 2>&1
fi
STANDALONE="$ROOT/apps/web/.next/standalone"
# In CI and in the Docker image the tracing root is the repo root, so the server lives at
# standalone/apps/web/server.js. When the checkout is nested inside another pnpm workspace
# (e.g. a git worktree), Next infers the outer root and nests the path deeper — locate it.
WEB_SERVER="$(find "$STANDALONE" -path '*/node_modules' -prune -o -path '*/apps/web/server.js' -print 2>/dev/null | head -n 1)"
[ -n "$WEB_SERVER" ] || { log "web standalone build missing (no apps/web/server.js under $STANDALONE)"; exit 1; }
WEB_APP_DIR="$(dirname "$WEB_SERVER")"
[ "$WEB_SERVER" = "$STANDALONE/apps/web/server.js" ] || log "note: standalone server at non-default path $WEB_SERVER"
# Same layout as the runner stage of infra/docker/Dockerfile.web
rm -rf "$WEB_APP_DIR/.next/static" "$WEB_APP_DIR/public"
cp -r "$ROOT/apps/web/.next/static" "$WEB_APP_DIR/.next/static"
cp -r "$ROOT/apps/web/public" "$WEB_APP_DIR/public"

# ---------------------------------------------------------------- analysis service
log "starting analysis-python on :$PY_PORT"
(cd services/analysis-python && exec "$PYTHON" -m uvicorn src.main:app --host 127.0.0.1 --port "$PY_PORT") \
  > "$ART/python.log" 2>&1 &
PIDS+=($!)
wait_http "http://127.0.0.1:$PY_PORT/health" 60 analysis-python

# ---------------------------------------------------------------- API (production mode)
API_PID=""
start_api() { # $1 = log file suffix
  log "starting API on :$API_PORT (NODE_ENV=production, DB_RUNTIME_ROLE=erppreflight_app)"
  (
    cd apps/api
    export NODE_ENV=production PORT="$API_PORT" API_PORT="$API_PORT" \
      AUTO_MIGRATE=true STRICT_MIGRATIONS=true MIGRATIONS_DIR="$ROOT/packages/database/migrations" \
      DATABASE_URL="$PG_ADMIN_URL/$DB_NAME" DB_RUNTIME_ROLE=erppreflight_app \
      REDIS_URL="$REDIS_URL_E2E" \
      ANALYSIS_SERVICE_URL="http://127.0.0.1:$PY_PORT" \
      S3_ENDPOINT="$S3_ENDPOINT" S3_REGION=us-east-1 S3_ACCESS_KEY="$S3_ACCESS_KEY" S3_SECRET_KEY="$S3_SECRET_KEY" \
      S3_BUCKET_QUARANTINE="$BUCKET_PREFIX-quarantine" S3_BUCKET_CLEAN="$BUCKET_PREFIX-clean" \
      S3_BUCKET_REPORTS="$BUCKET_PREFIX-reports" \
      JWT_SECRET="$JWT_SECRET" JWT_EXPIRES_IN=1h MASTER_ENCRYPTION_KEY="$MASTER_ENCRYPTION_KEY" \
      CORS_ORIGIN="http://localhost:$WEB_PORT" \
      CLAMAV_HOST="$CLAMAV_HOST" CLAMAV_PORT="$CLAMAV_PORT" CLAMAV_MOCK_MODE=false \
      AUTH_RATE_LIMIT_SCALE=20
    exec node dist/src/main.js
  ) > "$ART/api$1.log" 2>&1 &
  API_PID=$!
  PIDS+=("$API_PID")
  wait_http "http://127.0.0.1:$API_PORT/health/liveness" 90 api
}
stop_api() {
  kill "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  local i; for i in $(seq 1 30); do port_free "$API_PORT" && return 0; sleep 1; done
  log "API did not stop"; return 1
}
start_api ""
READY=$(curl -s "http://127.0.0.1:$API_PORT/health/readiness")
echo "$READY" > "$ART/readiness.json"
log "readiness: $(echo "$READY" | head -c 400)"
echo "$READY" | grep -q '"status":"unhealthy"' && { log "API readiness is unhealthy"; exit 1; }
MIG=$(psql "$PG_ADMIN_URL/$DB_NAME" -qAt -c "SELECT count(*) FROM _migrations")
log "migrations applied by API bootstrap: $MIG"

# ---------------------------------------------------------------- web (standalone)
log "starting web on :$WEB_PORT (standalone server)"
(cd "$WEB_APP_DIR" && NODE_ENV=production PORT="$WEB_PORT" HOSTNAME=127.0.0.1 NEXT_TELEMETRY_DISABLED=1 \
  exec node server.js) > "$ART/web.log" 2>&1 &
PIDS+=($!)
wait_http "http://127.0.0.1:$WEB_PORT/api/health" 60 web

# ---------------------------------------------------------------- smoke tests
log "running API live smoke (scripts/e2e-live-smoke.sh)"
set +e
API_BASE_URL="http://localhost:$API_PORT" bash scripts/e2e-live-smoke.sh 2>&1 | tee "$ART/smoke-live.log"
LIVE=${PIPESTATUS[0]}
log "running UI smoke (scripts/e2e-ui-smoke.cjs)"
WEB_URL="http://localhost:$WEB_PORT" node scripts/e2e-ui-smoke.cjs "$ART/screenshots" 2>&1 | tee "$ART/smoke-ui.log"
UI=${PIPESTATUS[0]}
# Real-stack Playwright suite (spec §50): runs when a live config exists. It receives the URLs
# of this stack and must not start its own web server.
PW=0
PW_CONFIG="${E2E_PLAYWRIGHT_CONFIG:-playwright.live.config.ts}"
if [ -f "$PW_CONFIG" ]; then
  log "running Playwright suite ($PW_CONFIG)"
  PLAYWRIGHT_BASE_URL="http://localhost:$WEB_PORT" WEB_URL="http://localhost:$WEB_PORT" \
    API_BASE_URL="http://localhost:$API_PORT" \
    pnpm exec playwright test -c "$PW_CONFIG" --output "$ART/playwright" 2>&1 | tee "$ART/playwright.log"
  PW=${PIPESTATUS[0]}
else
  log "no $PW_CONFIG — Playwright suite skipped (API + UI smoke scripts cover the core loop)"
fi
set -e

log "results: api-smoke exit=$LIVE ui-smoke exit=$UI playwright exit=$PW (artifacts in $ART)"
[ "$LIVE" -eq 0 ] && [ "$UI" -eq 0 ] && [ "$PW" -eq 0 ] || exit 1

# ---------------------------------------------------------------- backup / restore drill
# Spec 12.7 / 13.11 "working backups" / 20.30: create known data through the API, back up
# Postgres + MinIO with scripts/backup.sh, destroy both, restore with scripts/restore.sh
# (which verifies checksums and per-table row counts), restart the API on the restored data
# and prove the tenant can log in and download the file it uploaded before the "disaster".
if [ "${E2E_BACKUP_DRILL:-1}" = "1" ]; then
  A="http://127.0.0.1:$API_PORT/api/v1"; J='Content-Type: application/json'
  jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1"; }
  MC_NET="${E2E_MC_NETWORK:-erppreflight-network}"
  MC_EP="${E2E_MC_ENDPOINT:-http://erppreflight-minio:9000}"
  DRILL_EMAIL="drill$(date +%s)@e2e.local"; DRILL_PW='DrillPass!2026-restore'
  log "drill: seeding tenant $DRILL_EMAIL"
  TOKEN=$(curl -fsS -X POST "$A/auth/register" -H "$J" \
    -d "{\"email\":\"$DRILL_EMAIL\",\"password\":\"$DRILL_PW\",\"fullName\":\"Drill\",\"organizationName\":\"Drill Org\"}" | jget "['accessToken']")
  H="Authorization: Bearer $TOKEN"
  PROJ=$(curl -fsS -X POST "$A/projects" -H "$J" -H "$H" \
    -d '{"name":"Restore Drill","description":"backup drill","targetRelease":"S4H_2023"}' | jget "['id']")
  FILE=$(curl -fsS -X POST "$A/projects/$PROJ/files" -H "$H" \
    -F "file=@$ROOT/tests/fixtures/known_bad_billing_opd.xml;type=application/xml" | jget "['fileId']")
  URL=$(curl -fsS "$A/projects/$PROJ/files/$FILE/presign-download" -H "$H" | jget "['downloadUrl']")
  curl -fsS "$URL" -o "$ART/drill-before.bin"
  BEFORE_SHA=$(sha256sum "$ART/drill-before.bin" | cut -d' ' -f1)
  log "drill: project $PROJ, file $FILE (stored object sha256 ${BEFORE_SHA:0:16})"

  stop_api # quiesce writers so the backed-up row counts are exact
  BUCKETS="$BUCKET_PREFIX-quarantine $BUCKET_PREFIX-clean $BUCKET_PREFIX-reports"
  DRILL_ENV=(PG_CONTAINER="${E2E_PG_CONTAINER:-erppreflight-postgres}" POSTGRES_USER="${E2E_PG_USER:-erppreflight}"
    POSTGRES_DB="$DB_NAME" S3_BUCKETS="$BUCKETS" S3_ACCESS_KEY="$S3_ACCESS_KEY" S3_SECRET_KEY="$S3_SECRET_KEY"
    MC_NETWORK="$MC_NET" MC_ENDPOINT="$MC_EP")
  BK=$(env "${DRILL_ENV[@]}" BACKUP_ROOT="$ART/backups" bash scripts/backup.sh | tee "$ART/backup.log" | tail -n 1)
  [ -f "$BK/postgres.dump" ] || { log "drill: backup failed"; exit 1; }

  log "drill: simulating disaster (drop database $DB_NAME, delete every object in $BUCKETS)"
  psql "$PG_ADMIN_URL/postgres" -qAt -c "DROP DATABASE \"$DB_NAME\" WITH (FORCE)" >/dev/null
  MC_URL=$(python3 -c 'import sys, urllib.parse as u
e, a, s = sys.argv[1:4]; scheme, rest = e.split("://", 1)
print(f"{scheme}://{u.quote(a, safe=str())}:{u.quote(s, safe=str())}@{rest}")' "$MC_EP" "$S3_ACCESS_KEY" "$S3_SECRET_KEY")
  for b in $BUCKETS; do
    docker run --rm --network "$MC_NET" -e HOME=/tmp -e "MC_HOST_x=$MC_URL" --entrypoint mc \
      "${MC_IMAGE:-elestio/minio:latest}" --quiet rm --recursive --force "x/$b" >/dev/null 2>&1 || true
  done

  set +e
  env "${DRILL_ENV[@]}" CONFIRM_RESTORE=yes RESTORE_DB="$DB_NAME" bash scripts/restore.sh "$BK" 2>&1 | tee "$ART/restore.log"
  RESTORE=${PIPESTATUS[0]}
  set -e
  [ "$RESTORE" -eq 0 ] || { log "drill: restore verification failed"; exit 1; }

  start_api "-restored"
  LT=$(curl -fsS -X POST "$A/auth/login" -H "$J" \
    -d "{\"email\":\"$DRILL_EMAIL\",\"password\":\"$DRILL_PW\"}" | jget "['accessToken']")
  H="Authorization: Bearer $LT"
  NAME=$(curl -fsS "$A/projects/$PROJ" -H "$H" | jget "['name']")
  URL=$(curl -fsS "$A/projects/$PROJ/files/$FILE/presign-download" -H "$H" | jget "['downloadUrl']")
  curl -fsS "$URL" -o "$ART/drill-after.bin"
  AFTER_SHA=$(sha256sum "$ART/drill-after.bin" | cut -d' ' -f1)
  if [ "$NAME" != "Restore Drill" ] || [ "$AFTER_SHA" != "$BEFORE_SHA" ]; then
    log "drill: post-restore check failed (project='$NAME', sha ${AFTER_SHA:0:16} vs ${BEFORE_SHA:0:16})"; exit 1
  fi
  log "drill: login OK, project '$NAME' readable, uploaded file byte-identical after restore (sha256 ${AFTER_SHA:0:16})"
  log "BACKUP/RESTORE DRILL PASSED ($BK)"
fi
log "LIVE E2E PASSED"
