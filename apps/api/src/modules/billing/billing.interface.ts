export type PlanTier = 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | 'PARTNER';

export interface PlanLimits {
  tier: PlanTier;
  displayName: string;
  priceEurMonthly: number;
  maxProjects: number; // -1 for unlimited
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

export interface TenantUsage {
  organizationId: string;
  planTier: PlanTier;
  projectsCount: number;
  analysesThisMonthCount: number;
  landscapesCount: number;
  limits: PlanLimits;
  quotaStatus: {
    canCreateProject: boolean;
    canTriggerAnalysis: boolean;
    canAddLandscape: boolean;
    canUseAgentGate: boolean;
    canUseAirGappedExport: boolean;
    canSyncCloudAlm: boolean;
  };
}

export type EntitlementFeature =
  | 'PROJECT_CREATE'
  | 'RUN_ANALYSIS'
  | 'ADD_LANDSCAPE'
  | 'AGENT_GATE'
  | 'AIR_GAPPED_EXPORT'
  | 'CLOUD_ALM_SYNC';
