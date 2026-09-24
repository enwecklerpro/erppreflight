# Dispatch: Domain 1 Remediation Worker (Iteration 2)

## 2026-09-24T06:39:45Z

- **Agent Name**: `m3_d1_worker_remediation`
- **Role**: `teamwork_preview_worker`
- **Working Directory**: `H:/erppreflight/.agents/m3_d1_worker_remediation`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`

## Mission
Remediate the 5 empirical defects discovered by Challenger 1 (`m3_d1_challenger_1`) in Domain 1 Preflight Engines (`services/analysis-python/src/engines/form_doctor.py` and `services/analysis-python/src/engines/opd_guard.py`).

## Inputs to Study
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/m3_d1_challenger_1/handoff.md` (Detailed defect analysis and recommendations)
- `H:/erppreflight/.agents/m3_d1_challenger_1/test_adversarial_opd_form.py` (Adversarial test suite)
- `H:/erppreflight/services/analysis-python/src/engines/form_doctor.py`
- `H:/erppreflight/services/analysis-python/src/engines/opd_guard.py`

## Specific Remediation Instructions

### 1. `services/analysis-python/src/engines/form_doctor.py:104-118` (CRITICAL)
- Plain text `.txt` uploads currently crash with `XML_PARSE_ERROR` when `xml_content = content` is fed to `_safe_parse_xml`.
- Fix: In `analyze()`, only invoke `self._safe_parse_xml(xml_content)` if `xml_content.strip().startswith("<")` and `not xml_content.strip().startswith("<?smartform")`.
- If `xml_content` is plain text SAPscript/ITF or does not start with `<` (or is a SmartForm text export), skip XML DOM indexing and proceed directly to `_audit_legacy_forms(xml_content, ...)`.

### 2. `services/analysis-python/src/engines/form_doctor.py:235-241` (MAJOR)
- In `_extract_payloads()`, expand `raw_content` inspection to capture ABAP driver calls, SAPscript comments `/*`, and generic text:
  ```python
  elif any(k in raw.lower() for k in ("<smartform", "/:", "/*", "/=", "address", "ssf_function_module_name")):
      xml_content = raw
      xml_path = request.artifact_s3_key or "legacy_form.txt"
  elif request.artifact_type == ArtifactType.TXT:
      xml_content = raw
      xml_path = request.artifact_s3_key or "legacy_form.txt"
  ```

### 3. `services/analysis-python/src/engines/form_doctor.py:73` (MAJOR)
- Replace invalid word boundary `\b%` with whitespace/boundary-aware pattern:
  ```python
  (re.compile(r"(?:^|[\s<])(%PAGE|%WINDOW|%TEXT)\b", re.IGNORECASE), "SmartForms Internal Elements"),
  ```

### 4. `services/analysis-python/src/engines/form_doctor.py:591` (MINOR)
- In `_audit_legacy_forms()`, for the SAPscript matching block, ensure `rule_id="FORM_LEGACY_SAPSCRIPT_DETECTED"` (NOT `FORM_LEGACY_SMARTFORM_DETECTED`).

### 5. `services/analysis-python/src/engines/opd_guard.py:404-430` (MEDIUM)
- In `condition_subsumes(cls, cond_a: Any, cond_b: Any) -> bool`:
- Add numerical range/interval subsumption logic:
  - If `cond_a` is an interval like `[low..high]` or `low..high`, parse `a_low` and `a_high`.
  - If `cond_b` is an interval `[b_low..b_high]`, check if `a_low <= b_low and b_high <= a_high`.
  - If `cond_b` is a single number, check if `a_low <= float(b) <= a_high`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Verification Requirements
In PowerShell (prepend `C:\Users\SKAF\AppData\Roaming\npm` to `$env:PATH`):
1. `py -3.13 -m pytest .agents/m3_d1_challenger_1/test_adversarial_opd_form.py -v` (Must pass 30/30)
2. `py -3.13 -m pytest services/analysis-python/tests/unit/test_domain1_engines.py -v` (Must pass 100%)
3. `py -3.13 -m pytest services/analysis-python/tests -q` (Must pass 337+ tests)
4. `pnpm test`
5. `py -3.13 -m pytest tests/e2e/ -q`
6. `pnpm run build --force`
7. `pnpm run typecheck`
8. `pnpm run lint`

Deliver a comprehensive `handoff.md` and call `send_message` to parent.
