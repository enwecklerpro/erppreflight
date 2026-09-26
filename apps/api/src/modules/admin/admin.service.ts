import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  PLAN_CATALOG,
  PlanLimitOverrides,
  PlanTierId,
  UsageMetricEnum,
} from '@erppreflight/schemas';
import { AuditService } from '../audit/audit.service';
import { UsageService, currentPeriodStart } from '../usage/usage.service';
import { EntitlementsService, resolvePlanState } from '../billing/entitlements.service';
import { BillingService } from '../billing/billing.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_COUNTS = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };

export interface AdminActor {
  id: string | null;
  email?: string | null;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Optional() @InjectQueue('analysis-queue') private readonly analysisQueue?: Queue,
    @Optional() @InjectQueue('maintenance-queue') private readonly maintenanceQueue?: Queue,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly usage?: UsageService,
    @Optional() private readonly entitlements?: EntitlementsService,
    @Optional() private readonly billing?: BillingService
  ) {}

  private pythonUrl(): string {
    return this.config.get<string>('ANALYSIS_SERVICE_URL', 'http://analysis-python:8000');
  }

  async getOverview() {
    const [
      tenantsRes,
      usersRes,
      projectsRes,
      analysesRes,
      findingsRes,
      critRes,
    ] = await Promise.all([
      this.db.query('SELECT count(*)::int as count FROM organizations', [], { bypassRls: true }),
      this.db.query('SELECT count(*)::int as count FROM users', [], { bypassRls: true }),
      this.db.query('SELECT count(*)::int as count FROM projects', [], { bypassRls: true }),
      this.db.query('SELECT count(*)::int as count FROM analyses', [], { bypassRls: true }),
      this.db.query('SELECT count(*)::int as count FROM findings', [], { bypassRls: true }),
      this.db.query(
        "SELECT count(*)::int as count FROM findings WHERE severity IN ('CRITICAL', 'BLOCKER')",
        [],
        { bypassRls: true }
      ),
    ]);

    const totalTenants = tenantsRes.rows[0]?.count || 0;
    const totalUsers = usersRes.rows[0]?.count || 0;
    const totalProjects = projectsRes.rows[0]?.count || 0;
    const totalAnalyses = analysesRes.rows[0]?.count || 0;
    const totalFindings = findingsRes.rows[0]?.count || 0;
    const blockersAndCritical = critRes.rows[0]?.count || 0;

    let dbStatus = 'HEALTHY';
    try {
      await this.db.query('SELECT 1', [], { bypassRls: true });
    } catch {
      dbStatus = 'DEGRADED';
    }

    let queueStatus = 'HEALTHY';
    try {
      if (this.analysisQueue) {
        await this.analysisQueue.getJobCounts();
      } else {
        queueStatus = 'UNAVAILABLE';
      }
    } catch {
      queueStatus = 'DEGRADED';
    }

    let pythonStatus = 'ONLINE';
    try {
      const resp = await fetch(`${this.pythonUrl()}/health`, { signal: AbortSignal.timeout(2000) });
      if (!resp.ok) pythonStatus = 'DEGRADED';
    } catch {
      pythonStatus = 'OFFLINE';
    }

    return {
      totalTenants,
      totalUsers,
      totalProjects,
      totalAnalyses,
      totalFindings,
      blockersAndCritical,
      systemHealth: {
        database: dbStatus,
        redisQueue: queueStatus,
        pythonEngines: pythonStatus,
        status: dbStatus === 'HEALTHY' && pythonStatus === 'ONLINE' ? 'OPERATIONAL' : 'DEGRADED',
      },
    };
  }

  /**
   * Business overview (spec 10.6) computed only from stored state. MRR is an
   * estimate from configured list prices of ACTIVE/PAST_DUE subscriptions
   * (excludes coupons, credits and tax) and is labelled as such in the UI.
   */
  async getBusinessMetrics() {
    const orgs = await this.db.query(
      `SELECT id, plan_tier, subscription_status, trial_tier, trial_ends_at, limit_overrides, created_at
         FROM organizations`,
      [],
      { bypassRls: true }
    );
    const now = new Date();
    const byEffectiveTier: Record<string, number> = {};
    const bySubscriptionStatus: Record<string, number> = {};
    let activeTrials = 0;
    let estimatedMrrEur = 0;
    let unpricedPaidTenants = 0;
    for (const row of orgs.rows ?? []) {
      const state = resolvePlanState(row, now);
      byEffectiveTier[state.effectiveTier] = (byEffectiveTier[state.effectiveTier] ?? 0) + 1;
      bySubscriptionStatus[state.subscriptionStatus] = (bySubscriptionStatus[state.subscriptionStatus] ?? 0) + 1;
      if (state.trial.active) activeTrials++;
      if (state.subscriptionStatus === 'ACTIVE' || state.subscriptionStatus === 'PAST_DUE') {
        const price = this.billing ? this.billing.priceForTier(state.planTier) : PLAN_CATALOG[state.planTier].monthlyPriceEur;
        if (price === null) unpricedPaidTenants++;
        else estimatedMrrEur += price;
      }
    }

    const [daily, activeOrgs, activeUsers, storage, failureRate] = await Promise.all([
      this.db.query(
        `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                count(*)::int AS total,
                count(*) FILTER (WHERE status = 'FAILED')::int AS failed
           FROM analyses WHERE created_at >= NOW() - INTERVAL '14 days'
          GROUP BY 1 ORDER BY 1`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT count(DISTINCT organization_id)::int AS count FROM analyses WHERE created_at >= NOW() - INTERVAL '30 days'`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT count(DISTINCT actor_id)::int AS count FROM audit_events
          WHERE action = 'auth.login.succeeded' AND created_at >= NOW() - INTERVAL '30 days'`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT (COALESCE((SELECT SUM(file_size) FROM uploaded_files), 0) +
                 COALESCE((SELECT SUM(file_size) FROM reports), 0))::text AS bytes`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'FAILED')::int AS failed
           FROM analyses WHERE created_at >= NOW() - INTERVAL '7 days'`,
        [],
        { bypassRls: true }
      ),
    ]);

    const total7d = failureRate.rows?.[0]?.total ?? 0;
    const failed7d = failureRate.rows?.[0]?.failed ?? 0;
    return {
      generatedAt: now.toISOString(),
      tenants: {
        total: orgs.rows?.length ?? 0,
        byEffectiveTier,
        bySubscriptionStatus,
        activeTrials,
        activeLast30Days: activeOrgs.rows?.[0]?.count ?? 0,
      },
      activeUsersLast30Days: activeUsers.rows?.[0]?.count ?? 0,
      revenue: {
        estimatedMrrEur,
        estimatedArrEur: estimatedMrrEur * 12,
        unpricedPaidTenants,
        basis: 'Configured list prices × ACTIVE/PAST_DUE subscriptions; excludes coupons, credits and tax.',
      },
      analysesPerDay: (daily.rows ?? []).map((r: any) => ({ day: r.day, total: r.total, failed: r.failed })),
      analysisErrorRate7d: total7d > 0 ? failed7d / total7d : null,
      analyses7d: { total: total7d, failed: failed7d },
      storageBytes: Number(storage.rows?.[0]?.bytes ?? 0),
    };
  }

  async getTenants() {
    const res = await this.db.query(
      `SELECT
         o.id,
         o.name,
         o.slug,
         o.plan_tier as "planTier",
         o.status,
         o.created_at as "createdAt",
         o.subscription_status as "subscriptionStatus",
         o.trial_tier as "trialTier",
         o.trial_ends_at as "trialEndsAt",
         o.limit_overrides as "limitOverrides",
         (SELECT count(*)::int FROM organization_members m WHERE m.organization_id = o.id) as "userCount",
         (SELECT count(*)::int FROM projects p WHERE p.organization_id = o.id) as "projectCount",
         (SELECT count(*)::int FROM analyses a WHERE a.organization_id = o.id) as "analysisCount",
         (SELECT count(*)::int FROM analyses a WHERE a.organization_id = o.id AND a.status = 'FAILED'
             AND a.created_at >= NOW() - INTERVAL '30 days') as "failedAnalyses30d",
         (COALESCE((SELECT SUM(f.file_size) FROM uploaded_files f WHERE f.organization_id = o.id), 0) +
          COALESCE((SELECT SUM(r.file_size) FROM reports r WHERE r.organization_id = o.id), 0))::bigint as "storageBytes"
       FROM organizations o
       ORDER BY o.created_at DESC`,
      [],
      { bypassRls: true }
    );
    const rows = res.rows ?? [];
    let usageByOrg: Map<string, Record<string, number>> = new Map();
    if (this.usage) {
      try {
        usageByOrg = (await this.usage.getPlatformTotalsSince(currentPeriodStart())) as Map<string, Record<string, number>>;
      } catch (err: any) {
        this.logger.warn(`Usage totals unavailable: ${err?.message ?? err}`);
      }
    }
    const now = new Date();
    return rows.map((row: any) => {
      const state = resolvePlanState(
        {
          plan_tier: row.planTier,
          subscription_status: row.subscriptionStatus,
          trial_tier: row.trialTier,
          trial_ends_at: row.trialEndsAt,
          limit_overrides: row.limitOverrides,
        },
        now
      );
      return {
        ...row,
        storageBytes: row.storageBytes !== undefined ? Number(row.storageBytes) : undefined,
        effectiveTier: state.effectiveTier,
        trialActive: state.trial.active,
        hasLimitOverrides: state.hasLimitOverrides,
        usageThisMonth: usageByOrg.get(row.id) ?? {},
      };
    });
  }

  /** Support console (10.14): read-only tenant lookup by id, slug, name or member e-mail. */
  async searchTenants(query: string) {
    const q = query.trim();
    if (q.length < 2) throw new BadRequestException('Search query must be at least 2 characters');
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const res = await this.db.query(
      `SELECT DISTINCT o.id, o.name, o.slug, o.plan_tier AS "planTier", o.status, o.created_at AS "createdAt"
         FROM organizations o
         LEFT JOIN organization_members m ON m.organization_id = o.id
         LEFT JOIN users u ON u.id = m.user_id
        WHERE o.id::text = $1 OR o.slug ILIKE $2 OR o.name ILIKE $2 OR u.email ILIKE $2
        ORDER BY o.created_at DESC
        LIMIT 25`,
      [q, like],
      { bypassRls: true }
    );
    return res.rows ?? [];
  }

  async getTenantDetail(organizationId: string) {
    if (!UUID_RE.test(organizationId)) throw new BadRequestException('organizationId must be a UUID');
    const orgRes = await this.db.query(
      `SELECT id, name, slug, plan_tier, status, created_at, subscription_status, current_period_end,
              cancel_at_period_end, trial_tier, trial_started_at, trial_ends_at, limit_overrides,
              artifact_retention_days, report_retention_days, stripe_customer_id IS NOT NULL AS has_billing_account
         FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    const org = orgRes.rows?.[0];
    if (!org) throw new NotFoundException(`Organization ${organizationId} not found`);

    const [members, projects, analyses, reports, auditTail] = await Promise.all([
      this.db.query(
        `SELECT u.id, u.email, u.full_name AS "fullName", u.status, m.role, m.created_at AS "joinedAt"
           FROM organization_members m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1 ORDER BY m.created_at ASC`,
        [organizationId],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT id, name, created_at AS "createdAt" FROM projects WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [organizationId],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT a.id, a.project_id AS "projectId", a.status, a.engine_types AS "engineTypes",
                a.target_release AS "targetRelease", a.created_at AS "createdAt", a.completed_at AS "completedAt",
                (SELECT count(*)::int FROM findings f WHERE f.analysis_id = a.id) AS "findingsCount"
           FROM analyses a WHERE a.organization_id = $1 ORDER BY a.created_at DESC LIMIT 25`,
        [organizationId],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT id, analysis_id AS "analysisId", format, file_size AS "fileSize", created_at AS "createdAt"
           FROM reports WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 25`,
        [organizationId],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT sequence_num AS "sequenceNum", action, target_type AS "resourceType", target_id AS "resourceId",
                actor_type AS "actorType", created_at AS "createdAt"
           FROM audit_events WHERE organization_id = $1 ORDER BY sequence_num DESC LIMIT 25`,
        [organizationId],
        { bypassRls: true }
      ),
    ]);

    const usage = this.entitlements ? await this.entitlements.getTenantUsage(organizationId) : null;
    return {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        createdAt: org.created_at,
        planTier: org.plan_tier,
        subscriptionStatus: org.subscription_status,
        currentPeriodEnd: org.current_period_end,
        cancelAtPeriodEnd: org.cancel_at_period_end,
        hasBillingAccount: org.has_billing_account,
        trial: { tier: org.trial_tier, startedAt: org.trial_started_at, endsAt: org.trial_ends_at },
        limitOverrides: org.limit_overrides ?? {},
        retention: {
          artifactRetentionDays: org.artifact_retention_days,
          reportRetentionDays: org.report_retention_days,
        },
      },
      usage,
      members: members.rows ?? [],
      projects: projects.rows ?? [],
      recentAnalyses: analyses.rows ?? [],
      recentReports: reports.rows ?? [],
      auditTail: auditTail.rows ?? [],
    };
  }

  /** Super-admin limit override for one tenant (plans are admin-configurable, 10.3). Audited in the tenant ledger. */
  async setTenantLimitOverrides(organizationId: string, overrides: PlanLimitOverrides, actor: AdminActor) {
    if (!UUID_RE.test(organizationId)) throw new BadRequestException('organizationId must be a UUID');
    const res = await this.db.query(
      `UPDATE organizations SET limit_overrides = $2::jsonb, updated_at = NOW() WHERE id = $1
       RETURNING id, limit_overrides`,
      [organizationId, JSON.stringify(overrides)],
      { bypassRls: true }
    );
    if (!res.rows?.length) throw new NotFoundException(`Organization ${organizationId} not found`);
    if (this.audit) {
      await this.audit.recordEvent({
        organizationId,
        action: 'admin.tenant.limits_overridden',
        resourceType: 'ORGANIZATION',
        resourceId: organizationId,
        payload: { overrides, byEmail: actor.email ?? null },
        actorType: 'HUMAN',
        actorId: actor.id,
      });
    }
    return { organizationId, limitOverrides: res.rows[0].limit_overrides };
  }

  /** Billing override (invoice / enterprise agreements). Audited via BillingService. */
  async setTenantPlan(organizationId: string, tier: PlanTierId, actor: AdminActor) {
    if (!UUID_RE.test(organizationId)) throw new BadRequestException('organizationId must be a UUID');
    if (!this.billing) throw new BadRequestException('Billing service unavailable');
    const exists = await this.db.query(`SELECT 1 FROM organizations WHERE id = $1`, [organizationId], {
      bypassRls: true,
    });
    if (!exists.rows?.length) throw new NotFoundException(`Organization ${organizationId} not found`);
    await this.billing.applySubscriptionPatch(
      organizationId,
      { planTier: tier },
      { source: 'super_admin_override' },
      { actorId: actor.id, actorType: 'HUMAN' }
    );
    return { organizationId, planTier: tier };
  }

  async getUsers() {
    const res = await this.db.query(
      `SELECT
         u.id,
         u.email,
         u.full_name as "fullName",
         u.system_role as "systemRole",
         u.status,
         u.created_at as "createdAt",
         COALESCE(
           json_agg(
             json_build_object(
               'organizationId', o.id,
               'organizationName', o.name,
               'role', m.role
             )
           ) FILTER (WHERE o.id IS NOT NULL),
           '[]'::json
         ) as organizations
       FROM users u
       LEFT JOIN organization_members m ON m.user_id = u.id
       LEFT JOIN organizations o ON o.id = m.organization_id
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [],
      { bypassRls: true }
    );
    return res.rows;
  }

  async updateUserRole(userId: string, systemRole: 'USER' | 'ADMIN' | 'SUPER_ADMIN', actor?: AdminActor) {
    const res = await this.db.query(
      `UPDATE users
       SET system_role = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, full_name as "fullName", system_role as "systemRole", status`,
      [systemRole, userId],
      { bypassRls: true }
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    this.logger.log(`Updated user ${userId} (${res.rows[0].email}) system role to ${systemRole}`);

    // Permission change (10.15): recorded in every tenant ledger the user belongs to.
    if (this.audit && actor) {
      const orgs = await this.db.query(
        `SELECT organization_id FROM organization_members WHERE user_id = $1`,
        [userId],
        { bypassRls: true }
      );
      for (const row of orgs.rows ?? []) {
        await this.audit.recordEvent({
          organizationId: row.organization_id,
          action: 'admin.user.system_role_changed',
          resourceType: 'USER',
          resourceId: userId,
          payload: { newSystemRole: systemRole, byEmail: actor.email ?? null },
          actorType: 'HUMAN',
          actorId: actor.id,
        });
      }
    }
    return res.rows[0];
  }

  /** Engine health straight from the analysis service registry; no fabricated counts. */
  async getEngineTrustCenter() {
    const checkedAt = new Date().toISOString();
    try {
      const [healthResp, enginesResp] = await Promise.all([
        fetch(`${this.pythonUrl()}/health`, { signal: AbortSignal.timeout(4000) }),
        fetch(`${this.pythonUrl()}/api/v1/engines`, { signal: AbortSignal.timeout(4000) }),
      ]);
      if (!enginesResp.ok) throw new Error(`engines endpoint HTTP ${enginesResp.status}`);
      const list = (await enginesResp.json()) as any[];
      const health = healthResp.ok ? await healthResp.json().catch(() => ({})) : null;
      const engines = (Array.isArray(list) ? list : []).map((e: any) => ({
        id: String(e.engine_type ?? e.id ?? ''),
        name: String(e.name ?? e.engine_type ?? ''),
        description: e.description ?? '',
        version: e.version ?? null,
        supportedArtifactTypes: Array.isArray(e.supported_artifact_types) ? e.supported_artifact_types : [],
        status: 'REGISTERED',
      }));
      return {
        engines,
        summary: {
          totalEngines: engines.length,
          registeredCount: engines.length,
          serviceStatus: healthResp.ok ? 'ONLINE' : 'DEGRADED',
          serviceVersion: health?.version ?? null,
          checkedAt,
        },
      };
    } catch (err: any) {
      this.logger.warn(`Could not fetch live engine registry from Python service: ${err.message}`);
      return {
        engines: [],
        summary: {
          totalEngines: null,
          registeredCount: 0,
          serviceStatus: 'OFFLINE',
          serviceVersion: null,
          checkedAt,
          error: String(err?.message ?? err).slice(0, 200),
        },
      };
    }
  }

  private async queueSnapshot(queue: Queue | undefined, name: string) {
    if (!queue) {
      return { queueName: name, status: 'UNAVAILABLE', counts: { ...EMPTY_COUNTS } };
    }
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      const isPaused = await queue.isPaused();
      return { queueName: name, status: isPaused ? 'PAUSED' : 'ACTIVE', counts: { ...EMPTY_COUNTS, ...counts } };
    } catch (err: any) {
      this.logger.error(`Error querying queue counts for ${name}: ${err.message}`);
      return { queueName: name, status: 'ERROR', counts: { ...EMPTY_COUNTS } };
    }
  }

  async getQueueStats() {
    return this.queueSnapshot(this.analysisQueue, 'analysis-queue');
  }

  /**
   * Incident visibility (13.11): queue depth, failed BullMQ jobs with reasons,
   * failed analyses and recent failure audit events across tenants.
   */
  async getIncidents() {
    const queues = await Promise.all([
      this.queueSnapshot(this.analysisQueue, 'analysis-queue'),
      this.queueSnapshot(this.maintenanceQueue, 'maintenance-queue'),
    ]);

    const failedJobs: any[] = [];
    for (const [queue, name] of [
      [this.analysisQueue, 'analysis-queue'],
      [this.maintenanceQueue, 'maintenance-queue'],
    ] as Array<[Queue | undefined, string]>) {
      if (!queue) continue;
      try {
        const jobs = await queue.getFailed(0, 19);
        for (const job of jobs) {
          failedJobs.push({
            queue: name,
            jobId: job.id,
            name: job.name,
            organizationId: (job.data as any)?.organizationId ?? null,
            analysisId: (job.data as any)?.analysisId ?? null,
            failedReason: String(job.failedReason ?? '').slice(0, 500),
            attemptsMade: job.attemptsMade,
            failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
          });
        }
      } catch (err: any) {
        this.logger.warn(`Could not list failed jobs for ${name}: ${err.message}`);
      }
    }

    const [failedAnalyses, failureEvents] = await Promise.all([
      this.db.query(
        `SELECT a.id, a.organization_id AS "organizationId", o.name AS "organizationName",
                a.project_id AS "projectId", a.engine_types AS "engineTypes", a.created_at AS "createdAt",
                a.completed_at AS "completedAt"
           FROM analyses a JOIN organizations o ON o.id = a.organization_id
          WHERE a.status = 'FAILED' AND a.created_at >= NOW() - INTERVAL '7 days'
          ORDER BY a.created_at DESC LIMIT 50`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT e.organization_id AS "organizationId", o.name AS "organizationName", e.action,
                e.target_type AS "resourceType", e.target_id AS "resourceId", e.created_at AS "createdAt",
                e.payload->>'error' AS error, e.payload->>'httpStatus' AS "httpStatus"
           FROM audit_events e JOIN organizations o ON o.id = e.organization_id
          WHERE (e.action LIKE '%.failed' OR e.action = 'billing.entitlement.denied')
            AND e.created_at >= NOW() - INTERVAL '24 hours'
          ORDER BY e.created_at DESC LIMIT 50`,
        [],
        { bypassRls: true }
      ),
    ]);

    failedJobs.sort((a, b) => String(b.failedAt ?? '').localeCompare(String(a.failedAt ?? '')));
    return {
      generatedAt: new Date().toISOString(),
      queues,
      failedJobs: failedJobs.slice(0, 40),
      failedAnalyses: failedAnalyses.rows ?? [],
      recentFailureEvents: failureEvents.rows ?? [],
    };
  }

  /** Metered usage across tenants for the current month (10.5 admin view). */
  async getPlatformUsage() {
    if (!this.usage) return { periodStart: currentPeriodStart().toISOString(), totals: {}, tenants: [] };
    const byOrg = await this.usage.getPlatformTotalsSince(currentPeriodStart());
    const totals: Record<string, number> = Object.fromEntries(UsageMetricEnum.options.map((m) => [m, 0]));
    const tenants: Array<{ organizationId: string; usage: Record<string, number> }> = [];
    for (const [organizationId, usage] of byOrg.entries()) {
      for (const [metric, value] of Object.entries(usage)) totals[metric] += Number(value) || 0;
      tenants.push({ organizationId, usage: usage as Record<string, number> });
    }
    return { periodStart: currentPeriodStart().toISOString(), totals, tenants };
  }
}
