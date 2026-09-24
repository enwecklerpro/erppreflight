# Handoff Report: Milestone 2 Iteration 3 Cross-Release Alignment Empirical Challenge

**Agent**: `m2_it3_challenger_2`  
**Role**: critic, specialist (Empirical Challenger)  
**Date**: 2026-09-24  
**Target Milestone**: Milestone 2 Iteration 3  
**Verdict**: **REQUEST_CHANGES**  

---

## 1. Observation

### 1.1 Scope & Investigation Targets
- `packages/evidence/src/release-alignment.ts`
- `packages/schemas/src/evidence.ts`
- `services/analysis-python/src/platform/evidence.py`
- Test suites:
  - `services/analysis-python/tests/adversarial/test_empirical_stress_m2_it3_challenger2.py`
  - `apps/api/test/empirical_stress_m2_it3_challenger2.spec.ts`

### 1.2 Direct Empirical Observations by Test Category

#### Category 1: Aligned Releases (`target >= validFrom`)
- **Requirement**: `penalty: 1.00`, `status: 'RELEASE_ALIGNED'`.
- Direct execution in Python and TypeScript:
  - Python: `ReleaseAlignmentValidator.validate('2408', '2402')` $\to$ `status='RELEASE_ALIGNED', is_aligned=True, penalty=1.0, message='Evidence is release-aligned.'`
  - TypeScript: `ReleaseAlignmentValidator.validate('2408', '2402')` $\to$ `status='RELEASE_ALIGNED', isAligned=true, penalty=1.0, message='Evidence is release-aligned.'`
  - Prefixed formats (`S4HC_2408` vs `S4HC_2402`, `S4H_2023` vs `S4H_2020`) evaluate cleanly.
- **Finding**: Aligned evaluations pass specification across both languages.

#### Category 2: Premature Releases (`target < validFrom`)
- **Requirement**: `penalty: 0.40`, `status: 'RELEASE_PREMATURE'`.
- Direct code inspection:
  - In `packages/evidence/src/release-alignment.ts` (lines 92–98):
    ```typescript
    if (this.isSameFamily(target.family, from.family) && target.version < from.version) {
      return {
        status: 'RELEASE_PREMATURE',
        isAligned: false,
        penalty: 0.0,
        message: `Feature requires release >= ${validFrom}, but target is ${targetRelease}.`,
      };
    }
    ```
  - In `services/analysis-python/src/platform/evidence.py` (lines 82–88):
    ```python
    if cls._is_same_family(target_fam, from_fam) and target_ver < from_ver:
        return ReleaseAlignmentResult(
            status="RELEASE_PREMATURE",
            is_aligned=False,
            penalty=0.0,
            message=f"Feature requires release >= {valid_from}, but target is {target_release}.",
        )
    ```
- Direct execution result: Both engines return `penalty: 0.0` instead of the specified `0.40`.

#### Category 3: Future Releases (`target >= validFrom + 2 releases ahead`)
- **Requirement**: `penalty: 0.80`, `status: 'RELEASE_FUTURE'`.
- Direct code inspection:
  - Neither `packages/evidence/src/release-alignment.ts` nor `services/analysis-python/src/platform/evidence.py` contains any logic for calculating release distance or checking whether target is $\ge 2$ releases ahead.
  - In `packages/schemas/src/evidence.ts` (lines 53–59):
    ```typescript
    export const ReleaseAlignmentEnum = z.enum([
      'RELEASE_ALIGNED',
      'RELEASE_PREMATURE',
      'RELEASE_DEPRECATED',
      'FAMILY_MISMATCH',
      'UNKNOWN',
    ]);
    ```
    The status code `RELEASE_FUTURE` is completely absent from the domain schema and validators.
- Direct execution result:
  - `ReleaseAlignmentValidator.validate('S4HC_2502', 'S4HC_2402')` (target 2502 is 2 releases ahead of 2402) returns `status: 'RELEASE_ALIGNED'`, `penalty: 1.0` in both TS and Python.

