import { pgTable, uuid, varchar, text, jsonb, timestamp, inet, bigserial, index } from 'drizzle-orm/pg-core';

export const auditEvents = pgTable(
  'audit_events',
  {
    sequenceNum: bigserial('sequence_num', { mode: 'number' }).primaryKey(),
    id: uuid('id').defaultRandom().notNull(),
    organizationId: uuid('organization_id').notNull(),
    actorType: varchar('actor_type', { length: 50 }).default('SYSTEM').notNull(),
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 100 }).notNull(),
    resourceType: varchar('resource_type', { length: 100 }).default('SYSTEM').notNull(),
    resourceId: uuid('resource_id'),
    payload: jsonb('payload').default({}).notNull(),
    clientIp: inet('client_ip'),
    userAgent: text('user_agent'),
    prevHash: varchar('prev_hash', { length: 64 }).notNull(),
    currentHash: varchar('current_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgSeqIdx: index('idx_audit_events_seq').on(table.organizationId, table.sequenceNum),
  })
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
