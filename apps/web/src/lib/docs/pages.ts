/**
 * Documentation pages (C §46). Typed, MDX-free content rendered with the safe
 * markdown renderer (see ARCHITECTURE_DECISIONS.md ADR-021). The engine catalog
 * and file-format pages are generated from the analysis service's live engine
 * catalog through the API (GET /api/v1/public/tools/engines).
 */
export const DOC_SLUGS = [
  'getting-started',
  'engines',
  'file-formats',
  'security',
  'api-cli',
  'local-agent',
  'faq',
] as const;
export type DocSlug = (typeof DOC_SLUGS)[number];

export function isDocSlug(value: string): value is DocSlug {
  return (DOC_SLUGS as readonly string[]).includes(value);
}

export interface DocSection {
  /** Anchor id (stable across locales). */
  id: string;
  title: string;
  /** Safe markdown (components/public/markdown.tsx). */
  body: string;
}

export interface DocPage {
  title: string;
  description: string;
  sections: DocSection[];
  /** FAQ pages expose their Q&A as FAQPage structured data. */
  faq?: Array<{ question: string; answer: string }>;
}

/** Date the documentation content was last checked against the running product (ISO date). */
export const DOCS_REVIEWED = '2026-09-26';
