import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { organizations, projects } from './core';

export const sapObjects = pgTable('sap_objects', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  objectType: varchar('object_type', { length: 50 }).notNull(),
  description: text('description'),
  package: varchar('package', { length: 100 }),
  softwareComponent: varchar('software_component', { length: 100 }),
  cleanCoreTier: varchar('clean_core_tier', { length: 50 }),
  modificationStatus: varchar('modification_status', { length: 50 }),
  complexity: varchar('complexity', { length: 50 }),
  findingSummary: jsonb('finding_summary').default({}).notNull(),
  dependencies: jsonb('dependencies').default([]).notNull(),
  lastChangedBy: varchar('last_changed_by', { length: 100 }),
  lastChangedAt: timestamp('last_changed_at', { withTimezone: true }),
  transportRequest: varchar('transport_request', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
