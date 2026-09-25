import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelemetryService } from '../src/modules/telemetry/telemetry.service';
import { TelemetryMiddleware } from '../src/modules/telemetry/telemetry.middleware';

describe('Telemetry & Observability Suite', () => {
  let service: TelemetryService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new TelemetryService(mockDb);
  });

  it('increments counters and formats valid Prometheus text exposition output', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ lag: 3 }],
    });

    service.incrementHttpRequests('GET', 200);
    service.incrementHttpRequests('POST', 201);
    service.incrementAnalyses('COMPLETED');
    service.incrementRulesEvaluated(42);
    service.incrementFindings('BLOCKER');
    service.incrementFindings('CRITICAL');

    const output = await service.getPrometheusMetrics();

    expect(output).toContain('# HELP erppreflight_http_requests_total');
    expect(output).toContain('erppreflight_http_requests_total{method="GET",status="200"} 1');
    expect(output).toContain('erppreflight_http_requests_total{method="POST",status="201"} 1');
    expect(output).toContain('erppreflight_analyses_total{status="COMPLETED"} 1');
    expect(output).toContain('erppreflight_rules_evaluated_total 42');
    expect(output).toContain('erppreflight_findings_emitted_total{severity="BLOCKER"} 1');
    expect(output).toContain('erppreflight_findings_emitted_total{severity="CRITICAL"} 1');
    expect(output).toContain('erppreflight_outbox_queue_lag 3');
    expect(output).toContain('process_resident_memory_bytes');
  });

  it('TelemetryMiddleware injects W3C traceparent and X-Trace-Id into response headers', () => {
    const middleware = new TelemetryMiddleware(service);

    const req: any = {
      headers: {},
      method: 'GET',
    };
    const setHeaderMap = new Map<string, string>();
    const res: any = {
      setHeader: vi.fn((k, v) => setHeaderMap.set(k.toLowerCase(), v)),
      on: vi.fn(),
      statusCode: 200,
    };
    const next = vi.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(setHeaderMap.has('x-trace-id')).toBe(true);
    expect(setHeaderMap.has('traceparent')).toBe(true);
    expect(setHeaderMap.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});
