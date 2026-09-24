# Blueprint: Test Harness Updates for SAP Release Prefix Stripping Fix

**Document Version**: 1.0.0  
**Author**: `m2_it3_explorer_3`  
**Target Milestone**: `m2_it3`  
**Scope**: Adversarial test harness alignment for Python (`test_empirical_stress_m2_it2.py`) and TypeScript API (`empirical_stress_m2_it2.spec.ts`) following resolution of the prefix stripping defect in `ReleaseAlignmentValidator`.

---

## 1. Executive Summary & Defect Context

In Milestone 2 Iteration 2 (Challenger 2), an empirical investigation identified a version arithmetic corruption defect in `ReleaseAlignmentValidator` across both TypeScript (`packages/evidence/src/release-alignment.ts`) and Python (`services/analysis-python/src/platform/evidence.py`).

### The Root Cause
When parsing SAP release identifiers with standard prefixes (such as `S4HC_2408`, `S4HANA_CLOUD_2408`, `S4H_2023`, `S4_2022`, `S4HANA_2023`), the validator executed global regex digit stripping (`re.sub(r"[^0-9]", "", clean)` or `clean.replace(/[^0-9]/g, '')`) over the entire release string without first removing the prefix token. Because the prefix `"S4"` contains the ASCII digit `'4'`, the integer version was prepended with `4`:
- `"S4HC_2408"` parsed to `version = 42408` (expected `2408`).
- `"S4H_2023"` parsed to `version = 42023` (expected `2023`).
- When validating a target release `target_release="2408"` (version `2408`) against `valid_from="S4HC_2402"` (version `42402`), the comparator evaluated `2408 < 42402` as true, improperly issuing `RELEASE_PREMATURE` with a zero trust score (`penalty = 0.0`) instead of `RELEASE_ALIGNED` (`penalty = 1.0`).

### The Challenge Test Harness State
To maintain strict reproducibility and prevent CI failures while documenting the defect, Challenger 2 established:
1. **Python (`test_empirical_stress_m2_it2.py`)**: Marked 3 test methods (comprising 11 parameterized test executions) with `@pytest.mark.xfail(strict=True, reason="BUG: ReleaseAlignmentValidator does not strip prefix...")`.
2. **TypeScript (`empirical_stress_m2_it2.spec.ts`)**: Created test `it('EMPIRICAL BUG REPRODUCTION: Demonstrates prefix version corruption in parseRelease and validate')` asserting the corrupted values (`42408`, `42023`, `isAligned: false`, `status: 'RELEASE_PREMATURE'`).

### Objective
Provide the authoritative implementation blueprint and machine-applicable diffs to transition both test harnesses from bug reproduction / xfail status to positive assertion of correct behavior once the prefix stripping fix is in place.

---

## 2. Implementation Context & Critical Code Fix Clarification

Before updating the test harnesses, the underlying source code in `packages/evidence/src/release-alignment.ts` and `services/analysis-python/src/platform/evidence.py` must be updated.

> **CRITICAL WARNING FOR IMPLEMENTERS**:  
> In `H:/erppreflight/.agents/m2_it2_challenger_2_gen2/handoff.md`, section 4 suggested a TypeScript snippet using:
> `const isCloud = prefix.startsWith('S4HC');` inside a unified prefix loop.  
> **This contains a latent bug**: `'S4HANA_CLOUD_'` does **NOT** start with `'S4HC'` (its 5th character is `'A'`, not `'C'`). If implemented that way, `'S4HANA_CLOUD_2408'` would be incorrectly assigned `family: 'ON_PREMISE'`.  
> The correct, robust implementation separates the Cloud and On-Premise prefix iterations or checks `['S4HC_', 'S4HANA_CLOUD_']` explicitly.

### Authoritative Implementation Reference

