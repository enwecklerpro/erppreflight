import { pgTable, uuid, varchar, text, jsonb, timestamp, bigserial } from 'drizzle-orm/pg-core';
import { organizations, projects, users, analyses } from './core';

/** Append-only analysis stage log (migration 018, Part 03 §3.8). */
export const analysisProgressEvents = pgTable('analysis_progress_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  analysisId: uuid('analysis_id').notNull().references(() => analyses.id, { onDelete: 'cascade' }),
  stage: varchar('stage', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  detail: jsonb('detail').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Persisted AI Problem Router decisions (migration 018, Part 05 §5.1). Advisory only. */
export const problemRoutings = pgTable('problem_routings', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  problemText: text('problem_text').notNull(),
  objectIdentifier: varchar('object_identifier', { length: 200 }),
  classifierVersion: varchar('classifier_version', { length: 40 }).notNull(),
  context: jsonb('context').default({}).notNull(),
  suggestions: jsonb('suggestions').default([]).notNull(),
  aiRefinement: jsonb('ai_refinement'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
