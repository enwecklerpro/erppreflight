import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  numeric,
  bigint,
  date,
  char,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { users } from './core';

/**
 * Platform governance (migration 022_admin_governance.sql): Rule Admin (spec 10.10),
 * AI Admin (10.11) and Source Sync Admin (10.12). Platform-level configuration and
 * history — no organization_id, no tenant RLS; written only by SUPER_ADMIN endpoints
 * and platform jobs. History tables are append-only (triggers).
 */
export const ruleSelfTestRuns = pgTable('rule_self_test_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleCode: varchar('rule_code', { length: 120 }).notNull(),
  engineType: varchar('engine_type', { length: 64 }).notNull(),
  ruleVersion: varchar('rule_version', { length: 80 }).notNull(),
  engineVersion: varchar('engine_version', { length: 40 }),
  manifestVersion: varchar('manifest_version', { length: 40 }),
  status: varchar('status', { length: 20 }).notNull(),
  passed: boolean('passed').notNull(),
  coverageGap: varchar('coverage_gap', { length: 40 }),
  positiveCount: integer('positive_count').default(0).notNull(),
  negativeCount: integer('negative_count').default(0).notNull(),
  resultDigest: char('result_digest', { length: 64 }),
  cases: jsonb('cases').default([]).notNull(),
  durationMs: integer('duration_ms'),
  runBy: uuid('run_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ruleGovernance = pgTable('rule_governance', {
  ruleCode: varchar('rule_code', { length: 120 }).primaryKey(),
  engineType: varchar('engine_type', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
  author: varchar('author', { length: 200 }),
  reviewer: varchar('reviewer', { length: 200 }),
  notes: text('notes'),
  publishedVersion: varchar('published_version', { length: 80 }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
  publishedSelfTestId: uuid('published_self_test_id').references(() => ruleSelfTestRuns.id),
  deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ruleGovernanceEvents = pgTable('rule_governance_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleCode: varchar('rule_code', { length: 120 }).notNull(),
  engineType: varchar('engine_type', { length: 64 }).notNull(),
  eventType: varchar('event_type', { length: 30 }).notNull(),
  fromStatus: varchar('from_status', { length: 20 }),
  toStatus: varchar('to_status', { length: 20 }),
  ruleVersion: varchar('rule_version', { length: 80 }),
  selfTestId: uuid('self_test_id').references(() => ruleSelfTestRuns.id),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: varchar('actor_email', { length: 320 }),
  note: varchar('note', { length: 1000 }),
  details: jsonb('details').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiTaskConfigs = pgTable('ai_task_configs', {
  taskType: varchar('task_type', { length: 64 }).primaryKey(),
  enabled: boolean('enabled').default(true).notNull(),
  provider: varchar('provider', { length: 32 }),
  primaryModel: varchar('primary_model', { length: 120 }),
  fallbackProvider: varchar('fallback_provider', { length: 32 }),
  fallbackModel: varchar('fallback_model', { length: 120 }),
  maxTokens: integer('max_tokens').default(512).notNull(),
  temperature: numeric('temperature', { precision: 3, scale: 2 }),
  privacyMode: varchar('privacy_mode', { length: 20 }).default('STANDARD').notNull(),
  costCeilingEurMonthly: numeric('cost_ceiling_eur_monthly', { precision: 12, scale: 2 }),
  inputPriceEurPer1k: numeric('input_price_eur_per_1k', { precision: 12, scale: 6 }).default('0').notNull(),
  outputPriceEurPer1k: numeric('output_price_eur_per_1k', { precision: 12, scale: 6 }).default('0').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiProviderControls = pgTable('ai_provider_controls', {
  provider: varchar('provider', { length: 32 }).primaryKey(),
  killSwitch: boolean('kill_switch').default(false).notNull(),
  killReason: varchar('kill_reason', { length: 500 }),
  killedAt: timestamp('killed_at', { withTimezone: true }),
  endpointUrl: varchar('endpoint_url', { length: 500 }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiTaskSpend = pgTable(
  'ai_task_spend',
  {
    taskType: varchar('task_type', { length: 64 }).notNull(),
    periodMonth: date('period_month').notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    model: varchar('model', { length: 120 }).default('').notNull(),
    requests: integer('requests').default(0).notNull(),
    blockedRequests: integer('blocked_requests').default(0).notNull(),
    inputTokens: bigint('input_tokens', { mode: 'number' }).default(0).notNull(),
    outputTokens: bigint('output_tokens', { mode: 'number' }).default(0).notNull(),
    costEur: numeric('cost_eur', { precision: 14, scale: 6 }).default('0').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskType, t.periodMonth, t.provider, t.model] })]
);

/** Atomic cost-ceiling ledger per task and month (spent + in-flight reservations). */
export const aiTaskBudget = pgTable(
  'ai_task_budget',
  {
    taskType: varchar('task_type', { length: 64 }).notNull(),
    periodMonth: date('period_month').notNull(),
    spentEur: numeric('spent_eur', { precision: 14, scale: 6 }).default('0').notNull(),
    reservedEur: numeric('reserved_eur', { precision: 14, scale: 6 }).default('0').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskType, t.periodMonth] })]
);

export const knowledgeSourceSettings = pgTable('knowledge_source_settings', {
  adapterId: varchar('adapter_id', { length: 64 }).primaryKey(),
  critical: boolean('critical').default(false).notNull(),
  freshnessThresholdHours: integer('freshness_threshold_hours').default(192).notNull(),
  alertsEnabled: boolean('alerts_enabled').default(true).notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeSourceAlerts = pgTable('knowledge_source_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  adapterId: varchar('adapter_id', { length: 64 }).notNull(),
  alertType: varchar('alert_type', { length: 20 }).default('STALE').notNull(),
  status: varchar('status', { length: 20 }).default('OPEN').notNull(),
  severity: varchar('severity', { length: 20 }).default('CRITICAL').notNull(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  thresholdHours: integer('threshold_hours').notNull(),
  ageHours: numeric('age_hours', { precision: 12, scale: 2 }),
  message: varchar('message', { length: 1000 }).notNull(),
  notifiedUsers: integer('notified_users').default(0).notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedReason: varchar('resolved_reason', { length: 200 }),
});
