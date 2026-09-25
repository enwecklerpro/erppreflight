import { pgTable, uuid, varchar, text, jsonb, timestamp, bigint, integer } from 'drizzle-orm/pg-core';
import { organizations, projects, analyses, findings, users } from './core';

export const reports = pgTable('reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  analysisId: uuid('analysis_id').notNull().references(() => analyses.id, { onDelete: 'cascade' }),
  format: varchar('format', { length: 50 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  s3Key: varchar('s3_key', { length: 1000 }).notNull(),
  checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const changesets = pgTable('changesets', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  targetEnvironment: varchar('target_environment', { length: 100 }),
  targetRelease: varchar('target_release', { length: 50 }),
  baselineAnalysisId: uuid('baseline_analysis_id').references(() => analyses.id, { onDelete: 'set null' }),
  proposedChanges: jsonb('proposed_changes').default([]).notNull(),
  simulationResult: jsonb('simulation_result').default({}).notNull(),
  approvalStatus: varchar('approval_status', { length: 50 }).default('PENDING').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  proposalHash: varchar('proposal_hash', { length: 64 }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const traceabilityNodes = pgTable('traceability_nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  processHierarchy: varchar('process_hierarchy', { length: 500 }),
  requirementId: varchar('requirement_id', { length: 100 }),
  requirementTitle: varchar('requirement_title', { length: 500 }),
  findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'set null' }),
  remediationTaskId: varchar('remediation_task_id', { length: 100 }),
  taskStatus: varchar('task_status', { length: 50 }),
  testCaseId: varchar('test_case_id', { length: 100 }),
  testStatus: varchar('test_status', { length: 50 }),
  defectId: varchar('defect_id', { length: 100 }),
  transportId: varchar('transport_id', { length: 100 }),
  releaseId: varchar('release_id', { length: 100 }),
  businessCriticality: varchar('business_criticality', { length: 50 }),
  externalSystem: varchar('external_system', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  prefix: varchar('prefix', { length: 10 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  scopes: jsonb('scopes').default([]).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  status: varchar('status', { length: 50 }).default('ACTIVE').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const webhooks = pgTable('webhooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  url: varchar('url', { length: 1000 }).notNull(),
  secret: varchar('secret', { length: 255 }),
  events: jsonb('events').default([]).notNull(),
  status: varchar('status', { length: 50 }).default('ACTIVE').notNull(),
  failureCount: integer('failure_count').default(0).notNull(),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const registeredAgents = pgTable('registered_agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  runtime: varchar('runtime', { length: 100 }).notNull(),
  allowedTools: jsonb('allowed_tools').default([]).notNull(),
  scopes: jsonb('scopes').default([]).notNull(),
  maxRiskClass: varchar('max_risk_class', { length: 50 }),
  approvalMode: varchar('approval_mode', { length: 50 }).default('MANUAL').notNull(),
  status: varchar('status', { length: 50 }).default('ACTIVE').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentProposals = pgTable('agent_proposals', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => registeredAgents.id, { onDelete: 'cascade' }),
  changeType: varchar('change_type', { length: 50 }).notNull(),
  proposedDiff: jsonb('proposed_diff').default({}).notNull(),
  proposalHash: varchar('proposal_hash', { length: 64 }).notNull(),
  targetEnvironment: varchar('target_environment', { length: 100 }),
  verdict: varchar('verdict', { length: 50 }).default('PENDING').notNull(),
  verdictDetails: text('verdict_details'),
  approvalStatus: varchar('approval_status', { length: 50 }).default('PENDING').notNull(),
  executionToken: varchar('execution_token', { length: 255 }),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const landscapes = pgTable('landscapes', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  systemId: varchar('system_id', { length: 10 }).notNull(),
  product: varchar('product', { length: 100 }).notNull(),
  edition: varchar('edition', { length: 100 }),
  release: varchar('release', { length: 50 }).notNull(),
  environment: varchar('environment', { length: 50 }).notNull(),
  url: varchar('url', { length: 1000 }),
  businessRole: varchar('business_role', { length: 100 }),
  criticality: varchar('criticality', { length: 50 }),
  status: varchar('status', { length: 50 }).default('ACTIVE').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
