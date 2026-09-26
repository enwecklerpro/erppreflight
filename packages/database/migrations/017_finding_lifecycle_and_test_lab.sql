-- ==============================================================================
-- ERP Preflight — Finding Lifecycle, Collaboration & Regression Test Lab
-- Migration: 017_finding_lifecycle_and_test_lab.sql
-- Spec: Part 01 §1.7/§1.8, Part 04 §4.10/§4.11, Part 05 §5.5, Section C §17/§18
--
-- Design
--   * findings rows stay immutable per analysis (AGENTS.md §4.3 "Finding Immutability").
--     Every persisted finding now records engine version, rule version, knowledge
--     snapshot, target release, source artifact and an object-state hash (Part 04 §4.10).
--   * finding_lifecycles holds the mutable, cross-analysis state of "the same" finding
--     (project + lifecycle_key): status, suppression, assignee, due date, first detected,
--     last evaluated. Each analysis links its new finding rows to the lifecycle, so
--     status, history, comments and attachments carry over between analyses.
--   * finding_status_history is append-only (UPDATE/direct DELETE rejected by trigger;
--     only FK cascades from project / organization deletion may remove rows).
--   * regression_test_cases / regression_test_runs / regression_test_schedules implement
--     the customer-facing Test Lab (finding → test, manual / batch / scheduled run,
--     baseline comparison, machine-readable fixture export).
--   All tables carry organization_id with ENABLE + FORCE RLS and grants to erppreflight_app.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Lifecycle state (one row per project + lifecycle key)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finding_lifecycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    lifecycle_key CHAR(64) NOT NULL,
    engine VARCHAR(100) NOT NULL,
    rule_id VARCHAR(100) NOT NULL,
    artifact_name VARCHAR(500),
    status VARCHAR(40) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'ACCEPTED_RISK', 'FALSE_POSITIVE', 'RESOLVED',
                          'REGRESSION_TEST_CREATED', 'SUPPRESSED')),
    status_reason TEXT,
    status_changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status_changed_at TIMESTAMPTZ,
    suppression_mode VARCHAR(30)
        CHECK (suppression_mode IS NULL OR suppression_mode IN ('PERMANENT', 'UNTIL_DATE', 'UNTIL_RELEASE', 'UNTIL_OBJECT_CHANGE')),
    suppressed_until TIMESTAMPTZ,
    suppressed_release VARCHAR(50),
    suppressed_object_hash CHAR(64),
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date DATE,
    first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    latest_finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    last_object_hash CHAR(64),
    last_target_release VARCHAR(50),
    detection_count INTEGER NOT NULL DEFAULT 1,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, project_id, lifecycle_key),
    CHECK (status <> 'SUPPRESSED' OR suppression_mode IS NOT NULL),
    CHECK (suppression_mode IS DISTINCT FROM 'UNTIL_DATE' OR suppressed_until IS NOT NULL),
    CHECK (suppression_mode IS DISTINCT FROM 'UNTIL_RELEASE' OR suppressed_release IS NOT NULL),
    CHECK (suppression_mode IS DISTINCT FROM 'UNTIL_OBJECT_CHANGE' OR suppressed_object_hash IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_finding_lifecycles_org_proj ON finding_lifecycles(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_finding_lifecycles_status ON finding_lifecycles(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_finding_lifecycles_assignee ON finding_lifecycles(organization_id, assignee_id);
CREATE INDEX IF NOT EXISTS idx_finding_lifecycles_due ON finding_lifecycles(organization_id, due_date);

-- ------------------------------------------------------------------------------
-- 2. Finding model completeness (Part 04 §4.10) — recorded once at insert time
-- ------------------------------------------------------------------------------
ALTER TABLE findings ADD COLUMN IF NOT EXISTS engine_version VARCHAR(50);
ALTER TABLE findings ADD COLUMN IF NOT EXISTS rule_version VARCHAR(80);
ALTER TABLE findings ADD COLUMN IF NOT EXISTS knowledge_snapshot_id UUID REFERENCES knowledge_snapshots(id);
ALTER TABLE findings ADD COLUMN IF NOT EXISTS target_release VARCHAR(50);
ALTER TABLE findings ADD COLUMN IF NOT EXISTS source_file_id UUID REFERENCES uploaded_files(id) ON DELETE SET NULL;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(500);
ALTER TABLE findings ADD COLUMN IF NOT EXISTS object_state_hash CHAR(64);
ALTER TABLE findings ADD COLUMN IF NOT EXISTS ai_model_version VARCHAR(120);
ALTER TABLE findings ADD COLUMN IF NOT EXISTS lifecycle_id UUID REFERENCES finding_lifecycles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_findings_lifecycle ON findings(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_findings_org_project ON findings(organization_id, project_id);

-- ------------------------------------------------------------------------------
-- 3. Append-only status history
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finding_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    lifecycle_id UUID NOT NULL REFERENCES finding_lifecycles(id) ON DELETE CASCADE,
    finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    event VARCHAR(40) NOT NULL,
    from_status VARCHAR(40),
    to_status VARCHAR(40) NOT NULL,
    reason TEXT,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_kind VARCHAR(10) NOT NULL DEFAULT 'USER' CHECK (actor_kind IN ('USER', 'SYSTEM')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_finding_status_history_lc ON finding_status_history(lifecycle_id, created_at);
CREATE INDEX IF NOT EXISTS idx_finding_status_history_org ON finding_status_history(organization_id);

-- History rows are immutable. A direct UPDATE or DELETE is rejected; deletes that
-- arrive through a foreign-key cascade (project / organization deletion, GDPR
-- erasure) run at trigger depth > 1 and are allowed. SET NULL cascades on the
-- nullable references (finding_id, analysis_id, actor_id) are allowed as well.
CREATE OR REPLACE FUNCTION finding_status_history_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        IF NEW.id = OLD.id AND NEW.lifecycle_id = OLD.lifecycle_id AND NEW.event = OLD.event
           AND NEW.to_status = OLD.to_status AND NEW.from_status IS NOT DISTINCT FROM OLD.from_status
           AND NEW.reason IS NOT DISTINCT FROM OLD.reason AND NEW.created_at = OLD.created_at THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'finding_status_history is append-only (% rejected)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_finding_status_history_immutable ON finding_status_history;
CREATE TRIGGER trg_finding_status_history_immutable
    BEFORE UPDATE OR DELETE ON finding_status_history
    FOR EACH ROW EXECUTE FUNCTION finding_status_history_immutable();

-- ------------------------------------------------------------------------------
-- 4. Comments with edit history and delete tombstones
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finding_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    lifecycle_id UUID NOT NULL REFERENCES finding_lifecycles(id) ON DELETE CASCADE,
    finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    body TEXT,
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((deleted_at IS NULL AND body IS NOT NULL AND char_length(body) BETWEEN 1 AND 5000)
        OR (deleted_at IS NOT NULL AND body IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_finding_comments_lc ON finding_comments(lifecycle_id, created_at);
CREATE INDEX IF NOT EXISTS idx_finding_comments_org ON finding_comments(organization_id);

CREATE TABLE IF NOT EXISTS finding_comment_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    comment_id UUID NOT NULL REFERENCES finding_comments(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    change_kind VARCHAR(10) NOT NULL CHECK (change_kind IN ('EDIT', 'DELETE')),
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_finding_comment_revisions_comment ON finding_comment_revisions(comment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_finding_comment_revisions_org ON finding_comment_revisions(organization_id);

-- ------------------------------------------------------------------------------
-- 5. Assignment log (current assignee/due date live on finding_lifecycles)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finding_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    lifecycle_id UUID NOT NULL REFERENCES finding_lifecycles(id) ON DELETE CASCADE,
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date DATE,
    note TEXT,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_finding_assignments_lc ON finding_assignments(lifecycle_id, created_at);
CREATE INDEX IF NOT EXISTS idx_finding_assignments_org ON finding_assignments(organization_id);

-- ------------------------------------------------------------------------------
-- 6. Attachments: links to artifacts that went through the ingestion pipeline
--    (magic bytes, ClamAV quarantine, redaction). No second upload path.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finding_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    lifecycle_id UUID NOT NULL REFERENCES finding_lifecycles(id) ON DELETE CASCADE,
    file_id UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
    file_name VARCHAR(500) NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    note TEXT,
    attached_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at TIMESTAMPTZ,
    removed_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_finding_attachments_lc ON finding_attachments(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_finding_attachments_org ON finding_attachments(organization_id);

-- ------------------------------------------------------------------------------
-- 7. Regression Test Lab (Part 05 §5.5, Section C §18)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regression_test_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    lifecycle_id UUID REFERENCES finding_lifecycles(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL,
    test_type VARCHAR(40) NOT NULL
        CHECK (test_type IN ('RULE_SCENARIO', 'SCHEMA_CONTRACT', 'API_BREAKING_CHANGE', 'FORM_XML_FIELD',
                             'OUTPUT_DETERMINATION', 'CHANGE_POINTER', 'TRANSPORT_DEPENDENCY', 'MFS_SEQUENCE')),
    engine VARCHAR(100) NOT NULL,
    rule_id VARCHAR(100) NOT NULL,
    match_objects JSONB NOT NULL DEFAULT '[]',
    preconditions JSONB NOT NULL DEFAULT '[]',
    artifact_file_id UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
    artifact_name VARCHAR(500),
    artifact_sha256 CHAR(64),
    artifact_type VARCHAR(20) NOT NULL,
    configuration JSONB NOT NULL DEFAULT '{}',
    expected_outcome VARCHAR(20) NOT NULL CHECK (expected_outcome IN ('FINDING_ABSENT', 'FINDING_PRESENT')),
    target_release VARCHAR(50) NOT NULL,
    fixture_version INTEGER NOT NULL DEFAULT 1,
    engine_version VARCHAR(50),
    rule_version VARCHAR(80),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    baseline_run_id UUID,
    last_run_id UUID,
    last_run_status VARCHAR(20),
    last_run_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_regression_test_cases_org_proj ON regression_test_cases(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_regression_test_cases_lc ON regression_test_cases(lifecycle_id);

CREATE TABLE IF NOT EXISTS regression_test_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    test_case_id UUID NOT NULL REFERENCES regression_test_cases(id) ON DELETE CASCADE,
    batch_id UUID,
    trigger_kind VARCHAR(20) NOT NULL CHECK (trigger_kind IN ('MANUAL', 'BATCH', 'SCHEDULED')),
    fixture_version INTEGER NOT NULL,
    artifact_file_id UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
    artifact_sha256 CHAR(64),
    target_release VARCHAR(50) NOT NULL,
    engine_version VARCHAR(50),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PASSED', 'FAILED', 'ERROR')),
    finding_present BOOLEAN,
    matched_findings JSONB NOT NULL DEFAULT '[]',
    findings_summary JSONB NOT NULL DEFAULT '[]',
    baseline_comparison JSONB,
    execution_time_ms INTEGER,
    error_message TEXT,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_regression_test_runs_case ON regression_test_runs(test_case_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_regression_test_runs_org ON regression_test_runs(organization_id, project_id);

ALTER TABLE regression_test_cases DROP CONSTRAINT IF EXISTS fk_regression_test_cases_baseline;
ALTER TABLE regression_test_cases ADD CONSTRAINT fk_regression_test_cases_baseline
    FOREIGN KEY (baseline_run_id) REFERENCES regression_test_runs(id) ON DELETE SET NULL;
ALTER TABLE regression_test_cases DROP CONSTRAINT IF EXISTS fk_regression_test_cases_last_run;
ALTER TABLE regression_test_cases ADD CONSTRAINT fk_regression_test_cases_last_run
    FOREIGN KEY (last_run_id) REFERENCES regression_test_runs(id) ON DELETE SET NULL;

-- Scheduled re-runs of a project's regression suite (same BullMQ repeatable-job
-- conventions as scheduled_preflights, own queue so analysis workers are untouched).
CREATE TABLE IF NOT EXISTS regression_test_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cron_expression VARCHAR(100) NOT NULL,
    test_case_ids JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
    repeat_job_key VARCHAR(255),
    last_run_at TIMESTAMPTZ,
    last_batch_id UUID,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_regression_test_schedules_org ON regression_test_schedules(organization_id, project_id);

-- ------------------------------------------------------------------------------
-- 8. Row-Level Security (ENABLE + FORCE + tenant policy) and runtime grants
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'finding_lifecycles', 'finding_status_history', 'finding_comments', 'finding_comment_revisions',
        'finding_assignments', 'finding_attachments', 'regression_test_cases', 'regression_test_runs',
        'regression_test_schedules'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%s ON %I', t, t);
        EXECUTE format($p$CREATE POLICY tenant_isolation_%s ON %I FOR ALL
            USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$p$, t, t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO erppreflight_app', t);
    END LOOP;
END $$;

-- The runtime role may only read and append status history.
REVOKE UPDATE, DELETE ON finding_status_history FROM erppreflight_app;
