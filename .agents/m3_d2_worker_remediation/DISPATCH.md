# Dispatch: Domain 2 Remediation Worker (Iteration 2)

- **Agent Name**: `m3_d2_worker_remediation`
- **Role**: `teamwork_preview_worker`
- **Working Directory**: `H:/erppreflight/.agents/m3_d2_worker_remediation`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`

## Mission
Remediate the 6 empirical defects identified by Challenger 1 (`m3_d2_challenger_1`) and Challenger 2 (`m3_d2_challenger_2`) across the 4 Domain 2 Preflight Engines (`ecc2cloud.py`, `spro2cloud.py`, `gap_radar.py`, `clean_core.py`).

## Inputs to Study
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/m3_d2_challenger_1/handoff.md` (Header collisions, SIMG prefix, delimiter)
- `H:/erppreflight/.agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py` (Adversarial test harness)
- `H:/erppreflight/.agents/m3_d2_challenger_2/handoff.md` (Epistemic confidence, multi-line ABAP, double-quote comments)
- `H:/erppreflight/.agents/m3_d2_challenger_2/test_adversarial_gap_clean_core.py` (Adversarial test harness)

## Specific Remediation Instructions

### 1. `services/analysis-python/src/engines/ecc2cloud.py:581-593` (CRITICAL)
- `UserCount` header keyword collision: currently matches `"count"` in line 586 before `user_idx` can check `user_count`, overwriting `exec_idx`.
- Fix: Evaluate `user_count` before generic `count`:
  ```python
  for col_idx, col_name in enumerate(header):
      if any(k in col_name for k in ["user_count", "users", "user"]):
          user_idx = col_idx
      elif any(k in col_name for k in ["object_type", "type"]):
          type_idx = col_idx
      elif any(k in col_name for k in ["tcode", "transaction", "object_name", "interface_name", "name"]) or col_name == "object":
          name_idx = col_idx
      elif any(k in col_name for k in ["executions", "steps", "dialog_steps", "usage"]) or col_name == "count" or "exec" in col_name:
          exec_idx = col_idx
      elif any(k in col_name for k in ["response_time", "resp_time", "resptime"]):
          resp_idx = col_idx
  ```

### 2. `services/analysis-python/src/engines/spro2cloud.py:598` (HIGH)
- False positive header detection: `"simg"` in keyword list causes headerless CSV starting with standard SAP SPRO activities (`SIMG_...`) to be dropped as a header row.
- Fix: Remove `"simg"` from the generic header keyword list:
  ```python
  if header is None and any(term in "".join(row).lower() for term in ["activity_id", "activity_name", "table_name", "module", "description"]):
  ```

### 3. `services/analysis-python/src/engines/spro2cloud.py:584` (MEDIUM)
- Delimiter detection checks only `clean_content.splitlines()[0]`. If line 0 is a comment (`# SAP SPRO Export`), delimiter detection fails.
- Fix: Inspect first non-comment, non-empty line when detecting delimiter:
  ```python
  sample_line = next((l for l in clean_content.splitlines() if not l.strip().startswith("#") and l.strip()), clean_content.splitlines()[0])
  delimiter = "\t" if "\t" in sample_line else ("," if "," in sample_line else None)
  ```

### 4. `services/analysis-python/src/engines/gap_radar.py:656` (HIGH)
- Tier 12 `UNKNOWN_REQUIREMENT` findings are hardcoded as `ConfidenceClass.RULE_DERIVED` (0.85) instead of `ConfidenceClass.UNKNOWN` (0.30).
- Fix: In `gap_radar.py` around line 656:
  ```python
  confidence=ConfidenceClass.UNKNOWN if tier == ResolutionTier.TIER_12_UNKNOWN else ConfidenceClass.RULE_DERIVED,
  confidence_score=0.30 if tier == ResolutionTier.TIER_12_UNKNOWN else (0.85 if score > 0 else 1.0),
  ```

### 5. `services/analysis-python/src/engines/clean_core.py:275-296` (HIGH)
- Line-by-line regex fails to detect multi-line split statements (e.g. `SELECT *\nFROM\nmara`).
- Fix: Support multi-line statements. Join code statements delimited by periods `.` (preserving line numbering for evidence) or search across line spans using regex `rf"\b(FROM|INTO|UPDATE|MODIFY)\s+(?:\n\s*)*{tbl}\b"` or token normalized representation so split statements are reliably caught with exact line numbers.

### 6. `services/analysis-python/src/engines/clean_core.py:281 & 310` (HIGH)
- `raw_line.split('"')[0]` strips double quotes before obsolete syntax check, causing `CALL "SYSTEM"` to be discarded as a comment.
- Fix: Evaluate `CALL "SYSTEM"` / `CALL 'SYSTEM'` or preserve string literals (both single and double quotes) before stripping comments starting with `"`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Verification Requirements
In PowerShell (prepend `C:\Users\SKAF\AppData\Roaming\npm` to `$env:PATH`):
1. `py -3.13 -m pytest .agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py -v` (Must pass 22/22)
2. `py -3.13 -m pytest .agents/m3_d2_challenger_2/test_adversarial_gap_clean_core.py -v` (Must pass 48/48, 100%)
3. `py -3.13 -m pytest services/analysis-python/tests/unit/test_domain2_engines.py -v` (Must pass 24/24)
4. `py -3.13 -m pytest services/analysis-python/tests -q` (All tests must pass cleanly)
5. `pnpm test`
6. `py -3.13 -m pytest tests/e2e/ -q`
7. `pnpm run build --force`
8. `pnpm run typecheck`
9. `pnpm run lint`

Deliver a comprehensive `handoff.md` and call `send_message` to parent.