#### Python (`services/analysis-python/src/platform/evidence.py`, lines 32–42)
```python
    @classmethod
    def _parse_release(cls, rel: str) -> Tuple[str, int]:
        clean = rel.strip().upper()

        # 1. Explicit S/4HANA Cloud prefixes (strip prefix before digit extraction)
        for prefix in ("S4HANA_CLOUD_", "S4HC_"):
            if clean.startswith(prefix):
                remainder = clean[len(prefix):]
                digits = re.sub(r"[^0-9]", "", remainder)
                return ("S4HANA_CLOUD", int(digits) if digits else 0)

        # 2. Explicit S/4HANA On-Premise prefixes (checked after S4HANA_CLOUD_)
        for prefix in ("S4HANA_", "S4H_", "S4_"):
            if clean.startswith(prefix):
                remainder = clean[len(prefix):]
                digits = re.sub(r"[^0-9]", "", remainder)
                return ("ON_PREMISE", int(digits) if digits else 0)

        # 3. SAP ECC prefix
        if clean.startswith("ECC"):
            return ("ECC", 600)
        ...
```

#### TypeScript (`packages/evidence/src/release-alignment.ts`, lines 28–42)
```typescript
  public static parseRelease(rel: string): ReleaseParseResult {
    const clean = rel.trim().toUpperCase();

    // 1. Explicit S/4HANA Cloud prefixes (strip prefix before digit extraction)
    for (const prefix of ['S4HANA_CLOUD_', 'S4HC_']) {
      if (clean.startsWith(prefix)) {
        const remainder = clean.substring(prefix.length);
        const numStr = remainder.replace(/[^0-9]/g, '');
        return { family: 'S4HANA_CLOUD', version: parseInt(numStr, 10) || 0 };
      }
    }

    // 2. Explicit S/4HANA On-Premise prefixes (checked after S4HANA_CLOUD_)
    for (const prefix of ['S4HANA_', 'S4H_', 'S4_']) {
      if (clean.startsWith(prefix)) {
        const remainder = clean.substring(prefix.length);
        const numStr = remainder.replace(/[^0-9]/g, '');
        return { family: 'ON_PREMISE', version: parseInt(numStr, 10) || 0 };
      }
    }

    // 3. SAP ECC prefix
    if (clean.startsWith('ECC')) {
      return { family: 'ECC', version: 600 };
    }
    ...
```

---

## 3. Blueprint 1: Python Test Harness Updates

**File Target**: `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py`

### Summary of Changes
1. **Remove `@pytest.mark.xfail(strict=True)`** from `test_bug_prefixed_cloud_releases_version_corruption` (Lines 355–358).
2. **Remove `@pytest.mark.xfail(strict=True)`** from `test_bug_prefixed_on_premise_releases_version_corruption` (Lines 393–396).
3. **Remove `@pytest.mark.xfail(strict=True)`** from `test_bug_cross_release_validation_with_prefixed_valid_from` (Lines 437–440).
4. Update method docstrings to reflect active regression verification.
5. Add assertion for `res.penalty == 1.00` in cross-release validation.

### Detailed Before / After Code Walkthrough

#### 3.1 Method: `test_bug_prefixed_cloud_releases_version_corruption`

**Location**: Lines 355–374  
**Before**:
```python
    @pytest.mark.xfail(
        reason="BUG: ReleaseAlignmentValidator does not strip prefix before regex digit extraction, causing 'S4' to prepend '4' (e.g. S4HC_2408 -> version 42408)",
        strict=True,
    )
    @pytest.mark.parametrize("release_str, expected_ver", [
        ("S4HC_2308", 2308),
        ("S4HC_2402", 2402),
        ("S4HC_2408", 2408),
        ("S4HC_2502", 2502),
        ("S4HANA_CLOUD_2308", 2308),
        ("S4HANA_CLOUD_2402", 2402),
        ("S4HANA_CLOUD_2408", 2408),
        ("S4HANA_CLOUD_2502", 2502),
    ])
    def test_bug_prefixed_cloud_releases_version_corruption(self, release_str, expected_ver):
        """Prefixed S/4HANA Cloud releases currently fail due to '4' in 'S4'."""
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "S4HANA_CLOUD"
        assert ver == expected_ver
```

