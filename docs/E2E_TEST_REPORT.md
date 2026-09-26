# E2E & Quality-Gate Test Report

> Spec C §75 #5. Exact commit, commands and counts. Sections 2–4 are workstream E's run on its branch;
> the coordinator appends the run on the merged commit (§5) using the same commands.

## 1. Environment

| Item | Value |
|---|---|
| Branch / commit | `worktree-agent-ace1e348aa8f737f7` @ `05edfd3` (contains spec `f4ba771` and Redis fix `c3f9b10`); only docs changed after it |
| Date | 2026-09-26 00:40–00:55 UTC |
| Node / pnpm | 22.22.2 / 10.20.0 |
| Python | 3.11 venv locally (CI and images use 3.13) |
| Infrastructure | Docker containers from `docker-compose.coolify.yml` images: pgvector/pgvector:pg16, redis:7.2-alpine, elestio/minio, clamav/clamav (real clamd, real signatures) |
| Isolation | own database `erppreflight_ws_e`, Redis DB 5, buckets `erppreflight-ws-e-*`, ports API 3501 / web 3500 / python 8500 |

## 2. Static gates and unit/integration suites

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | ok |
| `pnpm run check:deps` / `check:no-production-facades` / `check:production-truth` | pass / pass / pass |
| `pnpm run typecheck` | 13/13 tasks, 0 errors |
| `pnpm run lint` | pass |
| `pnpm run build` | 8/8 tasks |
| `pnpm --filter @erppreflight/api run test:boot` | AppModule DI graph resolves |
| `pnpm run test` | **api 681** (40 files), **web 155** (10 files), **local-agent 5** (1 file) — all passed, 0 skipped |
| `python -m pytest services/analysis-python/tests -q` | **548 passed**, 0 failed (1 warning) |
| `python -m pytest tests/e2e tests/empirical_redaction_stress.py -q` | **267 passed** |
| `python scripts/generate-engine-catalog.py --check` | up to date (19 engines) |
| `actionlint` 1.7.12 on `.github/workflows/*.yml` | 0 findings |
| `renovate-config-validator renovate.json` | valid |

## 3. Migration check — `scripts/ci-migration-check.sh`

`PG_ADMIN_URL=postgres://erppreflight:***@localhost:5432 bash scripts/ci-migration-check.sh`

| Check | Result |
|---|---|
| Fresh database, production runner | applied=10 skipped=0 |
| Second run | applied=0 skipped=10 |
| `pg_dump --schema-only` twice | identical (3472 lines) |
| Second fresh database | identical schema |
| Tenant tables with ENABLE + FORCE RLS + policy | 22 / 22 |
| `erppreflight_app` | NOSUPERUSER, NOBYPASSRLS |

## 4. Live E2E — `scripts/ci-live-e2e.sh` (same script as the CI `live-e2e` job)

Full sequence including builds (packages, API, web standalone with `NEXT_PUBLIC_API_URL`), API in
`NODE_ENV=production` with `DB_RUNTIME_ROLE=erppreflight_app`, migrations applied by the API on boot
(10), readiness `healthy` with postgres/redis/minio/analysis (19 engines)/clamav all `up`.

| Stage | Result |
|---|---|
| API smoke `scripts/e2e-live-smoke.sh` | **21/21 PASS**: register/login, wrong password 401, project, ClamAV CLEAN, OPD Guard run COMPLETED, 5 exports (PDF, JSON bundle, XLSX, CSV, offline HTML), unknown format 400, 7 cross-tenant/invalid-token denials (404/403/401), secret redacted at rest with XML intact |
| UI smoke `scripts/e2e-ui-smoke.cjs` (Chromium) | **7/7 OK**: signup, projects, open workspace, upload, launch, findings visible, finding detail with evidence |
| Playwright live suite | skipped — no `playwright.live.config.ts` on this branch (hook ready, C §50) |
| Backup/restore drill | **PASSED**: backup of 26 tables / 40 rows + bucket mirror → DB dropped and buckets emptied → restore verified checksum, per-table row counts, 22 RLS tables / 22 policies, object counts → API restarted on restored data: drill user login OK, project readable, uploaded object byte-identical (sha256 `9724d499…`) |

Earlier runs the same day (00:15, 00:17, 00:31 UTC) passed identically. Built images were also verified
separately: api + web images built with the real Dockerfiles (sandbox CA injected for registry access),
analysis image built with the apt steps removed (Debian mirrors blocked in the sandbox); Trivy image scan
0 fixable HIGH/CRITICAL for all three; API image entrypoint applied 10 migrations and served liveness;
web image served `/api/health` and `/login` (200); analysis image served `/health`.

## 5. Merged commit (coordinator)

| Command | Result |
|---|---|
| _same commands as §2–§4 on the merged commit_ | _fill in_ |
| GitHub Actions: ci / security / docker (first run) | _fill in_ |
| Production smoke after deploy (`API_BASE_URL=https://api.erppreflight.com`) | _fill in_ |
