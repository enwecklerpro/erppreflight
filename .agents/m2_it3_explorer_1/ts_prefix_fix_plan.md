# Drop-In Fix Blueprint: Release Prefix Version Stripping in TypeScript

**Target File**: `H:/erppreflight/packages/evidence/src/release-alignment.ts`  
**Affected Method**: `ReleaseAlignmentValidator.parseRelease(rel: string): ReleaseParseResult`  
**Author**: `m2_it3_explorer_1`  
**Date**: 2026-09-24  
**Status**: Ready for Implementation  

---

## 1. Executive Summary & Root Cause Analysis

### 1.1 The Defect
In `packages/evidence/src/release-alignment.ts` (lines 30–40), `ReleaseAlignmentValidator.parseRelease` detects S/4HANA release prefixes (`S4HC_`, `S4HANA_CLOUD_`, `S4H_`, `S4_`, `S4HANA_`), but extracts digits by executing a global regex match on the **entire** string:
```typescript
const numStr = clean.replace(/[^0-9]/g, '');
return { family: 'S4HANA_CLOUD', version: parseInt(numStr, 10) || 0 };
```

Because all SAP S/4HANA prefixes begin with `'S4'`, the digit `'4'` is captured before the release version digits. Consequently:
- `ReleaseAlignmentValidator.parseRelease('S4HC_2408')` yields `{ family: 'S4HANA_CLOUD', version: 42408 }` instead of `version: 2408`.
- `ReleaseAlignmentValidator.parseRelease('S4H_2023')` yields `{ family: 'ON_PREMISE', version: 42023 }` instead of `version: 2023`.

### 1.2 Downstream Impact
1. **Cross-Format Validation Failure**:
   When evaluating a target release provided as raw digits (`'2408'`) against an evidence rule specifying `validFrom: 'S4HC_2402'`, the validator compares `target.version < from.version` (`2408 < 42402`). This evaluates to `true`, erroneously emitting `RELEASE_PREMATURE` with `penalty = 0.0` for valid, release-aligned evidence.
2. **Contract Inconsistency**:
   `PROJECT.md` line 114 specifies `"target_release": "string (e.g. S4H_2023, S4HC_2402)"`. The inability to properly parse canonical SAP prefixed strings directly violates the architectural interface contract.

### 1.3 Fix Rationale
Prefixes must be explicitly stripped before digit extraction:
`const remainder = clean.substring(prefix.length);`  
`const numStr = remainder.replace(/[^0-9]/g, '');`

Prefix evaluation order is critical:
`'S4HANA_CLOUD_'` must be evaluated **before** `'S4HANA_'`, because `'S4HANA_CLOUD_2408'` starts with `'S4HANA_'`. If `'S4HANA_'` were evaluated first, Cloud releases would be misclassified as `ON_PREMISE`.

The evaluated prefix order:
1. `'S4HANA_CLOUD_'` (length 13) $\implies$ `S4HANA_CLOUD`
2. `'S4HANA_'` (length 7) $\implies$ `ON_PREMISE`
3. `'S4HC_'` (length 5) $\implies$ `S4HANA_CLOUD`
4. `'S4H_'` (length 4) $\implies$ `ON_PREMISE`
5. `'S4_'` (length 3) $\implies$ `ON_PREMISE`

---

## 2. Targeted Code Replacement Chunk

In `H:/erppreflight/packages/evidence/src/release-alignment.ts`, replace lines 30 to 41:

### Before (Existing Lines 30–41):
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

### After (Proposed Replacement):
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

---

## 3. Complete Drop-In File Replacement

Below is the complete, validated code for `H:/erppreflight/packages/evidence/src/release-alignment.ts`:

