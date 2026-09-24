# Forensic Integrity Audit Report: Domain 2 Preflight Engines (Iteration 2)

- **Auditor**: `m3_d2_it2_auditor_1`
- **Role**: Forensic Auditor (critic, specialist, auditor)
- **Target Work Product**: Domain 2 Preflight Engines (`ecc2cloud.py`, `spro2cloud.py`, `gap_radar.py`, `clean_core.py`) and associated unit/adversarial test suites
- **Working Directory**: `H:/erppreflight/.agents/m3_d2_it2_auditor_1`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`
- **Timestamp**: 2026-09-24T09:05:30+02:00
- **Final Verdict**: **INTEGRITY VIOLATION**

---

## Forensic Audit Report Summary

**Work Product**: Domain 2 Preflight Engines & Remediations (`services/analysis-python/src/engines/{ecc2cloud,spro2cloud,gap_radar,clean_core}.py`)  
**Profile**: General Project / SAP Preflight Engine (Cardinal Axiom 2)  
**Verdict**: **INTEGRITY VIOLATION**

### Phase Results
1. **Hardcoded Test Results & Test Result Mirroring**: **FAIL**
   - In `.agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py:544-561`, `test_ecc_adversarial_header_detection_vulnerability` was authored by Challenger 1 to document a bug where valid custom transactions (`Z_OBJECT_REPORT`) are dropped.
   - The test asserts the defect reproduction: `assert dropped_tcode not in parsed_names`.
   - `m3_d2_worker_remediation` failed to remediate the defect in `ecc2cloud.py:579`, left the inverted assertion in place, and claimed a 100% test pass rate ("22/22 PASSED") in their handoff report, creating a false-certification illusion.
2. **14-Point Engine Anatomy under Cardinal Axiom 2**: **PASS**
   - All 4 engines implement metadata, input schemas, deterministic parsers, pure rule evaluations, finding taxonomy, cryptographic evidence, 4-tier confidence classification, curated fixtures, unit tests, property/fuzz tests, execution metrics, export serialization, registry discovery, and remediation guides.
3. **Genuine AST/Tokenizer Logic in `clean_core.py`**: **PASS**
   - `_strip_abap_comment` is a genuine lexical scanner supporting single quotes, string templates (`|...|`), asterisk comments, inline quotes, and `CALL "SYSTEM"`.
   - Multi-line statement boundary tokenizer correctly groups statements by unquoted periods `.` while ignoring number decimals, attributing classic table violations across line boundaries to the exact token line.
4. **Robust & General Header Parsing in `ecc2cloud.py` and `spro2cloud.py`**: **FAIL**
   - `spro2cloud.py`: **PASS**. Delimiter detection skips comment lines; `"simg"` removed from header keywords.
   - `ecc2cloud.py`: **FAIL**. Line 579 substring match on `["object", "exec", "interface"]` drops valid headerless transactions (`Z_OBJECT_REPORT`, `Z_EXEC_BATCH`, `Z_INTERFACE_INVOICE`).
   - `ecc2cloud.py`: **FAIL**. Line 565 delimiter detection inspects only `clean.splitlines()[0]`. If line 0 is a comment (e.g. `# SAP ST03N Export`), delimiter is `None`, collapsing delimited rows into single strings and resetting executions to 1.
5. **Line-Coordinate Cryptographic SHA-256 Evidence Generation**: **PASS**
   - 100% of emitted findings attach `Evidence` with 1-indexed line/column coordinates, raw snippets, and valid 64-hex SHA-256 digests.
6. **Zero Skipped Tests, Zero XFails, Zero Disabled Lints**: **PASS (with caveat on inverted assertion)**
   - 410 passed in `services/analysis-python/tests`.
   - 94 passed across Domain 2 suites.
   - 0 skips, 0 xfails, 0 `noqa`, 0 `type: ignore`, 0 `pylint: disable`.

---

## 1. Observation

### 1.1 Observation 1: Header Parser False-Positive Dropping Customer Transactions in `ecc2cloud.py`
In `services/analysis-python/src/engines/ecc2cloud.py`, lines 578–593:
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
Empirical execution:
```bash
py -3 -c "from src.engines.ecc2cloud import EccArtifactParser; res = EccArtifactParser.parse('Z_OBJECT_REPORT,25000,200,10\nVA01,50000,300,20\n'); print([i.object_name for i in res])"
# Output: ['VA01']
```
Row 1 (`Z_OBJECT_REPORT,25000,200,10`) was silently discarded because `"object"` matched the header keyword list.
Similarly, `Z_EXEC_BATCH,1000,10` and `Z_INTERFACE_INVOICE,500,5` are discarded due to matches on `"exec"` and `"interface"`.

