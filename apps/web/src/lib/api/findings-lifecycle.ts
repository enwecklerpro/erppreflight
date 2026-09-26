import { z } from 'zod';
import {
  FindingStatusEnum,
  type AssignFindingInput,
  type BulkFindingActionInput,
  type Finding,
  type FindingStatus,
  type GenerateRegressionTestInput,
  type RegressionFixtureExport,
  type ScheduleRegressionTestsInput,
  type TransitionFindingStatusInput,
} from '@erppreflight/schemas';
import { customInstance } from './custom-instance';
import { fetchProjectFiles } from '../api-client';

/**
 * Typed client for the finding lifecycle (Part 01 §1.7) and regression Test Lab
 * (Part 05 §5.5) endpoints. Every response is validated with Zod at runtime.
 */

const Person = z.object({ id: z.string(), email: z.string().nullable(), fullName: z.string().nullable() });

export const LifecycleSummarySchema = z.object({
  id: z.string().nullable(),
  status: FindingStatusEnum,
  statusReason: z.string().nullable().optional(),
  statusChangedAt: z.string().nullable().optional(),
  assignee: Person.nullable().optional(),
  dueDate: z.string().nullable().optional(),
  firstDetectedAt: z.string().nullable(),
  lastEvaluatedAt: z.string().nullable(),
  lastDetectedAt: z.string().nullable().optional(),
  detectionCount: z.number().optional(),
  revision: z.number().optional(),
  isLatestDetection: z.boolean().optional(),
  suppression: z
    .object({ mode: z.string(), until: z.string().nullable(), release: z.string().nullable() })
    .nullable()
    .optional(),
});
export type LifecycleSummary = z.infer<typeof LifecycleSummarySchema>;

/** Finding row as returned by GET /findings (base finding + reproducibility + lifecycle). */
export type FindingWithLifecycle = Finding & {
  lifecycle?: LifecycleSummary;
  engineVersion?: string | null;
  ruleVersion?: string | null;
  knowledgeSnapshotId?: string | null;
  knowledgeSnapshotSeq?: number | null;
  targetRelease?: string | null;
  sourceFileId?: string | null;
  sourceFileName?: string | null;
  aiModelVersion?: string | null;
};

const LifecycleDetailSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: FindingStatusEnum,
  statusReason: z.string().nullable(),
  statusChangedAt: z.string().nullable(),
  suppression: z
    .object({ mode: z.string(), until: z.string().nullable(), release: z.string().nullable(), objectHash: z.string().nullable() })
    .nullable(),
  assigneeId: z.string().nullable(),
  assignee: Person.nullable(),
  dueDate: z.string().nullable(),
  firstDetectedAt: z.string().nullable(),
  lastDetectedAt: z.string().nullable(),
  lastEvaluatedAt: z.string().nullable(),
  lastTargetRelease: z.string().nullable(),
  detectionCount: z.number(),
  revision: z.number(),
  allowedTransitions: z.array(FindingStatusEnum),
});

export const LifecycleViewSchema = z.object({
  lifecycle: LifecycleDetailSchema,
  history: z.array(
    z.object({
      id: z.string(),
      event: z.string(),
      fromStatus: z.string().nullable(),
      toStatus: z.string(),
      reason: z.string().nullable(),
      actorKind: z.enum(['USER', 'SYSTEM']),
      actor: Person.nullable(),
      analysisId: z.string().nullable(),
      metadata: z.record(z.unknown()).default({}),
      createdAt: z.string().nullable(),
    })
  ),
  comments: z.array(
    z.object({
      id: z.string(),
      body: z.string().nullable(),
      deleted: z.boolean(),
      author: Person.nullable(),
      createdAt: z.string().nullable(),
      editedAt: z.string().nullable(),
      revisionCount: z.number(),
    })
  ),
  assignments: z.array(
    z.object({
      id: z.string(),
      assignee: Person.nullable(),
      dueDate: z.string().nullable(),
      note: z.string().nullable(),
      assignedByEmail: z.string().nullable(),
      createdAt: z.string().nullable(),
    })
  ),
  attachments: z.array(
    z.object({
      id: z.string(),
      fileId: z.string().nullable(),
      fileName: z.string(),
      checksumSha256: z.string(),
      quarantineStatus: z.string(),
      note: z.string().nullable(),
      attachedByEmail: z.string().nullable(),
      createdAt: z.string().nullable(),
    })
  ),
  regressionTests: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      testType: z.string(),
      expectedOutcome: z.string(),
      fixtureVersion: z.number(),
      lastRunStatus: z.string().nullable(),
      lastRunAt: z.string().nullable(),
      status: z.string(),
    })
  ),
});
export type LifecycleView = z.infer<typeof LifecycleViewSchema>;

