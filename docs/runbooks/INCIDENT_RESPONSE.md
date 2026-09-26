# Runbook — Security & Service Incident Response

> Spec 12.11, 20.13 (detect → contain → preserve evidence → assess tenant scope → eradicate →
> recover → notify → postmortem → preventive actions). Applies to outages and security incidents.

## 1. Detect — first 10 minutes

```bash
curl -s https://api.erppreflight.com/health/liveness
curl -s https://api.erppreflight.com/health/readiness | jq .     # postgres, redis, minio, analysis, clamav
curl -s -o /dev/null -w '%{http_code}\n' https://erppreflight.com/api/health
ssh root@<vps> 'docker ps --format "table {{.Names}}\t{{.Status}}"; free -m; df -h /'
ssh root@<vps> 'docker logs --since 30m erppreflight-api 2>&1 | tail -200'
```

| Readiness shows | Go to |
|---|---|
| `clamav: down` | `CLAMAV_DOWN.md` |
| analyses stuck in `QUEUED` / `RUNNING` | `QUEUE_BACKLOG.md` |
| `postgres: down`, data loss or corruption | `DISASTER_RECOVERY.md` |
| certificate / TLS errors in the browser | `CERTIFICATE_RENEWAL.md` |
| leaked credential, suspicious admin activity | §2 below + `SECRET_ROTATION.md` |

Open an incident record (time, reporter, symptom, severity SEV1–SEV3) before changing anything.

## 2. Security incident (suspected breach, leaked secret, cross-tenant exposure)

1. **Contain.** Block the vector: rotate the affected secret (`SECRET_ROTATION.md`); disable a
   compromised account (`UPDATE users SET status='SUSPENDED' WHERE email=…` via `psql` in the
   postgres container — this blocks new logins only: issued JWTs stay valid until they expire
   (`JWT_EXPIRES_IN`, default 7d) because the JWT strategy does not re-check the user, so to kill
   live sessions rotate `JWT_SECRET`, which logs out everyone); remove a malicious webhook/API key in the tenant settings or DB; if
   needed stop public ingress (`docker compose -f docker-compose.coolify.yml stop web api`).
2. **Preserve evidence before restarting anything:**
   ```bash
   ts=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p /root/incident-$ts
   for c in api web analysis postgres redis minio clamav; do docker logs erppreflight-$c > /root/incident-$ts/$c.log 2>&1; done
   docker exec erppreflight-postgres pg_dump -U erppreflight -d erppreflight -Fc > /root/incident-$ts/db.dump
   docker exec erppreflight-postgres psql -U erppreflight -d erppreflight -c \
     "COPY (SELECT * FROM audit_events ORDER BY sequence_num) TO STDOUT CSV HEADER" > /root/incident-$ts/audit_events.csv
   sha256sum /root/incident-$ts/* > /root/incident-$ts/SHA256SUMS
   ```
3. **Assess tenant scope.** Which `organization_id`s were touched? Query `audit_events`,
   `uploaded_files`, `reports` and the API log (`X-Request-ID`, user id) for the window. Note: the
   audit trail does not yet cover all business events (KNOWN_LIMITATIONS P6), so API logs are the
   primary source.
4. **Eradicate & recover.** Patch, redeploy by image digest, restore data if needed (`DISASTER_RECOVERY.md`), run
   `API_BASE_URL=https://api.erppreflight.com bash scripts/e2e-live-smoke.sh` (includes the
   cross-tenant denial checks).
5. **Notify.** GDPR Art. 33: personal-data breaches must be reported to the supervisory authority
   within 72 h of awareness; notify affected customers per contract. Decision owner: the company owner.
6. **Postmortem** within 5 working days: timeline, root cause, tenant impact, actions with owners;
   add a regression test (e.g. a new line in `scripts/e2e-live-smoke.sh`).

## 3. Service outage

1. Check host resources first (`free -m`, `df -h`, `docker stats --no-stream`) — OOM kills of
   ClamAV (3 GB limit) are the most likely cause on small plans (KNOWN_LIMITATIONS O6).
2. Restart only the failed service: `docker compose -f docker-compose.coolify.yml restart <svc>`
   (or "Restart" in Coolify). Postgres restarts are safe; the API reconnects.
3. If a deploy caused it: redeploy the previous image digest / commit in Coolify.
4. If a migration failed on start (`STRICT_MIGRATIONS=true` stops the API): read
   `docker logs erppreflight-api | grep Migration`, fix forward, or restore the pre-deploy backup.

## 4. Contacts & access

Keep outside the repository: VPS provider console access, Coolify admin, DNS registrar, Stripe,
off-site backup store, on-call phone list. Review quarterly.
