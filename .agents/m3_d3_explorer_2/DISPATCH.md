# Dispatch: Milestone 3.3 Domain 3 Explorer 2 (API Change Guard)

**Agent**: `m3_d3_explorer_2`  
**Role**: API Change Guard Blueprint Explorer  
**Working Directory**: `H:/erppreflight/.agents/m3_d3_explorer_2`  
**Timestamp**: 2026-09-24T08:35:00+02:00  

---

## Mission
Formulate the exhaustive drop-in production blueprint and proposed implementation for **API Change Guard** (`services/analysis-python/src/engines/api_change.py`: Feature 27):
- Parse and diff OpenAPI 2.0/3.0 (JSON/YAML) and OData EDMX (V2/V4 XML).
- Detect breaking changes: removed endpoints, removed operations, removed properties/fields, added required request parameters, changed data types, decreased max lengths, restricted enum values.
- Detect non-breaking changes: added optional properties, new endpoints/operations, expanded enums.
- Cross-reference breaking changes against Project Integration Registry (`affectedIntegrations`).
- Complete adherence to Cardinal Axiom 2 (14-point engine anatomy), cryptographic SHA-256 line evidence, and canonical `Severity` enums (`BLOCKER`, `CRITICAL`, `MAJOR`, `MINOR`, `INFO`).

Deliverables in your directory:
1. `BRIEFING.md` and `progress.md`.
2. `api_change_blueprint.md`.
3. `proposed_api_change.py`.
4. `test_proposed_engine.py` (with verification test run).
5. `handoff.md`.

When done, call `send_message` to parent (`b18c0539-d6d7-4a41-968f-58324775ab38`).
