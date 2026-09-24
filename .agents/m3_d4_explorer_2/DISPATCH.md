# Dispatch: Transport Dependency Analyzer Explorer

- **Agent Name**: `m3_d4_explorer_2`
- **Role**: `teamwork_preview_explorer`
- **Working Directory**: `H:/erppreflight/.agents/m3_d4_explorer_2`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`

## Mission
Author the authoritative production blueprint and complete drop-in implementation for:
`services/analysis-python/src/engines/transport_dependency.py` (Feature 29: Transport Dependency Analyzer).

## Inputs to Study
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md` (§12 Transport Dependency Analyzer, lines 899–960)
- `H:/erppreflight/services/analysis-python/src/models/`
- `H:/erppreflight/services/analysis-python/src/platform/evidence.py`
- `H:/erppreflight/services/analysis-python/src/platform/confidence.py`

## Engine Requirements
1. **Metadata**: Canonical ID `transport_dependency_analyzer`, supported artifacts (`JSON`, `CSV`, `XML`).
2. **Schema & Parsers**: Parse CTS transport request records:
   - E070 (Header: TR Number, Type [Workbench/Customizing], Status, Owner).
   - E071 (Object list: PGMID, OBJECT [e.g. TABL, CLAS, PROG, FUGR], OBJ_NAME).
   - E071K (Table keys for Customizing transports: TABLENAME, MASTERTYPE, KEY).
   - Cross-reference call trees or syntax definitions.
3. **Deterministic Rules & Collision Matrix**:
   - **Object Collision Check**: Same repository object modified across multiple open/unreleased or concurrent transports (`TR_OBJECT_COLLISION`).
   - **Cross-Transport Call Dependency**: Object in TR1 calls/references/inherits from an object created or altered in TR2 (`TR_CALL_DEPENDENCY_SEQUENCE_RISK`).
   - **Overtaking / Downgrade Risk**: Sequence inversion where older object transport is released or imported after newer version (`TR_OVERTAKER_DOWNGRADE_RISK`).
   - **Customizing/Workbench Linkage**: Customizing table entry (E071K) transported without or ahead of the structural table definition (E071 TABL) (`TR_CUSTOMIZING_AHEAD_OF_STRUCTURE`).
   - **Sequencing Engine**: Calculate deterministic topological import sequence (`recommendedImportSequence`).
4. **Evidence & Confidence**:
   - Concrete line/row pointers with SHA-256 hashes.
   - `VERIFIED` (1.0) for explicit E070/E071/E071K table entries; `RULE_DERIVED` (0.85) for call tree dependency inferences.
5. **Standard Taxonomy**: Findings with `TR_` codes, `Severity` (BLOCKER/CRITICAL/MAJOR/MEDIUM/MINOR/INFO), remediation guides with release-specific SAP steps.

## Deliverables in your directory
- `transport_dependency_blueprint.md`
- `proposed_transport_dependency.py`
- `test_proposed_engine.py` (run with Python 3.13 to verify 100% pass)
- `handoff.md`

## 2026-09-24T08:42:05Z
Initial dispatch received from orchestrator. Deliverables: transport_dependency_blueprint.md, proposed_transport_dependency.py, test_proposed_engine.py, handoff.md.