#### Category 4: Cross-Family Mismatches (e.g. `S4HANA_CLOUD` vs `ON_PREMISE`)
- **Requirement**: `penalty: 0.50`, `status: 'RELEASE_MISMATCH'`.
- Direct code inspection:
  - In `packages/evidence/src/release-alignment.ts` (lines 80–88):
    ```typescript
    // Check family consistency across target and evidence
    if (evidenceFamily && targetFamily && !this.isSameFamily(evidenceFamily, targetFamily)) {
      return {
        status: 'FAMILY_MISMATCH',
        isAligned: false,
        penalty: 0.5,
        message: `Evidence release family (${evidenceFamily}) does not match target family (${targetFamily}).`,
      };
    }
    ```
  - In `services/analysis-python/src/platform/evidence.py` (lines 70–76):
    ```python
    if evidence_family and target_family and not cls._is_same_family(evidence_family, target_family):
        return ReleaseAlignmentResult(
            status="FAMILY_MISMATCH",
            is_aligned=False,
            penalty=0.50,
            message=f"Evidence from {evidence_family} does not apply to {target_family}.",
        )
    ```
- **CRITICAL DEFECT OBSERVED**: When callers invoke `validate(targetRelease, validFrom)` across different families without explicitly providing `targetFamily` and `evidenceFamily` (e.g. `validate("S4HANA_CLOUD_2408", "S4H_2023")` or `validate("2408", "2023")`):
  1. `target` parses to family `S4HANA_CLOUD`, version `2408`.
  2. `from` parses to family `ON_PREMISE`, version `2023`.
  3. Because `evidenceFamily` / `targetFamily` arguments are `null` / `None`, the first block is bypassed.
  4. At the `validFrom` check: `this.isSameFamily(target.family, from.family)` evaluates to `false`.
  5. The check `if (isSameFamily(...) && target.version < from.version)` is skipped!
  6. The function falls through to the end and returns:
     `status: 'RELEASE_ALIGNED'`, `isAligned: true`, `penalty: 1.0`!
  7. Verbatim test output:
     `ReleaseAlignmentValidator.validate('S4HANA_CLOUD_2408', 'S4H_2023')` $\to$ `status='RELEASE_ALIGNED', penalty=1.0`.
  8. This silently gives 100% full trust to On-Premise evidence applied to a Cloud target, violating the Non-Generalization Axiom (`sap-evidence.md` Section 2.2).
- **Naming Discrepancy**: The status code in code is `FAMILY_MISMATCH`, while the user/dispatch specification explicitly designates `RELEASE_MISMATCH`.
- **Message Discrepancy**:
  - TS: `"Evidence release family (ON_PREMISE) does not match target family (S4HANA_CLOUD)."`
  - Python: `"Evidence from ON_PREMISE does not apply to S4HANA_CLOUD."`
  - Deprecated message:
    - TS: `"Feature was deprecated or removed after release 2308. Target is 2408."`
    - Python: `"Feature was deprecated or removed after release 2308. Target: 2408."`

#### Category 5: Malformed / Unrecognized / Empty Release Strings Fallback
- Direct execution:
  - `ReleaseAlignmentValidator.validate('INVALID_XYZ', '2408')`
  - `ReleaseAlignmentValidator.validate('', '')`
- Results in both TypeScript and Python:
  - `parseRelease("INVALID_XYZ")` $\to$ `{ family: 'UNKNOWN', version: 0 }`.
  - Because `isSameFamily('UNKNOWN', 'S4HANA_CLOUD')` is `false`, the checks are bypassed.
  - The function returns: `status: 'RELEASE_ALIGNED'`, `isAligned: true`, `penalty: 1.0`!
- Violation: An unparseable or empty target release is unconditionally granted `RELEASE_ALIGNED` with `1.0` penalty instead of falling back to `UNKNOWN` (penalty `0.30`) per `sap-evidence.md` Sections 2.3 and 7.2.

---

## 2. Logic Chain

