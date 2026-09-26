/**
 * Thin adapter for the public pricing page.
 *
 * TEMPORARY MIRROR: the tiers and limits below are copied verbatim from the plan
 * tiers the API enforces today (apps/api/src/modules/billing/entitlements.service.ts,
 * TIER_LIMITS). The shared plan catalog (packages/schemas/src/plans.ts, PLAN_CATALOG)
 * is owned by the billing workstream; when it lands, repoint `PUBLIC_PLANS` to it
 * and delete this constant. Do not add prices here that are not defined in code:
 * `priceEurMonthly: null` renders "Contact sales".
 */

export type PlanTier = 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | 'PARTNER';

export interface PublicPlan {
  tier: PlanTier;
  displayName: string;
  /** Monthly price in EUR as defined in code; null = not published ("Contact sales"). */
  priceEurMonthly: number | null;
  /** -1 = unlimited */
  maxProjects: number;
  maxAnalysesPerMonth: number;
  maxCustomCodeLoc: number;
  maxLandscapes: number;
  features: {
    agentGateEnabled: boolean;
    whatIfSimulationEnabled: boolean;
    airGappedExport: boolean;
    cloudAlmSync: boolean;
    auditLogRetentionDays: number;
    slaHours: number;
  };
}

export const PUBLIC_PLANS: readonly PublicPlan[] = [
  {
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
  {
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
  {
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
  {
    tier: 'ENTERPRISE',
    displayName: 'SAP Global Enterprise',
    priceEurMonthly: 4900,
    maxProjects: -1,
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
  {
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
];

export function getPublicPlans(): readonly PublicPlan[] {
  return PUBLIC_PLANS;
}
