# Dispatch: Software Collection Dependency Guard Explorer

- **Agent Name**: `m3_d4_explorer_1`
- **Role**: `teamwork_preview_explorer`
- **Working Directory**: `H:/erppreflight/.agents/m3_d4_explorer_1`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`

## Mission
Author the authoritative production blueprint and complete drop-in implementation for:
`services/analysis-python/src/engines/software_collection.py` (Feature 28: Software Collection Dependency Guard).

## Inputs to Study
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md` (§11 Software Collection Dependency Guard, lines 834–896)
- `H:/erppreflight/services/analysis-python/src/models/`
- `H:/erppreflight/services/analysis-python/src/platform/evidence.py`
- `H:/erppreflight/services/analysis-python/src/platform/confidence.py`

## Engine Requirements
1. **Metadata**: Canonical ID `software_collection_guard`, supported artifacts (`JSON`, `XML`, `ZIP`).
2. **Schema & Parsers**: Validate input JSON/XML export manifests, key-user extensibility item descriptors (Custom Fields, CDS Views, Custom Logic / BAdIs, Form Templates, App Variants).
3. **Deterministic Graph Rules**:
   - Extract item dependencies and cross-collection references.
   - Detect missing prerequisite items/collections in target system or release scope (`SC_MISSING_PREREQUISITE`).
   - Detect circular dependencies between collections: Tarjan's or Kahn's topological sort cycle detection (`SC_CIRCULAR_DEPENDENCY`).
   - Detect draft-status items exported in production collections (`SC_DRAFT_ITEM_INCLUDED`).
   - Detect broken dependencies (e.g. App Variant depending on missing or deleted field: `SC_DANGLING_FIELD_REFERENCE`).
   - Calculate optimal deterministic import sequence for all collections.
4. **Evidence & Confidence**:
   - Concrete line/coordinate pointers with SHA-256 artifact hashes.
   - `VERIFIED` (1.0) for explicit manifest references; `RULE_DERIVED` (0.85) for standard naming conventions; `UNKNOWN` (0.30) for dangling UUIDs.
5. **Standard Taxonomy**: Findings with `SC_` codes, `Severity` (BLOCKER/CRITICAL/MAJOR/MEDIUM/MINOR/INFO), remediation guides with release-specific SAP steps.

## Deliverables in your directory
- `software_collection_blueprint.md`
- `proposed_software_collection.py`
- `test_proposed_engine.py` (run with Python 3.13 to verify 100% pass)
- `handoff.md`

Maintain `progress.md` with timestamps. When done, call `send_message` to parent.
