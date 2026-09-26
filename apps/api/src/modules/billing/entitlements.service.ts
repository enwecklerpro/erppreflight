import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PLAN_TIERS,
  PlanLimitKey,
  PlanLimitKeyEnum,
  PlanLimitOverridesSchema,
  PlanTierEnum,
  SubscriptionStatus,
  SubscriptionStatusEnum,
  UsageMeter,
  applyLimitOverrides,
  getPlanDefinition,
  isUnlimited,
} from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { UsageService, currentPeriodStart } from '../usage/usage.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementFeature, PlanLimits, PlanTier, TenantUsage, TrialState } from './billing.interface';
import { PlanLimitExceededException } from './plan-limit.exception';

/** Subscription states that keep the paid tier in force (PAST_DUE = Stripe retry window). */
export const PAID_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE']);

export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_TRIAL_TIER: PlanTier = 'PROFESSIONAL';

export interface OrganizationPlanRow {
  plan_tier?: string | null;
  subscription_status?: string | null;
  current_period_end?: string | Date | null;
  cancel_at_period_end?: boolean | null;
  trial_tier?: string | null;
  trial_started_at?: string | Date | null;
  trial_ends_at?: string | Date | null;
  limit_overrides?: unknown;
  created_at?: string | Date | null;
}

export interface ResolvedPlanState {
  planTier: PlanTier;
  effectiveTier: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trial: TrialState;
  limits: PlanLimits;
  hasLimitOverrides: boolean;
}

