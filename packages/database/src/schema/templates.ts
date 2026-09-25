import { pgTable, uuid, varchar, text, jsonb, timestamp, boolean, integer, date } from 'drizzle-orm/pg-core';
import { organizations, projects, findings, users } from './core';

export const analysisTemplates = pgTable('analysis_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  description: text('description'),
  targetDomain: varchar('target_domain', { length: 100 }).notNull(),
  engines: jsonb('engines').default([]).notNull(),
  requiredInputs: jsonb('required_inputs').default([]).notNull(),
  optionalInputs: jsonb('optional_inputs').default([]).notNull(),
  standardChecks: jsonb('standard_checks').default([]).notNull(),
  reportType: varchar('report_type', { length: 100 }),
  isSystemTemplate: boolean('is_system_template').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const customerFeedback = pgTable('customer_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'set null' }),
  feedbackType: varchar('feedback_type', { length: 50 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description').notNull(),
  status: varchar('status', { length: 50 }).default('NEW').notNull(),
  votes: integer('votes').default(0).notNull(),
  voters: jsonb('voters').default([]).notNull(),
  targetEngine: varchar('target_engine', { length: 100 }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const releaseNotes = pgTable('release_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  version: varchar('version', { length: 50 }).notNull().unique(),
  releaseDate: date('release_date').notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  summary: text('summary'),
  features: jsonb('features').default([]).notNull(),
  engineChanges: jsonb('engine_changes').default([]).notNull(),
  knowledgeUpdates: jsonb('knowledge_updates').default([]).notNull(),
  breakingChanges: jsonb('breaking_changes').default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const syntheticScenarios = pgTable('synthetic_scenarios', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  domain: varchar('domain', { length: 100 }).notNull(),
  scenarioName: varchar('scenario_name', { length: 255 }).notNull(),
  failureType: varchar('failure_type', { length: 100 }).notNull(),
  payload: jsonb('payload').default({}).notNull(),
  expectedFindings: jsonb('expected_findings').default([]).notNull(),
  lastRunResult: jsonb('last_run_result').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
