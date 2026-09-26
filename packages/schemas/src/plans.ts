import { z } from 'zod';

/**
 * ERP Preflight — Single plan catalog (spec 10.3 / 10.5).
 *
 * This file is the ONE source of truth for plan tiers, limits, features and
 * list prices. It is consumed by:
 *   - apps/api EntitlementsService / EntitlementGuard (server-side enforcement),
 *   - apps/api BillingService (Stripe checkout line items),
 *   - apps/web billing settings page and the public pricing page.
 *
 * Values are the platform's CONFIGURED DEFAULTS. Operators can:
 *   - override list prices per tier with env `PLAN_PRICE_EUR_<TIER>` (API side),
 *   - bind a Stripe Price object per tier with env `STRIPE_PRICE_ID_<TIER>`,
 *   - override any numeric limit for a single tenant from the Super Admin
 *     console (persisted in organizations.limit_overrides, migration 012).
 *
 * `monthlyPriceEur: null` means "not sold self-service — contact sales".
 * `-1` for a limit means unlimited.
 */

export const PlanTierEnum = z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE', 'PARTNER']);
export type PlanTierId = z.infer<typeof PlanTierEnum>;

export const PLAN_TIERS: readonly PlanTierId[] = PlanTierEnum.options;

export const UNLIMITED = -1 as const;

/** Numeric, enforceable plan limits. */
export const PlanLimitKeyEnum = z.enum([
  'projects',
  'analysesPerMonth',
  'landscapes',
  'storageBytes',
  'exportsPerMonth',
  'aiTokensPerMonth',
  'teamMembers',
]);
export type PlanLimitKey = z.infer<typeof PlanLimitKeyEnum>;

export type PlanLimitValues = Record<PlanLimitKey, number>;

export interface PlanFeatures {
  agentGate: boolean;
  whatIfSimulation: boolean;
  airGappedExport: boolean;
  cloudAlmSync: boolean;
  reportBranding: boolean;
}

export interface PlanRetention {
  /** Audit-log retention promised by the plan (audit rows are append-only; see 10.15). */
  auditLogDays: number;
  /** Upper bound a tenant may configure for artifact retention (days). */
  maxArtifactRetentionDays: number;
  /** Upper bound a tenant may configure for report retention (days). */
  maxReportRetentionDays: number;
}

export interface PlanDefinition {
  tier: PlanTierId;
  displayName: string;
  summary: string;
  /** Whether the tier can be bought through self-service checkout. */
  selfServe: boolean;
  /** Configured monthly list price in EUR; null = contact sales. */
  monthlyPriceEur: number | null;
  currency: 'EUR';
  limits: PlanLimitValues;
  features: PlanFeatures;
  retention: PlanRetention;
  supportSlaHours: number;
}

const GiB = 1024 * 1024 * 1024;