export const findingLifecycleKeys = {
  all: ['finding-lifecycle'] as const,
  view: (findingId: string) => ['finding-lifecycle', findingId] as const,
  members: ['organization', 'members'] as const,
  currentUser: ['finding-lifecycle', 'current-user-role'] as const,
  projectFiles: (projectId: string) => ['projects', projectId, 'files', 'clean'] as const,
  regressionTests: (projectId: string) => ['regression-tests', projectId] as const,
  regressionTest: (id: string) => ['regression-tests', 'detail', id] as const,
  regressionSchedules: (projectId: string) => ['regression-schedules', projectId] as const,
};

const enc = encodeURIComponent;

export async function fetchLifecycleView(findingId: string): Promise<LifecycleView> {
  return LifecycleViewSchema.parse(await customInstance<unknown>(`/findings/${enc(findingId)}/lifecycle`));
}

function post<T>(path: string, body: unknown, method: 'POST' | 'PATCH' | 'DELETE' = 'POST'): Promise<T> {
  return customInstance<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

export async function transitionFinding(findingId: string, input: TransitionFindingStatusInput): Promise<LifecycleView> {
  return LifecycleViewSchema.parse(await post(`/findings/${enc(findingId)}/status`, input));
}

export async function assignFinding(findingId: string, input: AssignFindingInput): Promise<LifecycleView> {
  return LifecycleViewSchema.parse(await post(`/findings/${enc(findingId)}/assign`, input));
}

export async function addFindingComment(findingId: string, body: string): Promise<LifecycleView> {
  return LifecycleViewSchema.parse(await post(`/findings/${enc(findingId)}/comments`, { body }));
}

export async function editFindingComment(findingId: string, commentId: string, body: string): Promise<LifecycleView> {
  return LifecycleViewSchema.parse(await post(`/findings/${enc(findingId)}/comments/${enc(commentId)}`, { body }, 'PATCH'));
}

export async function deleteFindingComment(findingId: string, commentId: string): Promise<LifecycleView> {
  return LifecycleViewSchema.parse(await post(`/findings/${enc(findingId)}/comments/${enc(commentId)}`, undefined, 'DELETE'));
}

export async function attachArtifactToFinding(findingId: string, fileId: string, note?: string): Promise<LifecycleView> {
  return LifecycleViewSchema.parse(await post(`/findings/${enc(findingId)}/attachments`, { fileId, ...(note ? { note } : {}) }));
}

export async function detachFindingAttachment(findingId: string, attachmentId: string): Promise<LifecycleView> {
  return LifecycleViewSchema.parse(await post(`/findings/${enc(findingId)}/attachments/${enc(attachmentId)}`, undefined, 'DELETE'));
}

const BulkResultSchema = z.object({
  action: z.string(),
  requested: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(z.object({ findingId: z.string(), ok: z.boolean(), status: z.string().optional(), error: z.unknown().optional() })),
});
export type BulkResult = z.infer<typeof BulkResultSchema>;

export async function bulkFindingAction(input: BulkFindingActionInput): Promise<BulkResult> {
  return BulkResultSchema.parse(await post('/findings/bulk', input));
}

const MemberSchema = z.object({ userId: z.string(), email: z.string(), fullName: z.string().nullable(), role: z.string() });
export type OrganizationMember = z.infer<typeof MemberSchema>;

export async function fetchOrganizationMembers(): Promise<OrganizationMember[]> {
  return z.array(MemberSchema.passthrough()).parse(await customInstance<unknown>('/organizations/members'));
}

const CurrentUserSchema = z.object({
  user: z.object({ id: z.string(), role: z.string().nullable().optional(), systemRole: z.string().nullable().optional() }).passthrough(),
});
export async function fetchCurrentUserRole(): Promise<{ id: string; role: string | null; systemRole: string | null }> {
  const me = CurrentUserSchema.parse(await customInstance<unknown>('/auth/me'));
  return { id: me.user.id, role: me.user.role ?? null, systemRole: me.user.systemRole ?? null };
}

export interface CleanArtifact {
  id: string;
  fileName: string;
}
/** CLEAN artifacts of a project (passed magic-byte, ClamAV and redaction checks). */
export async function fetchCleanProjectArtifacts(projectId: string): Promise<CleanArtifact[]> {
  const files = await fetchProjectFiles(projectId);
  return files.filter((f) => f.quarantineStatus === 'CLEAN').map((f) => ({ id: f.id, fileName: f.name }));
}

// ---------------------------------------------------------------------------- Test Lab

const RunFindingSummarySchema = z.object({
  ruleId: z.string(),
  severity: z.string(),
  title: z.string(),
  affectedObjects: z.array(z.string()),
  evidence: z.object({ artifactPath: z.string().nullable(), lineNumber: z.number().nullable(), sha256: z.string().nullable() }).nullable(),
});

export const RegressionRunSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  batchId: z.string().nullable(),
  trigger: z.enum(['MANUAL', 'BATCH', 'SCHEDULED']),
  fixtureVersion: z.number(),
  artifactSha256: z.string().nullable(),
  targetRelease: z.string(),
  engineVersion: z.string().nullable(),
  status: z.enum(['PASSED', 'FAILED', 'ERROR']),
  findingPresent: z.boolean().nullable(),
  matchedFindings: z.array(RunFindingSummarySchema),
  findings: z.array(RunFindingSummarySchema),
  baselineComparison: z
    .object({
      baselineRunId: z.string(),
      baselineStatus: z.string(),
      statusChanged: z.boolean(),
      newRuleIds: z.array(z.string()),
      disappearedRuleIds: z.array(z.string()),
      verdict: z.enum(['UNCHANGED', 'IMPROVED', 'REGRESSED', 'CHANGED']),
    })
    .nullable(),
  executionTimeMs: z.number().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  isBaseline: z.boolean().optional(),
  findingResolved: z.boolean().optional(),
  /** Test Lab analysis (run history) that executed this run (migration 020). */
  analysisId: z.string().nullable().optional(),
});
export type RegressionRun = z.infer<typeof RegressionRunSchema>;

