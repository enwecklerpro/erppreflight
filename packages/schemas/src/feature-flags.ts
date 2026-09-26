import { z } from 'zod';
import { PlanTierEnum } from './plans';

/** Centralized feature flags (spec C §63): environment / plan / org / user-cohort / beta targeting. */
export const FeatureFlagKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.-]{1,99}$/, 'Flag keys are lower-case letters, digits, dot, dash or underscore');

export const FlagEnvironmentEnum = z.enum(['development', 'test', 'production']);

export const FeatureFlagUpsertSchema = z
  .object({
    description: z.string().max(500).default(''),
    enabled: z.boolean(),
    /** Empty = all environments. */
    environments: z.array(FlagEnvironmentEnum).max(3).default([]),
    /** Empty = all plan tiers (evaluated against the tenant's effective tier). */
    planTiers: z.array(PlanTierEnum).max(5).default([]),
    /** Always on for these organizations (still subject to the kill switch `enabled`). */
    allowOrganizations: z.array(z.string().uuid()).max(500).default([]),
    /** Always off for these organizations. */
    denyOrganizations: z.array(z.string().uuid()).max(500).default([]),
    /** Deterministic per-user (or per-org) cohort percentage. */
    rolloutPercentage: z.number().int().min(0).max(100).default(100),
    /** Only organizations that opted into beta features. */
    betaOnly: z.boolean().default(false),
  })
  .strict();
export type FeatureFlagUpsert = z.infer<typeof FeatureFlagUpsertSchema>;

export const FeatureFlagSchema = FeatureFlagUpsertSchema.extend({
  key: FeatureFlagKeySchema,
  updatedBy: z.string().uuid().nullable(),
  updatedAt: z.string(),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const FeatureFlagEvaluationSchema = z.object({
  key: FeatureFlagKeySchema,
  enabled: z.boolean(),
  reason: z.enum([
    'KILL_SWITCH_OFF',
    'ENVIRONMENT_EXCLUDED',
    'ORGANIZATION_DENIED',
    'ORGANIZATION_ALLOWED',
    'PLAN_EXCLUDED',
    'BETA_ONLY',
    'OUTSIDE_ROLLOUT',
    'ENABLED',
  ]),
});
export type FeatureFlagEvaluation = z.infer<typeof FeatureFlagEvaluationSchema>;
