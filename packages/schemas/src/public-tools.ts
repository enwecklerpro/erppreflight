/**
 * Shared contracts of the public free tools and programmatic SEO pages
 * (Part 01 §1.11, Part 02 §2.8/§2.9). Pure functions only — used by the API
 * (resolution, sitemap listing) and the web app (links, canonical URLs).
 */

/**
 * URL slug of a global SAP object key, e.g. `MARA` → `mara`,
 * `I_PRODUCT` → `i-product`, `/SAPAPO/MATKEY` → `~sapapo~matkey`.
 * SAP repository keys never contain `-` or `~`, so the mapping is reversible.
 * Keys with other characters (blanks in service keys, …) have no SEO page: null.
 */
export function objectKeyToSlug(objectKey: string): string | null {
  if (!/^[A-Z0-9_/]{1,200}$/.test(objectKey)) return null;
  return objectKey.toLowerCase().replace(/_/g, '-').replace(/\//g, '~');
}

export const OBJECT_SLUG_PATTERN = /^[a-z0-9~-]{1,200}$/;

/** Inverse of objectKeyToSlug; null for strings that cannot be a slug. */
export function slugToObjectKey(slug: string): string | null {
  if (!OBJECT_SLUG_PATTERN.test(slug)) return null;
  return slug.toUpperCase().replace(/-/g, '_').replace(/~/g, '/');
}

/**
 * Programmatic SEO quality gate (Part 02 §2.9): minimum number of graph-derived
 * related objects before an object page may be indexed.
 */
export const SEO_MIN_RELATED_OBJECTS = 2;

/** Sitemap protocol limit is 50,000 URLs per file; object pages emit up to 4 URLs (2 page kinds × 2 locales). */
export const SEO_SITEMAP_OBJECTS_PER_PAGE = 10_000;

export type SeoGateCheck =
  | 'GLOBAL_REVIEWED'
  | 'OBJECT_TYPE'
  | 'RELEASE_STATE'
  | 'SUCCESSOR_OR_EXPLICIT_NONE'
  | 'EVIDENCE_SOURCE'
  | 'RELATED_OBJECTS';

export interface SeoGateInput {
  isGlobalPublished: boolean;
  objectType: string | null;
  /** Official release-contract states (one per release). */
  states: Array<{ supportState: string; successorCount: number; successorConcept: string | null }>;
  /** Evidence sources of those states with their last retrieval date. */
  evidence: Array<{ trustLevel: string; retrievedAt: string | null }>;
  relatedCount: number;
}

export interface SeoGateResult {
  indexable: boolean;
  checks: Record<SeoGateCheck, boolean>;
  failed: SeoGateCheck[];
}

/** Deterministic gate evaluation shared by the page renderer and tests. */
export function evaluateSeoGate(input: SeoGateInput): SeoGateResult {
  const needsSuccessor = input.states.some((s) => s.supportState !== 'RELEASED');
  const hasSuccessor = input.states.some((s) => s.successorCount > 0 || Boolean(s.successorConcept));
  const checks: Record<SeoGateCheck, boolean> = {
    GLOBAL_REVIEWED: input.isGlobalPublished,
    OBJECT_TYPE: Boolean(input.objectType),
    RELEASE_STATE: input.states.length > 0,
    SUCCESSOR_OR_EXPLICIT_NONE: input.states.length > 0 && (!needsSuccessor || hasSuccessor),
    EVIDENCE_SOURCE:
      input.evidence.length > 0 &&
      input.evidence.every((e) => e.trustLevel.startsWith('OFFICIAL_') && Boolean(e.retrievedAt)),
    RELATED_OBJECTS: input.relatedCount >= SEO_MIN_RELATED_OBJECTS,
  };
  const failed = (Object.keys(checks) as SeoGateCheck[]).filter((k) => !checks[k]);
  return { indexable: failed.length === 0, checks, failed };
}