export const RegressionTestSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sourceFindingId: z.string().nullable(),
  title: z.string(),
  testType: z.string(),
  engine: z.string(),
  ruleId: z.string(),
  matchObjects: z.array(z.string()),
  preconditions: z.array(z.string()),
  artifact: z.object({ fileId: z.string().nullable(), name: z.string().nullable(), sha256: z.string().nullable(), type: z.string(), available: z.boolean() }),
  configuration: z.record(z.unknown()),
  expectedOutcome: z.enum(['FINDING_ABSENT', 'FINDING_PRESENT']),
  targetRelease: z.string(),
  fixtureVersion: z.number(),
  engineVersion: z.string().nullable(),
  ruleVersion: z.string().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  baselineRunId: z.string().nullable(),
  lastRun: z.object({ id: z.string(), status: z.string(), at: z.string().nullable() }).nullable(),
  findingStatus: FindingStatusEnum.nullable(),
  createdAt: z.string().nullable(),
  runs: z.array(RegressionRunSchema).optional(),
  /** Generated test this case was promoted from, and the analysis that generated it (migration 020). */
  generatedTestId: z.string().nullable().optional(),
  originAnalysisId: z.string().nullable().optional(),
});
export type RegressionTest = z.infer<typeof RegressionTestSchema>;

export async function fetchRegressionTests(projectId: string): Promise<RegressionTest[]> {
  const res = await customInstance<unknown>(`/lab/regression-tests?projectId=${enc(projectId)}`);
  return z.object({ items: z.array(RegressionTestSchema) }).parse(res).items;
}

export async function fetchRegressionTest(id: string): Promise<RegressionTest> {
  return RegressionTestSchema.parse(await customInstance<unknown>(`/lab/regression-tests/${enc(id)}`));
}

export async function generateRegressionTest(input: GenerateRegressionTestInput): Promise<RegressionTest> {
  return RegressionTestSchema.parse(await post('/lab/regression-tests', input));
}

export async function runRegressionTest(id: string, fileId?: string): Promise<RegressionRun> {
  return RegressionRunSchema.parse(await post(`/lab/regression-tests/${enc(id)}/run`, fileId ? { fileId } : {}));
}

export async function updateRegressionFixture(id: string, fileId: string): Promise<RegressionTest> {
  return RegressionTestSchema.parse(await post(`/lab/regression-tests/${enc(id)}/fixture`, { fileId }));
}

export async function archiveRegressionTest(id: string): Promise<RegressionTest> {
  return RegressionTestSchema.parse(await post(`/lab/regression-tests/${enc(id)}/archive`, {}));
}

const BatchSchema = z.object({ batchId: z.string(), total: z.number(), passed: z.number(), failed: z.number(), errored: z.number() }).passthrough();
export async function batchRunRegressionTests(projectId: string, testCaseIds?: string[]) {
  return BatchSchema.parse(await post('/lab/regression-tests/batch-run', { projectId, ...(testCaseIds?.length ? { testCaseIds } : {}) }));
}

export async function exportRegressionFixture(id: string): Promise<RegressionFixtureExport> {
  return customInstance<RegressionFixtureExport>(`/lab/regression-tests/${enc(id)}/fixture`);
}

export const RegressionScheduleSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  cronExpression: z.string(),
  testCaseIds: z.array(z.string()),
  status: z.enum(['ACTIVE', 'CANCELLED']),
  lastRunAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type RegressionSchedule = z.infer<typeof RegressionScheduleSchema>;

export async function fetchRegressionSchedules(projectId: string): Promise<RegressionSchedule[]> {
  const res = await customInstance<unknown>(`/lab/regression-schedules?projectId=${enc(projectId)}`);
  return z.object({ items: z.array(RegressionScheduleSchema) }).parse(res).items;
}

export async function createRegressionSchedule(input: ScheduleRegressionTestsInput): Promise<RegressionSchedule> {
  return RegressionScheduleSchema.parse(await post('/lab/regression-schedules', input));
}

export async function cancelRegressionSchedule(id: string): Promise<RegressionSchedule> {
  return RegressionScheduleSchema.parse(await post(`/lab/regression-schedules/${enc(id)}`, undefined, 'DELETE'));
}

export type { FindingStatus };
