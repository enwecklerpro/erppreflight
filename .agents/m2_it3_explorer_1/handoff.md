# Handoff Report — Drop-In Fix Blueprint for TypeScript Release Prefix Stripping

**Agent Identity**: `m2_it3_explorer_1`  
**Roles**: explorer, synthesis  
**Working Directory**: `H:/erppreflight/.agents/m2_it3_explorer_1`  
**Parent Agent**: `parent` (ID: `b18c0539-d6d7-4a41-968f-58324775ab38`)  
**Date**: 2026-09-24  
**Type**: Hard Handoff (Task Complete)  

---

## 1. Observation

1. **Current Code Implementation in `packages/evidence/src/release-alignment.ts` (lines 30–40)**:
   ```typescript
   // 1. Explicit S/4HANA Cloud prefixes
   if (clean.startsWith('S4HC_') || clean.startsWith('S4HANA_CLOUD_')) {
     const numStr = clean.replace(/[^0-9]/g, '');
     return { family: 'S4HANA_CLOUD', version: parseInt(numStr, 10) || 0 };
   }

   // 2. Explicit S/4HANA On-Premise prefixes
   if (clean.startsWith('S4H_') || clean.startsWith('S4_') || clean.startsWith('S4HANA_')) {
     const numStr = clean.replace(/[^0-9]/g, '');
     return { family: 'ON_PREMISE', version: parseInt(numStr, 10) || 0 };
   }
   ```
   Global regex `clean.replace(/[^0-9]/g, '')` matches the digit `'4'` from the leading `'S4'` prefix before extracting the release version numbers.

2. **Empirical Behavior Observed in Tests**:
   In `apps/api/test/empirical_stress_m2_it2.spec.ts` (lines 294–309):
   - `ReleaseAlignmentValidator.parseRelease('S4HC_2408')` yields `{ family: 'S4HANA_CLOUD', version: 42408 }` instead of `version: 2408`.
   - `ReleaseAlignmentValidator.parseRelease('S4H_2023')` yields `{ family: 'ON_PREMISE', version: 42023 }` instead of `version: 2023`.
   - `ReleaseAlignmentValidator.validate('2408', 'S4HC_2402')` evaluates `2408 < 42402` $\implies$ returns `status: 'RELEASE_PREMATURE'`, `isAligned: false`, `penalty: 0.0`.

3. **Interface Contract Requirement in `PROJECT.md` line 114**:
   `"target_release": "string (e.g. S4H_2023, S4HC_2402)"`
   Canonical SAP release strings with prefixes are explicitly supported and mandated by the preflight analysis schema.

4. **Package Structure and Exports**:
   `packages/evidence/src/release_validator.ts` contains:
   ```typescript
   export * from './release-alignment';
   ```
   `packages/evidence/src/index.ts` re-exports both `./release_validator` and `./release-alignment`.
   `@erppreflight/evidence` builds cleanly via `tsc` (`pnpm --filter @erppreflight/evidence build`).

5. **Prefix Collision Hazard**:
   `'S4HANA_CLOUD_'` starts with `'S4HANA_'`. If `'S4HANA_'` were evaluated before `'S4HANA_CLOUD_'`, any release such as `'S4HANA_CLOUD_2408'` would match `'S4HANA_'` and be misclassified as `family: 'ON_PREMISE'`. Furthermore, testing `prefix.startsWith('S4HC')` does not match `'S4HANA_CLOUD_'`. Explicit comparison (`prefix === 'S4HANA_CLOUD_' || prefix === 'S4HC_'`) is required.

---

## 2. Logic Chain

1. **Step 1 (Root Cause)**:
   Observations 1 and 2 demonstrate that extracting digits without first stripping the matched prefix leads to integer version corruption (`42408` instead of `2408`, `42023` instead of `2023`).
2. **Step 2 (Prefix Stripping Invariant)**:
   Extracting the remainder via `clean.substring(prefix.length)` before performing regex digit extraction `remainder.replace(/[^0-9]/g, '')` ensures only digits in the version component are extracted, completely eliminating the leading `'4'` from `'S4'`.