```typescript
import { ReleaseAlignment } from '@erppreflight/schemas';

export type ReleaseFamily = 'ON_PREMISE' | 'CLOUD' | 'S4HANA_CLOUD' | 'ECC' | 'UNKNOWN';

export interface ReleaseParseResult {
  family: ReleaseFamily;
  version: number;
}

export interface ReleaseAlignmentResult {
  status: ReleaseAlignment;
  isAligned: boolean;
  penalty: number;
  message: string;
}

export class ReleaseAlignmentValidator {
  private static readonly CLOUD_YYMM_REGEX = /^(2[0-9])(0[1-9]|1[0-2])$/;
  private static readonly CLOUD_FAMILIES = new Set<string>(['CLOUD', 'S4HANA_CLOUD']);

  public static isSameFamily(famA?: string | null, famB?: string | null): boolean {
    if (!famA || !famB) return false;
    if (famA === famB) return true;
    return this.CLOUD_FAMILIES.has(famA) && this.CLOUD_FAMILIES.has(famB);
  }

  public static parseRelease(rel: string): ReleaseParseResult {
    const clean = rel.trim().toUpperCase();

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

    // 2. SAP ECC prefix
    if (clean.startsWith('ECC')) {
      return { family: 'ECC', version: 600 };
    }

    const digitsOnly = clean.replace(/[^0-9]/g, '');

    // 3. Exact S/4HANA Cloud YYMM format: 2308, 2402, 2408, 2502
    if (this.CLOUD_YYMM_REGEX.test(clean) || (digitsOnly && this.CLOUD_YYMM_REGEX.test(digitsOnly))) {
      return { family: 'S4HANA_CLOUD', version: parseInt(digitsOnly, 10) || 0 };
    }

    const num = parseInt(digitsOnly, 10);
    if (!isNaN(num)) {
      // 4. Classic S/4HANA On-Premise releases: 1511, 1610, 1709, 1809, 1909, 2020, 2021, 2022, 2023, 2025
      if ((num >= 1500 && num <= 2100) || num === 2025) {
        return { family: 'ON_PREMISE', version: num };
      }
      // 5. Generic cloud versions (2200-2999)
      if (num >= 2200 && num <= 2999) {
        return { family: 'S4HANA_CLOUD', version: num };
      }
    }

    return { family: 'UNKNOWN', version: 0 };
  }

  public static validate(
    targetRelease: string,
    validFrom?: string | null,
    validTo?: string | null,
    targetFamily?: string | null,
    evidenceFamily?: string | null
  ): ReleaseAlignmentResult {
    const target = this.parseRelease(targetRelease);

    // Check family consistency across target and evidence
    if (evidenceFamily && targetFamily && !this.isSameFamily(evidenceFamily, targetFamily)) {
      return {
        status: 'FAMILY_MISMATCH',
        isAligned: false,
        penalty: 0.5,
        message: `Evidence release family (${evidenceFamily}) does not match target family (${targetFamily}).`,
      };
    }

    if (validFrom) {
      const from = this.parseRelease(validFrom);
      if (this.isSameFamily(target.family, from.family) && target.version < from.version) {
        return {
          status: 'RELEASE_PREMATURE',
          isAligned: false,
          penalty: 0.0,
          message: `Feature requires release >= ${validFrom}, but target is ${targetRelease}.`,
        };
      }
    }

    if (validTo) {
      const to = this.parseRelease(validTo);
      if (this.isSameFamily(target.family, to.family) && target.version > to.version) {
        return {
          status: 'RELEASE_DEPRECATED',
          isAligned: false,
          penalty: 0.0,
          message: `Feature was deprecated or removed after release ${validTo}. Target is ${targetRelease}.`,
        };
      }
    }

    return {
      status: 'RELEASE_ALIGNED',
      isAligned: true,
      penalty: 1.0,
      message: 'Evidence is release-aligned.',
    };
  }
}
```

---

## 4. Associated Test Harness Update Blueprint

When `packages/evidence/src/release-alignment.ts` is updated, the test case in `apps/api/test/empirical_stress_m2_it2.spec.ts` (lines 294–309) that asserted the buggy behavior will fail because the bug has been remediated.