1. **Premature Penalty (Observation 1.2.2)**: The specification explicitly calls for `penalty: 0.40` on premature releases (`target < validFrom`). Both TS and Python hardcode `0.0`.
2. **Missing Feature Contract (Observation 1.2.3)**: `RELEASE_FUTURE` with a penalty of `0.80` for releases $\ge 2$ versions ahead is completely absent from the codebase, engine logic, and Zod schemas (`ReleaseAlignmentEnum`). Both implementations fall back to `RELEASE_ALIGNED` (1.00).
3. **Severe Cross-Family Soundness Hole (Observation 1.2.4)**: In standard usage where only `targetRelease` and `validFrom` are supplied (e.g. `validate("S4HC_2408", "S4H_2023")`), the cross-family condition `!isSameFamily(target.family, from.family)` is never checked. Because `isSameFamily` returns `false`, the premature comparison is skipped, and the validator returns `RELEASE_ALIGNED` with `penalty: 1.0`. This breaks Cardinal Axiom 2 and the Non-Generalization Axiom.
4. **Cross-Language Parity (Observation 1.2.4)**: Status codes and error messages between TypeScript and Python drift in wording and punctuation (`Target is` vs `Target:`, `Evidence release family (...) does not match` vs `Evidence from ... does not apply to`).
5. **Absence / Invalid Fallback (Observation 1.2.5)**: Unparseable strings (`UNKNOWN` family) fail the `isSameFamily` predicate, falling through to `RELEASE_ALIGNED` (1.0). The engine must demote unknown releases to `status: 'UNKNOWN'` with penalty `0.30`.

---

## 3. Caveats

- **Scope of Worker Remediation**: The previous agent (`m2_it3_worker_remediation`) was strictly tasked with fixing the prefix digit stripping defect (`'S4HC_2408'` $\to$ `42408`). The worker correctly fixed that specific defect.
- **Specification Ambiguity**: `sap-evidence.md` Section 2.3 states `RELEASE_PREMATURE (Multiplier: 0.0)`, while the user request and dispatch assignment for M2 Iteration 3 explicitly state `Premature: target < validFrom (penalty 0.40, status RELEASE_PREMATURE)` and `Future: target >= validFrom + 2 releases ahead (penalty 0.80, status RELEASE_FUTURE)`. This indicates that M2 Iteration 3 introduces an enhanced release alignment penalty gradient (`1.00`, `0.80`, `0.50`, `0.40`, `0.30`) that has not yet been implemented in `packages/evidence` and `services/analysis-python`.

---

## 4. Conclusion

**Verdict**: **REQUEST_CHANGES**

While the prefix stripping defect was resolved, empirical testing revealed 5 substantial architectural and functional gaps in cross-release alignment and penalty evaluation:
1. **Critical Defect**: `validate(target, valid_from)` fails to detect cross-family release differences unless explicit family parameters are supplied, incorrectly returning `RELEASE_ALIGNED` with 100% confidence (`1.00`).
2. **Missing Feature**: `RELEASE_FUTURE` (target $\ge$ validFrom + 2 releases ahead, penalty `0.80`) is not implemented in either TypeScript or Python.
3. **Penalty Mismatch**: `RELEASE_PREMATURE` yields `0.0` instead of the required `0.40`.
4. **Invalid Release Demotion Failure**: Malformed or unparseable release strings silently pass as `RELEASE_ALIGNED` (penalty `1.00`) instead of being demoted to `UNKNOWN` (penalty `0.30`).
5. **Cross-Language Inconsistency**: Error messages and status string definitions (`RELEASE_MISMATCH` vs `FAMILY_MISMATCH`) differ between TypeScript and Python.

These issues must be remediated in a subsequent worker iteration before Release Alignment can be approved.

---

## 5. Verification Method

To independently verify these empirical findings and reproduction test suites, execute the following commands:

```powershell
# Prepend npm path in PowerShell:
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH

# 1. Run Python Challenger 2 adversarial suite (14 passed, 17 xfailed demonstrating all bugs):
py -m pytest services/analysis-python/tests/adversarial/test_empirical_stress_m2_it3_challenger2.py -v

# 2. Run TypeScript Challenger 2 adversarial suite in Vitest (31 passed, including 17 it.fails demonstrating all bugs):
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run test/empirical_stress_m2_it3_challenger2.spec.ts"

# 3. Verify cross-family leak directly via Python CLI:
py -c "from src.platform.evidence import ReleaseAlignmentValidator; print(ReleaseAlignmentValidator.validate('S4HC_2408', valid_from='S4H_2023'))"
# Output shows: status='RELEASE_ALIGNED', is_aligned=True, penalty=1.0

# 4. Verify unparseable release fallback directly via Node CLI:
node -e "const { ReleaseAlignmentValidator } = require('./packages/evidence/dist/release-alignment.js'); console.log(ReleaseAlignmentValidator.validate('INVALID_XYZ', '2408'));"
# Output shows: status: 'RELEASE_ALIGNED', isAligned: true, penalty: 1
```
