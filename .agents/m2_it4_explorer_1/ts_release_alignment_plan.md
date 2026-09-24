# TypeScript Cross-Release Alignment Remediation Blueprint

**Document**: `ts_release_alignment_plan.md`  
**Author**: `m2_it4_explorer_1` (TypeScript Release Alignment Explorer)  
**Target Milestone**: Milestone 2 Iteration 4  
**Date**: 2026-09-24  
**Authority**: Anchored to Cardinal Axiom 2 (`AGENTS.md`), `sap-evidence.md`, and empirical findings from `m2_it3_challenger_2/handoff.md`.

---

## 1. Executive Summary & Defect Remediation Scope

Empirical testing performed by `m2_it3_challenger_2` (`apps/api/test/empirical_stress_m2_it3_challenger2.spec.ts`) identified 5 critical defects and gaps in the TypeScript evidence alignment subsystem:

1. **Cross-Family Leakage**: When `targetRelease` and `validFrom` belong to different product families (e.g. S/4HANA Cloud `2408` vs On-Premise `2023`) and explicit family arguments are omitted, the engine fails to infer family differences from the parsed releases. Because `isSameFamily(target.family, from.family)` is false, it skips the check and incorrectly returns `status: 'RELEASE_ALIGNED'` with `100%` confidence (`penalty: 1.00`), violating the Non-Generalization Axiom (`sap-evidence.md` §2.2).
2. **Missing Future Release Calculation**: Releases $\ge 2$ versions ahead (semi-annual Cloud quarters $\ge 10$ months, or On-Premise year delta $\ge 2$) have no evaluation logic and return `RELEASE_ALIGNED` (1.00). The specification mandates `status: 'RELEASE_FUTURE'`, `isAligned: true`, `penalty: 0.80`.
3. **Premature Release Penalty Defect**: Premature releases (`target < validFrom`) incorrectly return `penalty: 0.0` instead of the mandated `0.40`.
4. **Unparseable / Empty Release Fallback Defect**: Malformed release strings (e.g. `'INVALID_UNKNOWN_XYZ'` or `''`) parse to `{ family: 'UNKNOWN', version: 0 }`, bypass checks, and return `RELEASE_ALIGNED` (`1.00`). Per `sap-evidence.md` §2.3 and §7.2, they must return `status: 'UNKNOWN'`, `isAligned: false`, `penalty: 0.30`.
5. **Schema & Naming Inconsistency**: `ReleaseAlignmentEnum` lacks `'RELEASE_FUTURE'` and `'RELEASE_MISMATCH'`. `ReleaseAlignmentValidator` returns `'FAMILY_MISMATCH'`, while the user specification requires `'RELEASE_MISMATCH'` (with backward-compatible support for `'FAMILY_MISMATCH'`).

This blueprint provides the exact, production-ready drop-in code for:
1. `packages/schemas/src/evidence.ts`
2. `packages/evidence/src/release-alignment.ts`

---

## 2. File 1: `packages/schemas/src/evidence.ts`

### 2.1 Modifications Overview
- Update `ReleaseAlignmentEnum` to include `'RELEASE_FUTURE'` and `'RELEASE_MISMATCH'`.
- Retain `'FAMILY_MISMATCH'` in `ReleaseAlignmentEnum` for full backward compatibility with stored database rows and existing JSON exports.
- Export `FAMILY_MISMATCH` as a const alias pointing to `'RELEASE_MISMATCH'`.

### 2.2 Full Drop-In Code (`packages/schemas/src/evidence.ts`)

