import { z } from 'zod';
import { customInstance } from './api/custom-instance';
import { serverApiBase } from './knowledge';

/**
 * Contracts of the public free tools and programmatic SEO pages
 * (API: /api/v1/public/tools/*). Every payload is validated with Zod — the web
 * app never renders unvalidated API data. Browser calls go through
 * customInstance (TanStack Query); server components use fetchPublicTool*,
 * cached by the Next.js data cache.
 */

export const SupportStateSchema = z.enum([
  'RELEASED',
  'DEPRECATED',
  'NOT_RELEASED',
  'NOT_TO_BE_RELEASED_STABLE',
  'CLASSIC_API',
  'NO_API',
  'SUPPORTED',
  'BLOCKED',
  'UNKNOWN',
]);
export type SupportState = z.infer<typeof SupportStateSchema>;

export const VerdictSchema = z.enum([
  'RELEASED',
  'RELEASED_ELSEWHERE',
  'SUCCESSOR_AVAILABLE',
  'CONCEPT_AVAILABLE',
  'NOT_RELEASED_NO_SUCCESSOR',
  'CLASSIC_API_ONLY',
  'NO_OFFICIAL_STATE',
]);
export type Verdict = z.infer<typeof VerdictSchema>;

const SnapshotSchema = z
  .object({
    seq: z.number(),
    adapterId: z.string(),
    contentSha256: z.string(),
    parserVersion: z.string(),
    publishedAt: z.string().nullable(),
  })
  .nullable();

export const MetaSchema = z.object({
  snapshot: SnapshotSchema,
  lastRetrievedAt: z.string().nullable(),
  sources: z.array(
    z.object({
      sourceKey: z.string(),
      title: z.string(),
      trustLevel: z.string(),
      publisher: z.string().nullable(),
      url: z.string().nullable(),
      lastRetrievedAt: z.string().nullable(),
    })
  ),
  coverage: z.object({
    objectTypes: z.record(z.number()),
    totalObjects: z.number(),
    transactionCodes: z.number(),
  }),
});
export type ToolsMeta = z.infer<typeof MetaSchema>;

const EvidenceSchema = z.object({
  title: z.string(),
  url: z.string().nullable(),
  trustLevel: z.string(),
  retrievedAt: z.string().nullable(),
});

const SuccessorSchema = z.object({
  sapObjectType: z.string(),
  objectKey: z.string(),
  slug: z.string().nullable(),
  supportState: SupportStateSchema.nullable(),
});

export const ReleaseFactSchema = z.object({
  productCode: z.string(),
  editionCode: z.string(),
  editionName: z.string(),
  releaseId: z.string(),
  releaseCode: z.string(),
  releaseLabel: z.string(),
  sortOrder: z.number(),
  isRolling: z.boolean(),
  scheme: z.string(),
  state: z.string(),
  supportState: SupportStateSchema,
  cleanCoreLevel: z.string().nullable(),
  successorClassification: z.string().nullable(),
  successorConcept: z.string().nullable(),
  successors: z.array(SuccessorSchema),
  evidence: EvidenceSchema,
});
export type ReleaseFact = z.infer<typeof ReleaseFactSchema>;

const LifecycleSchema = z.array(
  z.object({
    editionCode: z.string(),
    editionName: z.string(),
    currentState: SupportStateSchema,
    currentRelease: z.string(),
    firstReleasedIn: z.string().nullable(),
    firstDeprecatedIn: z.string().nullable(),
    releaseCount: z.number(),
  })
);

const DescribedObjectSchema = z.object({
  objectKey: z.string(),
  sapObjectType: z.string(),
  objectType: z.string(),
  applicationComponent: z.string().nullable(),
  softwareComponent: z.string().nullable(),
  slug: z.string().nullable(),
  verdict: VerdictSchema,
  headline: ReleaseFactSchema.nullable(),
  releases: z.array(ReleaseFactSchema),
  classicApi: z
    .object({ state: z.string(), supportState: SupportStateSchema, cleanCoreLevel: z.string().nullable(), evidence: EvidenceSchema })
    .nullable(),
});
export type DescribedObject = z.infer<typeof DescribedObjectSchema>;

