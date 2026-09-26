/**
 * Knowledge graph, release intelligence and notification tables
 * (migration 014_knowledge_graph_release_intelligence.sql).
 *
 * Global knowledge rows have `organizationId = null`; tenant rows carry the
 * owning organization and are RLS-isolated. See the migration header for the
 * snapshot validity model (validFromSeq / validToSeq).
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  bigint,
  bigserial,
  numeric,
  char,
} from 'drizzle-orm/pg-core';
import { organizations, users, projects, findings } from './core';

export const knowledgeProducts = pgTable('knowledge_products', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 200 }).notNull(),
  vendor: varchar('vendor', { length: 100 }).default('SAP').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeEditions = pgTable('knowledge_editions', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => knowledgeProducts.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 64 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  deployment: varchar('deployment', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeReleases = pgTable('knowledge_releases', {
  id: uuid('id').defaultRandom().primaryKey(),
  editionId: uuid('edition_id').notNull().references(() => knowledgeEditions.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 64 }).notNull(),
  label: varchar('label', { length: 200 }).notNull(),
  featurePack: varchar('feature_pack', { length: 32 }),
  sortOrder: integer('sort_order').default(0).notNull(),
  isRolling: boolean('is_rolling').default(false).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeEvidenceSources = pgTable('knowledge_evidence_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  sourceKey: varchar('source_key', { length: 160 }).notNull(),
  trustLevel: varchar('trust_level', { length: 40 }).notNull(),
  title: varchar('title', { length: 300 }).notNull(),
  publisher: varchar('publisher', { length: 200 }),
  url: text('url'),
  description: text('description'),
  targetReleaseId: uuid('target_release_id').references(() => knowledgeReleases.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  supersededBy: uuid('superseded_by'),
  reviewer: varchar('reviewer', { length: 200 }),
  internalNote: text('internal_note'),
  publicationDate: timestamp('publication_date', { withTimezone: true }),
  lastRetrievedAt: timestamp('last_retrieved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeSnapshots = pgTable('knowledge_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  seq: bigint('seq', { mode: 'number' }).notNull().unique(),
  adapterId: varchar('adapter_id', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).default('BUILDING').notNull(),
  contentSha256: char('content_sha256', { length: 64 }).notNull(),
  parserVersion: varchar('parser_version', { length: 40 }).notNull(),
  sourceVersions: jsonb('source_versions').default([]).notNull(),
  stats: jsonb('stats').default({}).notNull(),
  diffSummary: jsonb('diff_summary').default({}).notNull(),
  previousSnapshotId: uuid('previous_snapshot_id'),
  triggeredBy: varchar('triggered_by', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export const knowledgeSyncRuns = pgTable('knowledge_sync_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  adapterId: varchar('adapter_id', { length: 64 }).notNull(),
  trigger: varchar('trigger', { length: 20 }).notNull(),
  triggeredBy: varchar('triggered_by', { length: 200 }),
  status: varchar('status', { length: 20 }).default('RUNNING').notNull(),
  snapshotId: uuid('snapshot_id').references(() => knowledgeSnapshots.id),
  contentSha256: char('content_sha256', { length: 64 }),
  sourceResults: jsonb('source_results').default([]).notNull(),
  stats: jsonb('stats').default({}).notNull(),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const knowledgeObjects = pgTable('knowledge_objects', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  scope: varchar('scope', { length: 10 }).default('GLOBAL').notNull(),
  objectType: varchar('object_type', { length: 40 }).notNull(),
  sapObjectType: varchar('sap_object_type', { length: 20 }).notNull(),
  objectKey: varchar('object_key', { length: 200 }).notNull(),
  tadirObject: varchar('tadir_object', { length: 10 }),
  tadirObjName: varchar('tadir_obj_name', { length: 200 }),
  displayName: varchar('display_name', { length: 300 }),
  description: text('description'),
  applicationComponent: varchar('application_component', { length: 60 }),
  softwareComponent: varchar('software_component', { length: 60 }),
  attributes: jsonb('attributes').default({}).notNull(),
  reviewStatus: varchar('review_status', { length: 20 }).default('DRAFT').notNull(),
  reviewedBy: varchar('reviewed_by', { length: 200 }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  primarySourceId: uuid('primary_source_id').references(() => knowledgeEvidenceSources.id, { onDelete: 'set null' }),
  firstSeenSnapshotId: uuid('first_seen_snapshot_id').references(() => knowledgeSnapshots.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeObjectAliases = pgTable('knowledge_object_aliases', {
  id: uuid('id').defaultRandom().primaryKey(),
  objectId: uuid('object_id').notNull().references(() => knowledgeObjects.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  alias: varchar('alias', { length: 200 }).notNull(),
  aliasType: varchar('alias_type', { length: 30 }).notNull(),
  sourceId: uuid('source_id').references(() => knowledgeEvidenceSources.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeObjectReleaseStates = pgTable('knowledge_object_release_states', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  objectId: uuid('object_id').notNull().references(() => knowledgeObjects.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  releaseId: uuid('release_id').notNull().references(() => knowledgeReleases.id, { onDelete: 'cascade' }),
  scheme: varchar('scheme', { length: 40 }).notNull(),
  state: varchar('state', { length: 40 }).notNull(),
  supportState: varchar('support_state', { length: 40 }).notNull(),
  cleanCoreLevel: char('clean_core_level', { length: 1 }),
  successorClassification: varchar('successor_classification', { length: 40 }),
  successorConcept: varchar('successor_concept', { length: 300 }),
  successors: jsonb('successors').default([]).notNull(),
  labels: jsonb('labels').default([]).notNull(),
  softwareComponent: varchar('software_component', { length: 60 }),
  applicationComponent: varchar('application_component', { length: 60 }),
  sourceId: uuid('source_id').notNull().references(() => knowledgeEvidenceSources.id),
  confidenceClass: varchar('confidence_class', { length: 20 }).default('VERIFIED').notNull(),
  confidenceScore: numeric('confidence_score', { precision: 4, scale: 3 }).default('1.000').notNull(),
  contentHash: char('content_hash', { length: 64 }).notNull(),
  validFromSeq: bigint('valid_from_seq', { mode: 'number' }).notNull(),
  validToSeq: bigint('valid_to_seq', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeRelationships = pgTable('knowledge_relationships', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  scope: varchar('scope', { length: 10 }).default('GLOBAL').notNull(),
  sourceObjectId: uuid('source_object_id').notNull().references(() => knowledgeObjects.id, { onDelete: 'cascade' }),
  targetObjectId: uuid('target_object_id').notNull().references(() => knowledgeObjects.id, { onDelete: 'cascade' }),
  relationshipType: varchar('relationship_type', { length: 40 }).notNull(),
  releaseId: uuid('release_id').references(() => knowledgeReleases.id, { onDelete: 'cascade' }),
  validFromReleaseId: uuid('valid_from_release_id').references(() => knowledgeReleases.id, { onDelete: 'set null' }),
  validToReleaseId: uuid('valid_to_release_id').references(() => knowledgeReleases.id, { onDelete: 'set null' }),
  confidenceClass: varchar('confidence_class', { length: 20 }).default('VERIFIED').notNull(),
  confidenceScore: numeric('confidence_score', { precision: 4, scale: 3 }).default('1.000').notNull(),
  evidenceSourceId: uuid('evidence_source_id').references(() => knowledgeEvidenceSources.id, { onDelete: 'set null' }),
  reviewStatus: varchar('review_status', { length: 20 }).default('DRAFT').notNull(),
  attributes: jsonb('attributes').default({}).notNull(),
  validFromSeq: bigint('valid_from_seq', { mode: 'number' }).default(0).notNull(),
  validToSeq: bigint('valid_to_seq', { mode: 'number' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeChangeEvents = pgTable('knowledge_change_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  snapshotId: uuid('snapshot_id').notNull().references(() => knowledgeSnapshots.id),
  snapshotSeq: bigint('snapshot_seq', { mode: 'number' }).notNull(),
  changeType: varchar('change_type', { length: 40 }).notNull(),
  objectId: uuid('object_id').notNull().references(() => knowledgeObjects.id, { onDelete: 'cascade' }),
  releaseId: uuid('release_id').notNull().references(() => knowledgeReleases.id, { onDelete: 'cascade' }),
  scheme: varchar('scheme', { length: 40 }).notNull(),
  previous: jsonb('previous'),
  current: jsonb('current'),
  requiresReview: boolean('requires_review').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const releaseWatches = pgTable('release_watches', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  watchType: varchar('watch_type', { length: 30 }).notNull(),
  label: varchar('label', { length: 300 }).notNull(),
  notes: text('notes'),
  targetObjectIds: uuid('target_object_ids').array().default([]).notNull(),
  findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'cascade' }),
  releaseId: uuid('release_id').references(() => knowledgeReleases.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  lastState: jsonb('last_state').default({}).notNull(),
  lastSnapshotId: uuid('last_snapshot_id').references(() => knowledgeSnapshots.id),
  lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
  lastChangeAt: timestamp('last_change_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const releaseWatchEvents = pgTable('release_watch_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  watchId: uuid('watch_id').notNull().references(() => releaseWatches.id, { onDelete: 'cascade' }),
  snapshotId: uuid('snapshot_id').notNull().references(() => knowledgeSnapshots.id),
  eventType: varchar('event_type', { length: 40 }).notNull(),
  objectId: uuid('object_id').references(() => knowledgeObjects.id, { onDelete: 'set null' }),
  releaseId: uuid('release_id').references(() => knowledgeReleases.id, { onDelete: 'set null' }),
  previous: jsonb('previous'),
  current: jsonb('current'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 80 }).notNull(),
  severity: varchar('severity', { length: 20 }).default('INFO').notNull(),
  title: varchar('title', { length: 300 }).notNull(),
  body: text('body').default('').notNull(),
  link: varchar('link', { length: 500 }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  engine: varchar('engine', { length: 100 }),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: uuid('resource_id'),
  groupKey: varchar('group_key', { length: 200 }),
  dedupeKey: varchar('dedupe_key', { length: 200 }).notNull(),
  payload: jsonb('payload').default({}).notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 80 }).notNull(),
  channel: varchar('channel', { length: 20 }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type KnowledgeObjectRow = typeof knowledgeObjects.$inferSelect;
export type KnowledgeSnapshotRow = typeof knowledgeSnapshots.$inferSelect;
export type KnowledgeReleaseRow = typeof knowledgeReleases.$inferSelect;
export type ReleaseWatchRow = typeof releaseWatches.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
