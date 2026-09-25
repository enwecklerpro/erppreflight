import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  EntitlementFeature,
  PlanLimits,
  PlanTier,
  TenantUsage,
} from './billing.interface';

export const TIER_LIMITS: Record<PlanTier, PlanLimits> = {
  FREE: {
    tier: 'FREE',
    displayName: 'Community Sandbox',
    priceEurMonthly: 0,
    maxProjects: 1,
    maxAnalysesPerMonth: 10,
    maxCustomCodeLoc: 50_000,
    maxLandscapes: 1,
    features: {
      agentGateEnabled: false,
      whatIfSimulationEnabled: true,
      airGappedExport: false,
      cloudAlmSync: false,
      auditLogRetentionDays: 7,
      slaHours: 72,
    },
  },
  STARTER: {
    tier: 'STARTER',
    displayName: 'Clean Core Starter',
    priceEurMonthly: 490,
    maxProjects: 3,
    maxAnalysesPerMonth: 50,
    maxCustomCodeLoc: 250_000,
    maxLandscapes: 3,
    features: {
      agentGateEnabled: false,
      whatIfSimulationEnabled: true,
      airGappedExport: true,
      cloudAlmSync: false,
      auditLogRetentionDays: 30,
      slaHours: 24,
    },
  },
  PROFESSIONAL: {
    tier: 'PROFESSIONAL',
    displayName: 'Enterprise Preflight Pro',
    priceEurMonthly: 1490,
    maxProjects: 10,
    maxAnalysesPerMonth: 250,
    maxCustomCodeLoc: 1_000_000,
    maxLandscapes: 10,
    features: {
      agentGateEnabled: true,
      whatIfSimulationEnabled: true,
      airGappedExport: true,
      cloudAlmSync: true,
      auditLogRetentionDays: 90,
      slaHours: 8,
    },
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    displayName: 'SAP Global Enterprise',
    priceEurMonthly: 4900,
    maxProjects: -1, // Unlimited
    maxAnalysesPerMonth: -1,
    maxCustomCodeLoc: -1,
    maxLandscapes: -1,
    features: {
      agentGateEnabled: true,
      whatIfSimulationEnabled: true,
      airGappedExport: true,
      cloudAlmSync: true,
      auditLogRetentionDays: 365,
      slaHours: 1,
    },
  },
  PARTNER: {
    tier: 'PARTNER',
    displayName: 'System Integrator & Partner',
    priceEurMonthly: 7900,
    maxProjects: -1,
    maxAnalysesPerMonth: -1,
    maxCustomCodeLoc: -1,
    maxLandscapes: -1,
    features: {
      agentGateEnabled: true,
      whatIfSimulationEnabled: true,
      airGappedExport: true,
      cloudAlmSync: true,
      auditLogRetentionDays: 730,
      slaHours: 1,
    },
  },
};

