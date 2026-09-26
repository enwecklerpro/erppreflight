import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, boolean, date, char } from 'drizzle-orm/pg-core';
import { organizations, projects, findings, users, analyses, uploadedFiles } from './core';

/**
 * Finding lifecycle, collaboration and regression Test Lab (migration 017).
 * Mirrors packages/database/migrations/017_finding_lifecycle_and_test_lab.sql;
 * CHECK constraints, RLS policies and the append-only history trigger live in SQL.
 */
export const findingLifecycles = pgTable('finding_lifecycles', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  lifecycleKey: char('lifecycle_key', { length: 64 }).notNull(),
  engine: varchar('engine', { length: 100 }).notNull(),
  ruleId: varchar('rule_id', { length: 100 }).notNull(),
  artifactName: varchar('artifact_name', { length: 500 }),
  status: varchar('status', { length: 40 }).default('OPEN').notNull(),
  statusReason: text('status_reason'),
  statusChangedBy: uuid('status_changed_by').references(() => users.id, { onDelete: 'set null' }),
  statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
  suppressionMode: varchar('suppression_mode', { length: 30 }),
  suppressedUntil: timestamp('suppressed_until', { withTimezone: true }),
  suppressedRelease: varchar('suppressed_release', { length: 50 }),
  suppressedObjectHash: char('suppressed_object_hash', { length: 64 }),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  dueDate: date('due_date'),
  firstDetectedAt: timestamp('first_detected_at', { withTimezone: true }).defaultNow().notNull(),
  firstAnalysisId: uuid('first_analysis_id').references(() => analyses.id, { onDelete: 'set null' }),
  lastDetectedAt: timestamp('last_detected_at', { withTimezone: true }).defaultNow().notNull(),
  lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }).defaultNow().notNull(),
  lastAnalysisId: uuid('last_analysis_id').references(() => analyses.id, { onDelete: 'set null' }),
  latestFindingId: uuid('latest_finding_id').references(() => findings.id, { onDelete: 'set null' }),
  lastObjectHash: char('last_object_hash', { length: 64 }),
  lastTargetRelease: varchar('last_target_release', { length: 50 }),
  detectionCount: integer('detection_count').default(1).notNull(),
  revision: integer('revision').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const findingStatusHistory = pgTable('finding_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  lifecycleId: uuid('lifecycle_id').notNull().references(() => findingLifecycles.id, { onDelete: 'cascade' }),
  findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'set null' }),
  analysisId: uuid('analysis_id').references(() => analyses.id, { onDelete: 'set null' }),
  event: varchar('event', { length: 40 }).notNull(),
  fromStatus: varchar('from_status', { length: 40 }),
  toStatus: varchar('to_status', { length: 40 }).notNull(),
  reason: text('reason'),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actorKind: varchar('actor_kind', { length: 10 }).default('USER').notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const findingComments = pgTable('finding_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  lifecycleId: uuid('lifecycle_id').notNull().references(() => findingLifecycles.id, { onDelete: 'cascade' }),
  findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'set null' }),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  body: text('body'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const findingCommentRevisions = pgTable('finding_comment_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  commentId: uuid('comment_id').notNull().references(() => findingComments.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  changeKind: varchar('change_kind', { length: 10 }).notNull(),
  changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const findingAssignments = pgTable('finding_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  lifecycleId: uuid('lifecycle_id').notNull().references(() => findingLifecycles.id, { onDelete: 'cascade' }),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  dueDate: date('due_date'),
  note: text('note'),
  assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const findingAttachments = pgTable('finding_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  lifecycleId: uuid('lifecycle_id').notNull().references(() => findingLifecycles.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id').references(() => uploadedFiles.id, { onDelete: 'set null' }),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  checksumSha256: char('checksum_sha256', { length: 64 }).notNull(),
  note: text('note'),
  attachedBy: uuid('attached_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'set null' }),
});

export const regressionTestCases = pgTable('regression_test_cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceFindingId: uuid('source_finding_id').references(() => findings.id, { onDelete: 'set null' }),
  lifecycleId: uuid('lifecycle_id').references(() => findingLifecycles.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 500 }).notNull(),
  testType: varchar('test_type', { length: 40 }).notNull(),
  engine: varchar('engine', { length: 100 }).notNull(),
  ruleId: varchar('rule_id', { length: 100 }).notNull(),
  matchObjects: jsonb('match_objects').default([]).notNull(),
  preconditions: jsonb('preconditions').default([]).notNull(),
  artifactFileId: uuid('artifact_file_id').references(() => uploadedFiles.id, { onDelete: 'set null' }),
  artifactName: varchar('artifact_name', { length: 500 }),
  artifactSha256: char('artifact_sha256', { length: 64 }),
  artifactType: varchar('artifact_type', { length: 20 }).notNull(),
  configuration: jsonb('configuration').default({}).notNull(),
  expectedOutcome: varchar('expected_outcome', { length: 20 }).notNull(),
  targetRelease: varchar('target_release', { length: 50 }).notNull(),
  fixtureVersion: integer('fixture_version').default(1).notNull(),
  engineVersion: varchar('engine_version', { length: 50 }),
  ruleVersion: varchar('rule_version', { length: 80 }),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  baselineRunId: uuid('baseline_run_id'),
  lastRunId: uuid('last_run_id'),
  lastRunStatus: varchar('last_run_status', { length: 20 }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  /** Generated test (table `tests`) this case was promoted from (migration 020). FK in SQL only. */
  generatedTestId: uuid('generated_test_id'),
});

export const regressionTestRuns = pgTable('regression_test_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  testCaseId: uuid('test_case_id').notNull().references(() => regressionTestCases.id, { onDelete: 'cascade' }),
  batchId: uuid('batch_id'),
  triggerKind: varchar('trigger_kind', { length: 20 }).notNull(),
  fixtureVersion: integer('fixture_version').notNull(),
  artifactFileId: uuid('artifact_file_id').references(() => uploadedFiles.id, { onDelete: 'set null' }),
  artifactSha256: char('artifact_sha256', { length: 64 }),
  targetRelease: varchar('target_release', { length: 50 }).notNull(),
  engineVersion: varchar('engine_version', { length: 50 }),
  status: varchar('status', { length: 20 }).notNull(),
  findingPresent: boolean('finding_present'),
  matchedFindings: jsonb('matched_findings').default([]).notNull(),
  findingsSummary: jsonb('findings_summary').default([]).notNull(),
  baselineComparison: jsonb('baseline_comparison'),
  executionTimeMs: integer('execution_time_ms'),
  errorMessage: text('error_message'),
  triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  /** Lab analysis (analyses.kind = LAB_REGRESSION) that executed this run (migration 020). FK in SQL only. */
  analysisId: uuid('analysis_id'),
});

export const regressionTestSchedules = pgTable('regression_test_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  cronExpression: varchar('cron_expression', { length: 100 }).notNull(),
  testCaseIds: jsonb('test_case_ids').default([]).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  repeatJobKey: varchar('repeat_job_key', { length: 255 }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastBatchId: uuid('last_batch_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
