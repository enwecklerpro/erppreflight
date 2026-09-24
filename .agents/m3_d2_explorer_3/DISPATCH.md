# Dispatch: Milestone 3.2 Domain 2 Explorer 3 (Curated Golden Fixtures & Pytest Harness)

**Agent**: `m3_d2_explorer_3`  
**Role**: Domain 2 Golden Fixtures & Pytest Harness Explorer  
**Working Directory**: `H:/erppreflight/.agents/m3_d2_explorer_3`  
**Timestamp**: 2026-09-24T08:20:00+02:00  

---

## Mission
Formulate the curated golden test fixture catalog and comprehensive Pytest test harness blueprint for all 4 Preflight Engines in **Domain 2: Migration & Clean Core**:
1. SPRO2Cloud (`spro2cloud.py`)
2. ECC2Cloud Navigator (`ecc2cloud.py`)
3. SAP Gap Radar (`gap_radar.py`)
4. Clean Core Object Guard (`clean_core.py`)

Every engine must have at least 3 curated fixtures (positive clean scenario, negative rule violation, edge-case boundary scenario). Design an automated fixture provisioning script (`generate_domain2_fixtures.py`) that writes into `services/analysis-python/tests/fixtures/domain2/`, and author the full proposed test harness in `proposed_test_domain2_engines.py` ready for deployment to `services/analysis-python/tests/unit/test_domain2_engines.py`.

---

## Mandatory Inputs & Authoritative References
1. `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MUST READ FIRST)
2. `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
3. `H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md` (§5–§8, lines 388–683)
4. Existing test patterns and platform services:
   - `H:/erppreflight/.agents/m3_d1_explorer_3/domain1_test_plan.md`
   - `H:/erppreflight/.agents/m3_d1_explorer_3/proposed_test_domain1_engines.py`
   - `H:/erppreflight/services/analysis-python/tests/`

---

## Required Deliverables
In `H:/erppreflight/.agents/m3_d2_explorer_3/`:
1. `BRIEFING.md` and `progress.md` with timestamps.
2. `domain2_test_plan.md`: Comprehensive fixture catalog and test architecture specification.
3. `generate_domain2_fixtures.py`: Automated Python 3.13 script creating all Domain 2 fixtures under `services/analysis-python/tests/fixtures/domain2/`.
4. `proposed_test_domain2_engines.py`: Complete pytest test suite verifying positive, negative, edge cases, 14-point engine anatomy, cryptographic SHA-256 evidence, and property-based fuzz tests.
5. `handoff.md`: Formal 5-component handoff (Observation, Logic Chain, Caveats, Conclusion, Verification Method).

When complete, call `send_message` to parent (`b18c0539-d6d7-4a41-968f-58324775ab38`).
