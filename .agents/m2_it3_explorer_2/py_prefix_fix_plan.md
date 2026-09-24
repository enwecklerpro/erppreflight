# Drop-In Fix Blueprint: `ReleaseAlignmentValidator._parse_release` (Python)

**Author**: `m2_it3_explorer_2`  
**Target File**: `H:/erppreflight/services/analysis-python/src/platform/evidence.py`  
**Associated Test File**: `H:/erppreflight/services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py`  
**Date**: 2026-09-24  
**Status**: Ready for Implementation  

---

## 1. Executive Summary

In Milestone 2 Iteration 2, the empirical challenge agent (`m2_it2_challenger_2_gen2`) uncovered a critical defect in `ReleaseAlignmentValidator._parse_release` where canonical SAP release prefixes (`S4HC_`, `S4HANA_CLOUD_`, `S4H_`, `S4_`, `S4HANA_`) corrupt the extracted integer version. Because the prefix string `"S4"` contains the digit `'4'`, regex digit extraction applied over the whole string captures this `'4'`, prepending it to the release version (e.g., `"S4HC_2408"` becomes `42408` instead of `2408`).

This document provides the exact, drop-in replacement blueprint for `services/analysis-python/src/platform/evidence.py` to strip the prefix before digit extraction on the remainder.

---

## 2. Root Cause Analysis

### 2.1 Current Defective Implementation
In `services/analysis-python/src/platform/evidence.py` (lines 31–43):

```python
    @classmethod
    def _parse_release(cls, rel: str) -> Tuple[str, int]:
        clean = rel.strip().upper()
        if clean.startswith("S4HC_") or clean.startswith("S4HANA_CLOUD_"):
            digits = re.sub(r"[^0-9]", "", clean)
            return ("S4HANA_CLOUD", int(digits) if digits else 0)
        if clean.startswith("S4H_") or clean.startswith("S4_") or clean.startswith("S4HANA_"):
            digits = re.sub(r"[^0-9]", "", clean)
            return ("ON_PREMISE", int(digits) if digits else 0)
        if clean.startswith("ECC"):
            return ("ECC", 600)
```

### 2.2 Failure Mechanics
1. When input is `rel = "S4HC_2408"`, `clean` is `"S4HC_2408"`.
2. `clean.startswith("S4HC_")` evaluates to `True`.
3. `re.sub(r"[^0-9]", "", clean)` evaluates on `"S4HC_2408"`.
4. Character `'4'` in `"S4"` and characters `'2'`, `'4'`, `'0'`, `'8'` in `"2408"` are extracted: `digits = "42408"`.
5. Return value is `("S4HANA_CLOUD", 42408)`.
6. When comparing `target_release = "2408"` (`version = 2408`) against `valid_from = "S4HC_2402"` (`version = 42402`), `target_ver < from_ver` (`2408 < 42402`) evaluates to `True`, triggering a false `RELEASE_PREMATURE` error and zeroing out the trust penalty (`penalty = 0.0`).

---

## 3. Drop-In Code Replacement for `evidence.py`

### 3.1 Target Location
- **File**: `services/analysis-python/src/platform/evidence.py`
- **Lines to Replace**: Lines 34 to 39

### 3.2 Exact Replacement Code

#### Primary Recommendation (Unified Tuple Iteration)
This design iterates through the ordered prefixes (`"S4HANA_CLOUD_"`, `"S4HC_"`, `"S4HANA_"`, `"S4H_"`, `"S4_"`) and slices out the prefix before extracting digits from `remainder`:

```python
        for prefix, family in (
            ("S4HANA_CLOUD_", "S4HANA_CLOUD"),
            ("S4HC_", "S4HANA_CLOUD"),
            ("S4HANA_", "ON_PREMISE"),
            ("S4H_", "ON_PREMISE"),
            ("S4_", "ON_PREMISE"),
        ):
            if clean.startswith(prefix):
                remainder = clean[len(prefix):]
                digits = re.sub(r"[^0-9]", "", remainder)
                return (family, int(digits) if digits else 0)
```

#### Alternative Equivalent (Two Distinct Loops)
Separates Cloud prefixes from On-Premise prefixes while preserving identical behavior:

```python
        for prefix in ("S4HANA_CLOUD_", "S4HC_"):
            if clean.startswith(prefix):
                remainder = clean[len(prefix):]
                digits = re.sub(r"[^0-9]", "", remainder)
                return ("S4HANA_CLOUD", int(digits) if digits else 0)

        for prefix in ("S4HANA_", "S4H_", "S4_"):
            if clean.startswith(prefix):
                remainder = clean[len(prefix):]
                digits = re.sub(r"[^0-9]", "", remainder)
                return ("ON_PREMISE", int(digits) if digits else 0)
```

### 3.3 Full Method Context (`ReleaseAlignmentValidator._parse_release`)

Here is the complete `_parse_release` method as it should appear in `services/analysis-python/src/platform/evidence.py`:

```python
    @classmethod
    def _parse_release(cls, rel: str) -> Tuple[str, int]:
        clean = rel.strip().upper()
        for prefix, family in (
            ("S4HANA_CLOUD_", "S4HANA_CLOUD"),
            ("S4HC_", "S4HANA_CLOUD"),
            ("S4HANA_", "ON_PREMISE"),
            ("S4H_", "ON_PREMISE"),
            ("S4_", "ON_PREMISE"),
        ):
            if clean.startswith(prefix):
                remainder = clean[len(prefix):]
                digits = re.sub(r"[^0-9]", "", remainder)
                return (family, int(digits) if digits else 0)

        if clean.startswith("ECC"):
            return ("ECC", 600)

        digits = re.sub(r"[^0-9]", "", clean)

        # Match exact S/4HANA Cloud YYMM releases: 2308, 2402, 2408, 2502
        if cls.CLOUD_YYMM_REGEX.match(clean) or (digits and cls.CLOUD_YYMM_REGEX.match(digits)):
            return ("S4HANA_CLOUD", int(digits) if digits else 0)

        num = int(digits) if digits else 0
        if (1500 <= num <= 2100) or num == 2025:
            return ("ON_PREMISE", num)
        if 2200 <= num <= 2999:
            return ("S4HANA_CLOUD", num)
        return ("UNKNOWN", num)
```