**After**:
```python
    @pytest.mark.parametrize("release_str, expected_ver", [
        ("S4HC_2308", 2308),
        ("S4HC_2402", 2402),
        ("S4HC_2408", 2408),
        ("S4HC_2502", 2502),
        ("S4HANA_CLOUD_2308", 2308),
        ("S4HANA_CLOUD_2402", 2402),
        ("S4HANA_CLOUD_2408", 2408),
        ("S4HANA_CLOUD_2502", 2502),
    ])
    def test_bug_prefixed_cloud_releases_version_corruption(self, release_str, expected_ver):
        """Prefixed S/4HANA Cloud releases parse version correctly without corruption from 'S4' prefix."""
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "S4HANA_CLOUD"
        assert ver == expected_ver
```

#### 3.2 Method: `test_bug_prefixed_on_premise_releases_version_corruption`

**Location**: Lines 393–406  
**Before**:
```python
    @pytest.mark.xfail(
        reason="BUG: ReleaseAlignmentValidator does not strip prefix before regex digit extraction, causing 'S4' to prepend '4' (e.g. S4H_2023 -> version 42023)",
        strict=True,
    )
    @pytest.mark.parametrize("release_str, expected_ver", [
        ("S4H_2023", 2023),
        ("S4_2022", 2022),
    ])
    def test_bug_prefixed_on_premise_releases_version_corruption(self, release_str, expected_ver):
        """Prefixed S/4HANA On-Premise releases fail due to '4' in 'S4'."""
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "ON_PREMISE"
        assert ver == expected_ver
```

**After**:
```python
    @pytest.mark.parametrize("release_str, expected_ver", [
        ("S4H_2023", 2023),
        ("S4_2022", 2022),
        ("S4HANA_2023", 2023),
    ])
    def test_bug_prefixed_on_premise_releases_version_corruption(self, release_str, expected_ver):
        """Prefixed S/4HANA On-Premise releases parse version correctly without corruption from 'S4' prefix."""
        fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
        assert fam == "ON_PREMISE"
        assert ver == expected_ver
```

*Note*: Adding `("S4HANA_2023", 2023)` provides complete parity with the `S4HANA_` prefix branch.

#### 3.3 Method: `test_bug_cross_release_validation_with_prefixed_valid_from`

**Location**: Lines 437–446  
**Before**:
```python
    @pytest.mark.xfail(
        reason="BUG: ReleaseAlignmentValidator.validate('2408', valid_from='S4HC_2402') fails because '42402' > '2408'",
        strict=True,
    )
    def test_bug_cross_release_validation_with_prefixed_valid_from(self):
        """Cross-release compatibility fails when valid_from has S4HC_ prefix."""
        res = ReleaseAlignmentValidator.validate(target_release="2408", valid_from="S4HC_2402")
        assert res.is_aligned is True, f"Expected 2408 to be aligned with S4HC_2402, got status={res.status}"
        assert res.status == "RELEASE_ALIGNED"
```

**After**:
```python
    def test_bug_cross_release_validation_with_prefixed_valid_from(self):
        """Cross-release compatibility succeeds when valid_from has S4HC_ prefix."""
        res = ReleaseAlignmentValidator.validate(target_release="2408", valid_from="S4HC_2402")
        assert res.is_aligned is True, f"Expected 2408 to be aligned with S4HC_2402, got status={res.status}"
        assert res.status == "RELEASE_ALIGNED"
        assert res.penalty == 1.00
```

### Expected Pytest Output Metrics
- Baseline (M2-IT2): `24 passed, 11 xfailed in 0.18s`
- After Fix (with additional `S4HANA_2023` parameter): `36 passed, 0 xfailed, 0 failed in ~0.20s` (or `35 passed` if keeping original 2 on-prem parameters).

---

## 4. Blueprint 2: TypeScript Vitest Harness Updates

**File Target**: `apps/api/test/empirical_stress_m2_it2.spec.ts`