```typescript
import { z } from 'zod';
import { ConfidenceClassEnum, SourceTypeEnum } from './common';

const sha256Regex = /^[a-fA-F0-9]{64}$/;

function normalizeEvidenceInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const createdAtRaw = obj.createdAt ?? obj.created_at;
  const createdAt = createdAtRaw instanceof Date ? createdAtRaw.toISOString() : (createdAtRaw as string | undefined);

  return {
    id: obj.id,
    findingId: obj.findingId ?? obj.finding_id,
    artifactPath: obj.artifactPath ?? obj.artifact_path,
    lineNumber: obj.lineNumber ?? obj.line_number ?? null,
    columnNumber: obj.columnNumber ?? obj.column_number ?? null,
    snippet: obj.snippet ?? null,
    sha256: obj.sha256,
    provenance: obj.provenance ?? 'VERIFIED',
    sourceType: obj.sourceType ?? obj.source_type ?? 'CUSTOMER_EVIDENCE',
    sourceTitle: obj.sourceTitle ?? obj.source_title ?? null,
    sourceUrl: obj.sourceUrl ?? obj.source_url ?? null,
    trustScore: obj.trustScore ?? obj.trust_score ?? obj.trust_level ?? 1.0,
    createdAt: createdAt ?? undefined,
  };
}

export const EvidenceSelectorEnum = z.enum([
  'LINE_COLUMN',
  'XPATH',
  'JSON_POINTER',
  'TABLE_CELL',
  'TELEGRAM_SEQ',
]);
export type EvidenceSelector = z.infer<typeof EvidenceSelectorEnum>;

export const EvidenceSourceOffsetSchema = z.object({
  artifactPath: z.string().min(1),
  selectorType: EvidenceSelectorEnum.default('LINE_COLUMN'),
  startLine: z.number().int().positive().nullable().optional(),
  endLine: z.number().int().positive().nullable().optional(),
  startColumn: z.number().int().positive().nullable().optional(),
  endColumn: z.number().int().positive().nullable().optional(),
  byteOffsetStart: z.number().int().nonnegative().nullable().optional(),
  byteOffsetEnd: z.number().int().nonnegative().nullable().optional(),
  selectorQuery: z.string().nullable().optional(),
  snippet: z.string().default(''),
  contextSnippet: z.string().nullable().optional(),
});
export type EvidenceSourceOffset = z.infer<typeof EvidenceSourceOffsetSchema>;

export const ReleaseAlignmentEnum = z.enum([
  'RELEASE_ALIGNED',
  'RELEASE_PREMATURE',
  'RELEASE_DEPRECATED',
  'RELEASE_FUTURE',
  'RELEASE_MISMATCH',
  'FAMILY_MISMATCH',
  'UNKNOWN',
]);
export type ReleaseAlignment = z.infer<typeof ReleaseAlignmentEnum>;

/** Backward-compatible alias for RELEASE_MISMATCH */
export const FAMILY_MISMATCH = 'RELEASE_MISMATCH' as const;

export const BaseEvidenceItemSchema = z.object({
  id: z.string().uuid().optional(),
  findingId: z.string().uuid().optional().nullable(),
  artifactPath: z.string().min(1),
  lineNumber: z.number().int().positive().optional().nullable(),
  columnNumber: z.number().int().positive().optional().nullable(),
  snippet: z.string().optional().nullable(),
  sha256: z.string().regex(sha256Regex, 'Must be a valid 64-character hexadecimal SHA-256 hash'),
  provenance: ConfidenceClassEnum.default('VERIFIED'),
  sourceType: SourceTypeEnum.default('CUSTOMER_EVIDENCE'),
  sourceTitle: z.string().optional().nullable(),
  sourceUrl: z.string().url().optional().nullable(),
  trustScore: z.number().min(0).max(1).default(1.0),
  targetRelease: z.string().optional().nullable(),
  validFromRelease: z.string().optional().nullable(),
  validToRelease: z.string().optional().nullable(),
  releaseAlignment: ReleaseAlignmentEnum.optional(),
  offset: EvidenceSourceOffsetSchema.optional().nullable(),
  createdAt: z.string().optional(),
});
export type EvidenceItem = z.infer<typeof BaseEvidenceItemSchema>;

export const EvidenceItemSchema = z.preprocess(
  normalizeEvidenceInput,
  BaseEvidenceItemSchema
);

function normalizeEvidenceWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    id: obj.id,
    finding_id: obj.finding_id ?? obj.findingId,
    artifact_path: obj.artifact_path ?? obj.artifactPath,
    line_number: obj.line_number ?? obj.lineNumber ?? null,
    column_number: obj.column_number ?? obj.columnNumber ?? null,
    snippet: obj.snippet ?? null,
    sha256: obj.sha256,
    provenance: obj.provenance ?? 'VERIFIED',
    source_type: obj.source_type ?? obj.sourceType ?? 'CUSTOMER_EVIDENCE',
    source_title: obj.source_title ?? obj.sourceTitle ?? null,
    source_url: obj.source_url ?? obj.sourceUrl ?? null,
    trust_score: obj.trust_score ?? obj.trustScore ?? obj.trust_level ?? 1.0,
  };
}

export const BaseEvidenceItemWireSchema = z.object({
  id: z.string().uuid().optional(),
  finding_id: z.string().uuid().optional().nullable(),
  artifact_path: z.string().min(1),
  line_number: z.number().int().positive().optional().nullable(),
  column_number: z.number().int().positive().optional().nullable(),
  snippet: z.string().optional().nullable(),
  sha256: z.string().regex(sha256Regex, 'Must be a valid 64-character hexadecimal SHA-256 hash'),
  provenance: ConfidenceClassEnum.default('VERIFIED'),
  source_type: SourceTypeEnum.default('CUSTOMER_EVIDENCE'),
  source_title: z.string().optional().nullable(),
  source_url: z.string().url().optional().nullable(),
  trust_score: z.number().min(0).max(1).default(1.0),
});
export type EvidenceItemWire = z.infer<typeof BaseEvidenceItemWireSchema>;

export const EvidenceItemWireSchema = z.preprocess(
  normalizeEvidenceWireInput,
  BaseEvidenceItemWireSchema
);
```