export const SuccessorLookupSchema = z.object({
  query: z.string(),
  snapshot: SnapshotSchema,
  lastRetrievedAt: z.string().nullable(),
  coverage: z.object({ transactionCodes: z.number() }),
  results: z.array(DescribedObjectSchema),
});
export type SuccessorLookup = z.infer<typeof SuccessorLookupSchema>;

export const ApiLifecycleSchema = z.object({
  query: z.string().nullable(),
  mode: z.enum(['SEARCH', 'DEPRECATED_BROWSE']),
  snapshot: SnapshotSchema,
  lastRetrievedAt: z.string().nullable(),
  total: z.number().nullable(),
  offset: z.number(),
  results: z.array(DescribedObjectSchema.extend({ lifecycle: LifecycleSchema })),
});
export type ApiLifecycle = z.infer<typeof ApiLifecycleSchema>;

export const ReleasesSchema = z.object({
  releases: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      label: z.string(),
      sortOrder: z.number(),
      isRolling: z.boolean(),
      editionCode: z.string(),
      editionName: z.string(),
      productCode: z.string(),
      productName: z.string(),
    })
  ),
});
export type PublicRelease = z.infer<typeof ReleasesSchema>['releases'][number];

export const CHANGE_TYPES = [
  'ADDED',
  'REMOVED',
  'NEWLY_RELEASED',
  'NEWLY_DEPRECATED',
  'RELEASE_WITHDRAWN',
  'STATE_CHANGED',
  'SUCCESSOR_CHANGED',
  'ATTRIBUTES_CHANGED',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

const DiffStateSchema = z
  .object({
    supportState: SupportStateSchema,
    state: z.string(),
    successors: z.array(z.object({ sapObjectType: z.string(), objectKey: z.string() }).passthrough()).nullable(),
  })
  .nullable();

export const ReleaseDiffSchema = z.object({
  snapshotSeq: z.number().optional(),
  summary: z.record(z.number()),
  total: z.number(),
  items: z.array(
    z.object({
      sapObjectType: z.string(),
      objectKey: z.string(),
      objectType: z.string(),
      changeType: z.enum(CHANGE_TYPES),
      slug: z.string().nullable(),
      previous: DiffStateSchema,
      current: DiffStateSchema,
    })
  ),
});
export type ReleaseDiff = z.infer<typeof ReleaseDiffSchema>;

export const SearchSchema = z.object({
  query: z.string(),
  locale: z.enum(['en', 'de']),
  articles: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      summary: z.string(),
      updateRequired: z.boolean(),
      reviewedAt: z.string().nullable(),
      targetReleases: z.array(z.string()),
      relatedEngineTypes: z.array(z.string()),
      snippet: z.string(),
    })
  ),
  objects: z.array(
    z.object({
      objectKey: z.string(),
      sapObjectType: z.string(),
      objectType: z.string(),
      matchType: z.string(),
      slug: z.string().nullable(),
      states: z.array(z.object({ editionCode: z.string(), scheme: z.string(), supportState: SupportStateSchema }).passthrough()),
    })
  ),
  rules: z.array(
    z.object({ engineType: z.string(), engineName: z.string(), code: z.string(), title: z.string(), severity: z.string() })
  ),
  engineCatalogAvailable: z.boolean(),
  snapshot: z.object({ id: z.string(), seq: z.number() }).nullable(),
});
export type SearchResult = z.infer<typeof SearchSchema>;

/** Same limits as the API (XmlFieldCheckSchema) so the form rejects what the server would reject. */
export const XML_CHECK_MAX_CHARS = 90_000;
export const XmlCheckFormSchema = z.object({
  xml: z
    .string()
    .min(1, 'xmlRequired')
    .max(XML_CHECK_MAX_CHARS, 'xmlTooLarge'),
  path: z
    .string()
    .trim()
    .min(1, 'pathRequired')
    .max(300, 'pathTooLong')
    .regex(/^\//, 'pathSlash'),
  namespaces: z
    .string()
    .max(4000)
    .refine((v) => parseNamespaceLines(v) !== null, 'namespacesInvalid'),
});
export type XmlCheckForm = z.infer<typeof XmlCheckFormSchema>;

/** "prefix=uri" per line → record; null when a line is malformed. */
export function parseNamespaceLines(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-Za-z_][\w.-]*)\s*=\s*(\S{1,500})$/.exec(line);
    if (!m) return null;
    out[m[1]] = m[2];
  }
  return Object.keys(out).length > 20 ? null : out;
}

