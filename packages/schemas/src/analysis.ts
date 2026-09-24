import { z } from 'zod';
import {
  EngineTypeEnum,
  TargetReleaseEnum,
  ArtifactTypeEnum,
  AnalysisStatusEnum,
} from './common';
import { FindingSchema, FindingWireSchema } from './finding';

// --- Analysis Job Request ---

function normalizeJobRequestInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    jobId: obj.jobId ?? obj.job_id,
    tenantId: obj.tenantId ?? obj.tenant_id,
    projectId: obj.projectId ?? obj.project_id,
    engineType: obj.engineType ?? obj.engine_type,
    targetRelease: obj.targetRelease ?? obj.target_release ?? 'S4H_2023',
    artifactS3Key: obj.artifactS3Key ?? obj.artifact_s3_key ?? null,
    artifactType: obj.artifactType ?? obj.artifact_type ?? 'JSON',
    configuration: obj.configuration ?? {},
    rawContent: obj.rawContent ?? obj.raw_content ?? null,
  };
}

export const BaseAnalysisJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  engineType: EngineTypeEnum,
  targetRelease: TargetReleaseEnum.default('S4H_2023'),
  artifactS3Key: z.string().optional().nullable(),
  artifactType: ArtifactTypeEnum.default('JSON'),
  configuration: z.record(z.unknown()).default({}),
  rawContent: z.string().optional().nullable(),
});
export type AnalysisJobRequest = z.infer<typeof BaseAnalysisJobRequestSchema>;

export const AnalysisJobRequestSchema = z.preprocess(
  normalizeJobRequestInput,
  BaseAnalysisJobRequestSchema
);

function normalizeJobRequestWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    job_id: obj.job_id ?? obj.jobId,
    tenant_id: obj.tenant_id ?? obj.tenantId,
    project_id: obj.project_id ?? obj.projectId,
    engine_type: obj.engine_type ?? obj.engineType,
    target_release: obj.target_release ?? obj.targetRelease ?? 'S4H_2023',
    artifact_s3_key: obj.artifact_s3_key ?? obj.artifactS3Key ?? null,
    artifact_type: obj.artifact_type ?? obj.artifactType ?? 'JSON',
    configuration: obj.configuration ?? {},
    raw_content: obj.raw_content ?? obj.rawContent ?? null,
  };
}

export const BaseAnalysisJobRequestWireSchema = z.object({
  job_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid(),
  engine_type: EngineTypeEnum,
  target_release: TargetReleaseEnum.default('S4H_2023'),
  artifact_s3_key: z.string().optional().nullable(),
  artifact_type: ArtifactTypeEnum.default('JSON'),
  configuration: z.record(z.unknown()).default({}),
  raw_content: z.string().optional().nullable(),
});
export type AnalysisJobRequestWire = z.infer<typeof BaseAnalysisJobRequestWireSchema>;

export const AnalysisJobRequestWireSchema = z.preprocess(
  normalizeJobRequestWireInput,
  BaseAnalysisJobRequestWireSchema
);

// --- Metrics ---

function normalizeMetricsInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    executionTimeMs: obj.executionTimeMs ?? obj.execution_time_ms ?? 0,
    rulesEvaluated: obj.rulesEvaluated ?? obj.rules_evaluated ?? 0,
    artifactsScanned: obj.artifactsScanned ?? obj.artifacts_scanned ?? 1,
    additionalMetrics: obj.additionalMetrics ?? obj.additional_metrics ?? obj.custom_metrics ?? {},
  };
}

export const BaseAnalysisMetricsSchema = z.object({
  executionTimeMs: z.number().int().nonnegative().default(0),
  rulesEvaluated: z.number().int().nonnegative().default(0),
  artifactsScanned: z.number().int().nonnegative().default(1),
  additionalMetrics: z.record(z.unknown()).default({}),
});
export type AnalysisMetrics = z.infer<typeof BaseAnalysisMetricsSchema>;

export const AnalysisMetricsSchema = z.preprocess(
  normalizeMetricsInput,
  BaseAnalysisMetricsSchema
);

function normalizeMetricsWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    execution_time_ms: obj.execution_time_ms ?? obj.executionTimeMs ?? 0,
    rules_evaluated: obj.rules_evaluated ?? obj.rulesEvaluated ?? 0,
    artifacts_scanned: obj.artifacts_scanned ?? obj.artifactsScanned ?? 1,
    additional_metrics: obj.additional_metrics ?? obj.additionalMetrics ?? obj.custom_metrics ?? {},
  };
}

export const BaseAnalysisMetricsWireSchema = z.object({
  execution_time_ms: z.number().int().nonnegative().default(0),
  rules_evaluated: z.number().int().nonnegative().default(0),
  artifacts_scanned: z.number().int().nonnegative().default(1),
  additional_metrics: z.record(z.unknown()).default({}),
});
export type AnalysisMetricsWire = z.infer<typeof BaseAnalysisMetricsWireSchema>;

export const AnalysisMetricsWireSchema = z.preprocess(
  normalizeMetricsWireInput,
  BaseAnalysisMetricsWireSchema
);

// --- Analysis Job Response ---

function normalizeJobResponseInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    jobId: obj.jobId ?? obj.job_id,
    engineType: obj.engineType ?? obj.engine_type,
    status: obj.status,
    findings: obj.findings ?? [],
    metrics: obj.metrics ?? {},
    errorMessage: obj.errorMessage ?? obj.error_message ?? null,
  };
}

export const BaseAnalysisJobResponseSchema = z.object({
  jobId: z.string().uuid(),
  engineType: EngineTypeEnum,
  status: AnalysisStatusEnum,
  findings: z.array(FindingSchema).default([]),
  metrics: AnalysisMetricsSchema.default({
    executionTimeMs: 0,
    rulesEvaluated: 0,
    artifactsScanned: 1,
    additionalMetrics: {},
  }),
  errorMessage: z.string().optional().nullable(),
});
export type AnalysisJobResponse = z.infer<typeof BaseAnalysisJobResponseSchema>;

export const AnalysisJobResponseSchema = z.preprocess(
  normalizeJobResponseInput,
  BaseAnalysisJobResponseSchema
);

function normalizeJobResponseWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    job_id: obj.job_id ?? obj.jobId,
    engine_type: obj.engine_type ?? obj.engineType,
    status: obj.status,
    findings: obj.findings ?? [],
    metrics: obj.metrics ?? {},
    error_message: obj.error_message ?? obj.errorMessage ?? null,
  };
}

export const BaseAnalysisJobResponseWireSchema = z.object({
  job_id: z.string().uuid(),
  engine_type: EngineTypeEnum,
  status: AnalysisStatusEnum,
  findings: z.array(FindingWireSchema).default([]),
  metrics: AnalysisMetricsWireSchema.default({
    execution_time_ms: 0,
    rules_evaluated: 0,
    artifacts_scanned: 1,
    additional_metrics: {},
  }),
  error_message: z.string().optional().nullable(),
});
export type AnalysisJobResponseWire = z.infer<typeof BaseAnalysisJobResponseWireSchema>;

export const AnalysisJobResponseWireSchema = z.preprocess(
  normalizeJobResponseWireInput,
  BaseAnalysisJobResponseWireSchema
);
