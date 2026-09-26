/**
 * OpenTelemetry tracing bootstrap (Part 21.25, C §57).
 *
 * Must run before the application modules are loaded so the http, express, pg,
 * ioredis (BullMQ) and undici (outbound fetch) instrumentations can patch them.
 * Enabled only when OTEL_EXPORTER_OTLP_ENDPOINT (or ..._TRACES_ENDPOINT) is set;
 * otherwise nothing is loaded and tracing is a no-op. Spans are exported over
 * OTLP/HTTP. Service name: OTEL_SERVICE_NAME (default erppreflight-api).
 * Incoming health/metrics probes are not traced.
 */

export interface TracingHandle {
  enabled: boolean;
  shutdown(): Promise<void>;
}

let handle: TracingHandle = { enabled: false, shutdown: async () => undefined };

export function isTracingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) && env.OTEL_SDK_DISABLED !== 'true';
}

export function initTracing(env: NodeJS.ProcessEnv = process.env): TracingHandle {
  if (handle.enabled || !isTracingConfigured(env)) return handle;
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
  const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis');
  const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');
  /* eslint-enable @typescript-eslint/no-var-requires */

  if (!env.OTEL_SERVICE_NAME) env.OTEL_SERVICE_NAME = 'erppreflight-api';
  const ignored = /^\/(health|api\/v1\/metrics)/;
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req: any) => ignored.test(String(req.url || '')),
        // Never record header values (Authorization, cookies, API keys).
        headersToSpanAttributes: { client: { requestHeaders: [], responseHeaders: [] }, server: { requestHeaders: [], responseHeaders: [] } },
      }),
      new ExpressInstrumentation(),
      // Statement text is recorded without parameter values (no tenant data in spans).
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new IORedisInstrumentation({ dbStatementSerializer: (cmd: string) => cmd }),
      new UndiciInstrumentation(),
    ],
  });
  sdk.start();
  handle = {
    enabled: true,
    shutdown: async () => {
      await sdk.shutdown().catch(() => undefined);
    },
  };
  return handle;
}

export function getTracingHandle(): TracingHandle {
  return handle;
}
