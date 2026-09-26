import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DatabaseService } from '../database/database.service';

/** Prometheus histogram with fixed buckets (seconds). */
export class Histogram {
  private readonly counts = new Map<string, number[]>();
  private readonly sums = new Map<string, number>();
  private readonly totals = new Map<string, number>();

  constructor(readonly buckets: number[]) {}

  observe(labels: string, seconds: number) {
    const c = this.counts.get(labels) ?? new Array(this.buckets.length).fill(0);
    this.buckets.forEach((b, i) => {
      if (seconds <= b) c[i]++;
    });
    this.counts.set(labels, c);
    this.sums.set(labels, (this.sums.get(labels) ?? 0) + seconds);
    this.totals.set(labels, (this.totals.get(labels) ?? 0) + 1);
  }

  render(name: string, help: string): string[] {
    const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
    for (const [labels, c] of this.counts.entries()) {
      const sep = labels ? `${labels},` : '';
      this.buckets.forEach((b, i) => lines.push(`${name}_bucket{${sep}le="${b}"} ${c[i]}`));
      lines.push(`${name}_bucket{${sep}le="+Inf"} ${this.totals.get(labels)}`);
      lines.push(`${name}_sum${labels ? `{${labels}}` : ''} ${Number((this.sums.get(labels) ?? 0).toFixed(6))}`);
      lines.push(`${name}_count${labels ? `{${labels}}` : ''} ${this.totals.get(labels)}`);
    }
    return lines;
  }
}

