import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, boolean, inet, bigserial, customType } from 'drizzle-orm/pg-core';
import { organizations, users } from './core';

/** PostgreSQL `cidr` (network address, host bits zero). */
const cidr = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'cidr';
  },
});

/**
 * Time-boxed (<= 30 min), reason-bound super-admin impersonation of one tenant member
 * (migration 021, spec 10.8 / C §24). Read-only unless a tenant support grant allows writes.
 */
export const impersonationSessions = pgTable('impersonation_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  impersonatorId: uuid('impersonator_id').references(() => users.id, { onDelete: 'set null' }),
  impersonatorEmail: varchar('impersonator_email', { length: 255 }).notNull(),
  impersonatorOrganizationId: uuid('impersonator_organization_id'),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  targetEmail: varchar('target_email', { length: 255 }).notNull(),
  reason: text('reason').notNull(),
  readOnly: boolean('read_only').default(true).notNull(),
  supportGrantId: uuid('support_grant_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  endReason: varchar('end_reason', { length: 30 }),
  endedBy: uuid('ended_by'),
  requestCount: integer('request_count').default(0).notNull(),
  lastRequestAt: timestamp('last_request_at', { withTimezone: true }),
  clientIp: inet('client_ip'),
  userAgent: varchar('user_agent', { length: 500 }),
});

/** Append-only platform ledger of super-admin actions (migration 021). */
export const platformAuditEvents = pgTable('platform_audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sequenceNum: bigserial('sequence_num', { mode: 'number' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id'),
  actorEmail: varchar('actor_email', { length: 255 }),
  impersonationId: uuid('impersonation_id'),
  action: varchar('action', { length: 120 }).notNull(),
  targetType: varchar('target_type', { length: 60 }).notNull(),
  targetId: uuid('target_id'),
  payload: jsonb('payload').default({}).notNull(),
  clientIp: inet('client_ip'),
  userAgent: varchar('user_agent', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Per-organization CIDR allowlist (migration 021, spec 10.2). Empty = not enforced. */
export const organizationIpAllowlist = pgTable('organization_ip_allowlist', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  cidr: cidr('cidr').notNull(),
  label: varchar('label', { length: 100 }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Support ticket conversation (migration 021). */
export const supportTicketMessages = pgTable('support_ticket_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  ticketId: uuid('ticket_id').notNull(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  authorRole: varchar('author_role', { length: 20 }).notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ImpersonationSessionRow = typeof impersonationSessions.$inferSelect;
export type PlatformAuditEventRow = typeof platformAuditEvents.$inferSelect;
export type OrganizationIpAllowlistRow = typeof organizationIpAllowlist.$inferSelect;
export type SupportTicketMessageRow = typeof supportTicketMessages.$inferSelect;
