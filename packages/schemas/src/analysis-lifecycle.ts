import { z } from 'zod';
import { EngineTypeEnum } from './common';

/**
 * Analysis run lifecycle contracts (section C §15/§16: persisted runs, cancel, rerun,
 * analysis detail; §18 Test Lab runs in the run history). Shared by the API (request
 * validation, response shaping) and the web app (response validation, Axiom 1.2).
 */

/** Every status an analysis record can have (engine wire responses use AnalysisStatusEnum). */
export const AnalysisRunStatusEnum = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']);
export type AnalysisRunStatus = z.infer<typeof AnalysisRunStatusEnum>;

export const ANALYSIS_ACTIVE_STATUSES: readonly AnalysisRunStatus[] = ['QUEUED', 'RUNNING'];
export const ANALYSIS_TERMINAL_STATUSES: readonly AnalysisRunStatus[] = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'];

/**
 * STANDARD / FULL_PREFLIGHT runs write findings. LAB_REGRESSION (Test Lab regression cases) and
 * LAB_SCENARIO (synthetic scenarios) are Test Lab executions recorded in the run history;
 * they never write findings rows and never count as "the latest analysis" of a project.
 */
export const AnalysisKindEnum = z.enum(['STANDARD', 'FULL_PREFLIGHT', 'LAB_REGRESSION', 'LAB_SCENARIO']);
export type AnalysisKind = z.infer<typeof AnalysisKindEnum>;
export const FINDING_PRODUCING_KINDS: readonly AnalysisKind[] = ['STANDARD', 'FULL_PREFLIGHT'];
export const LAB_KINDS: readonly AnalysisKind[] = ['LAB_REGRESSION', 'LAB_SCENARIO'];

/** Roles that may cancel or re-run analyses (VIEWER and AUDITOR are read-only). */
export const ANALYSIS_CONTROL_ROLES = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT', 'MIGRATION_CONSULTANT'] as const;

export const CancelAnalysisRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type CancelAnalysisRequest = z.infer<typeof CancelAnalysisRequestSchema>;

export const RerunAnalysisRequestSchema = z.object({}).strict();
export type RerunAnalysisRequest = z.infer<typeof RerunAnalysisRequestSchema>;

/**
 * Outcome of POST /analyses/:id/cancel.
 *  - CANCELLED: the run was still queued (job removed) or its worker is gone; final now.
 *  - CANCELLATION_REQUESTED: a worker is executing it; it stops at the next engine step and
 *    aborts the in-flight analysis-service call, then finalises CANCELLED.
 *  - ALREADY_CANCELLED / ALREADY_REQUESTED: idempotent repeats.
 */
export const CancelOutcomeEnum = z.enum(['CANCELLED', 'CANCELLATION_REQUESTED', 'ALREADY_CANCELLED', 'ALREADY_REQUESTED']);
export type CancelOutcome = z.infer<typeof CancelOutcomeEnum>;

export const CancelAnalysisResponseSchema = z.object({
  analysisId: z.string().uuid(),
  outcome: CancelOutcomeEnum,
  status: AnalysisRunStatusEnum,
  cancelRequestedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
});
export type CancelAnalysisResponse = z.infer<typeof CancelAnalysisResponseSchema>;

export const RerunAnalysisResponseSchema = z.object({
  analysisId: z.string().uuid(),
  status: AnalysisRunStatusEnum,
  kind: AnalysisKindEnum,
  engineTypes: z.array(z.string()),
  targetRelease: z.string().nullable(),
  rerunOfAnalysisId: z.string().uuid(),
  knowledgeSnapshotId: z.string().uuid().nullable(),
  previousKnowledgeSnapshotId: z.string().uuid().nullable(),
});
export type RerunAnalysisResponse = z.infer<typeof RerunAnalysisResponseSchema>;

// ---------------------------------------------------------------------------
// Persisted run inputs (analyses.inputs, version 1)
// ---------------------------------------------------------------------------

export const AnalysisInputFileSchema = z.object({
  fileId: z.string().uuid(),
  fileName: z.string(),
  artifactType: z.string(),
  sha256: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
});
export type AnalysisInputFile = z.infer<typeof AnalysisInputFileSchema>;

