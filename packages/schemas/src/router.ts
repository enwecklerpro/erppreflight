import { z } from 'zod';
import { EngineTypeEnum, TargetReleaseEnum } from './common';

export const RouterClassifyRequestSchema = z.object({
  problemText: z.string().default(''),
  artifactNames: z.array(z.string()).default([]),
  targetRelease: TargetReleaseEnum.optional(),
  projectContext: z.record(z.unknown()).optional(),
});
export type RouterClassifyRequest = z.infer<typeof RouterClassifyRequestSchema>;

export const RecommendedEngineSchema = z.object({
  engineType: EngineTypeEnum,
  confidence: z.number().min(0.0).max(0.60), // Enforced 0.60 ceiling
  rationale: z.string(),
  requiredArtifactsPresent: z.array(z.string()).default([]),
  missingArtifactsRequired: z.array(z.string()).default([]),
});
export type RecommendedEngine = z.infer<typeof RecommendedEngineSchema>;

export const RouterClassifyResponseSchema = z.object({
  status: z.enum(['SUCCESS', 'FALLBACK_DETERMINISTIC', 'UNKNOWN_INTENT']),
  recommendedEngines: z.array(RecommendedEngineSchema),
  suggestedWorkflow: z.enum(['SINGLE_ENGINE', 'MULTI_ENGINE_CHAIN']),
  missingArtifactsChecklist: z.array(z.string()).default([]),
  executionMode: z.enum(['DETERMINISTIC_FAST_PATH', 'LLM_SEMANTIC_PATH', 'FALLBACK']),
});
export type RouterClassifyResponse = z.infer<typeof RouterClassifyResponseSchema>;
