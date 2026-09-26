# Runbook — ClamAV down (uploads rejected)

> Uploads are scanned by clamd over TCP INSTREAM (`apps/api/src/modules/ingestion/clamav.scanner.ts`).
> In production the scanner **fails closed**: when clamd is unreachable, times out
> (`CLAMAV_TIMEOUT_MS`, default 10 s) or answers unexpectedly, the upload is rejected — nothing
> reaches storage unscanned. Never "fix" an outage by setting `CLAMAV_MOCK_MODE=true`.

## Symptoms

- Users see upload failures; API log: `ClamAV socket connection failed (...) - failing closed`
  or `ClamAV socket timeout: failing closed`.
- `GET /health/readiness` → `"clamav": {"status": "down"}` (overall `degraded`).
- Container `erppreflight-clamav` is `unhealthy`, restarting, or was OOM-killed.

## Diagnose

```bash
docker ps -a --filter name=erppreflight-clamav --format '{{.Status}}'
docker inspect -f '{{.State.OOMKilled}} {{.State.ExitCode}} {{.RestartCount}}' erppreflight-clamav
docker logs --tail 100 erppreflight-clamav          # freshclam download / clamd load progress
docker exec erppreflight-clamav /usr/local/bin/clamdcheck.sh && echo PONG   # same probe as the healthcheck
# from the API container's network namespace:
docker exec erppreflight-api sh -c 'printf "zPING\0" | nc -w 3 clamav 3310'   # busybox nc
free -m
```

## Causes and fixes

| Cause | Fix |
|---|---|
| Just (re)started — clamd loads ~300 MB of signatures, takes 1–3 min (first start with an empty `clamav_db` volume: 3–8 min to download) | Wait; healthcheck has `start_period: 180s`. Uploads resume automatically |
| OOM-killed (`OOMKilled=true`). clamd holds two signature copies during reloads (~1.5 GB each); limit is 3 GB | Add RAM/swap or reduce other limits. Optional: set `ConcurrentDatabaseReload no` in clamd.conf (halves peak memory, blocks scans briefly during reloads) |
| Signature download blocked (freshclam errors, rate limit from the mirror CDN) | Check outbound HTTPS from the VPS; restart later — the `clamav_db` volume keeps the last good signatures, so a restart does not need a download |
| Volume corrupted | `docker compose -f docker-compose.coolify.yml stop clamav && docker volume rm erppreflight_clamav_db && docker compose -f docker-compose.coolify.yml up -d clamav` (full re-download) |
| API cannot resolve `clamav` | `CLAMAV_HOST` must be `clamav` (compose alias) and both containers on `erppreflight-network` |

## Recover and verify

```bash
docker compose -f docker-compose.coolify.yml restart clamav
until docker exec erppreflight-clamav /usr/local/bin/clamdcheck.sh >/dev/null 2>&1; do sleep 10; done; echo clamd ready
curl -s https://api.erppreflight.com/health/readiness | jq .dependencies.clamav
```

Then upload a file in the UI (or run `scripts/e2e-live-smoke.sh`, which checks
"file scanned by ClamAV and CLEAN"). Files uploaded during the outage are recorded with
`quarantine_status = 'REJECTED'` (the ClamAV error is in `uploaded_files.metadata.error`) and were never
promoted to the clean bucket or analysed — users must upload them again. List them:

```bash
docker exec erppreflight-postgres psql -U erppreflight -d erppreflight -c \
  "SELECT organization_id, project_id, id, metadata->>'rejectedAt' FROM uploaded_files
    WHERE quarantine_status='REJECTED' AND metadata->>'error' ILIKE '%clam%' ORDER BY 4 DESC"
```

## Detect a real infection

A file flagged by ClamAV is marked `quarantine_status = 'QUARANTINED'` (API returns `ARTIFACT_QUARANTINED`) and is never
analysed. Treat repeated detections from one tenant as a security event (`INCIDENT_RESPONSE.md`).