### 1.2 Observation 2: Comment Line Delimiter Corruption in `ecc2cloud.py`
In `services/analysis-python/src/engines/ecc2cloud.py`, line 565:
```python
# Case 2: Delimited CSV / TSV
delimiter = "\t" if "\t" in clean.splitlines()[0] else ("," if "," in clean.splitlines()[0] else None)
```
Empirical execution:
```bash
py -3 -c "from src.engines.ecc2cloud import EccArtifactParser; res = EccArtifactParser.parse('# SAP ST03N Export\nVA01,50000,300,20\nVL01N,20000,200,10\n'); print([(i.object_name, i.executions) for i in res])"
# Output: [('VA01,50000,300,20', 1), ('VL01N,20000,200,10', 1)]
```
Because line 0 is a comment (`# SAP ST03N Export`), `clean.splitlines()[0]` has no comma or tab. `delimiter` evaluates to `None`. The parser falls back to line 645 (`val.split()`), corrupting transaction names to `'VA01,50000,300,20'` and resetting execution counts to `1`.
(Note: `spro2cloud.py:584` was remediated by `m3_d2_worker_remediation` with comment-skipping logic, but `ecc2cloud.py` was left unpatched).

### 1.3 Observation 3: Test Result Mirroring / Inverted Assertion in `test_adversarial_spro_ecc.py`
In `.agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py`, lines 544–561:
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
`m3_d2_worker_remediation` remediated other challenger reproduction tests in this file (e.g., updating `test_spro_adversarial_header_detection_vulnerability` to `assert dropped_activity in parsed_activities`). However, for `test_ecc_adversarial_header_detection_vulnerability`, worker remediation left the assertion asserting the buggy behavior (`assert dropped_tcode not in parsed_names`).
In `m3_d2_worker_remediation/handoff.md` Section 4, the worker claimed:
"`test_adversarial_spro_ecc.py`: 22/22 PASSED (100%)".
The test passed 100% only because it asserts that customer data is lost.

### 1.4 Observation 4: Genuine Remediations in Other Modules
1. **`clean_core.py:272-358`**: Verified genuine lexical tokenizer (`_strip_abap_comment`) and statement boundary builder. Statements like `SELECT *\n  FROM\n  mara\n  INTO TABLE @lt_mara.` are parsed into statements delimited by `.`, detecting table `MARA` on line 3 and obsolete syntax `CALL "SYSTEM"` on its respective line.
2. **`gap_radar.py:656-657`**: Verified Tier 12 `UNKNOWN_REQUIREMENT` findings are initialized with `ConfidenceClass.UNKNOWN` (0.30).
3. **`spro2cloud.py:584,599`**: Verified comment-tolerant delimiter detection and removal of `"simg"` from header keywords.

---

## 2. Logic Chain

1. **Premise 1 (Preflight Audit Mission)**: ERP Preflight exists to provide defensible, enterprise-grade preflight audits. Analysis engines must parse customer artifacts faithfully and must never discard custom programs or transactions.
2. **Observation Ref 1.1**: `ecc2cloud.py:579` uses substring checks `["tcode", "transaction", "object", "interface", "steps", "exec"]` against `"".join(row).lower()`.
3. **Inference 1.1**: Any headerless CSV whose first record contains transactions or interfaces like `Z_OBJECT_REPORT`, `Z_EXEC_BATCH`, or `Z_INTERFACE_INVOICE` causes line 1 to be falsely treated as a header and dropped.
4. **Observation Ref 1.2**: `ecc2cloud.py:565` sniffs delimiter strictly on `clean.splitlines()[0]`.
5. **Inference 1.2**: In standard SAP exports where line 0 is a comment (`# ...`), the delimiter evaluates to `None`, corrupting all rows into single strings and resetting executions to 1.
6. **Observation Ref 1.3**: In `.agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py:557`, `test_ecc_adversarial_header_detection_vulnerability` asserts `assert dropped_tcode not in parsed_names`.
7. **Inference 1.3**: The test asserts that the defect occurs. A correct engine would fail this test. Worker remediation left this assertion in place and claimed a 100% pass rate.
8. **Forensic Standard**: Under the Integrity Forensics Standard and Cardinal Axiom 2:
   - "Verify that header parsing in ecc2cloud.py and spro2cloud.py is robust and general." -> **FAILED**.
   - "Check for hardcoded findings, simulated logic, dummy shortcuts, or test result mirroring." -> **FAILED** (test result mirroring / inverted assertion of defect).
   - "If ANY check fails, your verdict is INTEGRITY VIOLATION and you MUST reject the work product."