export const PLAN_CATALOG: Readonly<Record<PlanTierId, PlanDefinition>> = Object.freeze({
  FREE: {
    tier: 'FREE',
    displayName: 'Community Sandbox',
    summary: 'Evaluate deterministic preflight engines on a single project.',
    selfServe: false,
    monthlyPriceEur: 0,
    currency: 'EUR',
    limits: {
      projects: 1,
      analysesPerMonth: 10,
      landscapes: 1,
      storageBytes: 1 * GiB,
      exportsPerMonth: 20,
      aiTokensPerMonth: 0,
      teamMembers: 2,
    },
    features: {
      agentGate: false,
      whatIfSimulation: true,
      airGappedExport: false,
      cloudAlmSync: false,
      reportBranding: false,
    },
    retention: { auditLogDays: 7, maxArtifactRetentionDays: 7, maxReportRetentionDays: 30 },
    supportSlaHours: 72,
  },
  STARTER: {
    tier: 'STARTER',
    displayName: 'Clean Core Starter',
    summary: 'Small teams running recurring clean-core and migration preflights.',
    selfServe: true,
    monthlyPriceEur: 490,
    currency: 'EUR',
    limits: {
      projects: 3,
      analysesPerMonth: 50,
      landscapes: 3,
      storageBytes: 10 * GiB,
      exportsPerMonth: 200,
      aiTokensPerMonth: 200_000,
      teamMembers: 5,
    },
    features: {
      agentGate: false,
      whatIfSimulation: true,
      airGappedExport: true,
      cloudAlmSync: false,
      reportBranding: false,
    },
    retention: { auditLogDays: 30, maxArtifactRetentionDays: 30, maxReportRetentionDays: 90 },
    supportSlaHours: 24,
  },
  PROFESSIONAL: {
    tier: 'PROFESSIONAL',
    displayName: 'Enterprise Preflight Pro',
    summary: 'Programme-level preflight with agent gate and delivery traceability.',
    selfServe: true,
    monthlyPriceEur: 1490,
    currency: 'EUR',
    limits: {
      projects: 10,
      analysesPerMonth: 250,
      landscapes: 10,
      storageBytes: 100 * GiB,
      exportsPerMonth: 1000,
      aiTokensPerMonth: 1_000_000,
      teamMembers: 25,
    },
    features: {
      agentGate: true,
      whatIfSimulation: true,
      airGappedExport: true,
      cloudAlmSync: true,
      reportBranding: true,
    },
    retention: { auditLogDays: 90, maxArtifactRetentionDays: 90, maxReportRetentionDays: 365 },
    supportSlaHours: 8,
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    displayName: 'SAP Global Enterprise',
    summary: 'Unlimited programmes, custom retention and contractual SLAs.',
    selfServe: false,
    monthlyPriceEur: null,
    currency: 'EUR',
    limits: {
      projects: UNLIMITED,
      analysesPerMonth: UNLIMITED,
      landscapes: UNLIMITED,
      storageBytes: UNLIMITED,
      exportsPerMonth: UNLIMITED,
      aiTokensPerMonth: UNLIMITED,
      teamMembers: UNLIMITED,
    },
    features: {
      agentGate: true,
      whatIfSimulation: true,
      airGappedExport: true,
      cloudAlmSync: true,
      reportBranding: true,
    },
    retention: { auditLogDays: 365, maxArtifactRetentionDays: 3650, maxReportRetentionDays: 3650 },
    supportSlaHours: 1,
  },
  PARTNER: {
    tier: 'PARTNER',
    displayName: 'System Integrator & Partner',
    summary: 'Multi-customer delivery for SAP partners and system integrators.',
    selfServe: false,
    monthlyPriceEur: null,
    currency: 'EUR',
    limits: {
      projects: UNLIMITED,
      analysesPerMonth: UNLIMITED,
      landscapes: UNLIMITED,
      storageBytes: UNLIMITED,
      exportsPerMonth: UNLIMITED,
      aiTokensPerMonth: UNLIMITED,
      teamMembers: UNLIMITED,
    },
    features: {
      agentGate: true,
      whatIfSimulation: true,
      airGappedExport: true,
      cloudAlmSync: true,
      reportBranding: true,
    },
    retention: { auditLogDays: 730, maxArtifactRetentionDays: 3650, maxReportRetentionDays: 3650 },
    supportSlaHours: 1,
  },
});

/** Returns the plan for a tier string, falling back to FREE for unknown values. */
export function getPlanDefinition(tier: string | null | undefined): PlanDefinition {
  const normalized = String(tier ?? 'FREE').toUpperCase();
  const parsed = PlanTierEnum.safeParse(normalized);
  return PLAN_CATALOG[parsed.success ? parsed.data : 'FREE'];
}

export function isUnlimited(limit: number): boolean {
  return limit === UNLIMITED;
}

/** Per-tenant limit overrides set by a Super Admin (subset of numeric limits). */
export const PlanLimitOverridesSchema = z
  .object({
    projects: z.number().int().min(-1).optional(),
    analysesPerMonth: z.number().int().min(-1).optional(),
    landscapes: z.number().int().min(-1).optional(),
    storageBytes: z.number().int().min(-1).optional(),
    exportsPerMonth: z.number().int().min(-1).optional(),
    aiTokensPerMonth: z.number().int().min(-1).optional(),
    teamMembers: z.number().int().min(-1).optional(),
  })
  .strict();
