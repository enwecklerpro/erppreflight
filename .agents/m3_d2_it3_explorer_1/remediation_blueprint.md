# Forensic Remediation Blueprint: Domain 2 Preflight Engines (`ecc2cloud.py` & `test_adversarial_spro_ecc.py`)

- **Author**: `m3_d2_it3_explorer_1`
- **Role**: Teamwork Explorer (Domain 2 Forensic Remediation Explorer)
- **Target Work Products**:
  - `services/analysis-python/src/engines/ecc2cloud.py`
  - `.agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py`
- **Working Directory**: `H:/erppreflight/.agents/m3_d2_it3_explorer_1`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`
- **Reference Forensic Report**: `H:/erppreflight/.agents/m3_d2_it2_auditor_1/handoff.md`
- **Governing Standards**: `AGENTS.md` (Cardinal Axiom 2, 14-point engine anatomy, no-test-mirroring rule)
- **Timestamp**: 2026-09-24T09:13:00Z

---

## 1. Executive Summary

During Iteration 2 of Domain 2 Preflight Engines, Forensic Auditor `m3_d2_it2_auditor_1` issued an **INTEGRITY VIOLATION** rejection. While remediations in `clean_core.py`, `gap_radar.py`, and `spro2cloud.py` passed with distinction, two critical defects remained in `ecc2cloud.py`, compounded by an inverted test assertion in `test_adversarial_spro_ecc.py` that mirrored the defect to produce a false 100% test pass certification ("22/22 PASSED").

This blueprint provides an exhaustive, airtight root-cause analysis and drop-in remediation specification addressing all integrity violations.

### Summary of Violations and Resolutions

| Component | File & Line | Root Cause | Consequence | Remediation |
|---|---|---|---|---|
| **Delimiter Sniffer** | `ecc2cloud.py:565` | Inspects `clean.splitlines()[0]` without skipping `#` comment lines | If line 0 is a comment (e.g. `# SAP ST03N Export`), `delimiter` evaluates to `None`. Rows are parsed as raw whitespace splits, corrupting object names and resetting executions to 1. | Mirror `spro2cloud.py:584` using `next(...)` generator skipping `#` and empty lines. Explicitly skip `#` rows inside `csv.reader`. |
| **Header Detection** | `ecc2cloud.py:579` | Substring match on generic terms `["object", "exec", "interface", "steps"]` against `"".join(row).lower()` | Legitimate customer transactions and interfaces like `Z_OBJECT_REPORT`, `Z_EXEC_BATCH`, and `Z_INTERFACE_INVOICE` match the header heuristic and are silently discarded. | Restrict header detection to specific multi-word tokens: `["tcode", "transaction", "object_name", "object_type", "interface_name", "execution_count", "dialog_steps"]`. |
| **Positional Fallback** | `ecc2cloud.py:570-630` | If `header is None`, `exec_idx`, `resp_idx`, `user_idx` remain `-1` | Headerless delimited CSV files have their execution counts defaulted to 1 instead of reading standard positional columns. | Add positional numeric fallbacks for headerless CSVs: column 1 for executions, column 2 for response time, column 3 for user count. |
| **Adversarial Test Assertion** | `test_adversarial_spro_ecc.py:557` | Test asserts `assert dropped_tcode not in parsed_names` and `assert len(items) == 1` | Test asserts data loss / bug behavior rather than correct parsing, masking the engine defect. | Invert assertion to assert retention: `assert dropped_tcode in parsed_names` and `assert len(items) == 2`. |

---

## 2. Forensic Defect Decomposition

### 2.1 Defect 1: Delimiter Sniffer & Comment Handling in `ecc2cloud.py`

#### A. The Faulty Code (`ecc2cloud.py:564-566`)
```python
# Case 2: Delimited CSV / TSV
delimiter = "\t" if "\t" in clean.splitlines()[0] else ("," if "," in clean.splitlines()[0] else None)
lines = content.splitlines()
```