export const AnalysisAssignmentSchema = z.object({
  engine: EngineTypeEnum,
  fileId: z.string().uuid(),
  companions: z.array(z.object({ fileId: z.string().uuid(), configKey: z.string() })).default([]),
});

export const AnalysisInputsSchema = z.object({
  version: z.literal(1),
  files: z.array(AnalysisInputFileSchema).default([]),
  /** Configuration as requested by the caller (before the organization data policy). */
  requestedConfiguration: z.record(z.unknown()).default({}),
  /** Configuration actually sent to the engines (data policy applied). */
  effectiveConfiguration: z.record(z.unknown()).default({}),
  assignmentMode: z.enum(['CROSS', 'AUTO', 'PLANNED']).default('CROSS'),
  assignments: z.array(AnalysisAssignmentSchema).optional(),
  stages: z.array(z.array(EngineTypeEnum)).optional(),
  /** Test Lab runs: regression test cases / scenario executed. */
  testCaseIds: z.array(z.string().uuid()).optional(),
  scenarioId: z.string().nullable().optional(),
  trigger: z.enum(['MANUAL', 'BATCH', 'SCHEDULED', 'API', 'RERUN']).optional(),
});
export type AnalysisInputs = z.infer<typeof AnalysisInputsSchema>;

// ---------------------------------------------------------------------------
// Analysis detail (GET /analyses/:id/detail)
// ---------------------------------------------------------------------------

export const AnalysisEngineCallSchema = z
  .object({
    engine: z.string(),
    fileId: z.string().nullable().optional(),
    fileName: z.string().nullable().optional(),
    outcome: z.string(),
    findings: z.number().optional(),
    rulesEvaluated: z.number().optional(),
    durationMs: z.number().optional(),
    engineVersion: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .passthrough();
export type AnalysisEngineCall = z.infer<typeof AnalysisEngineCallSchema>;

export const LabTestResultSchema = z.object({
  runId: z.string().uuid(),
  testCaseId: z.string().uuid(),
  title: z.string(),
  engine: z.string(),
  ruleId: z.string(),
  expectedOutcome: z.string(),
  status: z.enum(['PASSED', 'FAILED', 'ERROR']),
  findingPresent: z.boolean().nullable(),
  artifactSha256: z.string().nullable(),
  engineVersion: z.string().nullable(),
  executionTimeMs: z.number().nullable(),
  errorMessage: z.string().nullable(),
  baselineVerdict: z.string().nullable(),
});
export type LabTestResult = z.infer<typeof LabTestResultSchema>;

export const LabRunSummarySchema = z.object({
  type: z.enum(['REGRESSION', 'SCENARIO']),
  trigger: z.string().nullable(),
  batchId: z.string().uuid().nullable(),
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  errored: z.number().int(),
  scenario: z
    .object({
      scenarioId: z.string().nullable(),
      domain: z.string(),
      verdict: z.string(),
      assertions: z.number().int(),
      passedAssertions: z.number().int(),
      payloadSha256: z.string(),
    })
    .nullable()
    .optional(),
});
export type LabRunSummary = z.infer<typeof LabRunSummarySchema>;

export const GeneratedTestSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  analysisId: z.string().uuid().nullable(),
  findingId: z.string().uuid().nullable(),
  findingSeverity: z.string().nullable(),
  findingRuleId: z.string().nullable(),
  findingEngine: z.string().nullable(),
  title: z.string(),
  testType: z.string(),
  steps: z.array(z.object({ order: z.number(), action: z.string() })),
  expectedResult: z.string(),
  status: z.string(),
  generatorVersion: z.string().nullable(),
  createdAt: z.string().nullable(),
  promotion: z
    .object({
      regressionTestCaseId: z.string().uuid(),
      promotedAt: z.string().nullable(),
      caseStatus: z.string().nullable(),
      lastRunStatus: z.string().nullable(),
      lastRunAt: z.string().nullable(),
    })
    .nullable(),
  /** False when the source finding has no recorded CLEAN source artifact (cannot become executable). */
  promotable: z.boolean(),
});
export type GeneratedTest = z.infer<typeof GeneratedTestSchema>;

