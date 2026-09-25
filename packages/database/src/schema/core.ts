import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, bigint, numeric, customType } from 'drizzle-orm/pg-core';

const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): number[] {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return value;
  }
});

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  planTier: varchar('plan_tier', { length: 50 }).default('FREE').notNull(),
  status: varchar('status', { length: 50 }).default('ACTIVE').notNull(),
  dataPolicy: jsonb('data_policy').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }),
  systemRole: varchar('system_role', { length: 50 }).default('USER').notNull(),
  status: varchar('status', { length: 50 }).default('ACTIVE').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 50 }).default('MEMBER').notNull(),
  permissions: jsonb('permissions').default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  description: text('description'),
  targetRelease: varchar('target_release', { length: 50 }).default('S4H_2023').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  baselineAnalysisId: uuid('baseline_analysis_id'), // We'll manually refer as there's a circular ref if done naively
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const uploadedFiles = pgTable('uploaded_files', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  mimeType: varchar('mime_type', { length: 255 }).notNull(),
  storagePath: varchar('storage_path', { length: 1000 }).notNull(),
  checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
  quarantineStatus: varchar('quarantine_status', { length: 50 }).default('PENDING_SCAN').notNull(),
  redactionStatus: varchar('redaction_status', { length: 50 }).default('PENDING').notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const analyses = pgTable('analyses', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).default('QUEUED').notNull(),
  engineTypes: jsonb('engine_types').default([]).notNull(),
  targetRelease: varchar('target_release', { length: 50 }).notNull(),
  isBaseline: varchar('is_baseline', { length: 50 }),
  triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const findings = pgTable('findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  analysisId: uuid('analysis_id').notNull().references(() => analyses.id, { onDelete: 'cascade' }),
  engine: varchar('engine', { length: 100 }).notNull(),
  ruleId: varchar('rule_id', { length: 100 }).notNull(),
  severity: varchar('severity', { length: 50 }).notNull(),
  category: varchar('category', { length: 100 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description').notNull(),
  confidenceClass: varchar('confidence_class', { length: 50 }).notNull(),
  confidenceScore: numeric('confidence_score', { precision: 4, scale: 3 }).default('1.000').notNull(),
  remediation: text('remediation'),
  affectedObjects: jsonb('affected_objects').default([]).notNull(),
  technicalDetails: jsonb('technical_details').default({}).notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const evidence = pgTable('evidence', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'cascade' }),
  artifactPath: varchar('artifact_path', { length: 1000 }).notNull(),
  lineNumber: integer('line_number'),
  columnNumber: integer('column_number'),
  snippet: text('snippet'),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  provenance: varchar('provenance', { length: 50 }).default('VERIFIED').notNull(),
  sourceTitle: varchar('source_title', { length: 255 }),
  sourceUrl: varchar('source_url', { length: 1000 }),
  trustScore: numeric('trust_score', { precision: 4, scale: 3 }).default('1.000').notNull(),
  embedding: vector1536('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tests = pgTable('tests', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 500 }).notNull(),
  testType: varchar('test_type', { length: 100 }).default('REGRESSION').notNull(),
  steps: jsonb('steps').default([]).notNull(),
  expectedResult: text('expected_result').notNull(),
  status: varchar('status', { length: 50 }).default('PENDING').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