export type PlanLimitOverrides = z.infer<typeof PlanLimitOverridesSchema>;

export function applyLimitOverrides(
  base: PlanLimitValues,
  overrides: PlanLimitOverrides | null | undefined
): PlanLimitValues {
  if (!overrides) return { ...base };
  const merged: PlanLimitValues = { ...base };
  for (const key of PlanLimitKeyEnum.options) {
    const v = overrides[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= -1) merged[key] = v;
  }
  return merged;
}

// -----------------------------------------------------------------------------
// Usage metering (spec 10.5)
// -----------------------------------------------------------------------------

export const UsageMetricEnum = z.enum([
  'ANALYSIS_RUN',
  'ENGINE_EXECUTION',
  'ARTIFACT_UPLOAD',
  'ARTIFACT_BYTES',
  'REPORT_EXPORT',
  'AI_TOKENS',
]);
export type UsageMetric = z.infer<typeof UsageMetricEnum>;

/** Metered metrics that count against a monthly plan limit. */
export const USAGE_METRIC_MONTHLY_LIMIT: Partial<Record<UsageMetric, PlanLimitKey>> = {
  ANALYSIS_RUN: 'analysesPerMonth',
  REPORT_EXPORT: 'exportsPerMonth',
  AI_TOKENS: 'aiTokensPerMonth',
};

// -----------------------------------------------------------------------------
// Subscription / billing state exposed to the web app
// -----------------------------------------------------------------------------

export const SubscriptionStatusEnum = z.enum([
  'NONE',
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'UNPAID',
  'CANCELED',
  'INCOMPLETE',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusEnum>;

export const UsageMeterSchema = z.object({
  key: PlanLimitKeyEnum,
  used: z.number(),
  limit: z.number(),
  unlimited: z.boolean(),
  exceeded: z.boolean(),
});
export type UsageMeter = z.infer<typeof UsageMeterSchema>;

export const BillingOverviewSchema = z.object({
  organizationId: z.string().uuid(),
  planTier: PlanTierEnum,
  effectiveTier: PlanTierEnum,
  subscriptionStatus: SubscriptionStatusEnum,
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  trial: z.object({
    active: z.boolean(),
    tier: PlanTierEnum.nullable(),
    startedAt: z.string().nullable(),
    endsAt: z.string().nullable(),
    daysRemaining: z.number().int().nullable(),
  }),
  periodStart: z.string(),
  meters: z.array(UsageMeterSchema),
  metered: z.record(z.string(), z.number()),
  hasLimitOverrides: z.boolean(),
  provider: z.object({
    configured: z.boolean(),
    name: z.enum(['stripe', 'local', 'none']),
    checkoutAvailable: z.boolean(),
    portalAvailable: z.boolean(),
  }),
});
export type BillingOverview = z.infer<typeof BillingOverviewSchema>;

export const InvoiceSummarySchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  status: z.string().nullable(),
  amountDue: z.number(),
  amountPaid: z.number(),
  currency: z.string(),
  createdAt: z.string(),
  hostedInvoiceUrl: z.string().nullable(),
  invoicePdf: z.string().nullable(),
});
export type InvoiceSummary = z.infer<typeof InvoiceSummarySchema>;

// -----------------------------------------------------------------------------
// Retention settings (spec 10.16)
// -----------------------------------------------------------------------------

/** 0 = delete immediately after analysis (artifacts) / never keep (reports: not allowed). */
export const RetentionSettingsSchema = z
  .object({
    artifactRetentionDays: z.number().int().min(0).max(3650).nullable(),
    reportRetentionDays: z.number().int().min(1).max(3650).nullable(),
  })
  .strict();
export type RetentionSettings = z.infer<typeof RetentionSettingsSchema>;
