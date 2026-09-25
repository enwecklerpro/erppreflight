export type AiProviderType = 'ANTHROPIC' | 'OPENAI' | 'OLLAMA_LOCAL' | 'DETERMINISTIC_FALLBACK';

export interface TenantDataPolicy {
  deterministicOnly?: boolean;
  allowAiAssistance?: boolean;
  dataRetentionDays?: number;
  airGappedExportOnly?: boolean;
  telemetryOptOut?: boolean;
}

export interface AiRequestOptions {
  tenantId: string;
  dataPolicy?: TenantDataPolicy;
  preferredProvider?: AiProviderType;
  maxTokens?: number;
  temperature?: number;
}

export interface FindingExplanationRequest {
  ruleId: string;
  category: string;
  title: string;
  description: string;
  affectedObjects: string[];
  remediation?: string;
  technicalDetails?: Record<string, unknown>;
}

export interface FindingExplanationResponse {
  explanation: string;
  remediationSteps: string[];
  caveats: string[];
  confidenceScore: number; // Strictly <= 0.60
  confidenceClass: 'INFERRED' | 'RULE_DERIVED';
  providerUsed: AiProviderType;
  deterministicBypass: boolean;
}

export interface IntentClassificationRequest {
  problemDescription: string;
  artifactFilenames?: string[];
  targetRelease?: string;
}

export interface IntentClassificationResponse {
  recommendedEngines: Array<{
    engine: string;
    confidence: number;
    reason: string;
  }>;
  suggestedWorkflow: string;
  confidenceScore: number; // Strictly <= 0.60
  providerUsed: AiProviderType;
  deterministicBypass: boolean;
}

export interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: number | null;
  isOpen: boolean;
}