### Summary of Changes
1. **Update assertions** in `it('EMPIRICAL BUG REPRODUCTION: Demonstrates prefix version corruption in parseRelease and validate')` (Lines 294–309):
   - Change `expect(resS4HC.version).toBe(42408)` to `expect(resS4HC.version).toBe(2408)`.
   - Change `expect(resS4H.version).toBe(42023)` to `expect(resS4H.version).toBe(2023)`.
   - Change `expect(crossVal.isAligned).toBe(false)` to `expect(crossVal.isAligned).toBe(true)`.
   - Change `expect(crossVal.status).toBe('RELEASE_PREMATURE')` to `expect(crossVal.status).toBe('RELEASE_ALIGNED')`.
   - Add `expect(crossVal.penalty).toBe(1.0)`.
   - Replace `expect(crossVal.message).toContain('Feature requires release >= S4HC_2402, but target is 2408.')` with `expect(crossVal.message).toBe('Evidence is release-aligned.')`.
2. **Add comprehensive prefix matrix test** to cover all supported prefix variants (`S4HC_`, `S4HANA_CLOUD_`, `S4H_`, `S4_`, `S4HANA_`).

### Detailed Before / After Code Walkthrough

#### 4.1 Method: `EMPIRICAL BUG REPRODUCTION: Demonstrates prefix version corruption in parseRelease and validate`

**Location**: Lines 294–309  
**Before**:
```typescript
    it('EMPIRICAL BUG REPRODUCTION: Demonstrates prefix version corruption in parseRelease and validate', () => {
      // Demonstrates that S4HC_2408 yields 42408 instead of 2408
      const resS4HC = ReleaseAlignmentValidator.parseRelease('S4HC_2408');
      expect(resS4HC.family).toBe('S4HANA_CLOUD');
      expect(resS4HC.version).toBe(42408); // Bug: 42408 instead of 2408

      const resS4H = ReleaseAlignmentValidator.parseRelease('S4H_2023');
      expect(resS4H.family).toBe('ON_PREMISE');
      expect(resS4H.version).toBe(42023); // Bug: 42023 instead of 2023

      // Consequently, validating target 2408 against validFrom S4HC_2402 erroneously fails with RELEASE_PREMATURE
      const crossVal = ReleaseAlignmentValidator.validate('2408', 'S4HC_2402');
      expect(crossVal.isAligned).toBe(false); // Bug: false instead of true
      expect(crossVal.status).toBe('RELEASE_PREMATURE');
      expect(crossVal.message).toContain('Feature requires release >= S4HC_2402, but target is 2408.');
    });
```

**After**:
```typescript
    it('EMPIRICAL BUG REPRODUCTION: Demonstrates prefix version corruption in parseRelease and validate', () => {
      // Confirms that S4HC_2408 correctly parses to version 2408 without prefix digit corruption
      const resS4HC = ReleaseAlignmentValidator.parseRelease('S4HC_2408');
      expect(resS4HC.family).toBe('S4HANA_CLOUD');
      expect(resS4HC.version).toBe(2408);

      // Confirms that S4H_2023 correctly parses to version 2023 without prefix digit corruption
      const resS4H = ReleaseAlignmentValidator.parseRelease('S4H_2023');
      expect(resS4H.family).toBe('ON_PREMISE');
      expect(resS4H.version).toBe(2023);

      // Validating target 2408 against validFrom S4HC_2402 succeeds as RELEASE_ALIGNED
      const crossVal = ReleaseAlignmentValidator.validate('2408', 'S4HC_2402');
      expect(crossVal.isAligned).toBe(true);
      expect(crossVal.status).toBe('RELEASE_ALIGNED');
      expect(crossVal.penalty).toBe(1.0);
      expect(crossVal.message).toBe('Evidence is release-aligned.');
    });
```

*Note*: If the test description is updated for clarity while preserving backward compatibility, it can be named:
`it('VERIFIED: Strips prefixes correctly in parseRelease and cross-release validate without version corruption', () => {`
However, keeping the original title or updating the title to clearly indicate the verified state is fully documented below in the unified diffs.

