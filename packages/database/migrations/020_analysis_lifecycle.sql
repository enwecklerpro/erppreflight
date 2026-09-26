-- ==============================================================================
-- ERP Preflight — Analysis run lifecycle: cancel, rerun, run inputs, Test Lab runs
-- Migration: 020_analysis_lifecycle.sql
-- Specifications: section C §15 ("Support cancel/rerun"), §16 (POST /analyses/:id/cancel,
--                 POST /analyses/:id/rerun, persist inputs / knowledge snapshot / actor),
--                 §18 (Test Lab), Part 03 §3.8 (progress), Part 05 §5.5 (Test Lab).
--
-- 1. analyses: the exact run inputs (artifacts with SHA-256, engine selection, requested +
--    effective configuration, planner assignments/stages) so a run can be re-executed with
--    identical inputs; rerun link; cooperative cancellation (request, reason, actor,
--    finalisation); started_at for timing; error_message for failed runs; published_at is
--    the atomic "results are being published" gate that cancellation cannot pass.
-- 2. Status / kind are constrained (NOT VALID: legacy rows are not re-checked).
--    kind LAB_REGRESSION / LAB_SCENARIO = a Test Lab execution (regression cases / synthetic
--    scenario) recorded in the run history; lab runs never write findings rows.
-- 3. analysis_progress_events accept the CANCELLED stage status.
-- 4. Test Lab unification: regression_test_runs link to the lab analysis that executed them;
--    generated tests (table `tests`, written by the GENERATING_TESTS stage) record the
--    analysis that produced them and the regression test case they were promoted to
--    (regression_test_cases.generated_test_id is the reverse link, unique = idempotent
--    promotion).
-- No new tables: every touched table already carries organization_id with ENABLE + FORCE
-- RLS, a tenant policy and grants for erppreflight_app (migrations 001, 010, 017, 018).
-- ==============================================================================

-- 1. Analyses: inputs, rerun link, cancellation, timing, error ------------------------
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS inputs JSONB NOT NULL DEFAULT '{}';
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS rerun_of_analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS cancel_requested_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_analyses_rerun_of ON analyses(rerun_of_analysis_id)
    WHERE rerun_of_analysis_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analyses_org_status ON analyses(organization_id, status);

-- 2. Status / kind domain -----------------------------------------------------------
ALTER TABLE analyses DROP CONSTRAINT IF EXISTS chk_analyses_status;
ALTER TABLE analyses ADD CONSTRAINT chk_analyses_status
    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')) NOT VALID;
ALTER TABLE analyses DROP CONSTRAINT IF EXISTS chk_analyses_kind;
ALTER TABLE analyses ADD CONSTRAINT chk_analyses_kind
    CHECK (kind IN ('STANDARD', 'FULL_PREFLIGHT', 'LAB_REGRESSION', 'LAB_SCENARIO')) NOT VALID;
ALTER TABLE analyses DROP CONSTRAINT IF EXISTS chk_analyses_cancel_reason;
ALTER TABLE analyses ADD CONSTRAINT chk_analyses_cancel_reason
    CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 500) NOT VALID;

-- 3. Progress events: CANCELLED stage status ----------------------------------------
ALTER TABLE analysis_progress_events DROP CONSTRAINT IF EXISTS chk_progress_status;
ALTER TABLE analysis_progress_events ADD CONSTRAINT chk_progress_status
    CHECK (status IN ('STARTED', 'PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED'));

-- 4. Test Lab unification -----------------------------------------------------------
ALTER TABLE regression_test_runs ADD COLUMN IF NOT EXISTS analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_regression_test_runs_analysis ON regression_test_runs(analysis_id)
    WHERE analysis_id IS NOT NULL;

ALTER TABLE tests ADD COLUMN IF NOT EXISTS analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS generator_version VARCHAR(40);
ALTER TABLE tests ADD COLUMN IF NOT EXISTS regression_test_case_id UUID REFERENCES regression_test_cases(id) ON DELETE SET NULL;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS promoted_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tests_analysis ON tests(analysis_id) WHERE analysis_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tests_org_project ON tests(organization_id, project_id, created_at DESC);

ALTER TABLE regression_test_cases ADD COLUMN IF NOT EXISTS generated_test_id UUID REFERENCES tests(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_regression_test_cases_generated_test ON regression_test_cases(generated_test_id)
    WHERE generated_test_id IS NOT NULL;

-- 5. Runtime role grants (tables already granted; explicit for clarity) -------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erppreflight_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON analyses, tests, regression_test_cases, regression_test_runs,
            analysis_progress_events TO erppreflight_app;
    END IF;
END $$;
