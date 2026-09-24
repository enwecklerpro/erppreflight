# Dispatch: Domain 4 Fixtures & Pytest Harness Explorer

- **Agent Name**: `m3_d4_explorer_3`
- **Role**: `teamwork_preview_explorer`
- **Working Directory**: `H:/erppreflight/.agents/m3_d4_explorer_3`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`

## Mission
Author the test plan, golden test fixtures, and comprehensive pytest test suite for all Domain 4 Release & Transport Preflight Engines:
1. `software_collection.py` (Feature 28: Software Collection Dependency Guard)
2. `transport_dependency.py` (Feature 29: Transport Dependency Analyzer)

## Inputs to Study
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md` (§11 & §12)
- Existing Domain test harnesses: `services/analysis-python/tests/unit/test_domain1_engines.py`, `test_domain2_engines.py`

## Scope & Deliverables
1. Author `domain4_test_plan.md`:
   - Enumerate all test scenarios: positive, negative, boundary/edge-case, cyclic graphs, multi-transport collisions, overtaking downgrades.
2. Author `generate_domain4_fixtures.py`:
   - Automated fixture provisioning creating test files in `services/analysis-python/tests/fixtures/domain4/`:
     - `sc_valid_sequence.json`: Two clean independent software collections.
     - `sc_circular.json`: Mutually dependent collections (A -> B -> A).
     - `sc_missing_prereq.json`: Collection referencing unexported custom CDS view.
     - `sc_draft_item.json`: Collection containing draft BAdI implementation.
     - `tr_valid_sequence.json` / `tr_valid_e070_e071.csv`: Linear clean transport sequence.
     - `tr_collision.json` / `tr_collision.csv`: Multiple transports touching same `CLAS ZCL_ORDER`.
     - `tr_overtaker_downgrade.json`: Sequence inversion risking older version overwrite.
     - `tr_customizing_ahead_of_structure.json`: E071K table entries without preceding TABL definition.
3. Author `proposed_test_domain4_engines.py`:
   - Comprehensive test harness testing both engines against the golden fixtures.
   - Assert: valid `rule_id`, valid `Severity`, valid `ConfidenceClass`, concrete evidence with SHA-256 and line/row numbers, metrics dictionary, release-specific remediation.
   - Assert 100% pass rate.
4. Execute `generate_domain4_fixtures.py` and run tests via `py -3.13 -m pytest proposed_test_domain4_engines.py` to confirm 100% pass rate.
5. Deliver `handoff.md` and call `send_message` to parent.
