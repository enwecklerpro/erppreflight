# Dispatch Assignment — m3_d1_explorer_3

## 2026-09-24T07:56:00Z
**Role**: Domain 1 Fixtures & Pytest Harness Explorer
**Working Directory**: H:/erppreflight/.agents/m3_d1_explorer_3
**Parent Agent**: b18c0539-d6d7-4a41-968f-58324775ab38

### Mission:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md and H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md (§1 to §4).
Blueprint the curated test fixtures and comprehensive pytest suite for all 4 Domain 1 engines:
1. Golden test artifacts to create under `services/analysis-python/tests/fixtures/domain1/`:
   - `opd_decision_table.csv` / `opd_scenario_valid.json` / `opd_scenario_shadowed.json` / `opd_scenario_missing_channel.json`
   - `form_data_valid.xml` / `form_template_xdp.xml` / `form_data_missing_field.xml` / `form_legacy_smartform.xml`
   - `custom_field_registry.json` / `custom_field_type_mismatch.json`
   - `extension_manifest.json` / `extension_cycle.json`
2. Pytest test suite blueprint: `services/analysis-python/tests/unit/test_domain1_engines.py`:
   - Positive, negative, edge-case, and property-based test cases for OPD Guard, FormDoctor, Custom Field Flow Doctor, and Extension Impact Guard.
   - Assert findings contain valid rule_id, severity, confidence, evidence with line/col, snippet, sha256, and release-specific remediation.
   - Assert 100% pass rate.

Document the fixtures and test harness plan in H:/erppreflight/.agents/m3_d1_explorer_3/domain1_test_plan.md and write handoff.md.
