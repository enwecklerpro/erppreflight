-- ==============================================================================
-- ERP Preflight — Runtime Application Role (RLS Enforcement)
-- Migration: 010_app_runtime_role.sql
-- Purpose:
--   The API historically connected as the database owner / superuser, which
--   silently bypasses Row-Level Security (superusers ignore even FORCE RLS).
--   This migration creates a dedicated, non-privileged runtime role
--   `erppreflight_app` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT) that is
--   NOT the table owner. The API switches to it with `SET LOCAL ROLE` inside
--   every tenant-scoped transaction, so RLS policies are enforced even when the
--   login user is privileged.
--
--   No password is created here: the role is NOLOGIN. Operators who want a
--   dedicated login user for the runtime pool (APP_DATABASE_URL) create that
--   user out-of-band and `GRANT erppreflight_app TO <login_user>`.
--
--   Also tightens the customer_feedback policy (previously USING (true)).
-- ==============================================================================

-- 1. Create the runtime role idempotently
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erppreflight_app') THEN
        CREATE ROLE erppreflight_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    ELSE
        -- Re-assert the non-privileged attributes in case the role pre-existed.
        ALTER ROLE erppreflight_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

-- 2. Allow the migrating (owner) user to SET ROLE to the runtime role.
--    Superusers can always SET ROLE; for a non-superuser owner membership is required.
DO $$
BEGIN
    IF NOT pg_has_role(current_user, 'erppreflight_app', 'MEMBER') THEN
        EXECUTE format('GRANT erppreflight_app TO %I', current_user);
    END IF;
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE WARNING 'Could not grant erppreflight_app to %; grant it manually so the API can SET ROLE', current_user;
END $$;

-- 3. Privileges: DML only, no DDL, no ownership.
GRANT USAGE ON SCHEMA public TO erppreflight_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erppreflight_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO erppreflight_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO erppreflight_app;

-- Migration bookkeeping is never touched by the runtime role.
REVOKE ALL ON TABLE _migrations FROM erppreflight_app;

-- Future tables/sequences created by the migrating user inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erppreflight_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO erppreflight_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO erppreflight_app;

-- 4. Feedback: scope rows to the owning tenant (was USING (true)).
DROP POLICY IF EXISTS tenant_isolation_feedback ON customer_feedback;
CREATE POLICY tenant_isolation_feedback ON customer_feedback
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());
