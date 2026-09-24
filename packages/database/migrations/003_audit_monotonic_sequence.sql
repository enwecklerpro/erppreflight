-- ==============================================================================
-- ERP Preflight — Audit Trail Monotonic Sequence Migration
-- Migration: 003_audit_monotonic_sequence.sql
-- Purpose: Add strictly monotonic BIGSERIAL sequence_num to eliminate
--          millisecond timestamp sort collision false-positive tamper alerts.
-- ==============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_events' AND column_name = 'sequence_num'
    ) THEN
        ALTER TABLE audit_events ADD COLUMN sequence_num BIGSERIAL;
    END IF;
END $$;

-- High-performance b-tree index for tenant ledger ordered traversal
CREATE INDEX IF NOT EXISTS idx_audit_events_seq 
ON audit_events(organization_id, sequence_num ASC);

-- Index for acquiring the latest chain tip in constant time
CREATE INDEX IF NOT EXISTS idx_audit_events_tip 
ON audit_events(organization_id, sequence_num DESC);
