import { pgTable, uuid, varchar, char, bigint, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';
import { organizations, projects, users, uploadedFiles } from './core';

/** API Change Guard stored baselines (migration 023). Tenant RLS: organization_id. */
export const apiBaselines = pgTable('api_baselines', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  format: varchar('format', { length: 20 }).notNull(),
  specVersion: varchar('spec_version', { length: 40 }),
  version: varchar('version', { length: 100 }).notNull(),
  sha256: char('sha256', { length: 64 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storageKey: varchar('storage_key', { length: 1024 }).notNull(),
  sourceFileId: uuid('source_file_id').references(() => uploadedFiles.id, { onDelete: 'set null' }),
  sourceFileName: varchar('source_file_name', { length: 500 }),
  apiTitle: varchar('api_title', { length: 300 }),
  surface: jsonb('surface').default({}).notNull(),
  isActive: boolean('is_active').default(false).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
});
