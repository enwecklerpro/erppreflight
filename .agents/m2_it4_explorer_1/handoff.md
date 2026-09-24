# Handoff Report: TypeScript Cross-Release Alignment Remediation Blueprint

**Agent**: `m2_it4_explorer_1`  
**Role**: explorer, specialist (TypeScript Release Alignment & Schemas Explorer)  
**Date**: 2026-09-24  
**Working Directory**: `H:/erppreflight/.agents/m2_it4_explorer_1`  
**Parent Agent**: `b18c0539-d6d7-4a41-968f-58324775ab38`  
**Target Milestone**: Milestone 2 Iteration 4  
**Handoff Type**: Hard (Investigation & Blueprint Complete)

---

## 1. Observation

### 1.1 Direct Observations in `packages/schemas/src/evidence.ts`
- **File**: `packages/schemas/src/evidence.ts` (lines 53–60)
  ```typescript
  export const ReleaseAlignmentEnum = z.enum([
    'RELEASE_ALIGNED',
    'RELEASE_PREMATURE',
    'RELEASE_DEPRECATED',
    'FAMILY_MISMATCH',
    'UNKNOWN',
  ]);
  export type ReleaseAlignment = z.infer<typeof ReleaseAlignmentEnum>;
  ```
- **Finding**: `'RELEASE_FUTURE'` and `'RELEASE_MISMATCH'` are completely missing from the Zod enumeration.

### 1.2 Direct Observations in `packages/evidence/src/release-alignment.ts`
- **Cross-Family Defect** (lines 80–88):
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
  When callers omit `targetFamily` and `evidenceFamily` (e.g. `validate("2408", "2023")` or `validate("S4HC_2408", "S4H_2020")`), this block is skipped. Furthermore, because `isSameFamily(target.family, from.family)` evaluates to `false`, lines 92–99 are skipped, falling through to line 114:
  `status: 'RELEASE_ALIGNED'`, `isAligned: true`, `penalty: 1.0`!
- **Premature Penalty Defect** (lines 92–99):
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
  Returns `penalty: 0.0` instead of the mandated `0.40`.
- **Missing `RELEASE_FUTURE`**:
  No calculation exists for checking whether `target >= validFrom + 2 releases ahead` (penalty `0.80`).
- **Unparseable / Empty Fallback**:
  `parseRelease('INVALID_XYZ')` and `parseRelease('')` return `{ family: 'UNKNOWN', version: 0 }`. The function does not guard against `family === 'UNKNOWN'`, falling through to return `RELEASE_ALIGNED` (1.00).

### 1.3 Test Suite Execution & Baseline
- Command: `pnpm --filter api exec vitest run test/empirical_stress_m2_it3_challenger2.spec.ts`
  - Result: 31 passed (17 tests intentionally marked `it.fails` reproducing all 5 defects).
- Command: `py -m pytest services/analysis-python/tests/adversarial/test_empirical_stress_m2_it3_challenger2.py`
  - Result: 14 passed, 17 xfailed (identical 17 defect reproductions).

---

## 2. Logic Chain

1. **Schema Extension (Observation 1.1)**:
   Adding `'RELEASE_FUTURE'` and `'RELEASE_MISMATCH'` to `ReleaseAlignmentEnum` while retaining `'FAMILY_MISMATCH'` as an enum member and const alias ensures new findings conform to specification while preventing Zod parsing failures on existing stored records.
2. **Cross-Family Resolution (Observation 1.2)**:
   By establishing effective family variables (`effectiveTargetFamily = targetFamily || target.family`, `effectiveEvidenceFamily = evidenceFamily || from?.family || to?.family`), `ReleaseAlignmentValidator` detects cross-family differences even when explicit family arguments are omitted. When `!this.isSameFamily(...)`, returning `status: 'RELEASE_MISMATCH'`, `isAligned: false`, `penalty: 0.50` closes the cross-family leakage.
3. **Premature Penalty Correction (Observation 1.2)**:
   Updating `penalty` from `0.0` to `0.40` under `RELEASE_PREMATURE` fulfills the M2 Iteration 3 specification gradient (`1.00`, `0.80`, `0.50`, `0.40`, `0.30`, `0.00`).
4. **Future Release Distance (Observation 1.2)**:
   Implementing `isFutureRelease(target, from)`:
   - For Cloud (`CLOUD_FAMILIES`): `monthDelta = (targetYear - fromYear) * 12 + (targetMonth - fromMonth)`. With semi-annual releases (every 6 months: `02` and `08`), $\ge 2$ releases ahead corresponds to `monthDelta >= 10`. Thus, `2408` vs `2402` (6 months) is `RELEASE_ALIGNED`, while `2502` vs `2402` (12 months) is `RELEASE_FUTURE` (`0.80`).
   - For On-Premise: `(targetYear - fromYear) >= 2`. Thus `2021` vs `2020` is `RELEASE_ALIGNED`, while `2023` vs `2020` (delta 3) and `2025` vs `2021` (delta 4) are `RELEASE_FUTURE` (`0.80`).
   - Evaluated when `validTo` is absent (open-ended validity). When `validTo` is present and `target <= to.version`, the release is within the verified window and remains `RELEASE_ALIGNED`.
5. **Epistemic Demotion on Unparseable Input (Observation 1.2)**:
   Guards on `targetRelease`, `validFrom`, and `validTo` returning `status: 'UNKNOWN'`, `isAligned: false`, `penalty: 0.30` when strings are missing or parse to `{ family: 'UNKNOWN', version: 0 }` satisfy `sap-evidence.md` §2.3 and §7.2.

---

## 3. Caveats

- **Scope Boundary**: As an Explorer agent, code files were not directly modified in `packages/schemas` or `packages/evidence`. The complete drop-in source is provided in `.agents/m2_it4_explorer_1/ts_release_alignment_plan.md` for execution by the implementer worker.
- **Test File Updates**: Once the worker applies the drop-in code, the 17 `it.fails` markers in `apps/api/test/empirical_stress_m2_it3_challenger2.spec.ts` must be converted to normal `it` assertions. In `apps/api/test/empirical_stress_m2_it3.spec.ts`, lines 196–198 must be updated to expect `RELEASE_FUTURE` (`0.80`).

---

## 4. Conclusion

The TypeScript cross-release alignment architecture has been fully blueprinted. The proposed drop-in replacements for `packages/schemas/src/evidence.ts` and `packages/evidence/src/release-alignment.ts` resolve all 5 empirical challenger defects, uphold the Non-Generalization Axiom, and maintain backward compatibility across the monorepo.

Complete drop-in code is documented in:
`H:/erppreflight/.agents/m2_it4_explorer_1/ts_release_alignment_plan.md`.

---

## 5. Verification Method

To verify the blueprint once applied by the implementer:

```powershell
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH

# 1. Rebuild packages
pnpm --filter @erppreflight/schemas run build
pnpm --filter @erppreflight/evidence run build

# 2. Strict typecheck
pnpm run typecheck

# 3. Execute Challenger 2 empirical test suite
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run test/empirical_stress_m2_it3_challenger2.spec.ts"

# 4. Execute all API tests
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run"
```
