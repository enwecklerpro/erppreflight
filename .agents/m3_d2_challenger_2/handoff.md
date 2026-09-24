# Handoff Report: Adversarial Empirical Stress Test (SAP Gap Radar & Clean Core Object Guard)

**Agent**: `m3_d2_challenger_2`  
**Working Directory**: `H:/erppreflight/.agents/m3_d2_challenger_2`  
**Timestamp**: 2026-09-24T08:44:00+02:00  
**Target Engines**:
1. `services/analysis-python/src/engines/gap_radar.py` (`SAP_GAP_RADAR`)
2. `services/analysis-python/src/engines/clean_core.py` (`CLEAN_CORE_OBJECT_GUARD`)  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

Direct observations obtained by executing the adversarial empirical stress test harness at `.agents/m3_d2_challenger_2/test_adversarial_gap_clean_core.py`:

### 1.1 Test Execution Commands & Verbatim Outputs
Command executed:
```powershell
py -3 -m pytest .agents/m3_d2_challenger_2/test_adversarial_gap_clean_core.py -v
```
Output summary:
```text
======================== 3 failed, 45 passed in 0.29s =========================
```

CLI Diagnostic runner:
```powershell
py -3 .agents/m3_d2_challenger_2/test_adversarial_gap_clean_core.py
```
Output:
```text
================================================================================
RUNNING ADVERSARIAL STRESS TEST SUITE (m3_d2_challenger_2)
================================================================================

[SAP GAP RADAR]: 8 Passed, 1 Failed
  [FAIL] Epistemic Invariant Violation: Finding for UNKNOWN_REQUIREMENT has confidence 'ConfidenceClass.RULE_DERIVED' instead of 'ConfidenceClass.UNKNOWN'. Root Cause: gap_radar.py hardcodes ConfidenceClass.RULE_DERIVED.

[CLEAN CORE OBJECT GUARD]: 9 Passed, 2 Failed
  [FAIL] Vulnerability Confirmed: Clean Core Object Guard fails to detect multi-line split statements! Line-by-line regex is evadable by placing 'FROM' and table name on separate lines.
  [FAIL] Vulnerability Confirmed: 'CALL "SYSTEM"' is evadable because raw_line.split('"')[0] strips double quotes as comments before the obsolete check executes!
================================================================================
```

### 1.2 Verbatim Failure 1: SAP Gap Radar Epistemic Invariant Violation
- **File**: `H:/erppreflight/services/analysis-python/src/engines/gap_radar.py`, lines 650–658:
```python
650:             finding = Finding(
651:                 rule_id=code,
652:                 severity=severity,
653:                 category="MIGRATION_CLEAN_CORE",
654:                 title=title,
655:                 description=desc,
656:                 confidence=ConfidenceClass.RULE_DERIVED,
657:                 confidence_score=0.85 if score > 0 else 1.0,
658:                 remediation=remediation,
```
- **Observed Behavior**: For Tier 12 requirements (`verdict == "UNKNOWN_REQUIREMENT"` and `feasibility_score == 0.40`), `finding.confidence` is initialized as `ConfidenceClass.RULE_DERIVED` with score `0.85`. Because customer evidence is attached, `ConfidenceClassifier.classify(finding)` retains `RULE_DERIVED` (0.85).
- **Test Output**:
```text
AssertionError: Epistemic Invariant Violation: Finding for UNKNOWN_REQUIREMENT has confidence 'ConfidenceClass.RULE_DERIVED' instead of 'ConfidenceClass.UNKNOWN'. Root Cause: gap_radar.py hardcodes ConfidenceClass.RULE_DERIVED.
assert <ConfidenceClass.RULE_DERIVED: 'RULE_DERIVED'> == <ConfidenceClass.UNKNOWN: 'UNKNOWN'>
  - UNKNOWN
  + RULE_DERIVED
```