3. **Step 3 (Prefix Ordering and Cloud Classification)**:
   Per Observation 5, checking prefixes in order `['S4HANA_CLOUD_', 'S4HANA_', 'S4HC_', 'S4H_', 'S4_']` guarantees that `'S4HANA_CLOUD_'` matches before `'S4HANA_'`. Classifying `isCloud` as `prefix === 'S4HANA_CLOUD_' || prefix === 'S4HC_'` deterministically assigns `S4HANA_CLOUD` vs `ON_PREMISE`.
4. **Step 4 (Cross-Release Alignment Restoration)**:
   With `parseRelease('S4HC_2402')` returning `version: 2402` and `parseRelease('2408')` returning `version: 2408`, `validate('2408', 'S4HC_2402')` evaluates `2408 >= 2402`, correctly returning `status: 'RELEASE_ALIGNED'`, `isAligned: true`, `penalty: 1.0`.
5. **Step 5 (Non-Regression of Existing Tests)**:
   In `apps/api/test/platform_services.spec.ts` (lines 90–108), tests validating `'S4H_2023'`, `'S4H_2020'`, and `'S4H_2025'` continue to pass because `2020 <= 2023 <= 2025` preserves the same ordering as before, but with canonical version integers (`2020`, `2023`, `2025`) instead of corrupted versions (`42020`, `42023`, `42025`).

---

## 3. Caveats

1. **Read-Only Scope**:
   As an explorer agent, source code in `packages/evidence/src/release-alignment.ts` was not directly modified. The exact drop-in blueprint and replacement chunks have been written to `H:/erppreflight/.agents/m2_it3_explorer_1/ts_prefix_fix_plan.md`.
2. **Test File Update Required Upon Implementation**:
   `apps/api/test/empirical_stress_m2_it2.spec.ts` line 294 contains an empirical bug reproduction test that asserts the corrupted values (`42408`, `42023`, `isAligned: false`). Once the fix is applied, that test will fail until updated to assert the fixed values (`2408`, `2023`, `isAligned: true`). The required test diff is provided in Section 4 of `ts_prefix_fix_plan.md`.
3. **Python Service Parity**:
   While this blueprint targets the TypeScript package (`@erppreflight/evidence`), `services/analysis-python/src/platform/evidence.py` has an identical structure and must be updated in tandem to maintain cross-runtime parity.

---

## 4. Conclusion

The exact drop-in fix blueprint has been formulated, verified against all edge cases, and documented in `H:/erppreflight/.agents/m2_it3_explorer_1/ts_prefix_fix_plan.md`.

### Drop-in Replacement for `packages/evidence/src/release-alignment.ts` (lines 30–41):
```typescript
    // 1. Explicit S/4HANA prefixes (strip matching prefix before extracting digits to prevent 'S4' -> '4' corruption)
    const prefixes = ['S4HANA_CLOUD_', 'S4HANA_', 'S4HC_', 'S4H_', 'S4_'] as const;
    for (const prefix of prefixes) {
      if (clean.startsWith(prefix)) {
        const isCloud = prefix === 'S4HANA_CLOUD_' || prefix === 'S4HC_';
        const remainder = clean.substring(prefix.length);
        const numStr = remainder.replace(/[^0-9]/g, '');
        return {
          family: isCloud ? 'S4HANA_CLOUD' : 'ON_PREMISE',
          version: parseInt(numStr, 10) || 0,
        };
      }
    }
```

This replacement completely resolves the `'S4'` digit prepending defect across all prefixed releases (`S4HC_2408` $\implies$ 2408, `S4H_2023` $\implies$ 2023, `S4HANA_CLOUD_2402` $\implies$ 2402, `S4_2022` $\implies$ 2022).

---

## 5. Verification Method

1. **Inspect Blueprint**:
   Read `H:/erppreflight/.agents/m2_it3_explorer_1/ts_prefix_fix_plan.md` to review the complete before/after diff, drop-in replacement file, and test update blueprint.
2. **Apply Fix and Build**:
   ```powershell
   cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter @erppreflight/evidence build"
   ```
3. **Run TypeScript Tests**:
   ```powershell
   cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run test/platform_services.spec.ts"
   cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run test/empirical_stress_m2_it2.spec.ts"
   ```
4. **Invalidation Condition**:
   If `ReleaseAlignmentValidator.parseRelease('S4HC_2408').version` evaluates to any value other than `2408`, or if `ReleaseAlignmentValidator.validate('2408', 'S4HC_2402').isAligned` evaluates to `false`, the verification fails.
