import type {
  PlanDefinition,
  PlanLimitValues,
  PlanTierId,
  SubscriptionStatus,
  UsageMeter,
} from '@erppreflight/schemas';

/** Plan tiers come from the single catalog in @erppreflight/schemas (plans.ts). */
export type PlanTier = PlanTierId;

/** Resolved plan for a tenant: catalog plan + per-tenant overrides. */
export interface PlanLimits {
  tier: PlanTier;
  displayName: string;
  monthlyPriceEur: number | null;
  /** Effective numeric limits (-1 = unlimited) after tenant overrides. */
  limits: PlanLimitValues;
  features: PlanDefinition['features'];
  retention: PlanDefinition['retention'];
  supportSlaHours: number;
}

export interface TrialState {
  active: boolean;
  tier: PlanTier | null;
  startedAt: string | null;
  endsAt: string | null;
  daysRemaining: number | null;
}

export interface TenantUsage {
  organizationId: string;
  /** Tier the tenant pays for (organizations.plan_tier). */
  planTier: PlanTier;
  /** Tier used for enforcement (trial tier while a trial is active). */
  effectiveTier: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trial: TrialState;
  periodStart: string;
  projectsCount: number;
  analysesThisMonthCount: number;
  landscapesCount: number;
  exportsThisMonthCount: number;
  storageBytes: number;
  aiTokensThisMonth: number;
  teamMembersCount: number;
  /** All metered totals for the current period (usage_events). */
  metered: Record<string, number>;
  meters: UsageMeter[];
  hasLimitOverrides: boolean;
  limits: PlanLimits;
  quotaStatus: {
    canCreateProject: boolean;
    canTriggerAnalysis: boolean;
    canAddLandscape: boolean;
    canUploadArtifact: boolean;
    canExportReport: boolean;
    canUseAgentGate: boolean;
    canUseAirGappedExport: boolean;
    canSyncCloudAlm: boolean;
    canAddTeamMember: boolean;
    canUseAiTokens: boolean;
    canUseWhatIfSimulation: boolean;
  };
}

export type EntitlementFeature =
  | 'PROJECT_CREATE'
  | 'RUN_ANALYSIS'
  | 'ADD_LANDSCAPE'
  | 'UPLOAD_ARTIFACT'
  | 'EXPORT_REPORT'
  | 'AGENT_GATE'
  | 'AIR_GAPPED_EXPORT'
  | 'CLOUD_ALM_SYNC'
  | 'ADD_TEAM_MEMBER'
  | 'AI_TOKENS'
  | 'WHAT_IF_SIMULATION';