function tierRank(tier: PlanTier): number {
  return PLAN_TIERS.indexOf(tier);
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeTier(value: unknown): PlanTier {
  const parsed = PlanTierEnum.safeParse(String(value ?? 'FREE').toUpperCase());
  return parsed.success ? parsed.data : 'FREE';
}

/**
 * Pure plan resolution (unit-tested): subscription state + trial + tenant overrides
 * → the tier and limits enforced server-side.
 *  - an ACTIVE/TRIALING/PAST_DUE subscription keeps organizations.plan_tier;
 *  - otherwise an unexpired trial grants max(plan_tier, trial_tier);
 *  - otherwise plan_tier (FREE after cancellation / trial expiry = downgrade).
 */
export function resolvePlanState(row: OrganizationPlanRow | undefined, now: Date = new Date()): ResolvedPlanState {
  const planTier = normalizeTier(row?.plan_tier);
  const statusParsed = SubscriptionStatusEnum.safeParse(String(row?.subscription_status ?? 'NONE').toUpperCase());
  const subscriptionStatus: SubscriptionStatus = statusParsed.success ? statusParsed.data : 'NONE';
  const paid = PAID_STATUSES.has(subscriptionStatus);

  const trialTier = row?.trial_tier ? normalizeTier(row.trial_tier) : null;
  const trialEnds = toIso(row?.trial_ends_at);
  // A trial only matters while it grants more than the paid/assigned tier.
  const trialActive =
    !paid &&
    !!trialTier &&
    tierRank(trialTier) > tierRank(planTier) &&
    !!trialEnds &&
    now.getTime() < new Date(trialEnds).getTime();
  const daysRemaining = trialActive
    ? Math.max(0, Math.ceil((new Date(trialEnds!).getTime() - now.getTime()) / 86_400_000))
    : null;

  const effectiveTier: PlanTier = trialActive && trialTier ? trialTier : planTier;

  const plan = getPlanDefinition(effectiveTier);
  const overridesParsed = PlanLimitOverridesSchema.safeParse(
    row?.limit_overrides && typeof row.limit_overrides === 'object' ? row.limit_overrides : {}
  );
  const overrides = overridesParsed.success ? overridesParsed.data : {};
  const hasLimitOverrides = Object.keys(overrides).length > 0;

  return {
    planTier,
    effectiveTier,
    subscriptionStatus,
    currentPeriodEnd: toIso(row?.current_period_end),
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    trial: {
      active: trialActive,
      tier: trialTier,
      startedAt: toIso(row?.trial_started_at),
      endsAt: trialEnds,
      daysRemaining,
    },
    hasLimitOverrides,
    limits: {
      tier: effectiveTier,
      displayName: plan.displayName,
      monthlyPriceEur: plan.monthlyPriceEur,
      limits: applyLimitOverrides(plan.limits, overrides),
      features: plan.features,
      retention: plan.retention,
      supportSlaHours: plan.supportSlaHours,
    },
  };
}

function withinLimit(used: number, limit: number): boolean {
  return isUnlimited(limit) || used < limit;
}

const LIMIT_LABELS: Record<PlanLimitKey, string> = {
  projects: 'Project',
  analysesPerMonth: 'Monthly analysis',
  landscapes: 'SAP landscape',
  storageBytes: 'Storage',
  exportsPerMonth: 'Monthly report export',
  aiTokensPerMonth: 'Monthly AI token',
  teamMembers: 'Team member',
};

@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly usage?: UsageService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly audit?: AuditService
  ) {}

  /** Catalog limits for a tier (no tenant overrides). */
  getLimitsForTier(tier: string): PlanLimits {
    return resolvePlanState({ plan_tier: tier }).limits;
  }

  private trialDays(): number {
    const raw = this.config?.get<number | string>('TRIAL_DAYS') ?? process.env.TRIAL_DAYS;
    const n = raw === undefined || raw === '' ? DEFAULT_TRIAL_DAYS : Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 90 ? n : DEFAULT_TRIAL_DAYS;
  }

  private trialTier(): PlanTier {
    return normalizeTier(this.config?.get<string>('TRIAL_PLAN_TIER') ?? process.env.TRIAL_PLAN_TIER ?? DEFAULT_TRIAL_TIER);
  }

  /**
   * Loads the tenant's plan row. The trial is anchored at organization creation
   * (13.8): the first read after creation materialises trial_started_at =
   * created_at and trial_ends_at = created_at + TRIAL_DAYS and audits it.
   */
  async getPlanState(organizationId: string): Promise<ResolvedPlanState> {
    const res = await this.db.query(
      `SELECT plan_tier, subscription_status, current_period_end, cancel_at_period_end,
              trial_tier, trial_started_at, trial_ends_at, limit_overrides, created_at
         FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    let row: OrganizationPlanRow | undefined = res.rows?.[0];

    const days = this.trialDays();
    const trialTier = this.trialTier();
    if (
      row &&
      !row.trial_started_at &&
      days > 0 &&
      (row.subscription_status ?? 'NONE') === 'NONE' &&
      tierRank(trialTier) > tierRank(normalizeTier(row.plan_tier))
    ) {
      const upd = await this.db.query(
        `UPDATE organizations
            SET trial_tier = $2, trial_started_at = created_at,
                trial_ends_at = created_at + make_interval(days => $3::int), updated_at = NOW()
          WHERE id = $1 AND trial_started_at IS NULL
          RETURNING plan_tier, subscription_status, current_period_end, cancel_at_period_end,
                    trial_tier, trial_started_at, trial_ends_at, limit_overrides, created_at`,
        [organizationId, trialTier, days],
        { bypassRls: true }
      );
      if (upd.rows?.[0]) {
        row = upd.rows[0];
        await this.audit?.recordSafe({
          organizationId,
          action: 'billing.trial.started',
          resourceType: 'ORGANIZATION',
          resourceId: organizationId,
          payload: { trialTier, trialDays: days, endsAt: toIso(row!.trial_ends_at) },
        });
      }
    }
    return resolvePlanState(row);
  }

  /**
   * Plan, limits, current-period usage and quota gates for a tenant.
   */
  async getTenantUsage(organizationId: string): Promise<TenantUsage> {
    const state = await this.getPlanState(organizationId);
    const periodStart = currentPeriodStart();

    const count = async (sql: string): Promise<number> => {
      try {
        const r = await this.db.query(sql, [organizationId], { bypassRls: true });
        return Number(r.rows?.[0]?.count ?? 0);
      } catch (err: any) {
        this.logger.warn(`Usage count failed: ${err?.message ?? err}`);
        return 0;
      }
    };

    const [projectsCount, landscapesCount, teamMembersCount, metered, storageBytes] = await Promise.all([
      count(`SELECT count(*)::int AS count FROM projects WHERE organization_id = $1`),
      count(`SELECT count(*)::int AS count FROM landscapes WHERE organization_id = $1`),
      count(`SELECT count(*)::int AS count FROM organization_members WHERE organization_id = $1`),
      this.usage ? this.usage.getTotalsSince(organizationId, periodStart) : Promise.resolve(null),
      this.usage ? this.usage.getStoredBytes(organizationId) : Promise.resolve(0),
    ]);

    const analysesThisMonthCount = metered?.ANALYSIS_RUN ?? 0;
    const exportsThisMonthCount = metered?.REPORT_EXPORT ?? 0;
    const aiTokensThisMonth = metered?.AI_TOKENS ?? 0;
    const limits = state.limits.limits;

    const used: Record<PlanLimitKey, number> = {
      projects: projectsCount,
      analysesPerMonth: analysesThisMonthCount,
      landscapes: landscapesCount,
      storageBytes,
      exportsPerMonth: exportsThisMonthCount,
      aiTokensPerMonth: aiTokensThisMonth,
      teamMembers: teamMembersCount,
    };
    const meters: UsageMeter[] = PlanLimitKeyEnum.options.map((key) => ({
      key,
      used: used[key],
      limit: limits[key],
      unlimited: isUnlimited(limits[key]),
      exceeded: !isUnlimited(limits[key]) && used[key] >= limits[key],
    }));

    return {
      organizationId,
      planTier: state.planTier,
      effectiveTier: state.effectiveTier,
      subscriptionStatus: state.subscriptionStatus,
      currentPeriodEnd: state.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      trial: state.trial,
      periodStart: periodStart.toISOString(),
      projectsCount,
      analysesThisMonthCount,
      landscapesCount,
      exportsThisMonthCount,
      storageBytes,
      aiTokensThisMonth,
      teamMembersCount,
      metered: (metered ?? {}) as Record<string, number>,
      meters,
      hasLimitOverrides: state.hasLimitOverrides,
      limits: state.limits,
      quotaStatus: {
        canCreateProject: withinLimit(projectsCount, limits.projects),
        canTriggerAnalysis: withinLimit(analysesThisMonthCount, limits.analysesPerMonth),
        canAddLandscape: withinLimit(landscapesCount, limits.landscapes),
        canUploadArtifact: withinLimit(storageBytes, limits.storageBytes),
        canExportReport: withinLimit(exportsThisMonthCount, limits.exportsPerMonth),
        canUseAgentGate: state.limits.features.agentGate,
        canUseAirGappedExport: state.limits.features.airGappedExport,
        canSyncCloudAlm: state.limits.features.cloudAlmSync,
        canAddTeamMember: withinLimit(teamMembersCount, limits.teamMembers),
        canUseAiTokens: withinLimit(aiTokensThisMonth, limits.aiTokensPerMonth),
        canUseWhatIfSimulation: state.limits.features.whatIfSimulation,
        canUseIpAllowlist: state.limits.features.ipAllowlist,
      },
    };
  }

  private quotaError(usage: TenantUsage, key: PlanLimitKey, used: number): PlanLimitExceededException {
    const limit = usage.limits.limits[key];
    const period = key.endsWith('PerMonth') ? ' this month' : '';
    return new PlanLimitExceededException(
      key,
      used,
      limit,
      usage.effectiveTier,
      `${LIMIT_LABELS[key]} limit reached for plan '${usage.effectiveTier}' (${used}/${limit}${period}). Upgrade your plan in Settings → Billing${
        period ? ' or wait for the next billing period' : ''
      }.`
    );
  }

  /**
   * Asserts that a tenant may perform an action.
   *  - numeric/metered quota exhausted → 402 PLAN_LIMIT_EXCEEDED
   *  - feature not in plan → 403 Forbidden
   */
  async checkEntitlement(organizationId: string, feature: EntitlementFeature): Promise<void> {
    const usage = await this.getTenantUsage(organizationId);

    switch (feature) {
      case 'PROJECT_CREATE':
        if (!usage.quotaStatus.canCreateProject) throw this.quotaError(usage, 'projects', usage.projectsCount);
        break;
      case 'RUN_ANALYSIS':
        if (!usage.quotaStatus.canTriggerAnalysis)
          throw this.quotaError(usage, 'analysesPerMonth', usage.analysesThisMonthCount);
        break;
      case 'ADD_LANDSCAPE':
        if (!usage.quotaStatus.canAddLandscape) throw this.quotaError(usage, 'landscapes', usage.landscapesCount);
        break;
      case 'UPLOAD_ARTIFACT':
        if (!usage.quotaStatus.canUploadArtifact) throw this.quotaError(usage, 'storageBytes', usage.storageBytes);
        break;
      case 'EXPORT_REPORT':
        if (!usage.quotaStatus.canExportReport)
          throw this.quotaError(usage, 'exportsPerMonth', usage.exportsThisMonthCount);
        break;
      case 'AGENT_GATE':
        if (!usage.quotaStatus.canUseAgentGate) {
          throw new ForbiddenException(
            `Agentic Change Gate & MCP Client Governance requires plan tier 'PROFESSIONAL' or higher. Current tier: '${usage.effectiveTier}'.`
          );
        }
        break;
      case 'AIR_GAPPED_EXPORT':
        if (!usage.quotaStatus.canUseAirGappedExport) {
          throw new ForbiddenException(
            `Air-gapped offline exports require plan tier 'STARTER' or higher. Current tier: '${usage.effectiveTier}'.`
          );
        }
        break;
      case 'CLOUD_ALM_SYNC':
        if (!usage.quotaStatus.canSyncCloudAlm) {
          throw new ForbiddenException(
            `SAP Cloud ALM & Jira traceability requires plan tier 'PROFESSIONAL' or higher. Current tier: '${usage.effectiveTier}'.`
          );
        }
        break;
      case 'ADD_TEAM_MEMBER':
        if (!usage.quotaStatus.canAddTeamMember) throw this.quotaError(usage, 'teamMembers', usage.teamMembersCount);
        break;
      case 'AI_TOKENS':
        if (!usage.quotaStatus.canUseAiTokens)
          throw this.quotaError(usage, 'aiTokensPerMonth', usage.aiTokensThisMonth);
        break;
      case 'IP_ALLOWLIST':
        if (!usage.quotaStatus.canUseIpAllowlist) {
          throw new ForbiddenException({
            code: 'PLAN_FEATURE_REQUIRED',
            message: `IP allowlists are an Enterprise feature and not included in plan tier '${usage.effectiveTier}'. Contact sales to upgrade.`,
          });
        }
        break;
      case 'WHAT_IF_SIMULATION':
        if (!usage.quotaStatus.canUseWhatIfSimulation) {
          throw new ForbiddenException(
            `What-If change simulation is not included in plan tier '${usage.effectiveTier}'. Upgrade your plan in Settings → Billing.`
          );
        }
        break;
    }
  }
}
