-- ==============================================================================
-- ERP Preflight — Upgrade path from v0 (main@7a76aea): legacy finding provenance
-- Migration: 026_legacy_finding_source_backfill.sql
--
-- Findings persisted before migration 017 carry no source_file_id / source_file_name.
-- The finding lifecycle identity (apps/api .../lifecycle-keys.ts) is
--   engine + rule + affected objects + logical artifact NAME,
-- and the analysis pipeline uses the uploaded file's name. For a pre-017 finding the
-- lazily created lifecycle fell back to the evidence artifact_path, which v0 stored as
-- the full object-storage key (tenants/<org>/projects/<project>/<file>/<name>), so a
-- decision taken on an old finding (resolved, accepted risk, false positive, legacy
-- review) never carried over to the next analysis of the same file: every re-analysis
-- of an upgraded project started a second, OPEN lifecycle.
--
-- Backfill (additive, NULL -> value only): when an evidence row of the finding points
-- at an uploaded file of the SAME organization and project (exact storage_path match),
-- record that file as the finding's source. Nothing else about the finding changes;
-- findings whose evidence does not reference an uploaded file keep NULL.
-- Idempotent: only rows with both columns NULL are touched.
-- ==============================================================================

UPDATE findings f
   SET source_file_id = m.file_id,
       source_file_name = m.file_name
  FROM (
    SELECT DISTINCT ON (f2.id) f2.id AS finding_id, uf.id AS file_id, uf.file_name
      FROM findings f2
      JOIN evidence e
        ON e.finding_id = f2.id
      JOIN uploaded_files uf
        ON uf.storage_path = e.artifact_path
       AND uf.organization_id = f2.organization_id
       AND uf.project_id = f2.project_id
     WHERE f2.source_file_id IS NULL
       AND f2.source_file_name IS NULL
     ORDER BY f2.id, e.created_at ASC, e.id ASC
  ) m
 WHERE f.id = m.finding_id
   AND f.source_file_id IS NULL
   AND f.source_file_name IS NULL;