export const GeneratedTestListSchema = z.object({ items: z.array(GeneratedTestSchema) });

export const PromoteGeneratedTestRequestSchema = z
  .object({
    /** Default FINDING_ABSENT: the generated test verifies that the fix removed the finding. */
    expectedOutcome: z.enum(['FINDING_ABSENT', 'FINDING_PRESENT']).optional(),
  })
  .strict();
export type PromoteGeneratedTestRequest = z.infer<typeof PromoteGeneratedTestRequestSchema>;

export const PromoteGeneratedTestResponseSchema = z.object({
  generatedTestId: z.string().uuid(),
  regressionTestCaseId: z.string().uuid(),
  created: z.boolean(),
});

export const AnalysisDetailSchema = z.object({
  analysis: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    projectName: z.string().nullable(),
    status: AnalysisRunStatusEnum,
    kind: AnalysisKindEnum,
    engineTypes: z.array(z.string()),
    targetRelease: z.string().nullable(),
    findingsCount: z.number().int(),
    isBaseline: z.boolean(),
    problemStatement: z.string().nullable(),
    routingId: z.string().uuid().nullable(),
    triggeredBy: z.object({ id: z.string().uuid(), name: z.string().nullable(), email: z.string().nullable() }).nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    durationMs: z.number().nullable(),
    currentStage: z.string().nullable(),
    progressPercent: z.number(),
    errorMessage: z.string().nullable(),
  }),
  cancellation: z
    .object({
      requestedAt: z.string().nullable(),
      requestedBy: z.object({ id: z.string().uuid(), name: z.string().nullable(), email: z.string().nullable() }).nullable(),
      reason: z.string().nullable(),
      cancelledAt: z.string().nullable(),
      discardedFindings: z.number().int().nullable(),
    })
    .nullable(),
  lineage: z.object({
    rerunOf: z.object({ id: z.string().uuid(), status: z.string(), createdAt: z.string() }).nullable(),
    reruns: z.array(z.object({ id: z.string().uuid(), status: z.string(), createdAt: z.string() })),
  }),
  knowledgeSnapshot: z
    .object({
      id: z.string().uuid(),
      seq: z.number().int().nullable(),
      adapterId: z.string().nullable(),
      status: z.string().nullable(),
      publishedAt: z.string().nullable(),
      contentSha256: z.string().nullable(),
      /** A newer snapshot has been published since this run (a rerun would use it). */
      superseded: z.boolean(),
    })
    .nullable(),
  inputs: z.object({
    recorded: z.boolean(),
    assignmentMode: z.string(),
    files: z.array(
      AnalysisInputFileSchema.extend({
        /** Current state of the artifact (null = deleted, e.g. by retention). */
        currentStatus: z.string().nullable(),
        /** SHA-256 now stored for the file id differs from the recorded one. */
        changed: z.boolean(),
      })
    ),
    requestedConfiguration: z.record(z.unknown()),
    effectiveConfiguration: z.record(z.unknown()),
    assignments: z.array(z.object({ engine: z.string(), fileId: z.string(), companions: z.array(z.object({ fileId: z.string(), configKey: z.string() })) })),
    stages: z.array(z.array(z.string())),
    testCaseIds: z.array(z.string()),
  }),
  telemetry: z.object({
    engineCalls: z.number().int(),
    completedCalls: z.number().int(),
    partialCalls: z.number().int(),
    failedCalls: z.number().int(),
    rulesEvaluated: z.number().int(),
    totalEngineMs: z.number().int(),
    queueWaitMs: z.number().nullable(),
  }),
  calls: z.array(AnalysisEngineCallSchema),
  summary: z.record(z.unknown()).nullable(),
  plan: z.record(z.unknown()).nullable(),
  lab: LabRunSummarySchema.nullable(),
  labResults: z.array(LabTestResultSchema),
  generatedTests: z.object({ total: z.number().int(), promoted: z.number().int() }),
  permissions: z.object({ canCancel: z.boolean(), canRerun: z.boolean(), canExport: z.boolean() }),
});
export type AnalysisDetail = z.infer<typeof AnalysisDetailSchema>;