export const XmlCheckResultSchema = z.object({
  path: z.string(),
  bytes: z.number(),
  wellFormed: z.boolean(),
  rejected: z.string().nullable(),
  error: z.string().nullable(),
  exists: z.boolean(),
  matchCount: z.number(),
  matches: z.array(
    z.object({
      kind: z.enum(['element', 'attribute']),
      path: z.string(),
      localName: z.string(),
      namespaceUri: z.string().nullable(),
      line: z.number(),
      column: z.number(),
      value: z.string().nullable(),
      valueTruncated: z.boolean(),
      childElementCount: z.number(),
    })
  ),
  issues: z.array(
    z.object({ code: z.string(), severity: z.enum(['ERROR', 'WARNING', 'INFO']), message: z.string(), step: z.string().nullable() })
  ),
  document: z
    .object({
      rootLocalName: z.string(),
      rootNamespaceUri: z.string().nullable(),
      namespaces: z.array(z.object({ prefix: z.string(), uri: z.string(), line: z.number() })),
      elementCount: z.number(),
      maxDepth: z.number(),
    })
    .nullable(),
});
export type XmlCheckResult = z.infer<typeof XmlCheckResultSchema>;

const RelatedSchema = z.object({
  objectKey: z.string(),
  sapObjectType: z.string(),
  objectType: z.string(),
  slug: z.string().nullable(),
  relation: z.enum(['SUCCESSOR', 'REPLACES', 'SHARES_SUCCESSOR', 'CO_SUCCESSOR']),
  headline: ReleaseFactSchema.nullable(),
});

export const SeoObjectSchema = z.object({
  slug: z.string(),
  object: z.object({
    objectKey: z.string(),
    sapObjectType: z.string(),
    objectType: z.string(),
    applicationComponent: z.string().nullable(),
    softwareComponent: z.string().nullable(),
    description: z.string().nullable(),
    displayName: z.string().nullable(),
  }),
  verdict: VerdictSchema,
  headline: ReleaseFactSchema.nullable(),
  releases: z.array(ReleaseFactSchema),
  classicApi: ReleaseFactSchema.nullable(),
  lifecycle: LifecycleSchema,
  successors: z.array(SuccessorSchema),
  related: z.array(RelatedSchema),
  relatedTotal: z.number(),
  alternates: z.array(
    z.object({ objectKey: z.string(), sapObjectType: z.string(), objectType: z.string(), headline: ReleaseFactSchema.nullable() })
  ),
  evidence: z.array(EvidenceSchema),
  lastVerifiedAt: z.string().nullable(),
  snapshot: SnapshotSchema,
  gate: z.object({ indexable: z.boolean(), checks: z.record(z.boolean()), failed: z.array(z.string()) }),
  migration: z.object({ applicable: z.boolean(), indexable: z.boolean() }),
});
export type SeoObject = z.infer<typeof SeoObjectSchema>;

export const SitemapObjectsSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
  items: z.array(
    z.object({ slug: z.string().nullable(), objectKey: z.string(), lastVerifiedAt: z.string().nullable(), migration: z.boolean() })
  ),
});
export type SitemapObjects = z.infer<typeof SitemapObjectsSchema>;

export const EngineCatalogSchema = z.array(
  z.object({
    engine_type: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.string(),
    domain: z.string(),
    target_releases: z.array(z.string()),
    supported_artifact_types: z.array(z.string()),
    rule_count: z.number(),
    rule_codes: z.array(z.string()),
    input_validation_rule_codes: z.array(z.string()),
    rules: z.array(
      z.object({ code: z.string(), title: z.string(), defaultSeverity: z.string(), category: z.string(), remediation: z.string() })
    ),
    input_contract: z
      .object({
        acceptedFormats: z.array(z.string()),
        summary: z.string(),
        required: z.array(z.string()),
        notes: z.array(z.string()),
      })
      .nullable()
      .optional(),
  })
);
export type EngineCatalog = z.infer<typeof EngineCatalogSchema>;
export type EngineEntry = EngineCatalog[number];

