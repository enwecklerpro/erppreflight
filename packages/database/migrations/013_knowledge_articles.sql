-- ==============================================================================
-- ERP Preflight — Public Knowledge Base Articles
-- Migration: 013_knowledge_articles.sql
-- Specifications: Part 02 §2.8–2.13 (SEO knowledge pages, content workflow),
--                 Part 17 (knowledge governance: review date, sources, versions)
--
-- Knowledge articles are PUBLIC, platform-owned content (not customer data):
--   * NOT tenant-scoped — no organization_id and therefore no tenant RLS policy.
--     Public endpoints only ever read rows with status = 'PUBLISHED'.
--   * One current row per (slug, locale); every create/update/status change
--     appends an immutable snapshot to knowledge_article_revisions (version history).
--   * Writes are restricted at the API layer to SUPER_ADMIN.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS knowledge_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(160) NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    locale VARCHAR(5) NOT NULL CHECK (locale IN ('en', 'de')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'UPDATE_REQUIRED', 'DEPRECATED', 'ARCHIVED')),
    title VARCHAR(200) NOT NULL,
    summary VARCHAR(500) NOT NULL,
    body_markdown TEXT NOT NULL,
    related_engine_types TEXT[] NOT NULL DEFAULT '{}',
    target_releases TEXT[] NOT NULL DEFAULT '{}',
    -- [{ "title": "...", "url": "https://..." }]
    sources JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
    reviewed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_knowledge_articles_slug_locale UNIQUE (slug, locale)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_locale_status
    ON knowledge_articles(locale, status);

CREATE TABLE IF NOT EXISTS knowledge_article_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    summary VARCHAR(500) NOT NULL,
    body_markdown TEXT NOT NULL,
    related_engine_types TEXT[] NOT NULL DEFAULT '{}',
    target_releases TEXT[] NOT NULL DEFAULT '{}',
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    reviewed_at TIMESTAMPTZ,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    change_note VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_knowledge_article_revisions_version UNIQUE (article_id, version)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_article_revisions_article
    ON knowledge_article_revisions(article_id, version DESC);

-- Revisions are append-only history.
CREATE OR REPLACE FUNCTION prevent_knowledge_revision_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'knowledge_article_revisions is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_revisions_immutable ON knowledge_article_revisions;
CREATE TRIGGER trg_knowledge_revisions_immutable
    BEFORE UPDATE ON knowledge_article_revisions
    FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_revision_mutation();

-- Runtime role (migration 010): read for public pages, write for SUPER_ADMIN CRUD.
-- Revisions: no UPDATE/DELETE for the runtime role (cascade from the article only).
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_articles TO erppreflight_app;
GRANT SELECT, INSERT ON knowledge_article_revisions TO erppreflight_app;
REVOKE UPDATE, DELETE ON knowledge_article_revisions FROM erppreflight_app;
