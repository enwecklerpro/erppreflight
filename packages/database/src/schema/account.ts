import { pgTable, uuid, varchar, text, timestamp, char } from 'drizzle-orm/pg-core';
import { organizations, users } from './core';

/**
 * Account lifecycle tables (migration 011_account_lifecycle.sql).
 * Only SHA-256 digests of tokens / recovery codes are ever stored.
 */
export const userActionTokens = pgTable('user_action_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: varchar('purpose', { length: 40 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  requestedIp: varchar('requested_ip', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userRecoveryCodes = pgTable('user_recovery_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: char('code_hash', { length: 64 }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const revokedSessions = pgTable('revoked_sessions', {
  jti: uuid('jti').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mailOutbox = pgTable('mail_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  toAddress: varchar('to_address', { length: 320 }).notNull(),
  fromAddress: varchar('from_address', { length: 320 }).notNull(),
  subject: varchar('subject', { length: 998 }).notNull(),
  template: varchar('template', { length: 80 }).notNull(),
  textBody: text('text_body').notNull(),
  htmlBody: text('html_body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const organizationInvitations = pgTable('organization_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