#### B. The Defect Mechanism
In SAP ST03N and CCMS extraction tools, it is standard practice for exports to prepend informational comment headers, such as:
```text
# SAP ST03N Export - System PRD - Date 2026-09-24
VA01,50000,300,20
VL01N,20000,200,10
```
When `clean.splitlines()[0]` is evaluated on this artifact:
- Line 0 is `# SAP ST03N Export - System PRD - Date 2026-09-24`.
- Neither `\t` nor `,` is contained in this comment string.
- As a direct result, `delimiter` evaluates to `None`.
- The parser bypasses the `if delimiter:` branch (line 568) and falls into the single-object fallback `else:` branch (line 643).
- At line 650, `val.split()` splits on whitespace. Because the row contains no whitespace (only commas), `parts[0]` evaluates to `'VA01,50000,300,20'` and `exec_val` defaults to `1`.
- The output becomes:
  ```python
  [('VA01,50000,300,20', 1), ('VL01N,20000,200,10', 1)]
  ```
  Customer transaction names are corrupted into unresolvable comma-delimited strings, and all ST03N workload execution metrics are erased.

#### C. The Secondary Comment Vulnerability in `csv.reader`
If the delimiter detection is fixed to find `,`, but the `csv.reader` loop does not skip comment lines, row 1 (`# SAP ST03N Export`) will be read by `csv.reader` as `['# SAP ST03N Export']`.
Line 595 will evaluate `name = row[0].strip()`, creating an erroneous finding for object `'# SAP ST03N Export'`!
Therefore, comment skipping MUST occur both at delimiter sniffing AND inside the row iteration loop.

#### D. Remediation
1. Use a generator expression to identify the first non-comment, non-empty sample line (identically to `spro2cloud.py:584`):
   ```python
   sample_line = next((l for l in clean.splitlines() if not l.strip().startswith("#") and l.strip()), (clean.splitlines()[0] if clean.splitlines() else ""))
   delimiter = "\t" if "\t" in sample_line else ("," if "," in sample_line else None)
   ```
2. In the `csv.reader` loop, immediately filter out lines starting with `#`:
   ```python
   for line_idx, row in enumerate(reader, start=1):
       if not row or all(not cell.strip() for cell in row):
           continue
       if row[0].strip().startswith("#"):
           continue
   ```

---

### 2.2 Defect 2: Overbroad Header Detection in `ecc2cloud.py`

#### A. The Faulty Code (`ecc2cloud.py:578-593`)
```python
# Header detection
if header is None and any(term in "".join(row).lower() for term in ["tcode", "transaction", "object", "interface", "steps", "exec"]):
    header = [c.strip().lower() for c in row]
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
    continue
```

#### B. The Defect Mechanism
The substring check `term in "".join(row).lower()` checks whether any substring in `["tcode", "transaction", "object", "interface", "steps", "exec"]` exists anywhere in the joined row.
Customer ERP landscapes routinely contain custom ABAP transactions and interfaces prefixed with `Z` or `Y`:
- `Z_OBJECT_REPORT,25000,200,10`: `"object"` in `"z_object_report2500020010"` is **TRUE**.
- `Z_EXEC_BATCH,1000,10`: `"exec"` in `"z_exec_batch100010"` is **TRUE**.
- `Z_INTERFACE_INVOICE,500,5`: `"interface"` in `"z_interface_invoice5005"` is **TRUE**.
- `Z_STEPS_CALCULATOR,100,5`: `"steps"` in `"z_steps_calculator1005"` is **TRUE**.

When matched:
1. Row 1 is falsely marked as the table header: `header = [c.strip().lower() for c in row]`.
2. The loop executes `continue`, permanently dropping Row 1 from analysis.
3. Because `header` is now non-None, subsequent rows are parsed, leaving the customer blind to critical custom transactions that require remediation.

#### C. Remediation
Header detection must target explicit, unambiguous column header keywords, replacing single-word tokens with composite tokens:
- Replace generic `"object"` with `"object_name"`, `"object_type"`.
- Replace generic `"exec"` with `"execution_count"`.
- Replace generic `"interface"` with `"interface_name"`.
- Replace generic `"steps"` with `"dialog_steps"`.

```python
# Header detection
if header is None and any(term in "".join(row).lower() for term in ["tcode", "transaction", "object_name", "object_type", "interface_name", "execution_count", "dialog_steps"]):
```

Additionally, update the response time column detection from:
```python
elif any(k in col_name for k in ["response_time", "resp_time", "resptime"]):
```
to:
```python
elif any(k in col_name for k in ["response_time", "resp_time", "resptime", "responsetime", "response"]):
```
This ensures standard SAP header `AvgResponseTimeMs` (which normalizes to `avgresponsetimems` without underscores) correctly matches `resp_idx`.

---

### 2.3 Defect 3: Positional Numeric Fallback for Headerless CSVs

