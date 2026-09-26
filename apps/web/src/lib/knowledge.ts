import { z } from 'zod';
import type { Locale } from '../i18n/config';

/**
 * Server-side client for the public knowledge base API
 * (GET /api/v1/public/knowledge[/:slug]?locale=). Used by server components,
 * the sitemap and solution pages. Responses are validated with Zod.
 */

const LocaleSchema = z.enum(['en', 'de']);

export const KnowledgeSummarySchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  locale: LocaleSchema,
  title: z.string(),
  summary: z.string(),
  relatedEngineTypes: z.array(z.string()),
  targetReleases: z.array(z.string()),
  reviewedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  version: z.number().int(),
});

export const KnowledgeArticleSchema = KnowledgeSummarySchema.extend({
  bodyMarkdown: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  availableLocales: z.array(LocaleSchema),
});

const ListSchema = z.object({ locale: LocaleSchema, items: z.array(KnowledgeSummarySchema) });

export type KnowledgeSummary = z.infer<typeof KnowledgeSummarySchema>;
export type KnowledgeArticle = z.infer<typeof KnowledgeArticleSchema>;

/** Revalidation window for knowledge content (seconds). */
export const KNOWLEDGE_REVALIDATE_SECONDS = 300;

export class KnowledgeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeUnavailableError';
  }
}

/**
 * Base URL of the API as seen from the web server. API_INTERNAL_URL lets a
 * container reach the API on the internal network; otherwise the public URL is used.
 */
export function serverApiBase(): string {
  const raw = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  return raw.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${serverApiBase()}/api/v1${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate: KNOWLEDGE_REVALIDATE_SECONDS, tags: ['knowledge'] },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new KnowledgeUnavailableError(`Knowledge API unreachable: ${(err as Error).message}`);
  }
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new KnowledgeUnavailableError(`Knowledge API responded with HTTP ${res.status}`);
  return { status: res.status, body: await res.json() };
}

export async function fetchKnowledgeList(locale: Locale): Promise<KnowledgeSummary[]> {
  const { body } = await getJson(`/public/knowledge?locale=${locale}`);
  const parsed = ListSchema.safeParse(body);
  if (!parsed.success) throw new KnowledgeUnavailableError('Knowledge API returned an unexpected payload');
  return parsed.data.items;
}

/** Returns null when no published article exists for this slug and locale. */
export async function fetchKnowledgeArticle(slug: string, locale: Locale): Promise<KnowledgeArticle | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const { status, body } = await getJson(`/public/knowledge/${encodeURIComponent(slug)}?locale=${locale}`);
  if (status === 404) return null;
  const parsed = KnowledgeArticleSchema.safeParse(body);
  if (!parsed.success) throw new KnowledgeUnavailableError('Knowledge API returned an unexpected payload');
  return parsed.data;
}

/** Never throws: used where the knowledge base is optional (sitemap, solution pages). */
export async function fetchKnowledgeListSafe(locale: Locale): Promise<KnowledgeSummary[] | null> {
  try {
    return await fetchKnowledgeList(locale);
  } catch {
    return null;
  }
}
