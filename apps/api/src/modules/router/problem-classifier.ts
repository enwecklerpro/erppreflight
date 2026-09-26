import type { EngineType } from '@erppreflight/schemas';
import { CANONICAL_ENGINE_ORDER, engineName } from '../jobs/orchestration/engine-profiles';
import type { ArtifactSignals } from '../jobs/orchestration/artifact-signals';
import { normalizeProblemText, OBJECT_RULES, PHRASE_RULES, ROUTER_RULESET_VERSION } from './router-rules';

/**
 * Deterministic problem classifier (Part 05 §5.1): natural-language description +
 * artifact signals + project context + optional object identifier → ranked engine
 * suggestions. Pure function; identical input ⇒ identical output. Confidence is
 * RULE_DERIVED (≤ 0.85). It never fabricates findings.
 */

export interface ClassifierArtifact {
  fileId: string;
  fileName: string;
  signals: ArtifactSignals;
  contractAccepted: EngineType[] | null;
}

export interface ClassifierContext {
  sourceErp?: string | null;
  targetProduct?: string | null;
  deploymentType?: string | null;
  modules?: string[];
}

export interface ClassifierInput {
  text: string;
  objectIdentifier?: string | null;
  artifacts?: ClassifierArtifact[];
  context?: ClassifierContext;
}

export interface ClassifierReason {
  kind: 'PHRASE' | 'ARTIFACT' | 'CONTEXT' | 'OBJECT';
  detail: string;
  weight: number;
}

export interface ClassifiedEngine {
  engine: EngineType;
  engineName: string;
  role: 'PRIMARY' | 'SECONDARY';
  score: number;
  confidence: number;
  confidenceClass: 'RULE_DERIVED';
  why: ClassifierReason[];
  condition: string | null;
  matchingFileIds: string[];
}

export interface ClassificationResult {
  version: string;
  suggestions: ClassifiedEngine[];
  unmatched: boolean;
}

/** Score at which an engine is a primary route; below SECONDARY_MIN it is dropped. */
export const PRIMARY_MIN = 3;
export const SECONDARY_MIN = 2;
const PRIMARY_RATIO = 0.75;
const MAX_SUGGESTIONS = 6;

const MIGRATION_ENGINES: EngineType[] = ['ECC2CLOUD_NAVIGATOR', 'SPRO2CLOUD', 'SAP_GAP_RADAR', 'CLEAN_CORE_OBJECT_GUARD'];

export function classifyProblem(input: ClassifierInput): ClassificationResult {
  const text = normalizeProblemText(input.text);
  const scores = new Map<EngineType, { score: number; why: ClassifierReason[]; conditions: string[]; phrase: number; files: Set<string> }>();
  const bucket = (e: EngineType) => {
    let b = scores.get(e);
    if (!b) {
      b = { score: 0, why: [], conditions: [], phrase: 0, files: new Set() };
      scores.set(e, b);
    }
    return b;
  };

  // 1. Phrase rules (each rule counts once per engine).
  for (const rule of PHRASE_RULES) {
    if (!rule.test(text)) continue;
    for (const { engine, weight, condition } of rule.engines) {
      const b = bucket(engine);
      b.score += weight;
      b.phrase += weight;
      b.why.push({ kind: 'PHRASE', detail: rule.label, weight });
      if (condition) b.conditions.push(condition);
    }
  }

  // 2. Object identifier (first matching pattern only).
  const obj = (input.objectIdentifier ?? '').trim().toUpperCase();
  if (obj) {
    const rule = OBJECT_RULES.find((r) => r.pattern.test(obj));
    if (rule) {
      const b = bucket(rule.engine);
      b.score += rule.weight;
      b.why.push({ kind: 'OBJECT', detail: `${obj}: ${rule.label}`, weight: rule.weight });
    }
  }

  // 3. Artifact evidence: a specific content signal (optionally confirmed by the contract).
  for (const art of [...(input.artifacts ?? [])].sort((a, b) => a.fileName.localeCompare(b.fileName) || a.fileId.localeCompare(b.fileId))) {
    for (const engine of CANONICAL_ENGINE_ORDER) {
      const signal = art.signals.engines[engine];
      if (!signal) continue;
      if (art.contractAccepted && !art.contractAccepted.includes(engine) && !isPairedInput(engine)) continue;
      const b = bucket(engine);
      if (b.files.has(art.fileId)) continue;
      const weight = b.phrase > 0 ? 3 : 2.5;
      b.files.add(art.fileId);
      b.score += weight;
      b.why.push({ kind: 'ARTIFACT', detail: `${art.fileName}: ${signal}`, weight });
    }
  }

  // 4. Project context only strengthens engines that already matched.
  const ctx = input.context ?? {};
  const src = (ctx.sourceErp ?? '').toUpperCase();
  const cloud = `${ctx.targetProduct ?? ''} ${ctx.deploymentType ?? ''}`.toUpperCase().includes('CLOUD');
  for (const [engine, b] of scores) {
    if (b.score <= 0) continue;
    if (MIGRATION_ENGINES.includes(engine) && (src === 'SAP_ECC' || src === 'SAP_R3') && (ctx.targetProduct || ctx.deploymentType)) {
      b.score += 1;
      b.why.push({ kind: 'CONTEXT', detail: `project migrates from ${src} to ${ctx.targetProduct ?? ctx.deploymentType}`, weight: 1 });
    }
    if (engine === 'CLEAN_CORE_OBJECT_GUARD' && cloud) {
      b.score += 1;
      b.why.push({ kind: 'CONTEXT', detail: 'cloud target requires clean-core extensions', weight: 1 });
    }
    if (engine === 'OPD_GUARD' && (ctx.modules ?? []).some((m) => ['MM', 'SD', 'FI'].includes(m.toUpperCase()))) {
      b.score += 0.5;
      b.why.push({ kind: 'CONTEXT', detail: `project modules ${(ctx.modules ?? []).join('/')} produce output documents`, weight: 0.5 });
    }
  }

  // 5. Rank and assign roles.
  const ranked = [...scores.entries()]
    .filter(([, b]) => b.score >= SECONDARY_MIN)
    .sort((a, b) => b[1].score - a[1].score || CANONICAL_ENGINE_ORDER.indexOf(a[0]) - CANONICAL_ENGINE_ORDER.indexOf(b[0]))
    .slice(0, MAX_SUGGESTIONS);
  const top = ranked[0]?.[1].score ?? 0;
  const primaryCut = Math.max(PRIMARY_MIN, top * PRIMARY_RATIO);

  const suggestions: ClassifiedEngine[] = ranked.map(([engine, b], idx) => {
    const primary = b.score >= primaryCut || (idx === 0 && top < PRIMARY_MIN);
    const score = Math.round(b.score * 100) / 100;
    return {
      engine,
      engineName: engineName(engine),
      role: primary ? 'PRIMARY' : 'SECONDARY',
      score,
      confidence: Math.round(0.85 * Math.min(1, b.score / 6) * 100) / 100,
      confidenceClass: 'RULE_DERIVED',
      why: b.why,
      condition: primary ? null : b.conditions[0] ?? null,
      matchingFileIds: [...b.files].sort(),
    };
  });
  return { version: ROUTER_RULESET_VERSION, suggestions, unmatched: suggestions.length === 0 };
}

/** Engines whose input is split over several files (content signal suffices without a contract match). */
function isPairedInput(engine: EngineType): boolean {
  return engine === 'FORM_DOCTOR' || engine === 'API_CHANGE_GUARD';
}
