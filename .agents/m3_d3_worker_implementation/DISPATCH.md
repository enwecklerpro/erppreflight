# Dispatch: Domain 3 Implementation Worker

- **Agent Name**: `m3_d3_worker_implementation`
- **Role**: `teamwork_preview_worker`
- **Working Directory**: `H:/erppreflight/.agents/m3_d3_worker_implementation`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`

## Mission
Deploy production implementations and tests for Domain 3 Integration Engines:
1. `services/analysis-python/src/engines/change_pointer.py` (Feature 26: Change Pointer Coverage Auditor)
2. `services/analysis-python/src/engines/api_change.py` (Feature 27: API Change Guard)
3. Populate `services/analysis-python/tests/fixtures/domain3/`
4. Deploy `services/analysis-python/tests/unit/test_domain3_engines.py`

## Inputs
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/m3_d3_explorer_1/change_pointer_blueprint.md`
- `H:/erppreflight/.agents/m3_d3_explorer_1/proposed_change_pointer.py`
- `H:/erppreflight/.agents/m3_d3_explorer_2/api_change_blueprint.md`
- `H:/erppreflight/.agents/m3_d3_explorer_2/proposed_api_change.py`
- `H:/erppreflight/.agents/m3_d3_explorer_3/domain3_test_plan.md`
- `H:/erppreflight/.agents/m3_d3_explorer_3/generate_domain3_fixtures.py`
- `H:/erppreflight/.agents/m3_d3_explorer_3/proposed_test_domain3_engines.py`

## Write Ownership
You own and must implement:
1. `services/analysis-python/src/engines/change_pointer.py`
2. `services/analysis-python/src/engines/api_change.py`
3. `services/analysis-python/tests/fixtures/domain3/*`
4. `services/analysis-python/tests/unit/test_domain3_engines.py`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Verification Requirements
In PowerShell (prepend `C:\Users\SKAF\AppData\Roaming\npm` to `$env:PATH`):
1. `py -3.13 -m pytest services/analysis-python/tests/unit/test_domain3_engines.py -v` (100% pass rate mandatory)
2. `py -3.13 -m pytest services/analysis-python/tests -q` (All tests must pass cleanly)
3. `pnpm test`
4. `py -3.13 -m pytest tests/e2e/ -q`
5. `pnpm run build --force`
6. `pnpm run typecheck`
7. `pnpm run lint`

Deliver a comprehensive `handoff.md` and call `send_message` to parent.
