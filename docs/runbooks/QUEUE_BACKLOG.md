# Runbook — Analysis queue backlog / stuck analyses

> Analyses run asynchronously: `POST /api/v1/analyses` inserts an `analyses` row (`QUEUED`) and adds a
> BullMQ job to **`analysis-queue`** in Redis (`apps/api/src/modules/jobs/jobs.service.ts`: 3 attempts,
> exponential backoff from 1 s, last 100 completed / 500 failed jobs kept). The worker
> (`apps/api/src/modules/jobs/analysis.processor.ts`) runs inside the API container and calls the
> Python service (`ANALYSIS_SERVICE_URL`). Uploads use `ingestion-queue`. BullMQ keys live under
> `bull:<queue>:*` in Redis DB 0 (the BullMQ connection ignores a DB index in `REDIS_URL`,
> KNOWN_LIMITATIONS O10).

## Symptoms

- Runs stay `QUEUED` or `RUNNING` in the workspace "Run History".
- Admin console → Queues shows a growing `waiting` count or `status: PAUSED/ERROR`
  (`GET /api/v1/admin/queues`, SUPER_ADMIN only).
- Readiness: `analysis: down` or `redis: down`.

## Diagnose

```bash
R="docker exec erppreflight-redis redis-cli"
$R LLEN bull:analysis-queue:wait          # waiting jobs
$R LLEN bull:analysis-queue:active        # jobs being processed
$R ZCARD bull:analysis-queue:failed       # failed after all attempts
$R ZCARD bull:analysis-queue:delayed      # waiting for a retry backoff
$R HGETALL bull:analysis-queue:meta       # "paused" field present => queue paused
$R ZRANGE bull:analysis-queue:failed -5 -1   # last failed job ids
$R HGET bull:analysis-queue:<jobId> failedReason

docker exec erppreflight-postgres psql -U erppreflight -d erppreflight -c \
 "SELECT status, count(*), min(created_at) FROM analyses WHERE created_at > now() - interval '1 day' GROUP BY 1"
curl -s https://api.erppreflight.com/health/readiness | jq '.dependencies.analysis, .dependencies.redis'
docker logs --since 30m erppreflight-api 2>&1 | grep -i -E 'analysis|bull|worker' | tail -50
docker logs --since 30m erppreflight-analysis 2>&1 | tail -50
```

## Causes and fixes

| Cause | Fix |
|---|---|
| Python service down / unhealthy (`analysis: down`) | `docker compose -f docker-compose.coolify.yml restart analysis-python`; waiting jobs resume, failed ones need a re-run |
| API worker crashed or stuck (active count constant, no log progress) | `docker compose -f docker-compose.coolify.yml restart api` — BullMQ moves stalled active jobs back to `wait` |
| Large artifacts: payload cap / timeouts in the Python service | See the failed reason; split the artifact or raise the limit deliberately |
| Queue paused | `$R HDEL bull:analysis-queue:meta paused` (or resume via BullMQ tooling) |
| Redis out of memory / AOF rewrite stalls | `$R INFO memory`, `$R INFO persistence`; free memory, restart redis (AOF keeps jobs) |
| Burst of legitimate load | Wait; one API instance processes jobs serially per worker. Horizontal scaling means more API/worker replicas (not possible on the single-VPS layout without resource changes) |

## Clean up

Runs whose job is lost (e.g. Redis data lost) stay `QUEUED`/`RUNNING` forever. Mark them failed so
users can re-launch:

```bash
docker exec erppreflight-postgres psql -U erppreflight -d erppreflight -c \
 "UPDATE analyses SET status='FAILED', completed_at=now()
   WHERE status IN ('QUEUED','RUNNING') AND created_at < now() - interval '2 hours' RETURNING id, organization_id"
```

Re-launch from the workspace "Analysis Launcher" (files are still stored). Engine runs are
deterministic, so a re-run yields the same findings for the same file.

## Verify

`API_BASE_URL=https://api.erppreflight.com bash scripts/e2e-live-smoke.sh` — "analysis status COMPLETED".
