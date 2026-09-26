import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../i18n/config';
import {
  LOCALIZED_PUBLIC_ROUTES,
  PUBLIC_INDEXABLE_ROUTES,
  getAppBaseUrl,
  hreflangAlternates,
  localizedUrl,
} from '../lib/seo';
import { fetchKnowledgeListSafe, type KnowledgeSummary } from '../lib/knowledge';

// Rendered on request so newly published articles appear without a rebuild;
// the knowledge API responses themselves are cached for 5 minutes.
export const dynamic = 'force-dynamic';

function priorityFor(route: string): number {
  if (route === '/') return 1.0;
  if (route.startsWith('/solutions') || route === '/pricing') return 0.8;
  if (route.startsWith('/legal')) return 0.3;
  return 0.6;
}

/**
 * Public pages only: localized pages in every locale (with hreflang alternates),
 * English-only public pages and the published knowledge articles from the API.
 * If the API is unreachable, articles are omitted instead of failing the sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getAppBaseUrl();
  const entries: MetadataRoute.Sitemap = [];

  for (const route of LOCALIZED_PUBLIC_ROUTES) {
    for (const locale of LOCALES) {
      entries.push({
        url: localizedUrl(locale, route),
        changeFrequency: route.startsWith('/knowledge') ? 'weekly' : 'monthly',
        priority: priorityFor(route) * (locale === DEFAULT_LOCALE ? 1 : 0.9),
        alternates: { languages: hreflangAlternates(route) },
      });
    }
  }

  for (const route of PUBLIC_INDEXABLE_ROUTES) {
    entries.push({
      url: `${baseUrl}${route}`,
      changeFrequency: route === '/changelog' ? 'weekly' : 'monthly',
      priority: 0.5,
    });
  }

  const lists = await Promise.all(LOCALES.map((l) => fetchKnowledgeListSafe(l)));
  const bySlug = new Map<string, Map<Locale, KnowledgeSummary>>();
  LOCALES.forEach((locale, i) => {
    for (const article of lists[i] ?? []) {
      if (!bySlug.has(article.slug)) bySlug.set(article.slug, new Map());
      bySlug.get(article.slug)!.set(locale, article);
    }
  });
  for (const [slug, variants] of bySlug) {
    const available = Array.from(variants.keys());
    for (const [locale, article] of variants) {
      entries.push({
        url: localizedUrl(locale, `/knowledge/${slug}`),
        lastModified: article.updatedAt,
        changeFrequency: 'monthly',
        priority: 0.7,
        alternates: { languages: hreflangAlternates(`/knowledge/${slug}`, available) },
      });
    }
  }

  return entries;
}