@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Retrieves plan limits for a given plan tier.
   */
  getLimitsForTier(tier: string): PlanLimits {
    const normalized = (tier || 'FREE').toUpperCase() as PlanTier;
    return TIER_LIMITS[normalized] || TIER_LIMITS.FREE;
  }

  /**
   * Calculates comprehensive tenant usage, limits, and real-time quota gates.
   */
  async getTenantUsage(organizationId: string): Promise<TenantUsage> {
    // 1. Fetch organization plan tier
    const orgRes = await this.db.query(
      `SELECT plan_tier FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    const planTier = (orgRes.rows?.[0]?.plan_tier || 'FREE').toUpperCase() as PlanTier;
    const limits = this.getLimitsForTier(planTier);

    // 2. Fetch project count
    const projRes = await this.db.query(
      `SELECT count(*)::int as count FROM projects WHERE organization_id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    const projectsCount = projRes.rows?.[0]?.count || 0;

    // 3. Fetch analyses run during current calendar month
    const analysisRes = await this.db.query(
      `SELECT count(*)::int as count FROM analyses
       WHERE organization_id = $1 AND created_at >= date_trunc('month', NOW())`,
      [organizationId],
      { bypassRls: true }
    );
    const analysesThisMonthCount = analysisRes.rows?.[0]?.count || 0;

    // 4. Fetch registered landscapes count (if table exists)
    let landscapesCount = 0;
    try {
      const landRes = await this.db.query(
        `SELECT count(*)::int as count FROM landscapes WHERE organization_id = $1`,
        [organizationId],
        { bypassRls: true }
      );
      landscapesCount = landRes.rows?.[0]?.count || 0;
    } catch {
      landscapesCount = 0;
    }

    const canCreateProject = limits.maxProjects === -1 || projectsCount < limits.maxProjects;
    const canTriggerAnalysis =
      limits.maxAnalysesPerMonth === -1 || analysesThisMonthCount < limits.maxAnalysesPerMonth;
    const canAddLandscape = limits.maxLandscapes === -1 || landscapesCount < limits.maxLandscapes;

    return {
      organizationId,
      planTier,
      projectsCount,
      analysesThisMonthCount,
      landscapesCount,
      limits,
      quotaStatus: {
        canCreateProject,
        canTriggerAnalysis,
        canAddLandscape,
        canUseAgentGate: limits.features.agentGateEnabled,
        canUseAirGappedExport: limits.features.airGappedExport,
        canSyncCloudAlm: limits.features.cloudAlmSync,
      },
    };
  }

  /**
   * Asserts whether a tenant is entitled to perform a protected action.
   * Throws HTTP 403 Forbidden with remediation guidance if quota exceeded.
   */
  async checkEntitlement(organizationId: string, feature: EntitlementFeature): Promise<void> {
    const usage = await this.getTenantUsage(organizationId);

    switch (feature) {
      case 'PROJECT_CREATE':
        if (!usage.quotaStatus.canCreateProject) {
          throw new ForbiddenException(
            `Project quota exceeded for plan tier '${usage.planTier}' (${usage.projectsCount}/${usage.limits.maxProjects} projects). Upgrade to Professional or Enterprise for higher project capacity.`
          );
        }
        break;

      case 'RUN_ANALYSIS':
        if (!usage.quotaStatus.canTriggerAnalysis) {
          throw new ForbiddenException(
            `Monthly analysis scan limit reached for plan tier '${usage.planTier}' (${usage.analysesThisMonthCount}/${usage.limits.maxAnalysesPerMonth} runs this month). Upgrade your plan or wait until the next billing cycle.`
          );
        }
        break;

      case 'ADD_LANDSCAPE':
        if (!usage.quotaStatus.canAddLandscape) {
          throw new ForbiddenException(
            `SAP Landscape limit reached for plan tier '${usage.planTier}' (${usage.landscapesCount}/${usage.limits.maxLandscapes} landscapes). Upgrade to Professional or Enterprise to register additional SAP systems.`
          );
        }
        break;

      case 'AGENT_GATE':
        if (!usage.quotaStatus.canUseAgentGate) {
          throw new ForbiddenException(
            `Agentic Change Gate & MCP Client Governance requires plan tier 'PROFESSIONAL' or 'ENTERPRISE'. Current tier: '${usage.planTier}'.`
          );
        }
        break;

      case 'AIR_GAPPED_EXPORT':
        if (!usage.quotaStatus.canUseAirGappedExport) {
          throw new ForbiddenException(
            `Air-Gapped Standalone HTML / Offline Audit Exports requires plan tier 'STARTER', 'PROFESSIONAL', or 'ENTERPRISE'. Current tier: '${usage.planTier}'.`
          );
        }
        break;

      case 'CLOUD_ALM_SYNC':
        if (!usage.quotaStatus.canSyncCloudAlm) {
          throw new ForbiddenException(
            `Direct SAP Cloud ALM & Jira Delivery Traceability integration requires plan tier 'PROFESSIONAL' or 'ENTERPRISE'. Current tier: '${usage.planTier}'.`
          );
        }
        break;
    }
  }
}
