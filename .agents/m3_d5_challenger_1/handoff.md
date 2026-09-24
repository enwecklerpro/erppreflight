# Adversarial Empirical Challenge Report: Domain 5 Operations & Runtime Preflight Engines (Features 30–35)

- **Agent Name**: `m3_d5_challenger_1`
- **Role**: `critic`, `specialist` (EMPIRICAL CHALLENGER)
- **Working Directory**: `H:/erppreflight/.agents/m3_d5_challenger_1`
- **Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`
- **Target Files Under Review**:
  - `services/analysis-python/src/engines/decommission_audit.py` (Feature 30: DecommissionAuditEngine)
  - `services/analysis-python/src/engines/fiori_auth_guard.py` (Feature 31: Fiori403Engine)
  - `services/analysis-python/src/engines/workflow_deadlock.py` (Feature 32: WorkflowStuckEngine)
  - `services/analysis-python/src/engines/iam_cost_guard.py` (Feature 33: IAMCostEngine)
  - `services/analysis-python/src/engines/account_determination.py` (Feature 34: AccountDeterminationEngine)
  - `services/analysis-python/src/engines/system_refresh_guard.py` (Feature 35: SystemRefreshEngine)
- **Date**: 2026-09-24T12:47:00+02:00
- **Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

### 1.1 Adversarial Test Harness Execution
The adversarial test suite was authored and executed at `.agents/m3_d5_challenger_1/test_adversarial_domain5.py` (31 tests across 4 suites) using Python 3.13:

```powershell
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH
py -3.13 -m pytest .agents/m3_d5_challenger_1/test_adversarial_domain5.py -v
```

**Execution Output**:
```text
=========================== short test summary info ===========================
FAILED .agents/m3_d5_challenger_1/test_adversarial_domain5.py::TestMultiArtifactCorruption::test_fiori403_ragged_truncated_csv_resilience
FAILED .agents/m3_d5_challenger_1/test_adversarial_domain5.py::TestMultiArtifactCorruption::test_workflow_deadlock_ragged_truncated_csv_resilience
FAILED .agents/m3_d5_challenger_1/test_adversarial_domain5.py::TestMultiArtifactCorruption::test_workflow_deadlock_non_numeric_log_retcode_resilience
FAILED .agents/m3_d5_challenger_1/test_adversarial_domain5.py::TestMultiArtifactCorruption::test_account_determination_multi_artifact_without_raw_content
FAILED .agents/m3_d5_challenger_1/test_adversarial_domain5.py::TestMultiArtifactCorruption::test_iam_cost_multi_artifact_without_raw_content
=================== 5 failed, 24 passed, 2 skipped in 0.39s ===================
```

### 1.2 Baseline Suites Execution
1. Worker's unit tests:
   ```powershell
   py -3.13 -m pytest services/analysis-python/tests/unit/test_domain5_engines.py -v
   # Result: 43 passed in 0.09s
   ```
2. Monorepo Python test suite:
   ```powershell
   py -3.13 -m pytest services/analysis-python/tests -q
   # Result: 462 passed in 0.61s
   ```

---

### 1.3 Confirmed Empirical Defects (5 Failures)

#### Defect 1: Uncaught `AttributeError` on Multi-Artifact Request in `AccountDeterminationEngine`
- **File & Line**: `services/analysis-python/src/engines/account_determination.py:277`
- **Verbatim Code**:
  ```python
  275:         if request.raw_content:
  276:             raw_text = request.raw_content
  277:         elif request.artifact_reference and getattr(request.artifact_reference, "content", None):
  278:             raw_text = request.artifact_reference.content
  279:         elif request.configuration and "content" in request.configuration:
  ```
- **Verbatim Error**:
  ```text
  AttributeError: 'AnalysisRequest' object has no attribute 'artifact_reference'
  ```
- **Failing Test**: `TestMultiArtifactCorruption::test_account_determination_multi_artifact_without_raw_content`
- **Root Cause**: `AnalysisRequest` (defined in `services/analysis-python/src/models/request.py:21-37`) defines `artifacts: List[ArtifactReference]`, not `artifact_reference`. When `raw_content` is `None` or empty, evaluating `request.artifact_reference` throws an immediate `AttributeError`.
- **Impact**: Any customer ingestion job that supplies files via `request.artifacts` crashes with an unhandled exception inside `analyze()`, resulting in `AnalysisStatus.FAILED` with 0 findings.

#### Defect 2: Uncaught `AttributeError` on Multi-Artifact Request in `IAMCostEngine`
- **File & Line**: `services/analysis-python/src/engines/iam_cost_guard.py:305`
- **Verbatim Code**:
  ```python
  303:         if request.raw_content:
  304:             raw_text = request.raw_content
  305:         elif request.artifact_reference and getattr(request.artifact_reference, "content", None):
  306:             raw_text = request.artifact_reference.content
  307:         elif request.configuration and "content" in request.configuration:
  ```
- **Verbatim Error**:
  ```text
  AttributeError: 'AnalysisRequest' object has no attribute 'artifact_reference'
  ```
- **Failing Test**: `TestMultiArtifactCorruption::test_iam_cost_multi_artifact_without_raw_content`
- **Root Cause**: Identical to Defect 1. `AnalysisRequest` has no attribute `artifact_reference`.
- **Impact**: Any multi-artifact request submitting `AGR_USERS.csv` or `AGR_1251.csv` via `request.artifacts` without `raw_content` crashes with `AnalysisStatus.FAILED`.

#### Defect 3: Uncaught `AttributeError` on Ragged / Truncated CSV in `Fiori403Engine`
- **File & Line**: `services/analysis-python/src/engines/fiori_auth_guard.py:911`
- **Verbatim Code**:
  ```python
  910:         for idx, row in enumerate(reader, start=2):
  911:             norm_row = {k.strip().lower(): v.strip() for k, v in row.items() if k}
  ```
- **Verbatim Error**:
  ```text
  AttributeError: 'NoneType' object has no attribute 'strip'
  ```
- **Failing Test**: `TestMultiArtifactCorruption::test_fiori403_ragged_truncated_csv_resilience`
- **Root Cause**: In Python's `csv.DictReader`, if a CSV row has fewer columns than the header (a ragged or truncated row), missing values default to `None` (`v = None`). Line 911 filters on `if k`, but fails to guard `if k and v is not None` before calling `v.strip()`.
- **Impact**: Ingestion of customer SICF or SU53 exports containing ragged or incomplete lines causes an unhandled crash of the entire analysis worker.

#### Defect 4: Uncaught `AttributeError` on Ragged / Truncated CSV in `WorkflowStuckEngine`
- **File & Line**: `services/analysis-python/src/engines/workflow_deadlock.py:690`
- **Verbatim Code**:
  ```python
  689:         for idx, row in enumerate(reader, start=2):
  690:             norm_row = {k.strip().lower(): v.strip() for k, v in row.items() if k}
  ```
- **Verbatim Error**:
  ```text
  AttributeError: 'NoneType' object has no attribute 'strip'
  ```
- **Failing Test**: `TestMultiArtifactCorruption::test_workflow_deadlock_ragged_truncated_csv_resilience`
- **Root Cause**: Identical to Defect 3. Line 690 calls `v.strip()` without verifying that `v is not None`.
- **Impact**: Ingestion of `SWWWIHEAD`, `SWWLOGHIST`, or `SWETYPV` CSV extracts with truncated lines crashes the engine.

#### Defect 5: Uncaught `ValueError` on Non-Numeric Retcode in `WorkflowStuckEngine`
- **File & Line**: `services/analysis-python/src/engines/workflow_deadlock.py:709`
- **Verbatim Code**:
  ```python
  708:                         method=norm_row.get("method"),
  709:                         retcode=int(norm_row.get("retcode", 0)),
  710:                         exception=norm_row.get("exception"),
  ```
- **Verbatim Error**:
  ```text
  ValueError: invalid literal for int() with base 10: 'FAIL'
  ```
- **Failing Test**: `TestMultiArtifactCorruption::test_workflow_deadlock_non_numeric_log_retcode_resilience`
- **Root Cause**: Raw CSV text in `retcode` column containing non-numeric strings (e.g. `'FAIL'`, `'ERROR'`, `''`) is passed directly to `int()` without a `try...except ValueError` guard or integer sanity check.
- **Impact**: Workflow execution history logs with non-numeric return codes crash the analysis runner with an uncaught `ValueError`.

---

### 1.4 Algorithmic & Determinism Deficiencies (3 Issues)

#### Issue 6: Spurious False-Positive `WF_DEADLOCK_DETECTED` (Severity: BLOCKER)
- **File & Line**: `services/analysis-python/src/engines/workflow_deadlock.py:397-406`
- **Verbatim Code**:
  ```python
  397:         waiting_items = [h for h in context.headers if h.wi_stat.upper() == "WAITING"]
  398:         if len(waiting_items) >= 2:
  399:             # Check for mutual event wait or deadlocked wait steps
  400:             waiting_ids = [w.wi_id for w in waiting_items]
  401:             findings.append(
  402:                 Finding(
  403:                     rule_id=self.RULE_DEADLOCK_DETECTED,
  404:                     severity=Severity.BLOCKER,
  ```
- **Observation**: The engine triggers a `Severity.BLOCKER` finding `WF_DEADLOCK_DETECTED` solely if `len(waiting_items) >= 2`, without verifying that the waiting items share the same parent workflow (`wi_chckwi`) or have any mutual event wait dependency. Two completely independent approval workflows in status `WAITING` trigger a false-positive deadlock blocker.

#### Issue 7: Role Model `is_emergency: bool` Ignored in `IAMCostEngine`
- **File & Line**: `services/analysis-python/src/engines/iam_cost_guard.py:598-602`
- **Verbatim Code**:
  ```python
  598:                 is_emergency_role = (
  599:                     "EMERGENCY" in rname.upper()
  600:                     or "FIRECALL" in rname.upper()
  601:                     or "SUPERUSER" in rname.upper()
  602:                 )
  ```
- **Observation**: `BusinessRoleModel` defines `is_emergency: bool = False` (Line 89). However, Rule 4 completely ignores `role.is_emergency` and only checks substring presence of `"EMERGENCY"`, `"FIRECALL"`, or `"SUPERUSER"` in the role name. An emergency role named `Z_FIREC_ADMIN` with `is_emergency=True` is bypassed.

#### Issue 8: Non-Deterministic `date.today()` Invocation in `DecommissionAuditEngine`
- **File & Line**: `services/analysis-python/src/engines/decommission_audit.py:687, 696`
- **Verbatim Code**:
  ```python
  687:                 days_since_active = max(0, (date.today() - p_date).days)
  ...
  696:                         diff = max(0, (date.today() - d_parsed).days)
  ```
- **Observation**: Calling `date.today()` violates Cardinal Axiom 2, Point 4 ("Deterministic Analysis: Pure, rule-based AST, DOM, or tabular evaluations... Strictly Prohibited: Calling system clocks (datetime.now())..."). Two assessments on different days will produce divergent `daysSinceLastActive`, shifting risk scores across the 7-day, 30-day, or 90-day threshold.

---

## 2. Logic Chain

1. **Premise 1 (Cardinal Axiom 2 & Ingestion Hardening)**:
   - `AGENTS.md` Section 1 mandates Cardinal Axiom 2: Point 3 ("Deterministic Parser: Hardened, memory-bounded artifact parsing... rejecting malformed inputs"), Point 4 ("Pure Rule Evaluation: Zero probabilistic drift. Two identical artifact inputs must produce byte-for-byte identical findings"), and Point 10 ("Property-based tests... proving the engine fails closed without uncaught crashes").
   - Customer-provided extracts in enterprise migrations regularly contain malformed rows, missing columns, non-numeric return codes, and multi-file structures.

2. **Premise 2 (Crash Propagation to Job Queue)**:
   - When an engine raises an uncaught exception (`AttributeError` or `ValueError`), `EngineRunner.execute` catches the exception and returns `AnalysisStatus.FAILED` with 0 findings.
   - The analysis job fails completely; stakeholders receive no assessment report.

3. **Premise 3 (Direct Trace from Observations)**:
   - Observation 1.3 (Defects 1 & 2): `AccountDeterminationEngine` and `IAMCostEngine` fail on line 277 and line 305 because `request.artifact_reference` does not exist on `AnalysisRequest`. In multi-artifact mode, this crashes 100% of runs.
   - Observation 1.3 (Defects 3 & 4): `Fiori403Engine` and `WorkflowStuckEngine` fail on line 911 and line 690 because `v.strip()` is called on `None` when CSV lines have missing values.
   - Observation 1.3 (Defect 5): `WorkflowStuckEngine` fails on line 709 because non-numeric strings are passed to `int()`.
   - Observation 1.4 (Issues 6, 7, 8): Naive deadlock heuristics, unconsulted model flags, and system clock invocations introduce false positives and non-deterministic scoring drift.

---

## 3. Caveats

1. **Overall Engine Capabilities**: The business logic across all 6 engines is extensive, release-aware, and adheres to SAP clean core taxonomy.
2. **Cryptographic Grounding Verified**: All 6 engines passed rigorous SHA-256 evidence integrity checks: every emitted finding attaches valid SHA-256 hashes, line numbers $\ge 1$, non-empty snippets, and valid confidence classifications.
3. **High Volume Performance**: Scalability tests confirmed that `DecommissionAuditEngine` evaluates 2,000 users and 1,000 jobs in $< 0.2\text{s}$, and `AccountDeterminationEngine` evaluates 40 combinatorial condition records in $< 0.05\text{s}$.
4. **Scoping**: Remediating these 5 crash defects and 3 design issues requires targeted adjustments in the 5 affected engine files.

---

## 4. Conclusion

- **Verdict**: **REQUEST_CHANGES**
- Domain 5 cannot be certified under Cardinal Axiom 2 until the 5 uncaught crash defects are remediated:
  1. `AccountDeterminationEngine`: Replace `request.artifact_reference` with `request.artifacts` inspection.
  2. `IAMCostEngine`: Replace `request.artifact_reference` with `request.artifacts` inspection.
  3. `Fiori403Engine`: Guard CSV row items with `if k and v is not None: v.strip()`.
  4. `WorkflowStuckEngine`: Guard CSV row items with `if k and v is not None: v.strip()`.
  5. `WorkflowStuckEngine`: Guard integer conversions with `try...except ValueError`.
  6. Address algorithmic issues: refine deadlock detection to check shared parent workflows, check `role.is_emergency` flag, and allow reference date configuration instead of unconditional `date.today()`.

---

## 5. Verification Method

To independently reproduce all findings, execute the following commands in PowerShell from repository root:

### 1. Run Adversarial Challenge Suite (Reproduces the 5 Defects)
```powershell
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH
py -3.13 -m pytest .agents/m3_d5_challenger_1/test_adversarial_domain5.py -v
```
*Current Result*: `5 failed, 24 passed, 2 skipped in 0.39s`

### 2. Run Domain 5 Baseline Suite
```powershell
py -3.13 -m pytest services/analysis-python/tests/unit/test_domain5_engines.py -v
```
*Current Result*: `43 passed in 0.09s`

### 3. Run Full Python Test Suite
```powershell
py -3.13 -m pytest services/analysis-python/tests -q
```
*Current Result*: `462 passed in 0.61s`

### Invalidation Conditions
- A pull request or remediation that updates the 5 engine files so that `py -3.13 -m pytest .agents/m3_d5_challenger_1/test_adversarial_domain5.py -v` passes with 0 failures will invalidate this `REQUEST_CHANGES` verdict and qualify Domain 5 for `APPROVE`.
