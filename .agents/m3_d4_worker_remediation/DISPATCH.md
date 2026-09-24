# Task Assignment: m3_d4_worker_remediation

**Assigned Agent**: `m3_d4_worker_remediation`
**Role**: `teamwork_preview_worker`
**Mission**: Remediate Domain 4 Release & Transport Preflight Engines to resolve all issues identified by `m3_d4_auditor_1` (INTEGRITY VIOLATION) and `m3_d4_challenger_1` (REQUEST_CHANGES):

Read:
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md`
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/m3_d4_auditor_1/handoff.md` (FULL UNEDITED AUDIT REPORT)
- `H:/erppreflight/.agents/m3_d4_challenger_1/handoff.md` (CHALLENGER REPORT)
- `H:/erppreflight/services/analysis-python/src/engines/software_collection.py`
- `H:/erppreflight/services/analysis-python/src/engines/transport_dependency.py`
- `H:/erppreflight/services/analysis-python/tests/unit/test_domain4_engines.py`

Remediation Tasks:
1. **Fix CTS Multi-Table CSV Row Discrimination in `transport_dependency.py` (lines 480–513)**:
   - Row discrimination must NOT check `"TABLENAME" in col_map` (header presence).
   - Discriminate rows by cell content:
     - Header row (E070): if `record_type == "E070"` or (row contains TRFUNCTION/CORRFLAG values).
     - Table key (E071K): if `record_type == "E071K"` or `obj_col == "TABU"` or (bool(tbl_name) and not bool(obj_name)).
     - Repository object (E071): if `record_type == "E071"` or bool(obj_name).
   - In multi-table CSVs like `tr_e070_e071_complete.csv`, ensure repository objects are populated into `objects_by_tr` and table keys into `keys_by_tr`.
   - Update `test_complete_enterprise_csv_parsing` in `test_domain4_engines.py` to assert `assert total_objects >= 3` and `assert total_tr >= 3`.
2. **Cycle Detection Documentation / Implementation in `transport_dependency.py:1030`**:
   - Update the comment at line 1030 to `# Cycle Detection via 3-Color Recursive DFS` (or implement Tarjan's SCC) so algorithmic claims match the genuine implementation exactly.
3. **Fix Unicode and Pydantic Hardening in `software_collection.py`**:
   - Line 342: Replace `raw_content.encode("latin1")` with `raw_content.encode("utf-8", errors="replace")`.
   - Lines 118–123 (`SoftwareCollectionItem.normalize_fields`) & Lines 147–152 (`SoftwareCollection.normalize_fields`):
     Safely handle integer or non-list/non-string `dependencies` by resetting to `[]` or converting cleanly.
   - Lines 420–436 (`_parse_json_content`):
     Wrap `model_validate` in `try...except (ValidationError, Exception):` and emit `SC_SCHEMA_VALIDATION_FAILED` rather than crashing unhandled.
4. **Clean Static Ruff Linter Warnings**:
   - Remove unused imports `hashlib` and `Evidence` in both engines.
   - Remove unused variable `target_item_id` in line 676.
   - Rename ambiguous variable name `l` in lines 1159 and 1166 to `line`.

Verification Commands:
- `py -3.13 -m pytest services/analysis-python/tests/unit/test_domain4_engines.py -v` (34/34 pass)
- `py -3.13 -m pytest .agents/m3_d4_challenger_1/test_adversarial_software_collection.py -v` (33/33 pass)
- `py -3.13 -m pytest services/analysis-python/tests -q` (all pass)
- `py -3.13 -m ruff check services/analysis-python/src/engines/software_collection.py services/analysis-python/src/engines/transport_dependency.py` (0 errors)
- `pnpm test` (394/394 pass)
- `pnpm run build` and `pnpm run typecheck`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Deliver handoff.md with verification commands and output, and call send_message to parent (b18c0539-d6d7-4a41-968f-58324775ab38).
