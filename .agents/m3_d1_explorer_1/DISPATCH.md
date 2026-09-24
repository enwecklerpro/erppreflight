# Dispatch Assignment — m3_d1_explorer_1

## 2026-09-24T07:56:00Z
**Role**: OPD Guard & FormDoctor Specialist Explorer
**Working Directory**: H:/erppreflight/.agents/m3_d1_explorer_1
**Parent Agent**: b18c0539-d6d7-4a41-968f-58324775ab38

### Mission:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md and H:/erppreflight/.agents/spec_miner_survey_1/engines_spec.md (§1 OPD Guard, §2 FormDoctor).
Blueprint the complete production implementation in:
1. `services/analysis-python/src/engines/opd_guard.py`:
   - Decision table parser (CSV/JSON/XLSX) supporting steps: Output Type, Receiver, Channel, Printer Queue, Email Recipient/Sender, Form Template, Output Relevance.
   - Multi-step evaluation pipeline with condition matching, blank cell as wildcard (`*`), and shadowed/unreachable rule detection (`OPD_UNREACHABLE_RULE`).
   - Rule failure detection: `OPD_STEP_FAILED`, `OPD_NO_RULE_MATCH`, `OPD_PRINTER_QUEUE_NOT_FOUND`, `OPD_CHANNEL_INACTIVE`.
   - Concrete evidence pointers (line, col, snippet, SHA-256).
2. `services/analysis-python/src/engines/form_doctor.py`:
   - Form XML and XDP parser (safe XML, defusedxml).
   - Data path tracing: matching business fields from XML payload to Adobe Form XDP `dataRef` bindings.
   - Detecting missing fields (`FORM_FIELD_MISSING_IN_XML`), path mismatches (`FORM_BINDING_PATH_MISMATCH`), and Clean Core Tier 2 form assessment (legacy SmartForms/SAPscript detection `FORM_LEGACY_SMARTFORM_DETECTED`).
   - Evidence generation with exact line numbers in XML/XDP.

Document full drop-in designs in H:/erppreflight/.agents/m3_d1_explorer_1/opd_form_blueprint.md and write handoff.md.
