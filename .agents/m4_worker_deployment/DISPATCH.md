# Dispatch: m4_worker_deployment

- **Agent Name**: `m4_worker_deployment`
- **Archetype**: `teamwork_preview_worker`
- **Role**: Hostinger & Coolify Deployment Hardening Worker
- **Assigned Directory**: `H:/erppreflight/.agents/m4_worker_deployment`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`
- **Mandatory Reading**: `H:/erppreflight/.agents/ORIGINAL_REQUEST.md`, `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`

## Mission
Harden, complete, and verify the production deployment configuration for ERP Preflight targeted for Coolify on Hostinger (Requirement R4 and Master Spec Part 22):

1. **Docker Compose (`infra/coolify/docker-compose.coolify.yml`)**:
   - Verify full topology matrix: `web` (port 3000), `api` (port 3001), `analysis-python` (port 8000), `postgres` (port 5432, PostgreSQL 16 + pgvector), `redis` (port 6379, Redis 7.2 Alpine), `minio` (port 9000 API, 9001 Console).
   - Ensure network bridges, named volumes, health checks for every container, resource limits, restart policies (`unless-stopped`), and environment variable bindings.
   - Verify health check commands:
     - `web`: `wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1`
     - `api`: `wget --no-verbose --tries=1 --spider http://localhost:3001/health/liveness || exit 1`
     - `analysis-python`: `curl -f http://localhost:8000/health || exit 1`
     - `postgres`: `pg_isready -U postgres`
     - `redis`: `redis-cli ping`
     - `minio`: `curl -f http://localhost:9000/minio/health/live || exit 1`

2. **Hardened Multi-Stage Dockerfiles (`infra/docker/`)**:
   - `Dockerfile.web`: Multi-stage build (deps, builder, runner), standalone Next.js output, non-root execution (`USER nextjs` or `USER node`), minimal image size.
   - `Dockerfile.api`: Multi-stage build (deps, builder, runner), NestJS Fastify production build, non-root user, execution of entrypoint migration script.
   - `Dockerfile.analysis`: Multi-stage Python 3.13 slim build, virtualenv, non-root user (`USER nonroot` or `appuser`), uvicorn production runner.

3. **Automated Migration Runner**:
   - Ensure `apps/api` has an entrypoint script (e.g. `infra/docker/api-entrypoint.sh` or `apps/api/entrypoint.sh`) that runs database migrations (`pnpm run db:migrate` or `drizzle-kit migrate`) before launching NestJS API in production.

4. **Root `.env.example`**:
   - Create a clean, comprehensive `H:/erppreflight/.env.example` documenting all required environment variables for all 6 containers with production defaults and documentation, synchronized with `apps/api/src/config/env.validation.ts` and `docker-compose.coolify.yml`.

5. **Verification**:
   - Prepend `C:\Users\SKAF\AppData\Roaming\npm` to `$env:PATH` in PowerShell.
   - Verify `docker-compose.coolify.yml` syntax.
   - Run `pnpm test`, `pnpm run build`, `pnpm run typecheck`, and `py -3.13 -m pytest services/analysis-python/tests -q`.
   - Write comprehensive `handoff.md` and report to orchestrator.


## 2026-09-24T11:23:35Z
<USER_REQUEST>
You are m4_worker_deployment, working in directory H:/erppreflight/.agents/m4_worker_deployment.

MANDATORY: Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md before starting work.
Also read:
- H:/erppreflight/.agents/m4_worker_deployment/DISPATCH.md
- H:/erppreflight/.agents/orchestrator_main/PROJECT.md
- H:/erppreflight/infra/coolify/docker-compose.coolify.yml
- H:/erppreflight/infra/docker/Dockerfile.web
- H:/erppreflight/infra/docker/Dockerfile.api
- H:/erppreflight/infra/docker/Dockerfile.analysis
- H:/erppreflight/apps/api/src/config/env.validation.ts

Mission:
Harden and verify the complete production deployment configuration for ERP Preflight targeted for Coolify on Hostinger:
1. Docker Compose (`infra/coolify/docker-compose.coolify.yml`):
   - Verify full topology matrix: `web` (3000), `api` (3001), `analysis-python` (8000), `postgres` (5432, pgvector), `redis` (6379), `minio` (9000/9001).
   - Ensure health check directives, resource limits, restart policies (`unless-stopped`), networks, volumes, and secret bindings.
2. Hardened Multi-Stage Dockerfiles (`infra/docker/`):
   - Ensure all Dockerfiles (`Dockerfile.web`, `Dockerfile.api`, `Dockerfile.analysis`) use multi-stage builds, non-root users, security hardening, and production optimization.
3. Automated Migration Runner:
   - Ensure `apps/api` has a robust entrypoint script (`infra/docker/api-entrypoint.sh` or `apps/api/entrypoint.sh`) that runs database migrations before starting the NestJS server.
4. Comprehensive Root `.env.example`:
   - Author a complete, production-ready `H:/erppreflight/.env.example` documenting all configuration keys across web, api, analysis, db, redis, and minio, matching `apps/api/src/config/env.validation.ts`.
5. Execute Verification Commands in PowerShell:
   - Prepend `C:\Users\SKAF\AppData\Roaming\npm` to `$env:PATH`.
   - Run `pnpm test`
   - Run `pnpm run build`
   - Run `pnpm run typecheck`
   - Run `py -3.13 -m pytest services/analysis-python/tests -q`

## 2026-09-24T11:47:17Z
**Context**: Milestone 5 Acceptance Quality Gate — Python Static Analysis Lint Failure
**Content**: Challenger `m5_challenger_final` verified all 175 E2E tests (100% pass) and all 488 pytest tests (100% pass), but reported 45 ruff lint errors in `services/analysis-python/src/` (`py -3.13 -m ruff check services/analysis-python/src/` failed with exit code 1).

Please perform the following remediation:
1. In `services/analysis-python/src/main.py:7`: Ensure `import src.engines  # noqa: F401` is used so that engine side-effect registration is preserved while satisfying ruff.
2. Run `py -3.13 -m ruff check --fix services/analysis-python/src/` to automatically clean unused imports and empty f-strings.
3. Clean any remaining errors manually (e.g. unused local variables: `full_artifact_hash` in `custom_field_flow.py` and `gap_radar.py`, `parent_map` in `extension_impact.py`, `meta` in `gap_radar.py`, `matched_row_dict` in `opd_guard.py`). Prefix with `_` or remove as appropriate.
4. Verify with:
   - `py -3.13 -m ruff check services/analysis-python/src/` (must return exit code 0, 0 errors!)
   - `py -3.13 -m pytest services/analysis-python/tests -q` (must return exit code 0, 488/488 passed!)
   - `py -3.13 -m pytest tests/e2e/ -v` (must return exit code 0, 175/175 passed!)
5. Report back when complete.
**Action**: Clean all 45 ruff errors in `services/analysis-python/src/`, verify zero test regressions, and report back.
