import { z } from 'zod';

/**
 * Finding lifecycle contracts (Part 01 §1.7, Part 04 §4.11, Section C §17) and the
 * regression Test Lab (Part 05 §5.5, Section C §18). Shared by the API (request
 * validation, state machine) and the web app (forms, allowed actions).
 */

export const FindingStatusEnum = z.enum([
  'OPEN',
  'ACKNOWLEDGED',
  'ACCEPTED_RISK',
  'FALSE_POSITIVE',
  'RESOLVED',
  'REGRESSION_TEST_CREATED',
  'SUPPRESSED',
]);
export type FindingStatus = z.infer<typeof FindingStatusEnum>;

export const SuppressionModeEnum = z.enum(['PERMANENT', 'UNTIL_DATE', 'UNTIL_RELEASE', 'UNTIL_OBJECT_CHANGE']);
export type SuppressionMode = z.infer<typeof SuppressionModeEnum>;

/**
 * User-initiated transitions. REGRESSION_TEST_CREATED is never set by hand: it is
 * entered only by generating a regression test from the finding. System
 * transitions (carry-over re-open, auto-resolve, suppression lapse) are applied by
 * the lifecycle reconciler and are always recorded in the status history.
 */
export const FINDING_STATUS_TRANSITIONS: Readonly<Record<FindingStatus, readonly FindingStatus[]>> = {
  OPEN: ['ACKNOWLEDGED', 'ACCEPTED_RISK', 'FALSE_POSITIVE', 'RESOLVED', 'SUPPRESSED'],
  ACKNOWLEDGED: ['OPEN', 'ACCEPTED_RISK', 'FALSE_POSITIVE', 'RESOLVED', 'SUPPRESSED'],
  REGRESSION_TEST_CREATED: ['OPEN', 'ACKNOWLEDGED', 'ACCEPTED_RISK', 'FALSE_POSITIVE', 'RESOLVED', 'SUPPRESSED'],
  ACCEPTED_RISK: ['OPEN', 'RESOLVED'],
  FALSE_POSITIVE: ['OPEN'],
  SUPPRESSED: ['OPEN'],
  RESOLVED: ['OPEN'],
};

/** Organization roles allowed to change finding state, comment, assign or generate tests. */
export const FINDING_WRITE_ROLES = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT', 'MIGRATION_CONSULTANT'] as const;
/** Auditors may comment (review notes) but not change state. */
export const FINDING_COMMENT_ROLES = [...FINDING_WRITE_ROLES, 'AUDITOR'] as const;
/**
 * Risk decisions (accept risk, suppress) are governance decisions: owner, security
 * admin or the lead architect who owns the technical design authority.
 */
export const FINDING_RISK_ROLES = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT'] as const;

/** Statuses whose transition requires a written reason (audited). */
export const REASON_REQUIRED_STATUSES: readonly FindingStatus[] = ['ACCEPTED_RISK', 'FALSE_POSITIVE', 'SUPPRESSED'];
export const RISK_STATUSES: readonly FindingStatus[] = ['ACCEPTED_RISK', 'SUPPRESSED'];

export function isTransitionAllowed(from: FindingStatus, to: FindingStatus): boolean {
  return FINDING_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Roles that may move a finding into `to`. */
export function rolesForStatus(to: FindingStatus): readonly string[] {
  return RISK_STATUSES.includes(to) ? FINDING_RISK_ROLES : FINDING_WRITE_ROLES;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format');

export const SuppressionInputSchema = z
  .object({
    mode: SuppressionModeEnum,
    /** UNTIL_DATE: ISO date (inclusive end of day, UTC). */
    until: isoDate.optional(),
    /** UNTIL_RELEASE: release the suppression is valid for (defaults to the finding's target release). */
    release: z.string().trim().min(2).max(50).optional(),
  })
  .strict();
export type SuppressionInput = z.infer<typeof SuppressionInputSchema>;

export const TransitionFindingStatusSchema = z
  .object({
    status: FindingStatusEnum,
    reason: z.string().trim().max(2000).optional(),
    suppression: SuppressionInputSchema.optional(),
    /** Optimistic concurrency: the lifecycle revision the client saw. */
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === 'REGRESSION_TEST_CREATED') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'REGRESSION_TEST_CREATED is set by generating a regression test, not manually',
      });
    }
    if (REASON_REQUIRED_STATUSES.includes(v.status) && (!v.reason || v.reason.length < 10)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: `A reason of at least 10 characters is required for ${v.status}`,
      });
    }
    if (v.status === 'SUPPRESSED' && !v.suppression) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['suppression'], message: 'Suppression scope is required' });
    }
    if (v.status !== 'SUPPRESSED' && v.suppression) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['suppression'], message: 'Suppression is only valid for SUPPRESSED' });
    }
    if (v.suppression?.mode === 'UNTIL_DATE' && !v.suppression.until) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['suppression', 'until'], message: 'An end date is required' });
    }
  });
export type TransitionFindingStatusInput = z.infer<typeof TransitionFindingStatusSchema>;

