# Dispatch: m3_d5_explorer_3

## 2026-09-24T09:05:00Z
- **Identity**: m3_d5_explorer_3
- **Role**: teamwork_preview_explorer (Domain 5 Blueprint: IAM Cost & Account Determination + Test Harness)
- **Working Directory**: H:/erppreflight/.agents/m3_d5_explorer_3
- **Parent Conversation ID**: b18c0539-d6d7-4a41-968f-58324775ab38

### Mission
Explore, design, and draft production implementations for Feature 33 (Cloud IAM & BTP Role Tailoring Cost Guard) and Feature 34 (Universal Account Determination Verifier), plus golden fixtures and test harness for Domain 5:
1. Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.
2. Read H:/erppreflight/.agents/orchestrator_main/PROJECT.md.
3. Read H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md (§16 & §17).
4. Inspect `services/analysis-python/src/engines/` and existing engine patterns.
5. Feature 33: Cloud IAM & BTP Role Tailoring Cost Guard (`iam_cost_guard.py`):
   - Model business role and catalog composition (AGR_1251, AGR_AGRS, AGR_USERS, price categories, ST03N usage).
   - Detect redundant catalogs (100% overlap), license driver apps escalating users to Advanced tier, unused critical privileges, and propose least-privilege role refactoring.
   - Standard finding codes: `IAM_REDUNDANT_CATALOG_DETECTED`, `IAM_LICENSE_TIER_INFLATION_DRIVER`, `IAM_UNUSED_CRITICAL_AUTHORIZATION`.
6. Feature 34: Universal Account Determination Verifier (`account_determination.py`):
   - Combinatorial audit of automatic account determination (VKOA, OBYC, FBKP).
   - Evaluate T030, T030K, Chart of Accounts (SKA1/SKB1), posting blocks (XSPERR), valuation classes, movement types.
   - Standard finding codes: `ACCT_DET_MISSING_ACCOUNT`, `ACCT_DET_ACCOUNT_BLOCKED_POSTING`, `ACCT_DET_CONFLICTING_RULES`.
7. Author fixture generator and comprehensive test harness for all 6 Domain 5 engines:
   - `generate_domain5_fixtures.py` provisioning golden fixtures into `services/analysis-python/tests/fixtures/domain5/`.
   - `proposed_test_domain5_engines.py` containing >=30 test cases covering all 6 engines.
8. Author deliverable files in your working directory:
   - `domain5_iam_account_blueprint.md`
   - `proposed_iam_cost_guard.py`
   - `proposed_account_determination.py`
   - `generate_domain5_fixtures.py`
   - `proposed_test_domain5_engines.py`
   - `handoff.md`
9. Maintain progress.md with timestamps.
10. Call send_message to parent upon completion.