/** Escapes a Prometheus label value. */
export function escapeLabel(v: string): string {
  return String(v).replace(/[\\"]/g, (m) => `\\${m}`).replace(/\n/g, ' ');
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  // In-memory Prometheus metric counters (per API process)
  private httpRequestsTotal = new Map<string, number>();
  private analysesTotal = new Map<string, number>();
  private rulesEvaluatedTotal = 0;
  private findingsEmittedTotal = new Map<string, number>();
  private readonly httpDuration = new Histogram([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
  private readonly engineDuration = new Histogram([0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]);
  private readonly connectorDuration = new Histogram([0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]);
  private readonly engineRuns = new Map<string, number>();
  private readonly connectorCalls = new Map<string, number>();

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() @InjectQueue('analysis-queue') private readonly analysisQueue?: Queue
  ) {}

  incrementHttpRequests(method: string, statusCode: number) {
    const key = `${method.toUpperCase()}_${statusCode}`;
    this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) || 0) + 1);
  }

  recordHttpRequestDuration(durationMs: number, method = 'ALL', statusCode?: number) {
    const statusClass = statusCode ? `${Math.floor(statusCode / 100)}xx` : 'all';
    this.httpDuration.observe(`method="${escapeLabel(method.toUpperCase())}",status_class="${statusClass}"`, durationMs / 1000);
  }

  incrementAnalyses(status: 'COMPLETED' | 'FAILED' | 'QUEUED' | 'PARTIAL' | 'CANCELLED') {
    this.analysesTotal.set(status, (this.analysesTotal.get(status) || 0) + 1);
  }

  incrementRulesEvaluated(count = 1) {
    this.rulesEvaluatedTotal += count;
  }

  incrementFindings(severity: string, count = 1) {
    const key = severity.toUpperCase();
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    this.findingsEmittedTotal.set(key, (this.findingsEmittedTotal.get(key) || 0) + n);
  }

  /** Engine latency per engine and outcome (analysis service call duration). */
  recordEngineRun(engine: string, outcome: string, durationMs: number) {
    const labels = `engine="${escapeLabel(engine)}",outcome="${escapeLabel(outcome)}"`;
    this.engineRuns.set(labels, (this.engineRuns.get(labels) || 0) + 1);
    this.engineDuration.observe(labels, durationMs / 1000);
  }

  /** Outbound connector calls per type / operation / outcome. */
  recordConnectorCall(type: string, operation: string, outcome: string, durationMs: number) {
    const labels = `type="${escapeLabel(type)}",operation="${escapeLabel(operation)}",outcome="${escapeLabel(outcome)}"`;
    this.connectorCalls.set(labels, (this.connectorCalls.get(labels) || 0) + 1);
    this.connectorDuration.observe(`type="${escapeLabel(type)}"`, durationMs / 1000);
  }

  async getOutboxQueueLag(): Promise<number> {
    if (!this.db) return 0;
    try {
      const res = await this.db.query(
        `SELECT COUNT(*)::int as lag FROM domain_events_outbox WHERE status = 'PENDING'`,
        [],
        { bypassRls: true }
      );
      return res?.rows?.[0]?.lag || 0;
    } catch {
      return 0;
    }
  }

  private async groupedGauge(sql: string): Promise<Array<{ k: string; n: number }>> {
    if (!this.db) return [];
    try {
      const res = await this.db.query(sql, [], { bypassRls: true });
      return (res?.rows || []).map((r: any) => ({ k: String(r.k), n: Number(r.n) }));
    } catch {
      return [];
    }
  }

  /**
   * Serializes all metrics into standard Prometheus plaintext exposition format.
   */
  async getPrometheusMetrics(): Promise<string> {
    const lines: string[] = [];

    // 1. Process Metrics
    const memory = process.memoryUsage();
    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${memory.rss}`);

    lines.push('# HELP process_heap_bytes Process heap memory size in bytes.');
    lines.push('# TYPE process_heap_bytes gauge');
    lines.push(`process_heap_bytes ${memory.heapUsed}`);

    lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds counter');
    lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);

    // 2. HTTP Requests
    lines.push('# HELP erppreflight_http_requests_total Total number of HTTP requests processed.');
    lines.push('# TYPE erppreflight_http_requests_total counter');
    for (const [key, count] of this.httpRequestsTotal.entries()) {
      const [method, status] = key.split('_');
      lines.push(`erppreflight_http_requests_total{method="${method}",status="${status}"} ${count}`);
    }

    // 3. Analyses Counter (this process)
    lines.push('# HELP erppreflight_analyses_total SAP Preflight analyses finished by this API process.');
    lines.push('# TYPE erppreflight_analyses_total counter');
    for (const [status, count] of this.analysesTotal.entries()) {
      lines.push(`erppreflight_analyses_total{status="${status}"} ${count}`);
    }

    // 4. Rules Evaluated Counter
    lines.push('# HELP erppreflight_rules_evaluated_total Total AST and SAP Preflight rules evaluated.');
    lines.push('# TYPE erppreflight_rules_evaluated_total counter');
    lines.push(`erppreflight_rules_evaluated_total ${this.rulesEvaluatedTotal}`);

    // 5. Findings Emitted
    lines.push('# HELP erppreflight_findings_emitted_total Total findings emitted by severity.');
    lines.push('# TYPE erppreflight_findings_emitted_total counter');
    for (const [severity, count] of this.findingsEmittedTotal.entries()) {
      lines.push(`erppreflight_findings_emitted_total{severity="${severity}"} ${count}`);
    }

    // 6. Outbox Queue Lag Gauge
    const outboxLag = await this.getOutboxQueueLag();
    lines.push('# HELP erppreflight_outbox_queue_lag Number of PENDING domain events awaiting outbox dispatch.');
    lines.push('# TYPE erppreflight_outbox_queue_lag gauge');
    lines.push(`erppreflight_outbox_queue_lag ${outboxLag}`);

    // 7. Latency histograms (p95 via histogram_quantile)
    lines.push(...this.httpDuration.render('erppreflight_http_request_duration_seconds', 'HTTP request latency.'));
    lines.push(...this.engineDuration.render('erppreflight_engine_run_duration_seconds', 'Analysis engine call latency per engine and outcome.'));
    lines.push('# HELP erppreflight_engine_runs_total Engine runs per engine and outcome.');
    lines.push('# TYPE erppreflight_engine_runs_total counter');
    for (const [labels, n] of this.engineRuns.entries()) lines.push(`erppreflight_engine_runs_total{${labels}} ${n}`);
    lines.push(...this.connectorDuration.render('erppreflight_connector_call_duration_seconds', 'Outbound connector call latency.'));
    lines.push('# HELP erppreflight_connector_calls_total Outbound connector calls per type, operation and outcome.');
    lines.push('# TYPE erppreflight_connector_calls_total counter');
    for (const [labels, n] of this.connectorCalls.entries()) lines.push(`erppreflight_connector_calls_total{${labels}} ${n}`);

    // 8. Business gauges from the database (consistent across replicas and restarts)
    const analyses = await this.groupedGauge(`SELECT status AS k, COUNT(*)::int AS n FROM analyses GROUP BY status`);
    lines.push('# HELP erppreflight_analyses_by_status Analyses stored per status (all tenants).');
    lines.push('# TYPE erppreflight_analyses_by_status gauge');
    for (const r of analyses) lines.push(`erppreflight_analyses_by_status{status="${escapeLabel(r.k)}"} ${r.n}`);

    const uploads = await this.groupedGauge(
      `SELECT quarantine_status AS k, COUNT(*)::int AS n FROM uploaded_files GROUP BY quarantine_status`
    );
    lines.push('# HELP erppreflight_uploads_by_status Uploaded artifacts per ingestion status.');
    lines.push('# TYPE erppreflight_uploads_by_status gauge');
    for (const r of uploads) lines.push(`erppreflight_uploads_by_status{status="${escapeLabel(r.k)}"} ${r.n}`);
    const rejected = uploads.filter((r) => r.k === 'REJECTED' || r.k === 'QUARANTINED').reduce((a, r) => a + r.n, 0);
    lines.push('# HELP erppreflight_upload_rejections Uploads rejected by validation or quarantined by antivirus.');
    lines.push('# TYPE erppreflight_upload_rejections gauge');
    lines.push(`erppreflight_upload_rejections ${rejected}`);

    const connectors = await this.groupedGauge(
      `SELECT health_status AS k, COUNT(*)::int AS n FROM connector_instances WHERE status = 'ACTIVE' GROUP BY health_status`
    );
    lines.push('# HELP erppreflight_connectors_by_health Active connector instances per health status.');
    lines.push('# TYPE erppreflight_connectors_by_health gauge');
    for (const r of connectors) lines.push(`erppreflight_connectors_by_health{health="${escapeLabel(r.k)}"} ${r.n}`);

    const deliveries = await this.groupedGauge(`SELECT status AS k, COUNT(*)::int AS n FROM webhook_deliveries GROUP BY status`);
    lines.push('# HELP erppreflight_webhook_deliveries_by_status Webhook deliveries per status.');
    lines.push('# TYPE erppreflight_webhook_deliveries_by_status gauge');
    for (const r of deliveries) lines.push(`erppreflight_webhook_deliveries_by_status{status="${escapeLabel(r.k)}"} ${r.n}`);

    // 9. Queue depth (BullMQ analysis queue)
    if (this.analysisQueue) {
      try {
        let timer: NodeJS.Timeout | undefined;
        const counts = await Promise.race([
          this.analysisQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized'),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), 2000);
          }),
        ]).finally(() => timer && clearTimeout(timer));
        lines.push('# HELP erppreflight_queue_jobs Jobs in the analysis queue per state.');
        lines.push('# TYPE erppreflight_queue_jobs gauge');
        for (const [state, n] of Object.entries(counts)) {
          lines.push(`erppreflight_queue_jobs{queue="analysis-queue",state="${escapeLabel(state)}"} ${n}`);
        }
      } catch {
        lines.push('# erppreflight_queue_jobs unavailable (Redis unreachable)');
      }
    }

    // 10. Database pool
    const pool: any = (this.db as any)?.getPool?.();
    if (pool) {
      lines.push('# HELP erppreflight_db_pool_connections PostgreSQL pool connections by state.');
      lines.push('# TYPE erppreflight_db_pool_connections gauge');
      lines.push(`erppreflight_db_pool_connections{state="total"} ${pool.totalCount ?? 0}`);
      lines.push(`erppreflight_db_pool_connections{state="idle"} ${pool.idleCount ?? 0}`);
      lines.push(`erppreflight_db_pool_connections{state="waiting"} ${pool.waitingCount ?? 0}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Tenant-scoped telemetry summary. AI token accounting is not tracked by this
   * service, so AI usage fields are null (rendered as "N/A") rather than
   * estimated from unrelated counters.
   */
  async getTenantSummary(tenantId: string) {
    let analysesByStatus: Record<string, number> = {};
    if (this.db) {
      try {
        const res = await this.db.query(
          `SELECT status, COUNT(*)::int AS n FROM analyses WHERE organization_id = $1 GROUP BY status`,
          [tenantId],
          { tenantId }
        );
        analysesByStatus = Object.fromEntries((res?.rows || []).map((r: any) => [r.status, Number(r.n)]));
      } catch (err: any) {
        this.logger.warn(`Tenant telemetry summary unavailable: ${err?.message}`);
      }
    }
    return {
      monthlyAdvisoryTokens: null,
      meanAdvisoryLatencyMs: null,
      engineDeterminismRatio: null,
      analysesByStatus,
    };
  }
}
