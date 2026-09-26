import { ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { KnowledgeSyncService } from '../knowledge-graph/knowledge-sync.service';
import { MailService } from '../mail/mail.service';
import { escapeHtml, type RenderedMail } from '../mail/mail.templates';
import {
  ADAPTER_DEFAULTS,
  adapterDefaults,
  alertDecision,
  freshnessOf,
  type SourceSettingsInput,
} from './source-sync.types';

export const SOURCE_STALE_EVENT = 'knowledge.source_stale';

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function renderStaleMail(p: { title: string; adapterId: string; ageHours: number | null; thresholdHours: number; url: string }): RenderedMail {
  const age = p.ageHours === null ? 'has never completed a successful sync' : `was last synced successfully ${Math.round(p.ageHours)} hours ago`;
  const paragraphs = [
    `The critical knowledge source "${p.title}" (${p.adapterId}) ${age}; the freshness threshold is ${p.thresholdHours} hours.`,
    'Analyses keep using the last published knowledge snapshot, so release-dependent findings may be outdated until the source is synced again.',
    'Open Source Sync Admin to inspect the sync errors and retry the sync.',
  ];
  const subject = `[ERP Preflight] Knowledge source stale: ${p.title}`;
  return {
    template: 'KNOWLEDGE_SOURCE_STALE',
    subject,
    text: `${paragraphs.join('\n\n')}\n\n${p.url}`,
    html:
      `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111">` +
      paragraphs.map((x) => `<p style="margin:0 0 14px;line-height:1.5">${escapeHtml(x)}</p>`).join('') +
      `<p><a href="${escapeHtml(p.url)}">${escapeHtml(p.url)}</a></p></body></html>`,
  };
}

/**
 * Source Sync Admin (spec 10.12): knowledge source adapters with last sync, freshness,
 * errors, item counts, changed records and retry, plus the stale alert for critical
 * sources (alert record + in-app notification + e-mail to every SUPER_ADMIN). Platform
 * data, read and written through the login pool.
 */
@Injectable()
export class SourceSyncAdminService {
  private readonly logger = new Logger(SourceSyncAdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sync: KnowledgeSyncService,
    @Optional() private readonly mail?: MailService
  ) {}

  private async adapterIds(): Promise<string[]> {
    const res = await this.db.query(
      `SELECT adapter_id FROM knowledge_sync_runs UNION SELECT adapter_id FROM knowledge_source_settings`,
      [],
      { bypassRls: true }
    );
    return [...new Set([...Object.keys(ADAPTER_DEFAULTS), ...(res.rows ?? []).map((r: any) => String(r.adapter_id))])].sort();
  }

  private describe(adapterId: string): { title: string; documents: Array<{ sourceKey: string; url: string | null }> } {
    if (adapterId === 'SAP_CLOUDIFICATION_REPOSITORY') {
      try {
        const d = this.sync.cloudificationSource().describe();
        return { title: d.title, documents: d.documents };
      } catch {
        /* configuration error surfaces on the next sync run */
      }
    }
    return { title: adapterDefaults(adapterId).title, documents: [] };
  }

  async overview(now = new Date()) {
    const ids = await this.adapterIds();
    const [settings, lastRuns, lastSuccess, failures, snapshots, alerts, objects] = await Promise.all([
      this.db.query(`SELECT * FROM knowledge_source_settings`, [], { bypassRls: true }),
      this.db.query(
        `SELECT DISTINCT ON (adapter_id) id, adapter_id, trigger, triggered_by, status, error_message, started_at, finished_at
           FROM knowledge_sync_runs ORDER BY adapter_id, started_at DESC`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT DISTINCT ON (adapter_id) id, adapter_id, status, source_results, finished_at
           FROM knowledge_sync_runs WHERE status IN ('PUBLISHED', 'NOOP')
          ORDER BY adapter_id, finished_at DESC NULLS LAST`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT adapter_id, COUNT(*)::int AS failed_30d, MAX(started_at) AS last_failed_at
           FROM knowledge_sync_runs WHERE status = 'FAILED' AND started_at >= NOW() - INTERVAL '30 days'
          GROUP BY adapter_id`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT DISTINCT ON (adapter_id) id, adapter_id, seq, stats, diff_summary, published_at
           FROM knowledge_snapshots WHERE status = 'PUBLISHED' ORDER BY adapter_id, seq DESC`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT id, adapter_id, alert_type, status, severity, last_success_at, threshold_hours, age_hours::float AS age_hours,
                message, notified_users, opened_at, resolved_at, resolved_reason
           FROM knowledge_source_alerts ORDER BY opened_at DESC LIMIT 50`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT COUNT(*)::int AS objects,
                COUNT(*) FILTER (WHERE review_status = 'PUBLISHED')::int AS published
           FROM knowledge_objects WHERE organization_id IS NULL`,
        [],
        { bypassRls: true }
      ),
    ]);
    const by = (res: any) => new Map<string, any>((res.rows ?? []).map((r: any) => [r.adapter_id, r]));
    const settingsBy = by(settings);
    const lastRunBy = by(lastRuns);
    const successBy = by(lastSuccess);
    const failBy = by(failures);
    const snapBy = by(snapshots);
    const openAlertBy = new Map<string, any>((alerts.rows ?? []).filter((a: any) => a.status === 'OPEN').map((a: any) => [a.adapter_id, a]));

    const adapters = ids.map((adapterId) => {
      const defaults = adapterDefaults(adapterId);
      const s = settingsBy.get(adapterId);
      const critical = s ? Boolean(s.critical) : defaults.critical;
      const freshnessThresholdHours = s ? Number(s.freshness_threshold_hours) : defaults.freshnessThresholdHours;
      const alertsEnabled = s ? Boolean(s.alerts_enabled) : true;
      const success = successBy.get(adapterId);
      const lastSuccessAt = success?.finished_at ? new Date(success.finished_at) : null;
      const f = freshnessOf(lastSuccessAt, freshnessThresholdHours, now);
      const docs: any[] = Array.isArray(success?.source_results) ? success.source_results : [];
      const snap = snapBy.get(adapterId);
      const run = lastRunBy.get(adapterId);
      const fail = failBy.get(adapterId);
      const alert = openAlertBy.get(adapterId);
      const description = this.describe(adapterId);
      return {
        adapterId,
        title: description.title,
        documents: description.documents,
        retriable: defaults.retriable,
        settings: { critical, freshnessThresholdHours, alertsEnabled, configured: Boolean(s) },
        lastRun: run
          ? {
              id: run.id,
              status: run.status,
              trigger: run.trigger,
              triggeredBy: run.triggered_by,
              error: run.error_message ? String(run.error_message).slice(0, 1000) : null,
              startedAt: iso(run.started_at),
              finishedAt: iso(run.finished_at),
            }
          : null,
        lastSuccessAt: iso(lastSuccessAt),
        freshness: f.state,
        ageHours: f.ageHours,
        errors: { failedLast30Days: Number(fail?.failed_30d ?? 0), lastFailedAt: iso(fail?.last_failed_at) },
        items: {
          documents: docs.length,
          records: docs.reduce((n, d) => n + Number(d?.records ?? 0), 0),
          rejected: docs.reduce((n, d) => n + Number(d?.rejected ?? 0), 0),
        },
        latestSnapshot: snap
          ? { id: snap.id, seq: Number(snap.seq), publishedAt: iso(snap.published_at), stats: snap.stats ?? {}, changes: snap.diff_summary ?? {} }
          : null,
        openAlert: alert ? this.alertView(alert) : null,
      };
    });

    return {
      checkedAt: now.toISOString(),
      knowledgeObjects: { total: Number(objects.rows?.[0]?.objects ?? 0), published: Number(objects.rows?.[0]?.published ?? 0) },
      adapters,
      alerts: (alerts.rows ?? []).map((a: any) => this.alertView(a)),
    };
  }

  private alertView(a: any) {
    return {
      id: a.id,
      adapterId: a.adapter_id,
      alertType: a.alert_type,
      status: a.status,
      severity: a.severity,
      lastSuccessAt: iso(a.last_success_at),
      thresholdHours: Number(a.threshold_hours),
      ageHours: a.age_hours === null || a.age_hours === undefined ? null : Number(a.age_hours),
      message: a.message,
      notifiedUsers: Number(a.notified_users ?? 0),
      openedAt: iso(a.opened_at),
      resolvedAt: iso(a.resolved_at),
      resolvedReason: a.resolved_reason ?? null,
    };
  }

  async runs(adapterId: string, limit = 25) {
    const res = await this.db.query(
      `SELECT id, adapter_id, trigger, triggered_by, status, snapshot_id, content_sha256, source_results, stats,
              error_message, started_at, finished_at
         FROM knowledge_sync_runs WHERE adapter_id = $1 ORDER BY started_at DESC LIMIT $2`,
      [adapterId, limit],
      { bypassRls: true }
    );
    return (res.rows ?? []).map((r: any) => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      triggeredBy: r.triggered_by,
      snapshotId: r.snapshot_id,
      contentSha256: r.content_sha256,
      documents: Array.isArray(r.source_results) ? r.source_results.length : 0,
      records: Array.isArray(r.source_results) ? r.source_results.reduce((n: number, d: any) => n + Number(d?.records ?? 0), 0) : 0,
      changes: r.status === 'PUBLISHED' ? (r.stats ?? {}) : null,
      error: r.error_message ? String(r.error_message).slice(0, 1000) : null,
      startedAt: iso(r.started_at),
      finishedAt: iso(r.finished_at),
    }));
  }

  async updateSettings(adapterId: string, input: SourceSettingsInput, actorId: string | null) {
    await this.db.query(
      `INSERT INTO knowledge_source_settings (adapter_id, critical, freshness_threshold_hours, alerts_enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (adapter_id) DO UPDATE SET critical = EXCLUDED.critical,
         freshness_threshold_hours = EXCLUDED.freshness_threshold_hours, alerts_enabled = EXCLUDED.alerts_enabled,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [adapterId, input.critical, input.freshnessThresholdHours, input.alertsEnabled, actorId],
      { bypassRls: true }
    );
    const overview = await this.overview();
    return overview.adapters.find((a) => a.adapterId === adapterId)!;
  }

  /** Re-runs a retriable adapter through the knowledge-sync queue (same path as the weekly schedule). */
  async retry(adapterId: string, actorEmail: string) {
    if (!adapterDefaults(adapterId).retriable) {
      throw new ConflictException({
        message: `Source ${adapterId} is a file import and cannot be retried; upload a new export instead.`,
        code: 'SOURCE_NOT_RETRIABLE',
      });
    }
    const job = await this.sync.enqueueSync(`admin-retry:${actorEmail}`);
    this.logger.log(`Knowledge source ${adapterId} retry queued by ${actorEmail} (job ${job.jobId})`);
    return { adapterId, jobId: job.jobId ?? null, queued: true };
  }

  /**
   * Freshness check (scheduled hourly and on demand): opens one stale alert per critical
   * stale source (unique open alert per source — idempotent) and notifies every active
   * SUPER_ADMIN in-app and by e-mail; resolves alerts once the source is fresh again or
   * no longer critical.
   */
  async checkFreshness(now = new Date()) {
    const overview = await this.overview(now);
    const opened: Array<{ adapterId: string; alertId: string; notifiedUsers: number }> = [];
    const resolved: Array<{ adapterId: string; alertId: string; reason: string }> = [];
    for (const a of overview.adapters) {
      const decision = alertDecision({
        critical: a.settings.critical,
        alertsEnabled: a.settings.alertsEnabled,
        state: a.freshness,
        hasOpenAlert: Boolean(a.openAlert),
      });
      if (decision === 'OPEN') {
        const message =
          a.freshness === 'NEVER_SYNCED'
            ? `Critical knowledge source ${a.title} has never completed a successful sync.`
            : `Critical knowledge source ${a.title} is stale: last successful sync ${a.ageHours} h ago (threshold ${a.settings.freshnessThresholdHours} h).`;
        const res = await this.db.query(
          `INSERT INTO knowledge_source_alerts (adapter_id, alert_type, status, severity, last_success_at, threshold_hours, age_hours, message)
           VALUES ($1, 'STALE', 'OPEN', 'CRITICAL', $2, $3, $4, $5)
           ON CONFLICT (adapter_id, alert_type) WHERE status = 'OPEN' DO NOTHING
           RETURNING id`,
          [a.adapterId, a.lastSuccessAt, a.settings.freshnessThresholdHours, a.ageHours, message.slice(0, 1000)],
          { bypassRls: true }
        );
        const alertId: string | undefined = res.rows?.[0]?.id;
        if (!alertId) continue; // another instance opened it concurrently
        const notified = await this.notifySuperAdmins(alertId, a.adapterId, a.title, a.ageHours, a.settings.freshnessThresholdHours, message);
        await this.db.query(`UPDATE knowledge_source_alerts SET notified_users = $2 WHERE id = $1`, [alertId, notified], {
          bypassRls: true,
        });
        this.logger.warn(`Stale alert opened for ${a.adapterId} (${a.freshness}); ${notified} super admin(s) notified`);
        opened.push({ adapterId: a.adapterId, alertId, notifiedUsers: notified });
      } else if (decision === 'RESOLVE') {
        const reason = a.freshness === 'FRESH' ? 'FRESH' : !a.settings.critical ? 'NOT_CRITICAL' : 'ALERTS_DISABLED';
        const res = await this.db.query(
          `UPDATE knowledge_source_alerts SET status = 'RESOLVED', resolved_at = NOW(), resolved_reason = $2
            WHERE id = $1 AND status = 'OPEN' RETURNING id`,
          [a.openAlert!.id, reason],
          { bypassRls: true }
        );
        if (res.rows?.[0]) resolved.push({ adapterId: a.adapterId, alertId: a.openAlert!.id, reason });
      }
    }
    return { checkedAt: now.toISOString(), opened, resolved };
  }

  private async notifySuperAdmins(
    alertId: string,
    adapterId: string,
    title: string,
    ageHours: number | null,
    thresholdHours: number,
    body: string
  ): Promise<number> {
    const admins = await this.db.query(
      `SELECT u.id, u.email,
              (SELECT m.organization_id FROM organization_members m WHERE m.user_id = u.id ORDER BY m.created_at ASC LIMIT 1) AS org_id
         FROM users u WHERE u.system_role = 'SUPER_ADMIN' AND u.status = 'ACTIVE'`,
      [],
      { bypassRls: true }
    );
    let notified = 0;
    const link = '/admin/sources';
    for (const admin of admins.rows ?? []) {
      let delivered = false;
      if (admin.org_id) {
        try {
          await this.db.withTenantTransaction(admin.org_id, (client) =>
            client.query(
              `INSERT INTO notifications (organization_id, user_id, event_type, severity, title, body, link, resource_type,
                                          group_key, dedupe_key, payload)
               VALUES ($1, $2, $3, 'CRITICAL', $4, $5, $6, 'KNOWLEDGE_SOURCE', $7, $8, $9)
               ON CONFLICT (organization_id, user_id, dedupe_key) DO NOTHING`,
              [
                admin.org_id,
                admin.id,
                SOURCE_STALE_EVENT,
                `Knowledge source stale: ${title}`.slice(0, 300),
                body,
                link,
                `${SOURCE_STALE_EVENT}:${adapterId}`,
                `${SOURCE_STALE_EVENT}:${alertId}`,
                JSON.stringify({ alertId, adapterId, ageHours, thresholdHours }),
              ]
            )
          );
          delivered = true;
        } catch (err: any) {
          this.logger.error(`Stale-source notification for user ${admin.id} failed: ${err?.message ?? err}`);
        }
      }
      if (this.mail && admin.email) {
        try {
          await this.mail.send(admin.email, renderStaleMail({ title, adapterId, ageHours, thresholdHours, url: this.mail.link(link) }));
          delivered = true;
        } catch (err: any) {
          this.logger.error(`Stale-source e-mail to user ${admin.id} failed: ${err?.message ?? err}`);
        }
      }
      if (delivered) notified += 1;
    }
    return notified;
  }
}
