import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  // In-memory Prometheus metric counters
  private httpRequestsTotal = new Map<string, number>();
  private analysesTotal = new Map<string, number>();
  private rulesEvaluatedTotal = 0;
  private findingsEmittedTotal = new Map<string, number>();
  private requestDurations: number[] = [];

  constructor(@Optional() private readonly db?: DatabaseService) {}

  incrementHttpRequests(method: string, statusCode: number) {
    const key = `${method.toUpperCase()}_${statusCode}`;
    this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) || 0) + 1);
  }

  recordHttpRequestDuration(durationMs: number) {
    this.requestDurations.push(durationMs);
    if (this.requestDurations.length > 1000) {
      this.requestDurations.shift();
    }
  }

  incrementAnalyses(status: 'COMPLETED' | 'FAILED' | 'QUEUED') {
    this.analysesTotal.set(status, (this.analysesTotal.get(status) || 0) + 1);
  }

  incrementRulesEvaluated(count = 1) {
    this.rulesEvaluatedTotal += count;
  }

  incrementFindings(severity: string) {
    const key = severity.toUpperCase();
    this.findingsEmittedTotal.set(key, (this.findingsEmittedTotal.get(key) || 0) + 1);
  }

  async getOutboxQueueLag(): Promise<number> {
    if (!this.db) return 0;
    try {
      const res = await this.db.query(
        `SELECT COUNT(*)::int as lag FROM domain_events_outbox WHERE status = 'PENDING'`,
        [],
        { bypassRls: true }
      );
      return res.rows?.[0]?.lag || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Serializes all metrics into standard Prometheus plaintext exposition format.
   */
  async getPrometheusMetrics(): Promise<string> {
    const lines: string[] = [];
    const now = Date.now();

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
    if (this.httpRequestsTotal.size === 0) {
      lines.push('erppreflight_http_requests_total{method="GET",status="200"} 0');
    }

    // 3. Analyses Counter
    lines.push('# HELP erppreflight_analyses_total Total SAP Preflight analyses triggered.');
    lines.push('# TYPE erppreflight_analyses_total counter');
    for (const [status, count] of this.analysesTotal.entries()) {
      lines.push(`erppreflight_analyses_total{status="${status}"} ${count}`);
    }
    if (this.analysesTotal.size === 0) {
      lines.push('erppreflight_analyses_total{status="COMPLETED"} 0');
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

    return lines.join('\n') + '\n';
  }
}
