import { z } from 'zod';
import { EngineTypeEnum, TargetReleaseEnum } from './common';

/**
 * Analyze experience, Problem Router, analysis progress and Full Project Preflight
 * contracts (Part 01 §1.4–§1.6, Part 03 §3.8, Part 05 §5.1 / §5.6). Shared by the
 * API (request validation) and the web app (response validation).
 */

// ---------------------------------------------------------------------------
// Project mode context (Part 01 §1.5)
// ---------------------------------------------------------------------------

export const DeploymentTypeEnum = z.enum(['PUBLIC_CLOUD', 'PRIVATE_CLOUD', 'ON_PREMISE', 'HYBRID']);
export type DeploymentType = z.infer<typeof DeploymentTypeEnum>;

export const SourceErpEnum = z.enum(['SAP_ECC', 'SAP_S4HANA', 'SAP_R3', 'NON_SAP', 'OTHER']);
export type SourceErp = z.infer<typeof SourceErpEnum>;

export const TargetProductEnum = z.enum([
  'S4HANA_CLOUD_PUBLIC',
  'S4HANA_CLOUD_PRIVATE',
  'S4HANA_ON_PREMISE',
  'SAP_BTP',
  'OTHER',
]);
export type TargetProduct = z.infer<typeof TargetProductEnum>;

const COUNTRY = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/, 'Use ISO 3166-1 alpha-2 country codes (e.g. DE, FR)'));
const MODULE = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9_-]{0,19}$/, 'Use SAP module codes (e.g. FI, MM, SD)'));

/** Editable project context. `null` clears a value; omitted keys stay unchanged. */
export const ProjectContextUpdateSchema = z
  .object({
    sourceErp: SourceErpEnum.nullable().optional(),
    sourceVersion: z.string().trim().max(80).nullable().optional(),
    targetProduct: TargetProductEnum.nullable().optional(),
    targetEdition: z.string().trim().max(80).nullable().optional(),
    targetRelease: TargetReleaseEnum.optional(),
    deploymentType: DeploymentTypeEnum.nullable().optional(),
    countries: z.array(COUNTRY).max(60).optional(),
    modules: z.array(MODULE).max(40).optional(),
  })
  .strict();
export type ProjectContextUpdate = z.infer<typeof ProjectContextUpdateSchema>;

