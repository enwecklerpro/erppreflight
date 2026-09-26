-- ==============================================================================
-- ERP Preflight — Knowledge content publishing workflow
-- Migration: 019_knowledge_content_workflow.sql
-- Specifications: Part 02 §2.13 (content system: draft, technical review,
--   SEO review, publish, update required, deprecated; public pages show last
--   reviewed, target release and source provenance), Part 04 §4.14.
--
-- knowledge_articles stay platform content (no organization_id, no tenant RLS,
-- see migration 013). This migration
--   * replaces the single IN_REVIEW status by the two review gates
--     TECHNICAL_REVIEW and SEO_REVIEW (existing IN_REVIEW rows move to
--     TECHNICAL_REVIEW),
--   * records who passed each gate and when,
--   * adds the provenance class shown on public pages and the reason an
--     article was flagged UPDATE_REQUIRED.
-- Status transitions are enforced by the API (KnowledgeArticlesService).
-- ==============================================================================

ALTER TABLE knowledge_articles DROP CONSTRAINT IF EXISTS knowledge_articles_status_check;

UPDATE knowledge_articles SET status = 'TECHNICAL_REVIEW' WHERE status = 'IN_REVIEW';

ALTER TABLE knowledge_articles
    ADD CONSTRAINT knowledge_articles_status_check CHECK (status IN (
        'DRAFT', 'TECHNICAL_REVIEW', 'SEO_REVIEW', 'PUBLISHED', 'UPDATE_REQUIRED', 'DEPRECATED', 'ARCHIVED'));

ALTER TABLE knowledge_articles
    ADD COLUMN IF NOT EXISTS technical_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS technical_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS seo_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS seo_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS provenance VARCHAR(40) NOT NULL DEFAULT 'EDITORIAL',
    ADD COLUMN IF NOT EXISTS update_required_reason VARCHAR(500),
    ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ;

ALTER TABLE knowledge_articles DROP CONSTRAINT IF EXISTS knowledge_articles_provenance_check;
ALTER TABLE knowledge_articles
    ADD CONSTRAINT knowledge_articles_provenance_check CHECK (provenance IN (
        'OFFICIAL_SAP_DOCUMENTATION', 'OFFICIAL_SAP_REPOSITORY', 'CURATED_RULE', 'EDITORIAL'));

-- Published seed articles were reviewed technically when they were written.
UPDATE knowledge_articles
   SET technical_reviewed_at = reviewed_at
 WHERE status = 'PUBLISHED' AND technical_reviewed_at IS NULL AND reviewed_at IS NOT NULL;

-- Revisions keep the workflow gate that produced them.
ALTER TABLE knowledge_article_revisions
    ADD COLUMN IF NOT EXISTS provenance VARCHAR(40),
    ADD COLUMN IF NOT EXISTS transition VARCHAR(60);

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_status_updated
    ON knowledge_articles(status, updated_at DESC);

-- Grants: unchanged tables, new columns inherit the table grants of migration 013.
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_articles TO erppreflight_app;
GRANT SELECT, INSERT ON knowledge_article_revisions TO erppreflight_app;
