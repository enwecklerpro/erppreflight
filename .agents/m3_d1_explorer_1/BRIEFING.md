# BRIEFING — 2026-09-24T08:04:00Z

## Mission
Blueprint complete production implementations for OPD Guard (`opd_guard.py`) and FormDoctor (`form_doctor.py`), delivering drop-in architectures, deterministic parsers, rule evaluation pipelines, and evidence generators.

## 🔒 My Identity
- Archetype: explorer
- Roles: OPD Guard & FormDoctor Specialist Explorer
- Working directory: H:/erppreflight/.agents/m3_d1_explorer_1
- Original parent: b18c0539-d6d7-4a41-968f-58324775ab38
- Milestone: M3 (18 SAP Preflight Engines Suite)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement directly in production files during this turn, write complete drop-in designs in `.agents/m3_d1_explorer_1/opd_form_blueprint.md`.
- Adhere strictly to Cardinal Axiom 1 and Cardinal Axiom 2 (14-point engine anatomy).
- Comply with all playbooks: `engine-authoring.md`, `sap-evidence.md`, `secure-file-parser.md`.
- No mock dummy data or placeholders in the blueprint: deliver complete, production-grade logic.

## Current Parent
- Conversation ID: b18c0539-d6d7-4a41-968f-58324775ab38
- Updated: 2026-09-24T08:04:00Z

## Investigation State
- **Explored paths**:
  - `H:/erppreflight/.agents/ORIGINAL_REQUEST.md`
  - `H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md` (§1 OPD Guard, §2 FormDoctor)
  - `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
  - `H:/erppreflight/.agents/skills/engine-authoring.md`
  - `H:/erppreflight/.agents/skills/sap-evidence.md`
  - `H:/erppreflight/.agents/skills/secure-file-parser.md`
  - `services/analysis-python/src/engines/opd_guard.py` & `form_doctor.py`
  - `services/analysis-python/src/parsers/safe_xml.py`
  - `services/analysis-python/src/models/` (enums, evidence, finding, request, response)
  - `services/analysis-python/src/platform/` (evidence, confidence, router, audit)
  - `tests/e2e/fixtures/opd/` & `tests/e2e/fixtures/forms/`
  - `tests/e2e/evaluators.py` & `tests/e2e/test_tier1_features.py`
- **Key findings**:
  - OPD Guard requires multi-format table parsing (CSV, JSON, XLSX), multi-step sequential evaluation (Output Type -> Receiver -> Channel -> Printer -> Email Recipient -> Email Sender -> Form Template -> Output Relevance), wildcard/set/range condition matching, shadowed rule detection (`OPD_UNREACHABLE_RULE`), and specific failure detection (`OPD_STEP_FAILED`, `OPD_NO_RULE_MATCH`, `OPD_PRINTER_QUEUE_NOT_FOUND`, `OPD_CHANNEL_INACTIVE`).
  - FormDoctor requires safe XML/XDP parsing with exact line coordinate retention (`LineNumberTreeBuilder`), data path extraction and prefix/namespace normalization, XDP binding analysis (`subform` scope + `<bind match="dataRef" ref="..."/>`), field presence inspection, Clean Core Tier 2 form assessment (identifying legacy SAPscript/SmartForms `FORM_LEGACY_SMARTFORM_DETECTED`), and failure classification (`FORM_FIELD_MISSING_IN_XML`, `FORM_BINDING_PATH_MISMATCH`).
  - Implemented zero-dependency pure-Python XLSX parser using standard `zipfile` and `defusedxml` to parse spreadsheet tables without external pip dependencies.
  - Verified `LineNumberTreeBuilder` extracts exact 1-indexed source line and column coordinates from both XML payloads and Adobe XDP templates.
- **Unexplored areas**:
  - Live execution of full end-to-end multi-tenant uploads against MinIO/PostgreSQL (will occur during builder/integration phases).

## Key Decisions Made
- Architecture: Authored complete production-ready drop-in code for `opd_guard.py` and `form_doctor.py` in `opd_form_blueprint.md`.
- Security: Integrated `defusedxml` with `LineNumberTreeBuilder` and memory-bounded CSV/JSON parsing with cryptographic SHA-256 evidence hashing.
- Verification: Provided full companion `pytest` test suites (`test_opd_guard.py` and `test_form_doctor.py`).

## Artifact Index
- `H:/erppreflight/.agents/m3_d1_explorer_1/BRIEFING.md` — Agent persistent state and memory
- `H:/erppreflight/.agents/m3_d1_explorer_1/progress.md` — Liveness and execution heartbeat
- `H:/erppreflight/.agents/m3_d1_explorer_1/opd_form_blueprint.md` — Complete production-ready drop-in design and code
- `H:/erppreflight/.agents/m3_d1_explorer_1/handoff.md` — 5-component handoff report
