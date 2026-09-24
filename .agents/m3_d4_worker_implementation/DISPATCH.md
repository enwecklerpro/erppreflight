# Dispatch: Domain 4 Implementation Worker

- **Agent Name**: `m3_d4_worker_implementation`
- **Role**: `teamwork_preview_worker`
- **Working Directory**: `H:/erppreflight/.agents/m3_d4_worker_implementation`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`

## Mission
Deploy production implementations and tests for Domain 4 Release & Transport Preflight Engines:
1. `services/analysis-python/src/engines/software_collection.py` (Feature 28: Software Collection Dependency Guard)
2. `services/analysis-python/src/engines/transport_dependency.py` (Feature 29: Transport Dependency Analyzer)
3. Populate `services/analysis-python/tests/fixtures/domain4/`
4. Deploy `services/analysis-python/tests/unit/test_domain4_engines.py`

## Inputs
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/m3_d4_explorer_1/software_collection_blueprint.md`
- `H:/erppreflight/.agents/m3_d4_explorer_1/proposed_software_collection.py`
- `H:/erppreflight/.agents/m3_d4_explorer_2/transport_dependency_blueprint.md`
- `H:/erppreflight/.agents/m3_d4_explorer_2/proposed_transport_dependency.py`
- `H:/erppreflight/.agents/m3_d4_explorer_3/domain4_test_plan.md`
- `H:/erppreflight/.agents/m3_d4_explorer_3/generate_domain4_fixtures.py`
- `H:/erppreflight/.agents/m3_d4_explorer_3/proposed_test_domain4_engines.py`

## Write Ownership
You own and must implement:
1. `services/analysis-python/src/engines/software_collection.py` (deploy from `H:/erppreflight/.agents/m3_d4_explorer_1/proposed_software_collection.py`)
2. `services/analysis-python/src/engines/transport_dependency.py` (deploy from `H:/erppreflight/.agents/m3_d4_explorer_2/proposed_transport_dependency.py`)
3. Populate `services/analysis-python/tests/fixtures/domain4/` (run `py -3.13 .agents/m3_d4_explorer_3/generate_domain4_fixtures.py`)
4. `services/analysis-python/tests/unit/test_domain4_engines.py` (copy from `H:/erppreflight/.agents/m3_d4_explorer_3/proposed_test_domain4_engines.py`)

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Verification Requirements
In PowerShell (prepend `C:\Users\SKAF\AppData\Roaming\npm` to `$env:PATH`):
1. `py -3.13 -m pytest services/analysis-python/tests/unit/test_domain4_engines.py -v` (100% pass rate mandatory)
2. `py -3.13 -m pytest services/analysis-python/tests -q` (All tests must pass cleanly)
3. `pnpm test`
4. `py -3.13 -m pytest tests/e2e/ -q`
5. `pnpm run build --force`
6. `pnpm run typecheck`
7. `pnpm run lint`

Deliver a comprehensive `handoff.md` and call `send_message` to parent.

## 2026-09-24T06:58:00Z
You are m3_d4_worker_implementation, working in directory H:/erppreflight/.agents/m3_d4_worker_implementation.

MANDATORY: Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md before starting work.
Also read:
- H:/erppreflight/.agents/m3_d4_worker_implementation/DISPATCH.md
- H:/erppreflight/.agents/orchestrator_main/PROJECT.md
- H:/erppreflight/.agents/m3_d4_explorer_1/software_collection_blueprint.md
- H:/erppreflight/.agents/m3_d4_explorer_1/proposed_software_collection.py
- H:/erppreflight/.agents/m3_d4_explorer_2/transport_dependency_blueprint.md
- H:/erppreflight/.agents/m3_d4_explorer_2/proposed_transport_dependency.py
- H:/erppreflight/.agents/m3_d4_explorer_3/domain4_test_plan.md
- H:/erppreflight/.agents/m3_d4_explorer_3/generate_domain4_fixtures.py
- H:/erppreflight/.agents/m3_d4_explorer_3/proposed_test_domain4_engines.py

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write Ownership:
You own and must implement:
1. `services/analysis-python/src/engines/software_collection.py` (deploy from `H:/erppreflight/.agents/m3_d4_explorer_1/proposed_software_collection.py`)
2. `services/analysis-python/src/engines/transport_dependency.py` (deploy from `H:/erppreflight/.agents/m3_d4_explorer_2/proposed_transport_dependency.py`)
3. Populate `services/analysis-python/tests/fixtures/domain4/` (run `py -3.13 .agents/m3_d4_explorer_3/generate_domain4_fixtures.py`)
4. `services/analysis-python/tests/unit/test_domain4_engines.py` (copy from `H:/erppreflight/.agents/m3_d4_explorer_3/proposed_test_domain4_engines.py`)

Verification Requirements:
In PowerShell (prepend `C:\Users\SKAF\AppData\Roaming\npm` to `$env:PATH`):
1. `py -3.13 -m pytest services/analysis-python/tests/unit/test_domain4_engines.py -v` (Must pass 34/34)
2. `py -3.13 -m pytest services/analysis-python/tests -q` (All tests must pass cleanly)
3. `pnpm test`
4. `py -3.13 -m pytest tests/e2e/ -q`
5. `pnpm run build --force`
6. `pnpm run typecheck`
7. `pnpm run lint`

Deliver a comprehensive handoff.md in your directory and call send_message to parent (conversation ID: b18c0539-d6d7-4a41-968f-58324775ab38).

