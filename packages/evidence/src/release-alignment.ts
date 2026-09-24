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