### 1.3 Verbatim Failure 2: Clean Core Object Guard Multi-Line Split Statement Evasion
- **File**: `H:/erppreflight/services/analysis-python/src/engines/clean_core.py`, lines 275–296:
```python
275:         lines = abap_code.splitlines()
...
279:         for line_no, raw_line in enumerate(lines, start=1):
280:             # Strip trailing comment
281:             code_part = raw_line.split('"')[0].strip()
282:             line = code_part.upper()
...
291:             for tbl, meta in CLASSIC_TABLE_SUCCESSOR_MAP.items():
292:                 pattern = rf"\b(FROM|INTO|UPDATE|MODIFY)\s+{tbl}\b"
293:                 if re.search(pattern, line):
```
- **Observed Behavior**: `CleanCoreEngine.evaluate` parses ABAP strictly line-by-line. When an ABAP statement splits the keyword and the target table across line breaks:
```abap
SELECT *
  FROM
  mara
  INTO TABLE @lt_mara.
```
Neither Line 2 (`FROM`) nor Line 3 (`MARA`) matches `rf"\b(FROM|INTO|UPDATE|MODIFY)\s+MARA\b"`. The parser reports `violations_count: 0`.

### 1.4 Verbatim Failure 3: Clean Core Object Guard Double-Quote Dead Code
- **File**: `H:/erppreflight/services/analysis-python/src/engines/clean_core.py`, lines 281 and 309–311:
```python
281:             code_part = raw_line.split('"')[0].strip()
...
309:                 if stmt == "CALL 'SYSTEM'":
310:                     if "CALL 'SYSTEM'" in line or 'CALL "SYSTEM"' in line:
311:                         is_match = True
```
- **Observed Behavior**: Line 281 unconditionally strips trailing comments via `raw_line.split('"')[0]`. When provided `CALL "SYSTEM" ID 'COMMAND' FIELD lv_cmd.`, `raw_line.split('"')[0]` yields `"CALL "`. The string `"SYSTEM"` is discarded as a comment. The condition `'CALL "SYSTEM"' in line` at line 310 is unreachable dead code, allowing `CALL "SYSTEM"` to pass undetected.

### 1.5 Robust Invariants Verified (45 Passed Tests)
1. **Gap Radar Contradictory Precedence**: All 13 permutations combining Tier 1–10 standard/extensibility keywords with Tier 11 direct DB writes/exits successfully resolved to Tier 11 `BLOCKED_CLEAN_CORE_VIOLATION`, `feasibility_score: 0.00`, `Severity.CRITICAL`.
2. **Gap Radar Ambiguous Fallback**: All 7 arbitrary/generic strings properly fell back to Tier 12 `UNKNOWN_REQUIREMENT`, `feasibility_score: 0.40`, `Severity.MINOR`.
3. **Gap Radar 12-Tier Gradient**: Verified exact feasibility scores across all 12 tiers matching `TIER_METADATA` ($1.00 \to 0.00$).
4. **Clean Core 26 Classic Tables**: 100% detection rate (26/26) with correct C1 successor CDS views (`MARA`, `MAKT`, `MARC`, `MARD`, `VBAK`, `VBAP`, `VBEP`, `BKPF`, `BSEG`, `ACDOCA`, `KNA1`, `KNVV`, `LFA1`, `LFB1`, `EKKO`, `EKPO`, `LIKP`, `LIPS`, `VBRK`, `VBRP`, `BSIS`, `BSAS`, `BSID`, `BSAD`, `BSIK`, `BSAK`).
5. **Clean Core Obsolete Syntax Triggers**: `TABLES`, `FORM`/`PERFORM`, `CALL 'SYSTEM'`, `OPEN DATASET`, `READ DATASET`, `TRANSFER`, `CLOSE DATASET`, `EXEC SQL`, `CALL TRANSACTION`, `SUBMIT` correctly trigger `CLEAN_CORE_OBSOLETE_SYNTAX`.
6. **Clean Core Boundary Invariants**: Mathematical invariant $0.0 \le \text{Compliance \%} \le 100.0$ held across all boundary cases and 50 randomized fuzz trials.

---

## 2. Logic Chain