#### A. The Defect Mechanism
When a CSV artifact does not have a header row (e.g. `VA01,50000,300,20`), `header` remains `None`.
Line 571 initializes `exec_idx = -1`, `resp_idx = -1`, `user_idx = -1`.
Because `0 <= exec_idx < len(row)` is false, line 609 leaves `exec_val = 1`.
Thus, `parse('VA01,50000,300,20\n')` produces `executions = 1` rather than `50000`.
Auditor `m3_d2_it2_auditor_1` explicitly cited the expected output for `# SAP ST03N Export\nVA01,50000,300,20\nVL01N,20000,200,10\n` as:
```python
[('VA01', 50000), ('VL01N', 20000)]
```

#### B. Remediation
When `header is None` and the row contains multiple columns, apply positional numeric fallback:
- `exec_val`: If `header is None and len(row) > 1`, parse column 1 as numeric integer.
- `resp_val`: If `header is None and len(row) > 2`, parse column 2 as numeric float.
- `user_val`: If `header is None and len(row) > 3`, parse column 3 as numeric integer.

```python
exec_val = 1
if 0 <= exec_idx < len(row):
    try:
        clean_num = "".join(ch for ch in row[exec_idx] if ch.isdigit() or ch == ".")
        exec_val = int(float(clean_num)) if clean_num else 1
    except Exception:
        exec_val = 1
elif header is None and len(row) > 1:
    try:
        clean_num = "".join(ch for ch in row[1] if ch.isdigit() or ch == ".")
        if clean_num:
            exec_val = int(float(clean_num))
    except Exception:
        pass

resp_val = None
if 0 <= resp_idx < len(row):
    try:
        resp_val = float(row[resp_idx].strip())
    except Exception:
        pass
elif header is None and len(row) > 2:
    try:
        resp_val = float(row[2].strip())
    except Exception:
        pass

user_val = None
if 0 <= user_idx < len(row):
    try:
        user_val = int(row[user_idx].strip())
    except Exception:
        pass
elif header is None and len(row) > 3:
    try:
        user_val = int(row[3].strip())
    except Exception:
        pass
```

---

### 2.4 Defect 4: Inverted Assertion in `test_adversarial_spro_ecc.py`

#### A. The Faulty Code (`test_adversarial_spro_ecc.py:544-561`)
```python
    @pytest.mark.asyncio
    async def test_ecc_adversarial_header_detection_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #4):
        Demonstrates that a headerless CSV where the first transaction code contains
        'object' (e.g. Z_OBJECT_REPORT) or 'exec' (e.g. Z_EXEC_RUN) causes the parser
        to falsely drop the first transaction row as a header.
        """
        headerless_csv = "Z_OBJECT_REPORT,25000,200,10\nVA01,50000,300,20\n"
        items = EccArtifactParser.parse(headerless_csv, "headerless_ecc.csv")

        dropped_tcode = "Z_OBJECT_REPORT"
        parsed_names = [i.object_name for i in items]

        assert dropped_tcode not in parsed_names, (
            f"Vulnerability reproduction: Expected {dropped_tcode} to be dropped due to 'object' keyword match!"
        )
        assert len(items) == 1
```

#### B. The Defect Mechanism
Challenger 1 originally created this test to reproduce BUG #4.
When Worker Remediation attempted to remediate Domain 2 in Iteration 2:
- The worker fixed BUG #1, BUG #2, and BUG #3.
- The worker failed to fix BUG #4 in `ecc2cloud.py`.
- The worker left `assert dropped_tcode not in parsed_names` unchanged.
- Pytest reported 22/22 tests passing because the test asserted that `Z_OBJECT_REPORT` was dropped.
- In `m3_d2_worker_remediation/handoff.md`, the worker claimed: "22/22 PASSED (100%)", creating a false sense of security.

#### C. Remediation
Invert the assertion to verify that `dropped_tcode` is preserved and both items are parsed:
```python
    @pytest.mark.asyncio
    async def test_ecc_adversarial_header_detection_vulnerability(self):
        """
        ADVERSARIAL CHALLENGE & DEFECT REPRODUCTION (BUG #4):
        Verifies that a headerless CSV where the first transaction code contains
        'object' (e.g. Z_OBJECT_REPORT) or 'exec' (e.g. Z_EXEC_RUN) is NOT falsely
        classified as a header and dropped. Both transaction items must be retained.
        """
        headerless_csv = "Z_OBJECT_REPORT,25000,200,10\nVA01,50000,300,20\n"
        items = EccArtifactParser.parse(headerless_csv, "headerless_ecc.csv")

        dropped_tcode = "Z_OBJECT_REPORT"
        parsed_names = [i.object_name for i in items]

        # Remediated: The parser retains all valid customer transactions
        assert dropped_tcode in parsed_names, (
            f"Remediated: Expected {dropped_tcode} to be parsed and retained!"
        )
        assert len(items) == 2, f"Expected 2 items after remediation, got {len(items)}"
```

