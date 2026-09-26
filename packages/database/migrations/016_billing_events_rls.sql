-- ==============================================================================
-- 016: Row-Level Security on billing_events (defense in depth)
-- billing_events (migration 012) is a platform-scope Stripe idempotency ledger that
-- carries organization_id. The runtime role already has no privileges on it; RLS is
-- enabled and forced as well, with a policy that admits only non-runtime roles, so a
-- future GRANT cannot silently expose other tenants' billing events.
-- ==============================================================================

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_events_platform_only ON billing_events;
CREATE POLICY billing_events_platform_only ON billing_events
    USING (current_user <> 'erppreflight_app')
    WITH CHECK (current_user <> 'erppreflight_app');

REVOKE ALL ON billing_events FROM erppreflight_app;
