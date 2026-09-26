import { CANONICAL_ENGINES } from './api-client';

/**
 * Public solution pages (Part 02 §2.6) are generated from ONE typed source:
 * every group is bound to an engine domain of CANONICAL_ENGINES, so the engines
 * listed on a page are always the engines the platform actually ships.
 * Localized prose for each group lives in the i18n dictionaries under
 * `solutions.items[slug]`.
 */
export const SOLUTION_SLUGS = [
  'output-extensibility',
  'migration-clean-core',
  'integration',
  'release-transport',
  'operations',
  'warehouse-automation',
] as const;

export type SolutionSlug = (typeof SOLUTION_SLUGS)[number];

export type EngineDomain = (typeof CANONICAL_ENGINES)[number]['domain'];

export const SOLUTION_DOMAINS: Record<SolutionSlug, EngineDomain> = {
  'output-extensibility': 'Output & Extensibility',
  'migration-clean-core': 'Migration & Clean Core',
  integration: 'Integration',
  'release-transport': 'Release & Transport',
  operations: 'Operations',
  'warehouse-automation': 'Warehouse Automation',
};

export interface SolutionEngine {
  id: string;
  name: string;
  domain: string;
  description: string;
}

export function isSolutionSlug(value: unknown): value is SolutionSlug {
  return typeof value === 'string' && (SOLUTION_SLUGS as readonly string[]).includes(value);
}

export function enginesForSolution(slug: SolutionSlug): SolutionEngine[] {
  const domain = SOLUTION_DOMAINS[slug];
  return CANONICAL_ENGINES.filter((e) => e.domain === domain);
}

/** Solution page that covers a given engine (used to link knowledge articles). */
export function solutionForEngine(engineId: string): SolutionSlug | null {
  const engine = CANONICAL_ENGINES.find((e) => e.id === engineId);
  if (!engine) return null;
  const match = SOLUTION_SLUGS.find((slug) => SOLUTION_DOMAINS[slug] === engine.domain);
  return match ?? null;
}

export function engineName(engineId: string): string {
  return CANONICAL_ENGINES.find((e) => e.id === engineId)?.name ?? engineId;
}

export const TOTAL_ENGINE_COUNT = CANONICAL_ENGINES.length;
