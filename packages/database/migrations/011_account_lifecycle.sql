-- ==============================================================================
-- ERP Preflight — Account Lifecycle & Authentication Completeness
-- Migration: 011_account_lifecycle.sql
-- Spec: 10 §10.2 (auth), §10.7 (organizations/members), §10.19 (GDPR), 13.11
--
--   * users: e-mail verification, token_version (session revocation), TOTP 2FA,
--     soft-delete / anonymisation markers.
--   * organizations: "require 2FA" policy flag.
--   * user_action_tokens: hashed, single-use, expiring tokens (e-mail
--     verification, password reset). Only SHA-256 digests are stored.
--   * user_recovery_codes: hashed 2FA recovery codes.
--   * revoked_sessions: per-token (jti) logout denylist until natural expiry.
--   * organization_invitations: tenant-owned invitations (RLS enforced).
--   * mail_outbox: messages captured by the development mail transport.
--
-- User-global tables (tokens, recovery codes, revoked sessions, mail outbox) are
-- not tenant data. They are only accessed by the authentication service with the
-- login role, so the tenant runtime role `erppreflight_app` has NO privileges on
-- them (defence in depth: a tenant-scoped transaction can never read a reset
-- token digest or a recovery code hash).
-- ==============================================================================

-- 1. users -------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_created_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Accounts that existed before e-mail verification was introduced were created by
-- operators or during the pre-verification era; they are grandfathered as verified
-- so existing tenants keep working. Every account created from now on starts unverified.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- 2. organizations -------------------------------------------------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS require_2fa BOOLEAN NOT NULL DEFAULT false;

-- 3. user_action_tokens (global, user-scoped) ----------------------------------
CREATE TABLE IF NOT EXISTS user_action_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(40) NOT NULL CHECK (purpose IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET')),
    token_hash CHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    requested_ip VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_action_tokens_user_purpose
    ON user_action_tokens(user_id, purpose, created_at DESC);

-- 4. user_recovery_codes (global, user-scoped) ---------------------------------
CREATE TABLE IF NOT EXISTS user_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash CHAR(64) NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, code_hash)
);

-- 5. revoked_sessions (global, user-scoped) ------------------------------------
CREATE TABLE IF NOT EXISTS revoked_sessions (
    jti UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expiry ON revoked_sessions(expires_at);

-- 6. mail_outbox (development transport capture) -------------------------------
CREATE TABLE IF NOT EXISTS mail_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_address VARCHAR(320) NOT NULL,
    from_address VARCHAR(320) NOT NULL,
    subject VARCHAR(998) NOT NULL,
    template VARCHAR(80) NOT NULL,
    text_body TEXT NOT NULL,
    html_body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_to ON mail_outbox(lower(to_address), created_at DESC);

-- 7. organization_invitations (tenant-owned, RLS) ------------------------------
CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON organization_invitations(organization_id, created_at DESC);
-- At most one open invitation per (organization, e-mail).
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_open
    ON organization_invitations(organization_id, lower(email))
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_org_invitations ON organization_invitations;
CREATE POLICY tenant_isolation_org_invitations ON organization_invitations
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 8. Runtime role privileges ----------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erppreflight_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_invitations TO erppreflight_app;
        REVOKE ALL ON TABLE user_action_tokens FROM erppreflight_app;
        REVOKE ALL ON TABLE user_recovery_codes FROM erppreflight_app;
        REVOKE ALL ON TABLE revoked_sessions FROM erppreflight_app;
        REVOKE ALL ON TABLE mail_outbox FROM erppreflight_app;
    END IF;
END $$;