#### 4.2 Supplementary Matrix Test for TypeScript (Recommended Extension)
Directly append after the bug resolution test:
```typescript
    it('VERIFIED: Full prefix matrix parses correctly without prepending 4', () => {
      const cloudReleases = [
        'S4HC_2308', 'S4HC_2402', 'S4HC_2408', 'S4HC_2502',
        'S4HANA_CLOUD_2308', 'S4HANA_CLOUD_2402', 'S4HANA_CLOUD_2408', 'S4HANA_CLOUD_2502',
      ];
      for (const rel of cloudReleases) {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe('S4HANA_CLOUD');
        const expected = parseInt(rel.split('_').pop()!, 10);
        expect(res.version).toBe(expected);
      }

      const onPremReleases = [
        { rel: 'S4H_2023', ver: 2023 },
        { rel: 'S4_2022', ver: 2022 },
        { rel: 'S4HANA_2023', ver: 2023 },
      ];
      for (const { rel, ver } of onPremReleases) {
        const res = ReleaseAlignmentValidator.parseRelease(rel);
        expect(res.family).toBe('ON_PREMISE');
        expect(res.version).toBe(ver);
      }
    });
```

### Expected Vitest Output Metrics
- Baseline (M2-IT2): `13 passed in ~14ms`
- After Fix (with supplementary test): `14 passed in ~14ms`

---

## 5. Machine-Applicable Unified Patches

Below are the exact unified diffs ready for application by the implementing agent.

### 5.1 Patch for `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py`

```diff
--- a/services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py
+++ b/services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py
@@ -355,10 +355,6 @@
-    @pytest.mark.xfail(
-        reason="BUG: ReleaseAlignmentValidator does not strip prefix before regex digit extraction, causing 'S4' to prepend '4' (e.g. S4HC_2408 -> version 42408)",
-        strict=True,
-    )
     @pytest.mark.parametrize("release_str, expected_ver", [
         ("S4HC_2308", 2308),
         ("S4HC_2402", 2402),
         ("S4HC_2408", 2408),
         ("S4HC_2502", 2502),
         ("S4HANA_CLOUD_2308", 2308),
         ("S4HANA_CLOUD_2402", 2402),
         ("S4HANA_CLOUD_2408", 2408),
         ("S4HANA_CLOUD_2502", 2502),
     ])
     def test_bug_prefixed_cloud_releases_version_corruption(self, release_str, expected_ver):
-        """Prefixed S/4HANA Cloud releases currently fail due to '4' in 'S4'."""
+        """Prefixed S/4HANA Cloud releases parse version correctly without corruption from 'S4' prefix."""
         fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
         assert fam == "S4HANA_CLOUD"
         assert ver == expected_ver
@@ -393,10 +389,6 @@
-    @pytest.mark.xfail(
-        reason="BUG: ReleaseAlignmentValidator does not strip prefix before regex digit extraction, causing 'S4' to prepend '4' (e.g. S4H_2023 -> version 42023)",
-        strict=True,
-    )
     @pytest.mark.parametrize("release_str, expected_ver", [
         ("S4H_2023", 2023),
         ("S4_2022", 2022),
+        ("S4HANA_2023", 2023),
     ])
     def test_bug_prefixed_on_premise_releases_version_corruption(self, release_str, expected_ver):
-        """Prefixed S/4HANA On-Premise releases fail due to '4' in 'S4'."""
+        """Prefixed S/4HANA On-Premise releases parse version correctly without corruption from 'S4' prefix."""
         fam, ver = ReleaseAlignmentValidator._parse_release(release_str)
         assert fam == "ON_PREMISE"
         assert ver == expected_ver
@@ -437,10 +429,7 @@
-    @pytest.mark.xfail(
-        reason="BUG: ReleaseAlignmentValidator.validate('2408', valid_from='S4HC_2402') fails because '42402' > '2408'",
-        strict=True,
-    )
     def test_bug_cross_release_validation_with_prefixed_valid_from(self):
-        """Cross-release compatibility fails when valid_from has S4HC_ prefix."""
+        """Cross-release compatibility succeeds when valid_from has S4HC_ prefix."""
         res = ReleaseAlignmentValidator.validate(target_release="2408", valid_from="S4HC_2402")
         assert res.is_aligned is True, f"Expected 2408 to be aligned with S4HC_2402, got status={res.status}"
         assert res.status == "RELEASE_ALIGNED"
+        assert res.penalty == 1.00
```

