import { ConfidenceScoreMap } from '@erppreflight/schemas';

export const TrustScoreConstants = {
  OFFICIAL_METADATA: 1.0,
  OFFICIAL_DOCS: 0.95,
  OFFICIAL_SUPPORT: 0.9,
  CURATED_RULE: 0.85,
  OFFICIAL_COMMUNITY: 0.7,
  THIRD_PARTY_REF: 0.6,
  CUSTOMER_EVIDENCE: 0.5,
  INFERRED: 0.3,
};

export interface TrustCalculationOptions {
  isLlmGenerated?: boolean;
  maxCeiling?: number;
}

/**
 * Calculates composite trust score for an array of evidence items.
 * Uses an asymptotic Noisy-OR uncertainty booster anchored on the maximum score.
 * Formula: Trust_composite = max(s_k) + (1.0 - max(s_k)) * (1.0 - prod_{corrob}(1.0 - 0.2 * s_k))
 */
export function calculateCompositeTrustScore(
  evidenceList: Array<{ trustScore?: number } | number>,
  options?: TrustCalculationOptions
): number {
  if (!evidenceList || evidenceList.length === 0) return 0.0;

  const rawScores: number[] = evidenceList.map((item) => {
    if (typeof item === 'number') return item;
    return item?.trustScore ?? 0.5;
  });

  if (rawScores.length === 0) return 0.0;

  const maxScore = Math.max(...rawScores);
  if (rawScores.length === 1) {
    return clampTrust(maxScore, options);
  }

  // Find index of first maximum score to treat as anchor
  const maxIndex = rawScores.indexOf(maxScore);
  const corroboratingScores = rawScores.filter((_, idx) => idx !== maxIndex);

  // Compute unclosed uncertainty fraction
  let prod = 1.0;
  for (const s of corroboratingScores) {
    prod *= 1.0 - 0.20 * Math.max(0.0, Math.min(1.0, s));
  }

  const uncertaintyClosed = 1.0 - prod;
  const composite = maxScore + (1.0 - maxScore) * uncertaintyClosed;

  return clampTrust(composite, options);
}

function clampTrust(value: number, options?: TrustCalculationOptions): number {
  let ceiling = 1.0;
  if (options?.isLlmGenerated) {
    ceiling = ConfidenceScoreMap.INFERRED; // 0.60 strict ceiling
  }
  if (options?.maxCeiling !== undefined && options.maxCeiling < ceiling) {
    ceiling = options.maxCeiling;
  }

  const rounded = Math.round((value + 1e-9) * 1000) / 1000;
  return Math.min(ceiling, Math.max(0.0, rounded));
}