---

## 3. File 2: `packages/evidence/src/release-alignment.ts`

### 3.1 Algorithmic Design & Logic Rules

#### 1. Unparseable & Empty String Demotion (`UNKNOWN`, `0.30`)
- If `targetRelease` is falsy, empty, whitespace-only, parses to `family: 'UNKNOWN'`, or parses to `version: 0`, return `status: 'UNKNOWN'`, `isAligned: false`, `penalty: 0.30`.
- If `validFrom` is provided (not `null` or `undefined`) and is empty, whitespace-only, or parses to `family: 'UNKNOWN'` or `version: 0`, return `status: 'UNKNOWN'`, `isAligned: false`, `penalty: 0.30`.
- If `validTo` is provided and is empty, whitespace-only, or parses to `family: 'UNKNOWN'` or `version: 0`, return `status: 'UNKNOWN'`, `isAligned: false`, `penalty: 0.30`.

#### 2. Cross-Family Inference (`RELEASE_MISMATCH`, `0.50`)
- `effectiveTargetFamily = targetFamily || target.family;`
- `effectiveEvidenceFamily = evidenceFamily || (from && from.family !== 'UNKNOWN' ? from.family : null) || (to && to.family !== 'UNKNOWN' ? to.family : null);`
- If both are resolved and `!this.isSameFamily(effectiveEvidenceFamily, effectiveTargetFamily)`:
  - Return `status: 'RELEASE_MISMATCH'`, `isAligned: false`, `penalty: 0.50`.
  - Message: `Evidence release family (${effectiveEvidenceFamily}) does not match target family (${effectiveTargetFamily}).`

#### 3. Premature Release (`RELEASE_PREMATURE`, `0.40`)
- If `from` is present, both releases share the same family, and `target.version < from.version`:
  - Return `status: 'RELEASE_PREMATURE'`, `isAligned: false`, `penalty: 0.40`.
  - Message: `Feature requires release >= ${validFrom}, but target is ${targetRelease}.`

#### 4. Deprecated Release (`RELEASE_DEPRECATED`, `0.00`)
- If `to` is present, both releases share the same family, and `target.version > to.version`:
  - Return `status: 'RELEASE_DEPRECATED'`, `isAligned: false`, `penalty: 0.00`.
  - Message: `Feature was deprecated or removed after release ${validTo}. Target is ${targetRelease}.`