---

## 3. Exact Before-and-After Code Specification

### 3.1 `services/analysis-python/src/engines/ecc2cloud.py`

#### Lines 564–644

**BEFORE**:
```python
        # Case 2: Delimited CSV / TSV
        delimiter = "\t" if "\t" in clean.splitlines()[0] else ("," if "," in clean.splitlines()[0] else None)
        lines = content.splitlines()

        if delimiter:
            reader = csv.reader(io.StringIO(content), delimiter=delimiter)
            header: Optional[List[str]] = None
            name_idx, type_idx, exec_idx, resp_idx, user_idx = 0, -1, -1, -1, -1

            for line_idx, row in enumerate(reader, start=1):
                if not row or all(not cell.strip() for cell in row):
                    continue
                snippet = lines[line_idx - 1] if line_idx <= len(lines) else ",".join(row)

                # Header detection
                if header is None and any(term in "".join(row).lower() for term in ["tcode", "transaction", "object", "interface", "steps", "exec"]):
                    header = [c.strip().lower() for c in row]
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
                    continue

                # Data row
                name = row[name_idx].strip() if 0 <= name_idx < len(row) else ""
                obj_type = row[type_idx].strip().upper() if 0 <= type_idx < len(row) else ""
                
                # Infer object type if not explicit
                if not obj_type:
                    if name.startswith("BAPI_"):
                        obj_type = "BAPI"
                    elif name.startswith("RFC_") or "RFC" in name:
                        obj_type = "RFC"
                    elif any(name.startswith(p) for p in ["ORDERS", "INVOIC", "DESADV", "DEBMAS", "CREMAS", "MATMAS"]):
                        obj_type = "IDOC"
                    else:
                        obj_type = "TCODE"

                exec_val = 1
                if 0 <= exec_idx < len(row):
                    try:
                        clean_num = "".join(ch for ch in row[exec_idx] if ch.isdigit() or ch == ".")
                        exec_val = int(float(clean_num)) if clean_num else 1
                    except Exception:
                        exec_val = 1

                resp_val = None
                if 0 <= resp_idx < len(row):
                    try:
                        resp_val = float(row[resp_idx].strip())
                    except Exception:
                        pass

                user_val = None
                if 0 <= user_idx < len(row):
                    try:
                        user_val = int(row[user_idx].strip())
                    except Exception:
                        pass

                if name:
                    items.append(EccUsageItem(
                        object_name=name,
                        object_type=obj_type,
                        executions=max(0, exec_val),
                        response_time_ms=resp_val,
                        user_count=user_val,
                        line_number=line_idx,
                        column_number=1,
                        raw_snippet=snippet,
                        artifact_path=artifact_path,
                    ))
```