1. **Premise 1 (Epistemic Trust Standard)**: According to `AGENTS.md` Cardinal Axiom 2 Point 7 and `sap-evidence.md` Section 1.1, findings derived from unknown/unsupported requirements must be assigned `UNKNOWN` (confidence score 0.30). DISPATCH.md explicitly demands: *"Ambiguous requirements (assert fallback to Tier 12 UNKNOWN_REQUIREMENT with 0.30 confidence)"*.
2. **Inference 1**: Observation 1.2 confirms that `gap_radar.py` line 656 assigns `ConfidenceClass.RULE_DERIVED` (score 0.85) to Tier 12 `UNKNOWN_REQUIREMENT` findings. Claiming high epistemic confidence (0.85) on an unknown requirement with a 0.40 feasibility score is an epistemic integrity violation.
3. **Premise 2 (Enterprise Security & Audit Standard)**: According to `AGENTS.md` Cardinal Axiom 2 Point 3, an analysis engine must possess a deterministic, hardened parser capable of evaluating artifacts without being evadable by trivial syntax variations.
4. **Inference 2**: Observations 1.3 and 1.4 confirm that `clean_core.py` parses code strictly line-by-line and splits indiscriminately on `"`. An adversary or standard ABAP code formatter can evade Clean Core violation detection by:
   - Placing `FROM` and the table name on separate lines (`SELECT *\nFROM\nmara`).
   - Using double quotes for kernel C system calls (`CALL "SYSTEM"`).
5. **Inference 3**: These two evasion vectors compromise the audit defense of ERP Preflight, allowing non-compliant ABAP code to receive a 100% clean core compliance score.
6. **Deduction**: Because one architectural contract requirement and two parser security checks failed empirical verification, the engine suite cannot be approved in its current state.

---

## 3. Caveats

- **Scope Boundary**: This review focused strictly on the domain rules and parsing logic of `gap_radar.py` and `clean_core.py`. Underlying shared platform libraries (`ConfidenceClassifier`, `EvidenceEngine`) functioned as designed.
- **Single-Line Accuracy**: When ABAP statements are formatted on single lines without split keywords, Clean Core Object Guard achieves 100% detection accuracy across all 26 tables and 11 obsolete statements.
- **No Production Code Modification**: As mandated by the challenger role constraints, zero edits were made to production engine files. All fixes must be implemented by the worker agent.

---

## 4. Conclusion & Required Changes

**Verdict**: **REQUEST_CHANGES**

To achieve full approval, the following three remediation items must be resolved:

### Change Request 1: Correct Epistemic Confidence on Gap Radar Tier 12 (`gap_radar.py`)
In `services/analysis-python/src/engines/gap_radar.py` line 656:
```python
# Before:
confidence=ConfidenceClass.RULE_DERIVED,
confidence_score=0.85 if score > 0 else 1.0,

# Required Fix:
confidence=ConfidenceClass.UNKNOWN if tier == ResolutionTier.TIER_12_UNKNOWN else ConfidenceClass.RULE_DERIVED,
confidence_score=0.30 if tier == ResolutionTier.TIER_12_UNKNOWN else (0.85 if score > 0 else 1.0),
```

### Change Request 2: Multi-Line Statement Support in Clean Core Guard (`clean_core.py`)
In `services/analysis-python/src/engines/clean_core.py`:
Normalize ABAP statements by joining non-comment lines delimited by periods (`.`) before evaluating table and syntax regexes, or implement multi-line regex search matching `\b(FROM|INTO|UPDATE|MODIFY)\s+(?:\n\s*)*{tbl}\b`.

### Change Request 3: Fix Double-Quote Comment Stripping Bug (`clean_core.py`)
In `services/analysis-python/src/engines/clean_core.py` line 281:
Ensure inline comment stripping only strips `"` when it is outside string quotes, or evaluate `CALL "SYSTEM"` / `CALL 'SYSTEM'` prior to inline comment stripping.

---

## 5. Verification Method

To independently reproduce the empirical findings and verify subsequent fixes:

1. **Run Full Pytest Adversarial Suite**:
```powershell
py -3 -m pytest .agents/m3_d2_challenger_2/test_adversarial_gap_clean_core.py -v
```
Expected result before fix: 45 passed, 3 failed.  
Expected result after fix: 48 passed, 0 failed (100% pass rate).

2. **Run Python CLI Diagnostic Suite**:
```powershell
py -3 .agents/m3_d2_challenger_2/test_adversarial_gap_clean_core.py
```
Expected result before fix: reports 3 specific failures under `[SAP GAP RADAR]` and `[CLEAN CORE OBJECT GUARD]`.  
Expected result after fix: reports `0 Failed` across both engines.

3. **Verify Existing Domain 2 Test Regression**:
```powershell
py -3 -m pytest services/analysis-python/tests/unit/test_domain2_engines.py -v
```
Must maintain 100% pass rate (24/24 passed).
