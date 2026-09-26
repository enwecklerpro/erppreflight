-- ==============================================================================
-- ERP Preflight — Magic-link sign-in
-- Migration: 025_magic_link_sign_in.sql
-- Specifications: Part 10 §10.2 (Authentication: magic link), C §8.2 / §68
--   (cookie session, no primary token in localStorage).
--
-- Magic-link tokens reuse the hashed, single-use, expiring token store
-- user_action_tokens (migration 011): only the SHA-256 digest of the 256-bit
-- token is stored, consumption is one conditional UPDATE (at most once), and
-- issuing a new link supersedes every open link of the same purpose.
--
-- user_action_tokens is user-global authentication data (no organization_id):
-- the tenant runtime role erppreflight_app keeps NO privileges on it (migration
-- 011 §8); only the authentication service reads it with the login role.
-- ==============================================================================

-- 1. Allow the MAGIC_LINK purpose (drops whichever CHECK constraint guards the column,
--    whatever its generated name).
DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT c.conname
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.conrelid = 'user_action_tokens'::regclass
           AND c.contype = 'c'
           AND a.attname = 'purpose'
    LOOP
        EXECUTE format('ALTER TABLE user_action_tokens DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE user_action_tokens
    ADD CONSTRAINT user_action_tokens_purpose_check
    CHECK (purpose IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'MAGIC_LINK'));

-- 2. Defence in depth: the runtime role never reads token digests.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erppreflight_app') THEN
        REVOKE ALL ON TABLE user_action_tokens FROM erppreflight_app;
    END IF;
END $$;