#### 5. Future Release Calculation (`RELEASE_FUTURE`, `0.80`)
- Applicable when `from` is present, `validTo` is absent (`!validTo`), and `this.isSameFamily(...)` is true.
- Distance calculation in `isFutureRelease(target, from)`:
  - **Cloud Cadence (YYMM)**:
    - `monthDelta = (targetYear - fromYear) * 12 + (targetMonth - fromMonth)`
    - SAP S/4HANA Cloud releases run semi-annually (February `02` and August `08`, 6 months apart).
    - `2402` to `2408`: `monthDelta = 6` (< 10) $\to$ 1 release ahead $\to$ `RELEASE_ALIGNED` (1.00).
    - `2408` to `2502`: `monthDelta = 6` (< 10) $\to$ 1 release ahead $\to$ `RELEASE_ALIGNED` (1.00).
    - `2402` to `2502`: `monthDelta = 12` ($\ge 10$) $\to$ 2 releases ahead $\to$ `RELEASE_FUTURE` (0.80).
    - `2402` to `2508`: `monthDelta = 18` ($\ge 10$) $\to$ 3 releases ahead $\to$ `RELEASE_FUTURE` (0.80).
  - **On-Premise Cadence (Years)**:
    - Normalizes releases $\ge 2000$ as literal years (`2020`..`2025`) and legacy releases (`1511`..`1909`) to `2015`..`2019`.
    - `yearDelta = targetYear - fromYear`
    - `2020` to `2021`: `yearDelta = 1` (< 2) $\to$ `RELEASE_ALIGNED` (1.00).
    - `2020` to `2023`: `yearDelta = 3` ($\ge 2$) $\to$ `RELEASE_FUTURE` (0.80).
    - `2021` to `2025`: `yearDelta = 4` ($\ge 2$) $\to$ `RELEASE_FUTURE` (0.80).
- If `isFutureRelease` returns true:
  - Return `status: 'RELEASE_FUTURE'`, `isAligned: true`, `penalty: 0.80`.
  - Message: `Feature is valid from ${validFrom}, but target ${targetRelease} is 2 or more releases ahead.`

#### 6. Aligned Release (`RELEASE_ALIGNED`, `1.00`)
- If all previous constraints pass, return `status: 'RELEASE_ALIGNED'`, `isAligned: true`, `penalty: 1.00`, message `'Evidence is release-aligned.'`.

### 3.3 Full Drop-In Code (`packages/evidence/src/release-alignment.ts`)

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

/** Backward-compatible export alias */
export const FAMILY_MISMATCH = 'RELEASE_MISMATCH' as const;
export const RELEASE_MISMATCH = 'RELEASE_MISMATCH' as const;

export class ReleaseAlignmentValidator {
  private static readonly CLOUD_YYMM_REGEX = /^(2[0-9])(0[1-9]|1[0-2])$/;
  private static readonly CLOUD_FAMILIES = new Set<string>(['CLOUD', 'S4HANA_CLOUD']);

  public static isSameFamily(famA?: string | null, famB?: string | null): boolean {
    if (!famA || !famB) return false;
    if (famA === famB) return true;
    return this.CLOUD_FAMILIES.has(famA) && this.CLOUD_FAMILIES.has(famB);
  }