### Target: `apps/api/test/empirical_stress_m2_it2.spec.ts` (Lines 294–309)

#### Before:
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

#### After (Remediated Assertion):
```typescript
    it('REMEDIATED: Correctly strips prefixes to prevent version corruption in parseRelease and validate', () => {
      // S4HC_2408 correctly parses to 2408 without '4' corruption
      const resS4HC = ReleaseAlignmentValidator.parseRelease('S4HC_2408');
      expect(resS4HC.family).toBe('S4HANA_CLOUD');
      expect(resS4HC.version).toBe(2408);

      // S4H_2023 correctly parses to 2023 without '4' corruption
      const resS4H = ReleaseAlignmentValidator.parseRelease('S4H_2023');
      expect(resS4H.family).toBe('ON_PREMISE');
      expect(resS4H.version).toBe(2023);

      // Cross-release validation: target 2408 is aligned with validFrom S4HC_2402 (2408 >= 2402)
      const crossVal = ReleaseAlignmentValidator.validate('2408', 'S4HC_2402');
      expect(crossVal.isAligned).toBe(true);
      expect(crossVal.status).toBe('RELEASE_ALIGNED');
      expect(crossVal.penalty).toBe(1.0);
    });
```

---

## 5. Parity & Invariant Matrix Across All Formats

| Input Release String | Matched Prefix | Remainder | Stripped Digits | Parsed Family | Parsed Version | Correct Behavior |
|---|---|---|---|---|---|---|
| `'S4HC_2408'` | `'S4HC_'` | `'2408'` | `'2408'` | `S4HANA_CLOUD` | `2408` | Identical to unprefixed `'2408'` |
| `'S4HC_2402'` | `'S4HC_'` | `'2402'` | `'2402'` | `S4HANA_CLOUD` | `2402` | Identical to unprefixed `'2402'` |
| `'S4HC_2308'` | `'S4HC_'` | `'2308'` | `'2308'` | `S4HANA_CLOUD` | `2308` | Identical to unprefixed `'2308'` |
| `'S4HC_2502'` | `'S4HC_'` | `'2502'` | `'2502'` | `S4HANA_CLOUD` | `2502` | Identical to unprefixed `'2502'` |
| `'S4HANA_CLOUD_2408'` | `'S4HANA_CLOUD_'` | `'2408'` | `'2408'` | `S4HANA_CLOUD` | `2408` | Preempts `'S4HANA_'` prefix |
| `'S4HANA_2023'` | `'S4HANA_'` | `'2023'` | `'2023'` | `ON_PREMISE` | `2023` | Correctly stripped |
| `'S4H_2023'` | `'S4H_'` | `'2023'` | `'2023'` | `ON_PREMISE` | `2023` | Identical to unprefixed `'2023'` |
| `'S4_2022'` | `'S4_'` | `'2022'` | `'2022'` | `ON_PREMISE` | `2022` | Identical to unprefixed `'2022'` |
| `'ECC600'` | None | — | — | `ECC` | `600` | Unaffected |
| `'2408'` | None | — | `'2408'` | `S4HANA_CLOUD` | `2408` | Unaffected |
| `'2023'` | None | — | `'2023'` | `ON_PREMISE` | `2023` | Unaffected |

---

## 6. Implementation and Verification Instructions

1. **Apply edit**: Replace lines 30–41 in `packages/evidence/src/release-alignment.ts` with the replacement chunk in Section 2.
2. **Build evidence package**:
   ```powershell
   cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter @erppreflight/evidence build"
   ```
3. **Update test assertions**: Update lines 294–309 in `apps/api/test/empirical_stress_m2_it2.spec.ts` as specified in Section 4.
4. **Run TypeScript test suites**:
   ```powershell
   cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run test/empirical_stress_m2_it2.spec.ts"
   cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run test/platform_services.spec.ts"
   cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api test"
   ```
5. **Verify full monorepo build & typecheck**:
   ```powershell
   cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm run build"
   ```
