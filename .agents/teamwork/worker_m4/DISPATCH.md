## 2026-09-24T21:31:19Z
You are Worker M4 (teamwork_preview_worker).
Your working directory is H:/erppreflight/.agents/teamwork/worker_m4.
You MUST read the original user request at H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md before starting.
Also review the comprehensive blueprint prepared by Explorer 3 at:
H:/erppreflight/.agents/teamwork/explorer_survey_3/handoff.md
And review H:/erppreflight/AGENTS.md, /.agents/skills/engine-authoring.md, /.agents/skills/sap-evidence.md, and /.agents/skills/secure-file-parser.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP (You may ONLY edit or create these files):
- services/analysis-python/src/engines/opd_guard.py
- services/analysis-python/tests/unit/test_domain1_engines.py (if needed for rule ID backward compatibility)
- tests/fixtures/known_bad_billing_opd.xml
- package.json (root package.json to add @playwright/test and test:e2e script)
- playwright.config.ts
- tests/e2e/preflight-pipeline.spec.ts

TASKS FOR MILESTONE M4:
1. R7: Python OPD Guard XML Support in `services/analysis-python/src/engines/opd_guard.py`:
   - Add `ArtifactType.XML` to `supported_artifact_types`.
   - In `_parse_inputs`: detect XML and use `SafeXmlParser` (`src.parsers.safe_xml`) to parse decision tables and capture `sourceline` coordinates.
   - When a determination step fails (e.g. Channel step missing or email channel missing for billing type F2), emit `rule_id="OPD_DETERMINATION_STEP_MISSING"` (while maintaining backward compatibility if needed).
   - Run `pytest services/analysis-python/tests -v` to ensure 100% pass rate.
2. R7: Golden Defective SAP XML Fixture in `tests/fixtures/known_bad_billing_opd.xml`:
   - Create golden defective XML fixture representing an S/4HANA billing output parameter determination scenario (`BillingType=F2`) with an OPD table where the `Channel` determination step fails or lacks an email rule.
3. R7: Playwright Setup:
   - In monorepo root: add `@playwright/test` to `devDependencies`, add `"test:e2e": "playwright test"` to `scripts`. Run `pnpm install`.
   - Create `playwright.config.ts` configured for `tests/e2e` directory, `baseURL: 'http://localhost:3000'`.
4. R7: Automated End-to-End Test in `tests/e2e/preflight-pipeline.spec.ts`:
   - Implement the complete user journey:
     1. User signs up -> Logs in (HttpOnly session cookie verified).
     2. Creates a new project workspace for S/4HANA 2023.
     3. Uploads `tests/fixtures/known_bad_billing_opd.xml` into the Artifact Dropzone tab.
     4. Triggers preflight analysis.
     5. Awaits BullMQ worker completion.
     6. Asserts `findingsCount >= 1`.
     7. Asserts finding rule ID is `OPD_DETERMINATION_STEP_MISSING`.
     8. Asserts evidence contains exact file pointer (`known_bad_billing_opd.xml#Channel` or line coordinate) and non-empty SHA-256 hash.
     9. Asserts finding appears in Findings Ledger table and updates Executive Dashboard Clean Core Index.
   - Ensure the Playwright test is resilient: support live services, or provide request interceptors/mock routes if live background daemon containers are not running during local test execution.

VERIFICATION:
Run tests:
- `pytest services/analysis-python/tests -v`
- `pnpm exec playwright test`
- `pnpm run typecheck`
- `pnpm run lint`
Document all changes, test commands, and test results in `H:/erppreflight/.agents/teamwork/worker_m4/handoff.md`. Send completion message when done.