  public static isFutureRelease(target: ReleaseParseResult, from: ReleaseParseResult): boolean {
    if (!this.isSameFamily(target.family, from.family)) {
      return false;
    }
    if (target.version < from.version) {
      return false;
    }

    // Cloud family comparison (YYMM semi-annual cadence)
    if (this.CLOUD_FAMILIES.has(target.family) && this.CLOUD_FAMILIES.has(from.family)) {
      const targetYear = Math.floor(target.version / 100);
      const targetMonth = target.version % 100;
      const fromYear = Math.floor(from.version / 100);
      const fromMonth = from.version % 100;

      const monthDelta = (targetYear - fromYear) * 12 + (targetMonth - fromMonth);
      // In SAP S/4HANA Cloud (semi-annual ~6 months cycle):
      // >= 2 releases ahead means delta >= 10 months (e.g. 2402 -> 2502 is 12 months)
      return monthDelta >= 10;
    }

    // On-Premise family comparison (Year delta >= 2)
    if (target.family === 'ON_PREMISE' && from.family === 'ON_PREMISE') {
      const targetYear = target.version >= 2000 ? target.version : Math.floor(target.version / 100) + 2000;
      const fromYear = from.version >= 2000 ? from.version : Math.floor(from.version / 100) + 2000;
      return (targetYear - fromYear) >= 2;
    }

    // Generic fallback: version difference >= 2
    return (target.version - from.version) >= 2;
  }

