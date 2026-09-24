# Dispatch Assignment: m3_d5_worker_remediation

- **Agent**: `m3_d5_worker_remediation`
- **Archetype**: `teamwork_preview_worker`
- **Role**: Domain 5 Remediation Worker
- **Working Directory**: `H:/erppreflight/.agents/m3_d5_worker_remediation`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`
- **Timestamp**: 2026-09-24T12:48:00+02:00

## Objective
Remediate the 5 uncaught crash defects and 3 algorithmic issues identified by `m3_d5_challenger_1` across Domain 5 preflight engines:
- `services/analysis-python/src/engines/account_determination.py`
- `services/analysis-python/src/engines/iam_cost_guard.py`
- `services/analysis-python/src/engines/fiori_auth_guard.py`
- `services/analysis-python/src/engines/workflow_deadlock.py`
- `services/analysis-python/src/engines/decommission_audit.py`

## Authoritative Inputs
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (MANDATORY)
- `H:/erppreflight/.agents/orchestrator_main/PROJECT.md`
- `H:/erppreflight/.agents/m3_d5_challenger_1/handoff.md` (FULL CHALLENGER REPORT)
- Adversarial test harness: `H:/erppreflight/.agents/m3_d5_challenger_1/test_adversarial_domain5.py`

## Remediation Tasks

### 1. `services/analysis-python/src/engines/account_determination.py` (Line 277)
Fix `request.artifact_reference` bug:
Replace:
```python
        if request.raw_content:
            raw_text = request.raw_content
        elif request.artifact_reference and getattr(request.artifact_reference, "content", None):
            raw_text = request.artifact_reference.content
        elif request.configuration and "content" in request.configuration:
```
With safe multi-artifact and configuration extraction:
```python
        if request.raw_content:
            raw_text = request.raw_content
        elif request.artifacts and len(request.artifacts) > 0 and getattr(request.artifacts[0], "content", None):
            raw_text = request.artifacts[0].content
        elif getattr(request, "artifact_reference", None) and getattr(request.artifact_reference, "content", None):
            raw_text = request.artifact_reference.content
        elif request.configuration and isinstance(request.configuration, dict) and "content" in request.configuration:
            raw_text = request.configuration["content"]
```
Also support parsing direct dictionaries in `request.configuration` (e.g. if `request.configuration` contains tables/rules directly).

### 2. `services/analysis-python/src/engines/iam_cost_guard.py` (Line 305 & Line 598)
1. Fix `request.artifact_reference` bug (Line 305):
   Apply the same fix as task 1:
   ```python
        if request.raw_content:
            raw_text = request.raw_content
        elif request.artifacts and len(request.artifacts) > 0 and getattr(request.artifacts[0], "content", None):
            raw_text = request.artifacts[0].content
        elif getattr(request, "artifact_reference", None) and getattr(request.artifact_reference, "content", None):
            raw_text = request.artifact_reference.content
        elif request.configuration and isinstance(request.configuration, dict) and "content" in request.configuration:
            raw_text = request.configuration["content"]
   ```
2. Check `role.is_emergency` flag (Line 598):
   ```python
                is_emergency_role = (
                    getattr(role, "is_emergency", False)
                    or "EMERGENCY" in rname.upper()
                    or "FIRECALL" in rname.upper()
                    or "SUPERUSER" in rname.upper()
                )
   ```

### 3. `services/analysis-python/src/engines/fiori_auth_guard.py` (Line 911)
In `_parse_csv_content`:
Safely handle ragged/truncated CSV rows where values default to `None`:
Replace:
```python
        for idx, row in enumerate(reader, start=2):
            norm_row = {k.strip().lower(): v.strip() for k, v in row.items() if k}
```
With:
```python
        for idx, row in enumerate(reader, start=2):
            norm_row = {k.strip().lower(): (v.strip() if v is not None else "") for k, v in row.items() if k}
```

### 4. `services/analysis-python/src/engines/workflow_deadlock.py` (Lines 690, 709, and 397)
1. Ragged CSV row fix (Line 690):
   ```python
        for idx, row in enumerate(reader, start=2):
            norm_row = {k.strip().lower(): (v.strip() if v is not None else "") for k, v in row.items() if k}
   ```
2. Safe integer parsing for `retcode` (Line 709):
   Replace:
   ```python
   retcode=int(norm_row.get("retcode", 0)),
   ```
   With:
   ```python
   try:
       retcode_val = int(norm_row.get("retcode", 0))
   except (ValueError, TypeError):
       retcode_val = 0
   ```
   and pass `retcode=retcode_val`.
3. Deadlock detection heuristic (Line 397):
   Refine `Rule 4` (`RULE_DEADLOCK_DETECTED`):
   Instead of flagging any 2 work items in status WAITING, verify that the waiting items share the same parent workflow (`wi_chckwi` is not None and matches, or same `top_wi_id`), or have conflicting mutual container bindings. If waiting items belong to completely different parent workflows, do NOT flag a mutual deadlock.

### 5. `services/analysis-python/src/engines/decommission_audit.py` (Lines 687, 696)
Support configurable snapshot/evaluation date for deterministic auditing:
```python
        ref_date_str = (request.configuration or {}).get("evaluation_date") or (request.configuration or {}).get("snapshot_date")
        if ref_date_str:
            try:
                ref_date = date.fromisoformat(str(ref_date_str)[:10])
            except Exception:
                ref_date = date.today()
        else:
            ref_date = date.today()
```
And replace calls to `date.today()` with `ref_date`.

## Verification Commands
Execute in PowerShell:
```powershell
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH
# 1. Verify adversarial test harness (must pass 100% of non-skipped tests!)
py -3.13 -m pytest .agents/m3_d5_challenger_1/test_adversarial_domain5.py -v

# 2. Verify Domain 5 unit tests
py -3.13 -m pytest services/analysis-python/tests/unit/test_domain5_engines.py -v

# 3. Verify Full Python analysis suite
py -3.13 -m pytest services/analysis-python/tests -q

# 4. Verify Ruff linter (0 errors)
py -3.13 -m ruff check services/analysis-python/src/engines/decommission_audit.py services/analysis-python/src/engines/fiori_auth_guard.py services/analysis-python/src/engines/workflow_deadlock.py services/analysis-python/src/engines/iam_cost_guard.py services/analysis-python/src/engines/account_determination.py services/analysis-python/src/engines/system_refresh_guard.py

# 5. Verify Monorepo build and typecheck
pnpm test
pnpm run build
pnpm run typecheck
```

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A forensic auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Deliver `handoff.md` with verification commands and output, and call `send_message` to parent (`b18c0539-d6d7-4a41-968f-58324775ab38`).
