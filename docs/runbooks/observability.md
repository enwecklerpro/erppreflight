# Runbook — Observability (logs, traces, metrics, errors)

Scope: `apps/api` (NestJS), `services/analysis-python` (FastAPI), `apps/local-agent`.
Everything below is **opt-in and fail-open**: an unreachable collector or Sentry never
blocks a request or an analysis job.

## 1. Structured logs (Pino)

- The API logs one JSON line per event to stdout (`apps/api/src/observability/logger.ts`).
  Coolify/Docker collect stdout; ship it to Loki/ELK/Datadog as usual.
- Every line carries `requestId` (echoed as the `X-Request-Id` response header),
  `traceId`/`spanId` when tracing is on, `tenantId` when a tenant context exists, and the Nest `context`.
- Level: `LOG_LEVEL` (`info` default; `debug` in development).
- **Redaction** happens at two points:
  1. keys such as `authorization`, `cookie`, `password`, `secret`, `token`, `apiKey`,
     `clientSecret` and `privateKey` are censored anywhere in the payload;
  2. string values are scrubbed for bearer tokens, JWTs, `scheme://user:pass@` URLs and
     `key=value` secrets.

  Request logs contain the path only, never the query string or body.

Triage: search by the `X-Request-Id` a user reports, then pivot on `traceId`.

## 2. Distributed tracing (OpenTelemetry → OTLP/HTTP)

| Service | Enable | What is traced |
|---|---|---|
| API | `OTEL_EXPORTER_OTLP_ENDPOINT` (+ optional `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`) | HTTP server (express), outbound HTTP (http + undici/fetch: connectors, webhooks, OIDC, the analysis service), `pg`, `ioredis`/BullMQ |
| analysis-python | same variables, and the image built with `INSTALL_OTEL=true` (the default) or `pip install .[otel]` | FastAPI server spans plus an `analysis.engine` span per engine run (engine, status, finding count, duration) |

- The tracing SDK is bootstrapped before Nest loads (`src/observability/bootstrap-tracing.ts`
  is the first import in `main.ts`). No endpoint means no SDK is started, so there is zero overhead.
- W3C `traceparent` is propagated API → analysis-python. A single trace therefore shows
  upload → BullMQ job → engine run.
- Spans never carry artifact content, finding text, credentials or query strings.
  Tenant ids are not span attributes; correlate through logs.
- Collector choices:
  - any OTLP/HTTP endpoint: OpenTelemetry Collector, Grafana Tempo/Alloy, Honeycomb, Jaeger ≥ 1.35 on `:4318`;
  - on Coolify, add an `otel-collector` service and set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`.

Verify tracing:

```bash
# API: request with a known trace id, then find it in the tracing backend
curl -s -H 'traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' \
  https://api.example.com/health/liveness
# analysis-python: log line "OpenTelemetry tracing enabled for analysis-python" at startup
```

## 3. Metrics (Prometheus)

`GET /api/v1/metrics` returns Prometheus text format.

- Authentication: `Authorization: Bearer $METRICS_TOKEN`, or a Super Admin session. An anonymous request gets 404.
- Business and platform series:

| Metric | Meaning / alert idea |
|---|---|
| `erppreflight_http_requests_total`, `erppreflight_http_request_duration_seconds` | RED metrics by method/route/status. Alert: 5xx ratio > 2 % for 10 min |
| `erppreflight_engine_runs_total`, `erppreflight_engine_run_duration_seconds` | Per-engine outcomes and latency. Alert: FAILED ratio > 10 % |
| `erppreflight_findings_emitted_total`, `erppreflight_rules_evaluated_total` | Finding volume by engine/severity |
| `erppreflight_analyses_total`, `erppreflight_analyses_by_status` | Job throughput / backlog |
| `erppreflight_queue_jobs` | BullMQ depth by state. Alert: `waiting` growing for 15 min |
| `erppreflight_outbox_queue_lag` | Unpublished outbox events (notifications, webhooks) |
| `erppreflight_connector_calls_total`, `erppreflight_connector_call_duration_seconds` | Outbound connector calls by type/outcome |
| `erppreflight_connectors_by_health` | Connectors UNKNOWN/HEALTHY/DEGRADED/UNHEALTHY |
| `erppreflight_webhook_deliveries_by_status` | DELIVERED / RETRYING / FAILED. Alert: FAILED increases |
| `erppreflight_uploads_by_status`, `erppreflight_upload_rejections` | Ingestion health, quarantine rate |
| `erppreflight_db_pool_connections` | pg pool total/idle/waiting. Alert: waiting > 0 for 5 min |

- Tenant-facing roll-up: `GET /api/v1/telemetry/summary`. Values that are not measured are
  returned as `null`, never estimated.

## 4. Error reporting (Sentry protocol)

- `SENTRY_DSN` enables `SentryErrorReporter` (`src/observability/error-reporter.ts`). It posts
  envelopes directly, so no SDK is involved. Without a DSN, a no-op reporter is used.
- What is reported: unhandled 5xx (from the global exception filter) and unhandled promise
  rejections. Each event carries the exception type and message, stack, route template, `requestId`, `traceId`,
  environment and release.
- Never reported: request bodies, headers, cookies, query strings or user emails.
- The DSN is operator configuration, not tenant input. Delivery is best-effort with a 5 s timeout
  and is flushed on shutdown.

## 5. Connector, webhook and agent health

- **Connector health**: `GET /api/v1/connectors` (field `health`). A background sweep runs every
  `CONNECTOR_HEALTH_INTERVAL_MS`. After repeated failures, a per-connector circuit breaker opens: calls fail fast
  until the cool-down ends. Health becomes `UNHEALTHY`, and a `connector.unhealthy` event is emitted
  (webhook + notification).
  - To reset: fix the credentials and use **Test connection** in `/integrations`.
- **Webhook deliveries**: `/integrations?tab=webhooks` shows the per-attempt log.
  Retries use exponential backoff, polled every `WEBHOOK_RETRY_INTERVAL_MS`. **Replay** re-sends a
  delivery with a fresh signature.
- **Local agents**: the `LOCAL_AGENT` connector's health check fails when the device has sent no heartbeat for
  `AGENT_HEARTBEAT_STALE_MS` (default 5 min).
  - To fix: run `erp-preflight-agent probe` on the host, which checks the API, clock skew and signature.
  - To revoke: `/integrations?tab=agents` → Revoke. The device credential stops working immediately.

## 6. Incident checklist

1. Get the `X-Request-Id` / time window from the reporter. Pull the logs for that `requestId`, then its `traceId`.
2. Check `erppreflight_http_requests_total{status=~"5.."}` and Sentry for the same release.
3. Analysis stuck:
   - check `erppreflight_queue_jobs{state="waiting"}`, Redis health and the analysis-python `/health`;
   - then look at the trace of the last job.
4. Integration failures: check connector health, sync log (`/integrations` → connector → Sync log) and breaker state.
5. After mitigation: confirm the metrics recover and note the incident in the audit log / status page.