// ---------------------------------------------------------------------------
// Browser (TanStack Query) fetchers
// ---------------------------------------------------------------------------
const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const toolKeys = {
  all: ['public-tools'] as const,
  meta: ['public-tools', 'meta'] as const,
  successors: (q: string) => ['public-tools', 'successors', q] as const,
  api: (q: string, deprecated: boolean, offset: number) => ['public-tools', 'api', q, deprecated, offset] as const,
  releases: ['public-tools', 'releases'] as const,
  diff: (from: string, to: string, changeType: string, offset: number) => ['public-tools', 'diff', from, to, changeType, offset] as const,
  search: (q: string, locale: string) => ['public-tools', 'search', q, locale] as const,
};

export async function fetchToolsMeta(signal?: AbortSignal) {
  return MetaSchema.parse(await customInstance<unknown>('/public/tools/meta', { signal }));
}
export async function fetchSuccessors(q: string, signal?: AbortSignal) {
  return SuccessorLookupSchema.parse(await customInstance<unknown>(`/public/tools/successors${qs({ q, limit: 10 })}`, { signal }));
}
export async function fetchApiLifecycle(p: { q?: string; deprecated?: boolean; offset?: number }, signal?: AbortSignal) {
  return ApiLifecycleSchema.parse(
    await customInstance<unknown>(
      `/public/tools/api-lifecycle${qs({ q: p.q, deprecated: p.deprecated ? 'true' : undefined, offset: p.offset, limit: 20 })}`,
      { signal }
    )
  );
}
export async function fetchPublicReleases(signal?: AbortSignal) {
  return ReleasesSchema.parse(await customInstance<unknown>('/public/tools/releases', { signal }));
}
export async function fetchPublicReleaseDiff(
  p: { fromRelease: string; toRelease: string; changeType?: string; offset?: number },
  signal?: AbortSignal
) {
  return ReleaseDiffSchema.parse(
    await customInstance<unknown>(`/public/tools/release-diff${qs({ ...p, limit: 25 })}`, { signal })
  );
}
export async function fetchPublicSearch(q: string, locale: string, signal?: AbortSignal) {
  return SearchSchema.parse(await customInstance<unknown>(`/public/tools/search${qs({ q, locale })}`, { signal }));
}
export async function postXmlCheck(body: { xml: string; path: string; namespaces?: Record<string, string> }) {
  return XmlCheckResultSchema.parse(
    await customInstance<unknown>('/public/tools/xml-field-check', { method: 'POST', body: JSON.stringify(body) })
  );
}

// ---------------------------------------------------------------------------
// Server-side fetchers (server components, sitemaps) — cached for an hour
// ---------------------------------------------------------------------------
export class PublicToolsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicToolsUnavailableError';
  }
}

export const SEO_REVALIDATE_SECONDS = 3600;

async function serverGet<T>(path: string, schema: z.ZodType<T>, revalidate = SEO_REVALIDATE_SECONDS): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${serverApiBase()}/api/v1/public/tools${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate, tags: ['public-tools'] },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new PublicToolsUnavailableError(`Public tools API unreachable: ${(err as Error).message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new PublicToolsUnavailableError(`Public tools API responded with HTTP ${res.status}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new PublicToolsUnavailableError('Public tools API returned an unexpected payload');
  return parsed.data;
}

export function fetchSeoObject(slug: string) {
  return serverGet(`/seo/objects/${encodeURIComponent(slug)}`, SeoObjectSchema);
}
export function fetchSitemapObjects(page: number) {
  return serverGet(`/seo/sitemap/objects?page=${page}`, SitemapObjectsSchema);
}
export function fetchServerToolsMeta() {
  return serverGet('/meta', MetaSchema, 300);
}
export function fetchEngineCatalog() {
  return serverGet('/engines', EngineCatalogSchema, 300);
}