export const AssignFindingSchema = z
  .object({
    assigneeId: z.string().uuid().nullable(),
    dueDate: isoDate.nullable().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type AssignFindingInput = z.infer<typeof AssignFindingSchema>;

export const FindingCommentBodySchema = z
  .object({ body: z.string().trim().min(1, 'Comment cannot be empty').max(5000) })
  .strict();
export type FindingCommentBodyInput = z.infer<typeof FindingCommentBodySchema>;

export const AttachArtifactSchema = z
  .object({ fileId: z.string().uuid(), note: z.string().trim().max(1000).optional() })
  .strict();
export type AttachArtifactInput = z.infer<typeof AttachArtifactSchema>;

export const BulkFindingActionSchema = z
  .object({
    findingIds: z.array(z.string().uuid()).min(1).max(200),
    action: z.enum(['ACKNOWLEDGE', 'ASSIGN']),
    assigneeId: z.string().uuid().nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === 'ASSIGN' && v.assigneeId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assigneeId'], message: 'assigneeId is required for ASSIGN' });
    }
  });
export type BulkFindingActionInput = z.infer<typeof BulkFindingActionSchema>;

// ----------------------------------------------------------------------------
// Regression Test Lab
// ----------------------------------------------------------------------------

export const RegressionTestTypeEnum = z.enum([
  'RULE_SCENARIO',
  'SCHEMA_CONTRACT',
  'API_BREAKING_CHANGE',
  'FORM_XML_FIELD',
  'OUTPUT_DETERMINATION',
  'CHANGE_POINTER',
  'TRANSPORT_DEPENDENCY',
  'MFS_SEQUENCE',
]);
export type RegressionTestType = z.infer<typeof RegressionTestTypeEnum>;

export const RegressionExpectedOutcomeEnum = z.enum(['FINDING_ABSENT', 'FINDING_PRESENT']);
export type RegressionExpectedOutcome = z.infer<typeof RegressionExpectedOutcomeEnum>;

export const RegressionRunStatusEnum = z.enum(['PASSED', 'FAILED', 'ERROR']);
export type RegressionRunStatus = z.infer<typeof RegressionRunStatusEnum>;

/** Test type per engine (Part 05 §5.5 test types); everything else is a rule scenario test. */
export const ENGINE_TEST_TYPES: Readonly<Record<string, RegressionTestType>> = {
  OPD_GUARD: 'OUTPUT_DETERMINATION',
  FORM_DOCTOR: 'FORM_XML_FIELD',
  API_CHANGE_GUARD: 'API_BREAKING_CHANGE',
  CHANGE_POINTER_COVERAGE_AUDITOR: 'CHANGE_POINTER',
  TRANSPORT_DEPENDENCY_ANALYZER: 'TRANSPORT_DEPENDENCY',
  MFS_BLACKBOX: 'MFS_SEQUENCE',
  CUSTOM_FIELD_FLOW_DOCTOR: 'SCHEMA_CONTRACT',
};

export const GenerateRegressionTestSchema = z
  .object({
    findingId: z.string().uuid(),
    /** Fixture artifact when the finding has no recorded source artifact (imports, legacy rows). */
    fileId: z.string().uuid().optional(),
    expectedOutcome: RegressionExpectedOutcomeEnum.default('FINDING_ABSENT'),
    title: z.string().trim().min(3).max(500).optional(),
    preconditions: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  })
  .strict();
export type GenerateRegressionTestInput = z.infer<typeof GenerateRegressionTestSchema>;

export const RunRegressionTestSchema = z
  .object({
    /** Run against another CLEAN artifact of the project instead of the stored fixture (one-off). */
    fileId: z.string().uuid().optional(),
  })
  .strict();
export type RunRegressionTestInput = z.infer<typeof RunRegressionTestSchema>;

export const UpdateRegressionFixtureSchema = z
  .object({ fileId: z.string().uuid(), note: z.string().trim().max(500).optional() })
  .strict();
export type UpdateRegressionFixtureInput = z.infer<typeof UpdateRegressionFixtureSchema>;

export const BatchRunRegressionTestsSchema = z
  .object({
    projectId: z.string().uuid(),
    /** Defaults to every ACTIVE test case of the project. */
    testCaseIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  })
  .strict();
export type BatchRunRegressionTestsInput = z.infer<typeof BatchRunRegressionTestsSchema>;

const CRON_FIELD = /^[\d*/,\-]+$/;
export const ScheduleRegressionTestsSchema = z
  .object({
    projectId: z.string().uuid(),
    cronExpression: z
      .string()
      .trim()
      .refine((c) => {
        const parts = c.split(/\s+/);
        return parts.length === 5 && parts.every((p) => CRON_FIELD.test(p));
      }, 'Expected a standard 5-field cron expression, e.g. "0 2 * * *"'),
    testCaseIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict();
export type ScheduleRegressionTestsInput = z.infer<typeof ScheduleRegressionTestsSchema>;

/** Machine-readable fixture export (versioned contract). */
export const RegressionFixtureExportSchema = z.object({
  schema: z.literal('erppreflight.regression-fixture/v1'),
  testCase: z.object({
    id: z.string().uuid(),
    title: z.string(),
    testType: RegressionTestTypeEnum,
    engine: z.string(),
    ruleId: z.string(),
    matchObjects: z.array(z.string()),
    preconditions: z.array(z.string()),
    expectedOutcome: RegressionExpectedOutcomeEnum,
    targetRelease: z.string(),
    fixtureVersion: z.number().int().positive(),
    engineVersion: z.string().nullable(),
    ruleVersion: z.string().nullable(),
    sourceFindingId: z.string().uuid().nullable(),
  }),
  input: z.object({
    artifactName: z.string().nullable(),
    artifactType: z.string(),
    artifactSha256: z.string().nullable(),
    configuration: z.record(z.unknown()),
    /** Artifact bytes (utf-8 text or base64 for binary formats); null when unavailable or > 1 MiB. */
    content: z.string().nullable(),
    contentEncoding: z.enum(['utf-8', 'base64']).nullable(),
    contentOmittedReason: z.string().nullable(),
  }),
  baseline: z
    .object({ runId: z.string().uuid(), status: RegressionRunStatusEnum, findingPresent: z.boolean().nullable() })
    .nullable(),
  exportedAt: z.string(),
});
export type RegressionFixtureExport = z.infer<typeof RegressionFixtureExportSchema>;