  public static parseRelease(rel: string): ReleaseParseResult {
    if (!rel || typeof rel !== 'string') {
      return { family: 'UNKNOWN', version: 0 };
    }

    const clean = rel.trim().toUpperCase();
    if (!clean) {
      return { family: 'UNKNOWN', version: 0 };
    }

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
    // 1. Validate target release input
    if (!targetRelease || typeof targetRelease !== 'string' || !targetRelease.trim()) {
      return {
        status: 'UNKNOWN',
        isAligned: false,
        penalty: 0.30,
        message: 'Target release is missing or empty.',
      };
    }

    const target = this.parseRelease(targetRelease);
    if (target.family === 'UNKNOWN' || target.version === 0) {
      return {
        status: 'UNKNOWN',
        isAligned: false,
        penalty: 0.30,
        message: `Target release '${targetRelease}' cannot be identified or parsed.`,
      };
    }

    // 2. Parse and validate validFrom if supplied
    let from: ReleaseParseResult | null = null;
    if (validFrom !== undefined && validFrom !== null) {
      if (typeof validFrom !== 'string' || !validFrom.trim()) {
        return {
          status: 'UNKNOWN',
          isAligned: false,
          penalty: 0.30,
          message: 'Evidence validFrom release is empty or invalid.',
        };
      }
      from = this.parseRelease(validFrom);
      if (from.family === 'UNKNOWN' || from.version === 0) {
        return {
          status: 'UNKNOWN',
          isAligned: false,
          penalty: 0.30,
          message: `Evidence validFrom release '${validFrom}' cannot be identified or parsed.`,
        };
      }
    }

    // 3. Parse and validate validTo if supplied
    let to: ReleaseParseResult | null = null;
    if (validTo !== undefined && validTo !== null) {
      if (typeof validTo !== 'string' || !validTo.trim()) {
        return {
          status: 'UNKNOWN',
          isAligned: false,
          penalty: 0.30,
          message: 'Evidence validTo release is empty or invalid.',
        };
      }
      to = this.parseRelease(validTo);
      if (to.family === 'UNKNOWN' || to.version === 0) {
        return {
          status: 'UNKNOWN',
          isAligned: false,
          penalty: 0.30,
          message: `Evidence validTo release '${validTo}' cannot be identified or parsed.`,
        };
      }
    }

    // 4. Infer effective target and evidence families
    const effectiveTargetFamily = targetFamily || target.family;
    const effectiveEvidenceFamily =
      evidenceFamily ||
      (from && from.family !== 'UNKNOWN' ? from.family : null) ||
      (to && to.family !== 'UNKNOWN' ? to.family : null);

    // 5. Cross-family check: If both families are known and mismatch
    if (effectiveEvidenceFamily && effectiveTargetFamily && !this.isSameFamily(effectiveEvidenceFamily, effectiveTargetFamily)) {
      return {
        status: 'RELEASE_MISMATCH',
        isAligned: false,
        penalty: 0.50,
        message: `Evidence release family (${effectiveEvidenceFamily}) does not match target family (${effectiveTargetFamily}).`,
      };
    }

    // 6. Premature release check: target < validFrom
    if (from) {
      if (this.isSameFamily(effectiveTargetFamily, effectiveEvidenceFamily) && target.version < from.version) {
        return {
          status: 'RELEASE_PREMATURE',
          isAligned: false,
          penalty: 0.40,
          message: `Feature requires release >= ${validFrom}, but target is ${targetRelease}.`,
        };
      }
    }

    // 7. Deprecated release check: target > validTo
    if (to) {
      if (this.isSameFamily(effectiveTargetFamily, effectiveEvidenceFamily) && target.version > to.version) {
        return {
          status: 'RELEASE_DEPRECATED',
          isAligned: false,
          penalty: 0.0,
          message: `Feature was deprecated or removed after release ${validTo}. Target is ${targetRelease}.`,
        };
      }
    }

    // 8. Future release check: target >= validFrom + 2 releases ahead
    // Applicable when validTo is absent (open-ended validity) and target is 2+ releases ahead
    if (from && !validTo) {
      if (this.isSameFamily(effectiveTargetFamily, effectiveEvidenceFamily) && this.isFutureRelease(target, from)) {
        return {
          status: 'RELEASE_FUTURE',
          isAligned: true,
          penalty: 0.80,
          message: `Feature is valid from ${validFrom}, but target ${targetRelease} is 2 or more releases ahead.`,
        };
      }
    }

    // 9. Fully release-aligned
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

## 4. Test Suite Harmonization & Invariant Preservation

### 4.1 `apps/api/test/empirical_stress_m2_it3_challenger2.spec.ts`
When the implementation is applied, the 17 `it.fails` tests in Challenger 2 become regular passing tests:
- Premature releases penalty `0.40`: change `it.fails(...)` to `it(...)`.
- Future releases `RELEASE_FUTURE` (`0.80`): change `it.fails(...)` to `it(...)`.
- Cross-family mismatch without explicit family args: change `it.fails(...)` to `it(...)`.
- Status code `RELEASE_MISMATCH`: change `it.fails(...)` to `it(...)`.
- Invalid release fallback to `UNKNOWN` ($\le 0.30$): change `it.fails(...)` to `it(...)`.

### 4.2 `apps/api/test/empirical_stress_m2_it3.spec.ts`
In lines 196–198:
```typescript
      { target: 'S4HANA_2023', from: 'S4_2020', to: null, status: 'RELEASE_FUTURE', aligned: true, penalty: 0.80 },
      { target: 'S4H_2023', from: '2020', to: null, status: 'RELEASE_FUTURE', aligned: true, penalty: 0.80 },
      { target: '2023', from: 'S4H_2020', to: null, status: 'RELEASE_FUTURE', aligned: true, penalty: 0.80 },
```
These lines reflect that with `to: null`, `2023` is $\ge 2$ releases ahead of `2020`, yielding `RELEASE_FUTURE` with `penalty: 0.80`.

### 4.3 `apps/api/test/empirical_stress_m2_it2.spec.ts`
In line 290:
```typescript
      const res4 = ReleaseAlignmentValidator.validate('2408', null, null, 'S4HANA_CLOUD', 'ON_PREMISE');
      expect(res4.isAligned).toBe(false);
      expect(res4.status).toBe('RELEASE_MISMATCH'); // or expect(['RELEASE_MISMATCH', 'FAMILY_MISMATCH']).toContain(res4.status);
      expect(res4.penalty).toBe(0.5);
```

---

## 5. Verification Commands for the Implementer

```powershell
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;" + $env:PATH

# 1. Rebuild @erppreflight/schemas
pnpm --filter @erppreflight/schemas run build

# 2. Rebuild @erppreflight/evidence
pnpm --filter @erppreflight/evidence run build

# 3. Typecheck all packages
pnpm run typecheck

# 4. Run full Vitest suite in apps/api
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run"

# 5. Run Challenger 2 empirical test directly
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api exec vitest run test/empirical_stress_m2_it3_challenger2.spec.ts"
```