export const ProjectContextSchema = z.object({
  sourceErp: SourceErpEnum.nullable(),
  sourceVersion: z.string().nullable(),
  targetProduct: TargetProductEnum.nullable(),
  targetEdition: z.string().nullable(),
  targetRelease: z.string().nullable(),
  deploymentType: DeploymentTypeEnum.nullable(),
  countries: z.array(z.string()),
  modules: z.array(z.string()),
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;

// ---------------------------------------------------------------------------
// Analysis progress (Part 03 §3.8)
// ---------------------------------------------------------------------------

export const AnalysisStageEnum = z.enum([
  'UPLOAD_VALIDATED',
  'PARSING',
  'RUNNING_RULES',
  'MATCHING_EVIDENCE',
  'GENERATING_TESTS',
  'FINALIZING',
]);
export type AnalysisStage = z.infer<typeof AnalysisStageEnum>;
export const ANALYSIS_STAGES: readonly AnalysisStage[] = AnalysisStageEnum.options;

export const StageStateEnum = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED']);
export type StageState = z.infer<typeof StageStateEnum>;

export const StageSnapshotSchema = z.object({
  state: StageStateEnum,
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  detail: z.record(z.unknown()).optional(),
});
export type StageSnapshot = z.infer<typeof StageSnapshotSchema>;

export const AnalysisProgressSchema = z.object({
  analysisId: z.string().uuid(),
  status: z.string(),
  kind: z.string(),
  currentStage: AnalysisStageEnum.nullable(),
  percent: z.number().min(0).max(100),
  stages: z.record(AnalysisStageEnum, StageSnapshotSchema),
  updatedAt: z.string().nullable(),
  terminal: z.boolean(),
});
export type AnalysisProgress = z.infer<typeof AnalysisProgressSchema>;

export const ProgressEventStatusEnum = z.enum(['STARTED', 'PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED']);
export const AnalysisProgressEventSchema = z.object({
  id: z.number().int(),
  analysisId: z.string().uuid(),
  stage: AnalysisStageEnum,
  status: ProgressEventStatusEnum,
  detail: z.record(z.unknown()),
  createdAt: z.string(),
});
export type AnalysisProgressEvent = z.infer<typeof AnalysisProgressEventSchema>;

// ---------------------------------------------------------------------------
// Problem Router (Part 05 §5.1)
// ---------------------------------------------------------------------------

export const ProblemRouteRequestSchema = z
  .object({
    problem: z.string().trim().min(3, 'Describe the problem in a few words').max(4000),
    projectId: z.string().uuid().optional(),
    fileIds: z.array(z.string().uuid()).max(50).optional(),
    objectIdentifier: z.string().trim().max(200).optional(),
    /** Ask for an optional LLM refinement (honoured only when the org data policy allows AI). */
    useAi: z.boolean().optional(),
  })
  .strict();
export type ProblemRouteRequest = z.infer<typeof ProblemRouteRequestSchema>;

export const RouteReasonSchema = z.object({
  kind: z.enum(['PHRASE', 'ARTIFACT', 'CONTEXT', 'OBJECT']),
  detail: z.string(),
  weight: z.number(),
});

export const RequiredInputSchema = z.object({
  description: z.string(),
  satisfiedBy: z.array(z.string()).default([]),
});

export const RouterSuggestionSchema = z.object({
  engine: EngineTypeEnum,
  engineName: z.string(),
  role: z.enum(['PRIMARY', 'SECONDARY']),
  score: z.number(),
  confidence: z.number().min(0).max(0.85),
  confidenceClass: z.literal('RULE_DERIVED'),
  why: z.array(RouteReasonSchema),
  condition: z.string().nullable(),
  acceptedFormats: z.array(z.string()),
  inputSummary: z.string().nullable(),
  requiredInputs: z.array(RequiredInputSchema).nullable(),
  matchingFileIds: z.array(z.string()),
});
export type RouterSuggestion = z.infer<typeof RouterSuggestionSchema>;

export const AiRouteSuggestionSchema = z.object({
  engine: EngineTypeEnum,
  reason: z.string(),
  confidence: z.number().min(0).max(0.6),
  confidenceClass: z.literal('INFERRED'),
  agreesWithDeterministic: z.boolean(),
});

export const AiRefinementSchema = z.object({
  status: z.enum(['APPLIED', 'DISABLED_BY_POLICY', 'NOT_REQUESTED', 'PROVIDER_UNAVAILABLE', 'REJECTED_INVALID_OUTPUT', 'BUDGET_EXCEEDED']),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokens: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  suggestions: z.array(AiRouteSuggestionSchema),
  conflicts: z.array(z.string()),
  note: z.string(),
});
export type AiRefinement = z.infer<typeof AiRefinementSchema>;

export const ProblemRouteResponseSchema = z.object({
  routingId: z.string().uuid(),
  classifierVersion: z.string(),
  problem: z.string(),
  suggestions: z.array(RouterSuggestionSchema),
  unmatched: z.boolean(),
  contractsAvailable: z.boolean(),
  context: z.object({
    projectId: z.string().nullable(),
    targetRelease: z.string().nullable(),
    sourceErp: z.string().nullable(),
    targetProduct: z.string().nullable(),
    deploymentType: z.string().nullable(),
    modules: z.array(z.string()),
    countries: z.array(z.string()),
  }),
  ai: AiRefinementSchema,
  notice: z.string(),
});
export type ProblemRouteResponse = z.infer<typeof ProblemRouteResponseSchema>;

// ---------------------------------------------------------------------------
// Full Project Preflight (Part 01 §1.6, Part 05 §5.6)
// ---------------------------------------------------------------------------

export const PreflightCategoryEnum = z.enum([
  'MIGRATION_BLOCKERS',
  'OUTPUT_PROBLEMS',
  'FORM_DATA_PATH',
  'UNSUPPORTED_APIS',
  'TRANSPORT_DEPENDENCIES',
  'EXTENSION_DEPENDENCIES',
  'INTEGRATION_COVERAGE',
  'OPERATIONAL_RISKS',
]);
export type PreflightCategory = z.infer<typeof PreflightCategoryEnum>;

export const FullPreflightRequestSchema = z
  .object({
    targetRelease: TargetReleaseEnum.optional(),
    /** Restrict the run to these engines (still only where artifacts match their contracts). */
    engines: z.array(EngineTypeEnum).min(1).max(19).optional(),
  })
  .strict();
export type FullPreflightRequest = z.infer<typeof FullPreflightRequestSchema>;

export const AnalysisListQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  kind: z.enum(['STANDARD', 'FULL_PREFLIGHT']).optional(),
});

// ---------------------------------------------------------------------------
// Reports hub (Part 01 §1.9)
// ---------------------------------------------------------------------------

export const ReportListQuerySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    reportType: z.string().trim().max(40).optional(),
    format: z.string().trim().max(40).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ReportListQuery = z.infer<typeof ReportListQuerySchema>;

export const ReportListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  analysisId: z.string().uuid(),
  analysisKind: z.string(),
  format: z.string(),
  reportType: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  checksumSha256: z.string(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
});
export type ReportListItem = z.infer<typeof ReportListItemSchema>;

export const ReportListResponseSchema = z.object({
  items: z.array(ReportListItemSchema),
  pagination: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export type ReportListResponse = z.infer<typeof ReportListResponseSchema>;
