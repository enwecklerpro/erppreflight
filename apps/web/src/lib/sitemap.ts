import { DEFAULT_LOCALE, LOCALES, type Locale } from '../i18n/config';
import { LOCALIZED_PUBLIC_ROUTES, PUBLIC_INDEXABLE_ROUTES, getAppBaseUrl, hreflangAlternates, localizedUrl } from './seo';
import { fetchKnowledgeListSafe, type KnowledgeSummary } from './knowledge';
import { fetchEngineCatalog, fetchSitemapObjects } from './public-tools';

/**
 * Sitemap index split by content type (Part 02 §2.9, C §44):
 *   /sitemap.xml                 → sitemap index
 *   /sitemaps/pages.xml          → marketing, tools, docs and engine doc pages
 *   /sitemaps/knowledge.xml      → published knowledge articles
 *   /sitemaps/sap-objects-N.xml  → SAP object pages that pass the SEO quality gate
 * Only indexable URLs are listed; every child stays below the 50 000 URL limit.
 */

export const MAX_URLS_PER_SITEMAP = 50_000;

export interface SitemapUrl {
  loc: string;
  lastmod?: string | null;
  changefreq?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority?: number;
  /** hreflang → absolute URL (incl. x-default). */
  alternates?: Record<string, string>;
}

export function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function buildUrlset(urls: SitemapUrl[]): string {
  if (urls.length > MAX_URLS_PER_SITEMAP) throw new Error(`A sitemap may list at most ${MAX_URLS_PER_SITEMAP} URLs`);
  const body = urls
    .map((u) => {
      const parts = [`<loc>${xmlEscape(u.loc)}</loc>`];
      const lastmod = isoDate(u.lastmod);
      if (lastmod) parts.push(`<lastmod>${lastmod}</lastmod>`);
      if (u.changefreq) parts.push(`<changefreq>${u.changefreq}</changefreq>`);
      if (u.priority !== undefined) parts.push(`<priority>${u.priority.toFixed(2)}</priority>`);
      for (const [lang, href] of Object.entries(u.alternates ?? {})) {
        parts.push(`<xhtml:link rel="alternate" hreflang="${xmlEscape(lang)}" href="${xmlEscape(href)}"/>`);
      }
      return `<url>${parts.join('')}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
}

export function buildSitemapIndex(children: Array<{ loc: string; lastmod?: string | null }>): string {
  const body = children
    .map((c) => {
      const lastmod = isoDate(c.lastmod);
      return `<sitemap><loc>${xmlEscape(c.loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export function xmlResponse(xml: string, maxAge = 3600): Response {
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}`,
      'x-content-type-options': 'nosniff',
    },
  });
}

function priorityFor(route: string): number {
  if (route === '/') return 1.0;
  if (route.startsWith('/solutions') || route === '/pricing' || route.startsWith('/tools')) return 0.8;
  if (route.startsWith('/legal')) return 0.3;
  return 0.6;
}

/** Localized pages in every locale (hreflang), English-only public pages, engine documentation pages. */
export async function pageUrls(): Promise<SitemapUrl[]> {
  const base = getAppBaseUrl();
  const out: SitemapUrl[] = [];
  const localized = [...LOCALIZED_PUBLIC_ROUTES];
  try {
    const catalog = await fetchEngineCatalog();
    for (const e of catalog ?? []) localized.push(`/docs/engines/${e.engine_type}`);
  } catch {
    // Engine doc pages are omitted while the catalog is unavailable; the sitemap still renders.
  }
  for (const route of localized) {
    for (const locale of LOCALES) {
      out.push({
        loc: localizedUrl(locale, route),
        changefreq: route.startsWith('/knowledge') || route.startsWith('/tools') ? 'weekly' : 'monthly',
        priority: priorityFor(route) * (locale === DEFAULT_LOCALE ? 1 : 0.9),
        alternates: hreflangAlternates(route),
      });
    }
  }
  for (const route of PUBLIC_INDEXABLE_ROUTES) {
    out.push({ loc: `${base}${route}`, changefreq: route === '/changelog' ? 'weekly' : 'monthly', priority: 0.5 });
  }
  return out;
}

/** Published articles (UPDATE_REQUIRED articles are noindex and therefore not listed). */
export async function knowledgeUrls(): Promise<SitemapUrl[]> {
  const lists = await Promise.all(LOCALES.map((l) => fetchKnowledgeListSafe(l)));
  const bySlug = new Map<string, Map<Locale, KnowledgeSummary>>();
  LOCALES.forEach((locale, i) => {
    for (const article of lists[i] ?? []) {
      if (article.status && article.status !== 'PUBLISHED') continue;
      if (!bySlug.has(article.slug)) bySlug.set(article.slug, new Map());
      bySlug.get(article.slug)!.set(locale, article);
    }
  });
  const out: SitemapUrl[] = [];
  for (const [slug, variants] of bySlug) {
    const available = Array.from(variants.keys());
    for (const [locale, article] of variants) {
      out.push({
        loc: localizedUrl(locale, `/knowledge/${slug}`),
        lastmod: article.updatedAt,
        changefreq: 'monthly',
        priority: 0.7,
        alternates: hreflangAlternates(`/knowledge/${slug}`, available),
      });
    }
  }
  return out;
}

/** Number of SAP object child sitemaps (0 when the API is unavailable or nothing passes the gate). */
export async function sapObjectSitemapCount(): Promise<number> {
  try {
    const first = await fetchSitemapObjects(1);
    return first?.totalPages ?? 0;
  } catch {
    return 0;
  }
}

/** SAP object pages of one API page: Clean Core view always, migration view where applicable. */
export async function sapObjectUrls(page: number): Promise<SitemapUrl[] | null> {
  const data = await fetchSitemapObjects(page);
  if (!data || page > data.totalPages) return null;
  const out: SitemapUrl[] = [];
  for (const item of data.items) {
    if (!item.slug) continue;
    const paths = [`/sap/clean-core/${item.slug}`, ...(item.migration ? [`/sap/cloud/migration/${item.slug}`] : [])];
    for (const path of paths) {
      for (const locale of LOCALES) {
        out.push({
          loc: localizedUrl(locale, path),
          lastmod: item.lastVerifiedAt,
          changefreq: 'weekly',
          priority: 0.6,
          alternates: hreflangAlternates(path),
        });
      }
    }
  }
  return out;
}

export const SITEMAP_FILE_PATTERN = /^(pages|knowledge|sap-objects-([1-9]\d{0,3}))\.xml$/;
