# Dispatch: Milestone 3.1 Domain 1 Engines Implementation Worker

**Agent**: `m3_d1_worker_implementation`  
**Role**: Domain 1 Preflight Engines Implementation Worker  
**Working Directory**: `H:/erppreflight/.agents/m3_d1_worker_implementation`  
**Timestamp**: 2026-09-24T08:15:00+02:00  

---

## Mission
Implement and deploy the four production SAP Preflight Engines for **Domain 1: Output & Extensibility** into `services/analysis-python/`:
1. `services/analysis-python/src/parsers/safe_xml.py` (LineNumberTreeBuilder enhancement for line-level XDP coordinates)
2. `services/analysis-python/src/engines/opd_guard.py` (OPD Guard: Multi-step BRFplus determination, shadowed rules, wildcard evaluation)
3. `services/analysis-python/src/engines/form_doctor.py` (FormDoctor: Defused XML/XDP binding verification, path correction, missing fields, legacy form detection)
4. `services/analysis-python/src/engines/custom_field_flow.py` (Custom Field Flow Doctor: PO Item -> Supplier Invoice -> GL Account propagation, type mismatch, BAdI requirements)
5. `services/analysis-python/src/engines/extension_impact.py` (Extension Impact Guard: Directed dependency graph traversal, blast radius scoring, cycle detection, active deletion blocks)
6. Generate 12 golden test fixtures under `services/analysis-python/tests/fixtures/domain1/` using the Explorer 3 provisioning script.
7. Deploy comprehensive pytest test suite to `services/analysis-python/tests/unit/test_domain1_engines.py`.

---

## Mandatory Inputs & Authoritative Blueprints
1. `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MUST READ)
2. `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
3. Explorer 1 Artifacts:
   - `H:/erppreflight/.agents/m3_d1_explorer_1/opd_form_blueprint.md`
   - `H:/erppreflight/.agents/m3_d1_explorer_1/proposed_opd_guard.py`
   - `H:/erppreflight/.agents/m3_d1_explorer_1/proposed_form_doctor.py`
   - `H:/erppreflight/.agents/m3_d1_explorer_1/safe_xml_patch.py`
4. Explorer 2 Artifacts:
   - `H:/erppreflight/.agents/m3_d1_explorer_2/field_extension_blueprint.md`
   - `H:/erppreflight/.agents/m3_d1_explorer_2/proposed_custom_field_flow.py`
   - `H:/erppreflight/.agents/m3_d1_explorer_2/proposed_extension_impact.py`
   - `H:/erppreflight/.agents/m3_d1_explorer_2/test_proposed_engines.py`
5. Explorer 3 Artifacts:
   - `H:/erppreflight/.agents/m3_d1_explorer_3/domain1_test_plan.md`
   - `H:/erppreflight/.agents/m3_d1_explorer_3/generate_domain1_fixtures.py`
   - `H:/erppreflight/.agents/m3_d1_explorer_3/proposed_test_domain1_engines.py`

---

## Write Ownership
You own and may exclusively modify:
- `services/analysis-python/src/parsers/safe_xml.py`
- `services/analysis-python/src/engines/opd_guard.py`
- `services/analysis-python/src/engines/form_doctor.py`
- `services/analysis-python/src/engines/custom_field_flow.py`
- `services/analysis-python/src/engines/extension_impact.py`
- `services/analysis-python/tests/fixtures/domain1/*`
- `services/analysis-python/tests/unit/test_domain1_engines.py`

---

## Mandatory Anti-Cheat & Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

---

## Verification Commands
In PowerShell (prepend `C:\Users\SKAF\AppData\Roaming\npm` to `$env:PATH`):
1. `py -3.13 .agents/m3_d1_explorer_3/generate_domain1_fixtures.py`
2. `py -3.13 -m pytest services/analysis-python/tests/unit/test_domain1_engines.py -v`
3. `py -3.13 -m pytest services/analysis-python/tests -v`
4. `pnpm test`
5. `py -3.13 -m pytest tests/e2e/ -v`
6. `pnpm run build --force`
7. `pnpm run typecheck`
8. `pnpm run lint`

Document all commands, code modifications, and test results in `H:/erppreflight/.agents/m3_d1_worker_implementation/handoff.md`.
Maintain `progress.md` with timestamps.
When done, call `send_message` to parent (`b18c0539-d6d7-4a41-968f-58324775ab38`).
