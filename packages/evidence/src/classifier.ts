import { ConfidenceClass, ConfidenceScoreMap } from '@erppreflight/schemas';

export { ConfidenceScoreMap };

export interface ProvenanceClassificationOptions {
  isExactParserOrAstMatch?: boolean;
  isDeterministicRule?: boolean;
  isLlmGenerated?: boolean;
  hasEvidence?: boolean;
}

export function classifyProvenance(options: ProvenanceClassificationOptions): {
  confidence: ConfidenceClass;
  score: number;
} {
  // Hard invariant: Missing mandatory evidence demotes to UNKNOWN
  if (!options.hasEvidence) {
    return { confidence: 'UNKNOWN', score: ConfidenceScoreMap.UNKNOWN };
  }

  // Hard invariant: LLM outputs can NEVER exceed INFERRED (0.60)
  if (options.isLlmGenerated) {
    return { confidence: 'INFERRED', score: ConfidenceScoreMap.INFERRED };
  }

  // Deterministic AST or exact parser match
  if (options.isExactParserOrAstMatch) {
    return { confidence: 'VERIFIED', score: ConfidenceScoreMap.VERIFIED };
  }

  // Deterministic rule evaluation
  if (options.isDeterministicRule) {
    return { confidence: 'RULE_DERIVED', score: ConfidenceScoreMap.RULE_DERIVED };
  }

  return { confidence: 'UNKNOWN', score: ConfidenceScoreMap.UNKNOWN };
}

export * from './trust-score';