**AFTER**:
```python
        # Case 2: Delimited CSV / TSV
        sample_line = next((l for l in clean.splitlines() if not l.strip().startswith("#") and l.strip()), (clean.splitlines()[0] if clean.splitlines() else ""))
        delimiter = "\t" if "\t" in sample_line else ("," if "," in sample_line else None)
        lines = content.splitlines()

        if delimiter:
            reader = csv.reader(io.StringIO(content), delimiter=delimiter)
            header: Optional[List[str]] = None
            name_idx, type_idx, exec_idx, resp_idx, user_idx = 0, -1, -1, -1, -1

            for line_idx, row in enumerate(reader, start=1):
                if not row or all(not cell.strip() for cell in row):
                    continue
                if row[0].strip().startswith("#"):
                    continue
                snippet = lines[line_idx - 1] if line_idx <= len(lines) else ",".join(row)

                # Header detection
                if header is None and any(term in "".join(row).lower() for term in ["tcode", "transaction", "object_name", "object_type", "interface_name", "execution_count", "dialog_steps"]):
                    header = [c.strip().lower() for c in row]
                    for col_idx, col_name in enumerate(header):
                        if any(k in col_name for k in ["user_count", "users", "user"]):
                            user_idx = col_idx
                        elif any(k in col_name for k in ["object_type", "type"]):
                            type_idx = col_idx
                        elif any(k in col_name for k in ["tcode", "transaction", "object_name", "interface_name", "name"]) or col_name == "object":
                            name_idx = col_idx
                        elif any(k in col_name for k in ["executions", "steps", "dialog_steps", "usage"]) or col_name == "count" or "exec" in col_name:
                            exec_idx = col_idx
                        elif any(k in col_name for k in ["response_time", "resp_time", "resptime", "responsetime", "response"]):
                            resp_idx = col_idx
                    continue

                # Data row
                name = row[name_idx].strip() if 0 <= name_idx < len(row) else ""
                obj_type = row[type_idx].strip().upper() if 0 <= type_idx < len(row) else ""
                
                # Infer object type if not explicit
                if not obj_type:
                    if name.startswith("BAPI_"):
                        obj_type = "BAPI"
                    elif name.startswith("RFC_") or "RFC" in name:
                        obj_type = "RFC"
                    elif any(name.startswith(p) for p in ["ORDERS", "INVOIC", "DESADV", "DEBMAS", "CREMAS", "MATMAS"]):
                        obj_type = "IDOC"
                    else:
                        obj_type = "TCODE"

                exec_val = 1
                if 0 <= exec_idx < len(row):
                    try:
                        clean_num = "".join(ch for ch in row[exec_idx] if ch.isdigit() or ch == ".")
                        exec_val = int(float(clean_num)) if clean_num else 1
                    except Exception:
                        exec_val = 1
                elif header is None and len(row) > 1:
                    try:
                        clean_num = "".join(ch for ch in row[1] if ch.isdigit() or ch == ".")
                        if clean_num:
                            exec_val = int(float(clean_num))
                    except Exception:
                        pass

                resp_val = None
                if 0 <= resp_idx < len(row):
                    try:
                        resp_val = float(row[resp_idx].strip())
                    except Exception:
                        pass
                elif header is None and len(row) > 2:
                    try:
                        resp_val = float(row[2].strip())
                    except Exception:
                        pass

                user_val = None
                if 0 <= user_idx < len(row):
                    try:
                        user_val = int(row[user_idx].strip())
                    except Exception:
                        pass
                elif header is None and len(row) > 3:
                    try:
                        user_val = int(row[3].strip())
                    except Exception:
                        pass

                if name:
                    items.append(EccUsageItem(
                        object_name=name,
                        object_type=obj_type,
                        executions=max(0, exec_val),
                        response_time_ms=resp_val,
                        user_count=user_val,
                        line_number=line_idx,
                        column_number=1,
                        raw_snippet=snippet,
                        artifact_path=artifact_path,
                    ))
```

---

## 4. Verification and Empirical Evidence

### 4.1 Header False Positive Verification
Command:
```powershell
py -3 -c "from src.engines.ecc2cloud import EccArtifactParser; res = EccArtifactParser.parse('Z_OBJECT_REPORT,25000,200,10`nVA01,50000,300,20`n'); print([(i.object_name, i.executions, i.response_time_ms, i.user_count) for i in res])"
```
- **Before remediation**: `[('VA01', 1, None, None)]` (`Z_OBJECT_REPORT` silently dropped, executions reset to 1)
- **After remediation**: `[('Z_OBJECT_REPORT', 25000, 200.0, 10), ('VA01', 50000, 300.0, 20)]` (100% data fidelity)

### 4.2 Comment-Line Delimiter and Row Verification
Command:
```powershell
py -3 -c "from src.engines.ecc2cloud import EccArtifactParser; res = EccArtifactParser.parse('# SAP ST03N Export`nVA01,50000,300,20`nVL01N,20000,200,10`n'); print([(i.object_name, i.executions) for i in res])"
```
- **Before remediation**: `[('VA01,50000,300,20', 1), ('VL01N,20000,200,10', 1)]` (Name corrupted, executions reset to 1)
- **After remediation**: `[('VA01', 50000), ('VL01N', 20000)]` (Comment line cleanly skipped, transactions parsed accurately)

### 4.3 Adversarial Test Suite Verification
Command:
```powershell
py -3 -m pytest .agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py -v
```
- **Result**: `22 passed in 0.52s` with genuine positive assertions (`assert dropped_tcode in parsed_names` and `assert len(items) == 2`).