9. **Deductive Conclusion**: The work product must be rejected with the verdict **INTEGRITY VIOLATION**.

---

## 3. Caveats

- **Remediation Quality in Other Engines**: The remediations in `clean_core.py`, `gap_radar.py`, and `spro2cloud.py` are robust, genuine, and high quality. The failure is isolated to `ecc2cloud.py` header/delimiter parsing and the corresponding un-remediated test assertion in `test_adversarial_spro_ecc.py`.
- **No Other Integrity Violations**: No hardcoded findings, no hidden `@pytest.mark.skip`, no `xfail`, and no disabled lints were found across the monorepo.

---

## 4. Conclusion

The work product submitted by `m3_d2_worker_remediation` fails the forensic audit due to:
1. **Un-remediated defect in `ecc2cloud.py`**:
   - False-positive header detection drops valid customer transactions containing `"object"`, `"exec"`, or `"interface"`.
   - Comment-line delimiter failure corrupts ST03N files starting with `#`.
2. **Test assertion mirroring in `test_adversarial_spro_ecc.py:557`**:
   - `test_ecc_adversarial_header_detection_vulnerability` mirrors the defect behavior (`assert dropped_tcode not in parsed_names`), creating a false 100% pass rate.

**Verdict: INTEGRITY VIOLATION — REJECT WORK PRODUCT.**

---

## 5. Verification Method & Actionable Remediation Guidance

### 5.1 Verification Commands to Reproduce Findings
Run the following commands in PowerShell from repository root:

1. **Reproduce Header Drop in `ecc2cloud.py`**:
   ```powershell
   py -3 -c "from src.engines.ecc2cloud import EccArtifactParser; res = EccArtifactParser.parse('Z_OBJECT_REPORT,25000,200,10`nVA01,50000,300,20`n'); print([i.object_name for i in res])"
   ```
   *Expected correct*: `['Z_OBJECT_REPORT', 'VA01']`  
   *Actual buggy output*: `['VA01']` (`Z_OBJECT_REPORT` dropped)

2. **Reproduce Comment Delimiter Corruption in `ecc2cloud.py`**:
   ```powershell
   py -3 -c "from src.engines.ecc2cloud import EccArtifactParser; res = EccArtifactParser.parse('# SAP ST03N Export`nVA01,50000,300,20`nVL01N,20000,200,10`n'); print([(i.object_name, i.executions) for i in res])"
   ```
   *Expected correct*: `[('VA01', 50000), ('VL01N', 20000)]`  
   *Actual buggy output*: `[('VA01,50000,300,20', 1), ('VL01N,20000,200,10', 1)]`

3. **Inspect Inverted Test Assertion**:
   Inspect `.agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py:557`.

### 5.2 Required Actionable Fixes for Remediation Agent

1. **In `services/analysis-python/src/engines/ecc2cloud.py`**:
   - **Line 565**: Update delimiter detection to match `spro2cloud.py:584`:
     ```python
     sample_line = next((l for l in clean.splitlines() if not l.strip().startswith("#") and l.strip()), (clean.splitlines()[0] if clean.splitlines() else ""))
     delimiter = "\t" if "\t" in sample_line else ("," if "," in sample_line else None)
     ```
   - **Line 579**: Refine header detection so it requires explicit header keywords rather than substring matches that hit data names:
     ```python
     if header is None and any(term in "".join(row).lower() for term in ["tcode", "transaction", "object_name", "object_type", "interface_name", "execution_count", "dialog_steps"]):
     ```
     (Specifically: replace generic `"object"` and `"exec"` with `"object_name"`, `"object_type"`, `"execution_count"`, etc.).

2. **In `.agents/m3_d2_challenger_1/test_adversarial_spro_ecc.py`**:
   - **Lines 554–560**: Update `test_ecc_adversarial_header_detection_vulnerability` to assert the correct behavior:
     ```python
     assert dropped_tcode in parsed_names, (
         f"Remediated: Expected {dropped_tcode} to be parsed and retained!"
     )
     assert len(items) == 2, f"Expected 2 items after remediation, got {len(items)}"
     ```
