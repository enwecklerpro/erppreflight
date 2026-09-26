import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { UsageMetric, UsageMetricEnum } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordUsageOptions {
  resourceType?: string | null;
  resourceId?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
  /** Run inside an existing tenant transaction (same RLS context). */
  client?: PoolClient;
}

export type MonthlyUsageTotals = Record<UsageMetric, number>;

/** First instant of the current UTC calendar month (billing period for monthly limits). */
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Per-tenant usage metering ledger (spec 10.5). Rows are append-only
 * (runtime role has no UPDATE/DELETE, migration 012) and tenant-scoped by RLS.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly db: DatabaseService) {}

  async record(
    organizationId: string,
    metric: UsageMetric,
    quantity: number,
    options: RecordUsageOptions = {}
  ): Promise<void> {
    if (!UsageMetricEnum.safeParse(metric).success) {
      throw new Error(`Unknown usage metric '${metric}'`);
    }
    const qty = Math.max(0, Math.floor(Number(quantity) || 0));
    if (qty === 0 && metric !== 'ANALYSIS_RUN') {
      return;
    }
    const params = [
      organizationId,
      metric,
      qty,
      options.resourceType ?? null,
      options.resourceId && UUID_RE.test(options.resourceId) ? options.resourceId : null,
      options.actorId && UUID_RE.test(options.actorId) ? options.actorId : null,
      JSON.stringify(options.metadata ?? {}),
    ];
    const sql = `INSERT INTO usage_events
         (organization_id, metric, quantity, resource_type, resource_id, actor_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    if (options.client) {
      await options.client.query(sql, params);
      return;
    }
    await this.db.withTenantTransaction(organizationId, (client) => client.query(sql, params));
  }

  /**
   * Best-effort variant for hot paths (worker/engine loops): metering must never
   * turn a successful analysis into a failure; failures are logged at ERROR.
   */
  async recordSafe(
    organizationId: string,
    metric: UsageMetric,
    quantity: number,
    options: RecordUsageOptions = {}
  ): Promise<boolean> {
    try {
      await this.record(organizationId, metric, quantity, options);
      return true;
    } catch (err: any) {
      this.logger.error(
        `Usage metering write failed (org=${organizationId}, metric=${metric}, qty=${quantity}): ${err?.message ?? err}`
      );
      return false;
    }
  }

  /** Sums every metric for the tenant since `since` (default: current UTC month). */
  async getTotalsSince(organizationId: string, since: Date = currentPeriodStart()): Promise<MonthlyUsageTotals> {
    const totals = Object.fromEntries(UsageMetricEnum.options.map((m) => [m, 0])) as MonthlyUsageTotals;
    const res = await this.db.query<{ metric: UsageMetric; total: string }>(
      `SELECT metric, COALESCE(SUM(quantity), 0)::text AS total
         FROM usage_events
        WHERE organization_id = $1 AND occurred_at >= $2
        GROUP BY metric`,
      [organizationId, since.toISOString()],
      { tenantId: organizationId }
    );
    for (const row of res.rows ?? []) {
      if (row.metric in totals) totals[row.metric] = Number(row.total);
    }
    return totals;
  }

  /** Daily series for one metric (used by the billing page history). */
  async getDailySeries(organizationId: string, metric: UsageMetric, days = 30) {
    const res = await this.db.query<{ day: string; total: string }>(
      `SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              SUM(quantity)::text AS total
         FROM usage_events
        WHERE organization_id = $1 AND metric = $2
          AND occurred_at >= NOW() - ($3::int * INTERVAL '1 day')
        GROUP BY 1 ORDER BY 1`,
      [organizationId, metric, days],
      { tenantId: organizationId }
    );
    return (res.rows ?? []).map((r) => ({ day: r.day, total: Number(r.total) }));
  }

  /** Bytes currently held in tenant storage (artifacts + reports). */
  async getStoredBytes(organizationId: string): Promise<number> {
    const res = await this.db.query<{ total: string }>(
      `SELECT (
          COALESCE((SELECT SUM(file_size) FROM uploaded_files WHERE organization_id = $1), 0) +
          COALESCE((SELECT SUM(file_size) FROM reports WHERE organization_id = $1), 0)
        )::text AS total`,
      [organizationId],
      { tenantId: organizationId }
    );
    return Number(res.rows?.[0]?.total ?? 0);
  }

  /** Platform-wide per-tenant totals for the Super Admin console (bypasses RLS by design). */
  async getPlatformTotalsSince(since: Date = currentPeriodStart()) {
    const res = await this.db.query<{ organization_id: string; metric: UsageMetric; total: string }>(
      `SELECT organization_id, metric, SUM(quantity)::text AS total
         FROM usage_events
        WHERE occurred_at >= $1
        GROUP BY organization_id, metric`,
      [since.toISOString()],
      { bypassRls: true }
    );
    const byOrg = new Map<string, Partial<MonthlyUsageTotals>>();
    for (const row of res.rows ?? []) {
      const entry = byOrg.get(row.organization_id) ?? {};
      entry[row.metric] = Number(row.total);
      byOrg.set(row.organization_id, entry);
    }
    return byOrg;
  }
}