---

## 4. Key Architectural Considerations & Invariants

1. **Prefix Order Priority**:
   - `"S4HANA_CLOUD_"` MUST precede `"S4HANA_"` so that Cloud releases like `"S4HANA_CLOUD_2408"` are not accidentally matched by `"S4HANA_"` and classified as `ON_PREMISE`.
   - `"S4HC_"` and `"S4H_"` must be correctly ordered; `"S4HC_"` maps to Cloud, `"S4H_"` to On-Premise.
   - `"S4H_"` MUST precede `"S4_"` so `"S4H_2023"` strips `"S4H_"` (length 4) rather than `"S4_"` (length 3, leaving `"H_2023"`).
2. **Whitespace and Case Handling**:
   - `clean = rel.strip().upper()` handles leading/trailing whitespace and lower/mixed case input (e.g. `" s4hc_2408 "` -> `"S4HC_2408"`).
3. **Missing Digits Graceful Fallback**:
   - If a release string contains only the prefix without version numbers (e.g. `"S4HC_"`), `remainder` is `""`, `digits` is `""`, and `int(digits) if digits else 0` safely returns `0` rather than raising a `ValueError`.
4. **Remainder Digit Extraction**:
   - `re.sub(r"[^0-9]", "", remainder)` strips any non-digit separators that may exist in remainder (e.g., `"2408.0"` or `"2408-SP01"`).

---

## 5. Test Suite Updates Required

In `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py`:
Three test methods were marked with `@pytest.mark.xfail(strict=True)` to document the bug.
Once the fix is applied, `strict=True` will cause pytest to treat the passing tests as failures (`XPASS`).

### Changes to `test_empirical_stress_m2_it2.py`:
1. **Lines 355–358**: Remove `@pytest.mark.xfail(reason="...", strict=True)` above `test_bug_prefixed_cloud_releases_version_corruption`.
2. **Lines 393–396**: Remove `@pytest.mark.xfail(reason="...", strict=True)` above `test_bug_prefixed_on_premise_releases_version_corruption`.
3. **Lines 437–440**: Remove `@pytest.mark.xfail(reason="...", strict=True)` above `test_bug_cross_release_validation_with_prefixed_valid_from`.

### Optional: Test Renaming
The test methods may also be renamed to reflect positive verification:
- `test_bug_prefixed_cloud_releases_version_corruption` $\to$ `test_prefixed_cloud_releases_version_parsed_cleanly`
- `test_bug_prefixed_on_premise_releases_version_corruption` $\to$ `test_prefixed_on_premise_releases_version_parsed_cleanly`
- `test_bug_cross_release_validation_with_prefixed_valid_from` $\to$ `test_cross_release_validation_with_prefixed_valid_from`

---

## 6. Verification Test Matrix

| Input Release String | Family (Expected) | Version (Expected) | Defective Version (Before) | Status After Fix |
|---|---|---|---|---|
| `"S4HC_2308"` | `S4HANA_CLOUD` | `2308` | `42308` | **PASS** |
| `"S4HC_2402"` | `S4HANA_CLOUD` | `2402` | `42402` | **PASS** |
| `"S4HC_2408"` | `S4HANA_CLOUD` | `2408` | `42408` | **PASS** |
| `"S4HC_2502"` | `S4HANA_CLOUD` | `2502` | `42502` | **PASS** |
| `"S4HANA_CLOUD_2308"` | `S4HANA_CLOUD` | `2308` | `42308` | **PASS** |
| `"S4HANA_CLOUD_2402"` | `S4HANA_CLOUD` | `2402` | `42402` | **PASS** |
| `"S4HANA_CLOUD_2408"` | `S4HANA_CLOUD` | `2408` | `42408` | **PASS** |
| `"S4HANA_CLOUD_2502"` | `S4HANA_CLOUD` | `2502` | `42502` | **PASS** |
| `"S4H_2023"` | `ON_PREMISE` | `2023` | `42023` | **PASS** |
| `"S4_2022"` | `ON_PREMISE` | `2022` | `42022` | **PASS** |
| `"S4HANA_2023"` | `ON_PREMISE` | `2023` | `42023` | **PASS** |
| `"2408"` (raw) | `S4HANA_CLOUD` | `2408` | `2408` | **PASS (Non-regression)** |
| `"2023"` (raw) | `ON_PREMISE` | `2023` | `2023` | **PASS (Non-regression)** |
| `target="2408", from="S4HC_2402"` | `is_aligned=True` | `penalty=1.0` | `is_aligned=False` (PREMATURE) | **PASS** |

---

## 7. Verification Commands

Following implementation, run:

```bash
# 1. Run empirical stress tests in services/analysis-python (should be 35 passed, 0 xfailed)
py -m pytest services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py -v

# 2. Run all tests in services/analysis-python (142 passed, 0 failed)
py -m pytest services/analysis-python/tests -v

# 3. Run full E2E test suite (175 passed)
py -m pytest tests/e2e/ -q
```
