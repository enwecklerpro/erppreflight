import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, unique } from 'drizzle-orm/pg-core';
import { users } from './core';

/**
 * Public knowledge base (migration 013_knowledge_articles.sql).
 * Platform content, NOT tenant-scoped: no organization_id and no tenant RLS.
 */
export const knowledgeArticles = pgTable(
  'knowledge_articles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 160 }).notNull(),
    locale: varchar('locale', { length: 5 }).notNull(),
    version: integer('version').default(1).notNull(),
    status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    relatedEngineTypes: text('related_engine_types').array().default([]).notNull(),
    targetReleases: text('target_releases').array().default([]).notNull(),
    sources: jsonb('sources').default([]).notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('uq_knowledge_articles_slug_locale').on(t.slug, t.locale)]
);

/** Append-only revision history (UPDATE is blocked by a trigger). */
export const knowledgeArticleRevisions = pgTable(
  'knowledge_article_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleId: uuid('article_id').notNull().references(() => knowledgeArticles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    relatedEngineTypes: text('related_engine_types').array().default([]).notNull(),
    targetReleases: text('target_releases').array().default([]).notNull(),
    sources: jsonb('sources').default([]).notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    changeNote: varchar('change_note', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('uq_knowledge_article_revisions_version').on(t.articleId, t.version)]
);