### 5.2 Patch for `apps/api/test/empirical_stress_m2_it2.spec.ts`

```diff
--- a/apps/api/test/empirical_stress_m2_it2.spec.ts
+++ b/apps/api/test/empirical_stress_m2_it2.spec.ts
@@ -294,16 +294,17 @@
     it('EMPIRICAL BUG REPRODUCTION: Demonstrates prefix version corruption in parseRelease and validate', () => {
-      // Demonstrates that S4HC_2408 yields 42408 instead of 2408
+      // Confirms that S4HC_2408 correctly parses to version 2408 without prefix digit corruption
       const resS4HC = ReleaseAlignmentValidator.parseRelease('S4HC_2408');
       expect(resS4HC.family).toBe('S4HANA_CLOUD');
-      expect(resS4HC.version).toBe(42408); // Bug: 42408 instead of 2408
+      expect(resS4HC.version).toBe(2408);
 
+      // Confirms that S4H_2023 correctly parses to version 2023 without prefix digit corruption
       const resS4H = ReleaseAlignmentValidator.parseRelease('S4H_2023');
       expect(resS4H.family).toBe('ON_PREMISE');
-      expect(resS4H.version).toBe(42023); // Bug: 42023 instead of 2023
+      expect(resS4H.version).toBe(2023);
 
-      // Consequently, validating target 2408 against validFrom S4HC_2402 erroneously fails with RELEASE_PREMATURE
+      // Validating target 2408 against validFrom S4HC_2402 succeeds as RELEASE_ALIGNED
       const crossVal = ReleaseAlignmentValidator.validate('2408', 'S4HC_2402');
-      expect(crossVal.isAligned).toBe(false); // Bug: false instead of true
-      expect(crossVal.status).toBe('RELEASE_PREMATURE');
-      expect(crossVal.message).toContain('Feature requires release >= S4HC_2402, but target is 2408.');
+      expect(crossVal.isAligned).toBe(true);
+      expect(crossVal.status).toBe('RELEASE_ALIGNED');
+      expect(crossVal.penalty).toBe(1.0);
+      expect(crossVal.message).toBe('Evidence is release-aligned.');
     });
```

---

## 6. Verification and Regression Testing Sequence

Once the source code fixes and test harness updates are applied, execute the following verification steps in sequence:

```powershell
# Step 1: Run the updated Python adversarial stress test suite
py -m pytest services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py -v
# Expected: 35 (or 36) passed, 0 xfailed, 0 failed in ~0.20s

# Step 2: Run the full Python analysis test suite (confirming 0 regressions across all 18 engines & platform)
py -m pytest services/analysis-python/tests -v
# Expected: 142 passed, 0 xfailed, 0 failed in ~0.35s

# Step 3: Run the updated Vitest adversarial stress test suite
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run test/empirical_stress_m2_it2.spec.ts"
# Expected: 13 (or 14) passed in ~15ms

# Step 4: Run the full API test suite
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api test"
# Expected: 14 test files passed, 237 passed in ~1.2s

# Step 5: Run monorepo typecheck & build
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm run typecheck"
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm run build"

# Step 6: Run full monorepo test pipeline
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm test"
```

---

## 7. Downstream Agent Handoff Checklist

For the implementing agent:
- [ ] Apply the prefix stripping fix in `packages/evidence/src/release-alignment.ts` (ensuring `S4HANA_CLOUD_` is not misclassified as `ON_PREMISE`).
- [ ] Apply the prefix stripping fix in `services/analysis-python/src/platform/evidence.py`.
- [ ] Rebuild `@erppreflight/evidence` (`pnpm --filter @erppreflight/evidence build`).
- [ ] Apply Patch 5.1 to `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it2.py`.
- [ ] Apply Patch 5.2 to `apps/api/test/empirical_stress_m2_it2.spec.ts`.
- [ ] Execute the Verification Sequence in Section 6.
- [ ] Verify 100% test pass rate with 0 xfailures.
