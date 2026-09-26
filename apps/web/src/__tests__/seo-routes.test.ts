import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import robots from '../app/robots';
import { GET as sitemapIndex } from '../app/sitemap.xml/route';
import { GET as childSitemap } from '../app/sitemaps/[file]/route';
import {
  LOCALIZED_PUBLIC_ROUTES,
  LOCALIZED_PUBLIC_SEGMENTS,
  PRIVATE_ROUTE_PREFIXES,
  PUBLIC_INDEXABLE_ROUTES,
  SITEMAP_ROUTE_SEGMENTS,
  hreflangAlternates,
  publicPageMetadata,
} from '../lib/seo';
import { MAX_URLS_PER_SITEMAP, buildSitemapIndex, buildUrlset, pageUrls, knowledgeUrls, xmlEscape } from '../lib/sitemap';
import { AUTH_REQUIRED_PREFIXES } from '../lib/routing';

const APP_DIR = path.resolve(__dirname, '../app');
const LOCALE_DIR = path.join(APP_DIR, '[locale]');

function publicRouteExists(route: string): boolean {
  const dir = path.join(APP_DIR, route.replace(/^\//, ''));
  return fs.existsSync(path.join(dir, 'page.tsx'));
}

/** Resolves a localized route against app/[locale] including dynamic segments. */
function localizedRouteExists(route: string): boolean {
  if (route === '/') return fs.existsSync(path.join(LOCALE_DIR, 'page.tsx'));
  let dir = LOCALE_DIR;
  for (const segment of route.split('/').filter(Boolean)) {
    const exact = path.join(dir, segment);
    if (fs.existsSync(exact)) {
      dir = exact;
      continue;
    }
    const dynamic = fs.readdirSync(dir).find((d) => /^\[[^.]+\]$/.test(d));
    if (!dynamic) return false;
    dir = path.join(dir, dynamic);
  }
  return fs.existsSync(path.join(dir, 'page.tsx'));
}

afterEach(() => vi.unstubAllGlobals());

describe('SEO route inventory', () => {
  it('pages sitemap lists localized pages in both locales plus English-only public pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const entries = await pageUrls();
    expect(entries.length).toBe(LOCALIZED_PUBLIC_ROUTES.length * 2 + PUBLIC_INDEXABLE_ROUTES.length);
    for (const route of PUBLIC_INDEXABLE_ROUTES) expect(publicRouteExists(route), route).toBe(true);
    for (const route of LOCALIZED_PUBLIC_ROUTES) expect(localizedRouteExists(route), route).toBe(true);
    const urls = entries.map((e) => e.loc);
    expect(urls).toContain('https://erppreflight.com/en');
    expect(urls).toContain('https://erppreflight.com/de');
    expect(urls).toContain('https://erppreflight.com/de/pricing');
    expect(urls).toContain('https://erppreflight.com/de/tools/clean-core-lookup');
    expect(urls).toContain('https://erppreflight.com/en/docs/getting-started');
    for (const bad of ['/lab', '/trust-center', '/projects', '/dashboard', 'erppreflight.com/pricing', '/knowledge-graph/lookup']) {
      expect(urls.some((u) => u.endsWith(bad))).toBe(false);
    }
  });

  it('knowledge sitemap lists published articles with hreflang alternates and skips flagged ones', async () => {
    const item = (locale: string, slug: string, status = 'PUBLISHED') => ({
      slug, locale, title: 't', summary: 's', relatedEngineTypes: [], targetReleases: [],
      reviewedAt: null, publishedAt: null, updatedAt: '2026-09-26T00:00:00.000Z', version: 1, status,
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const locale = new URL(url).searchParams.get('locale')!;
      return new Response(JSON.stringify({ locale, items: [item(locale, 'change-pointers-bd52'), item(locale, 'stale-one', 'UPDATE_REQUIRED')] }), { status: 200 });
    }));
    const entries = await knowledgeUrls();
    const article = entries.find((e) => e.loc === 'https://erppreflight.com/de/knowledge/change-pointers-bd52');
    expect(article).toBeDefined();
    expect(article!.alternates).toMatchObject({
      en: 'https://erppreflight.com/en/knowledge/change-pointers-bd52',
      de: 'https://erppreflight.com/de/knowledge/change-pointers-bd52',
    });
    expect(entries.some((e) => e.loc.includes('stale-one'))).toBe(false);
  });

  it('sitemap index is split by content type and paginates SAP object sitemaps from the API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/seo/sitemap/objects')) {
        const page = Number(new URL(url).searchParams.get('page'));
        return new Response(JSON.stringify({
          page, pageSize: 10000, total: 3, totalPages: 2,
          items: page === 1
            ? [{ slug: 'mara', objectKey: 'MARA', lastVerifiedAt: '2026-09-26T00:00:00.000Z', migration: true },
               { slug: 'i-product', objectKey: 'I_PRODUCT', lastVerifiedAt: null, migration: false }]
            : [{ slug: 'bseg', objectKey: 'BSEG', lastVerifiedAt: null, migration: true }],
        }), { status: 200 });
      }
      throw new Error('offline');
    }));
    const index = await (await sitemapIndex()).text();
    expect(index).toContain('<sitemapindex');
    for (const child of ['pages.xml', 'knowledge.xml', 'sap-objects-1.xml', 'sap-objects-2.xml']) {
      expect(index).toContain(`https://erppreflight.com/sitemaps/${child}`);
    }
    expect(index).not.toContain('sap-objects-3.xml');
    const res = await childSitemap(new Request('http://x'), { params: Promise.resolve({ file: 'sap-objects-1.xml' }) });
    const xml = await res.text();
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(xml).toContain('<loc>https://erppreflight.com/en/sap/clean-core/mara</loc>');
    expect(xml).toContain('<loc>https://erppreflight.com/de/sap/cloud/migration/mara</loc>');
    expect(xml).toContain('<loc>https://erppreflight.com/de/sap/clean-core/i-product</loc>');
    expect(xml).not.toContain('/sap/cloud/migration/i-product');
    expect(xml).toContain('hreflang="x-default"');
    const missing = await childSitemap(new Request('http://x'), { params: Promise.resolve({ file: 'sap-objects-9.xml' }) });
    expect(missing.status).toBe(404);
    const bad = await childSitemap(new Request('http://x'), { params: Promise.resolve({ file: '../etc.xml' }) });
    expect(bad.status).toBe(404);
  });

  it('sitemap index survives an unreachable API and XML is escaped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const index = await (await sitemapIndex()).text();
    expect(index).toContain('/sitemaps/pages.xml');
    expect(index).not.toContain('sap-objects');
    expect(xmlEscape('a&b<"c">')).toBe('a&amp;b&lt;&quot;c&quot;&gt;');
    expect(buildSitemapIndex([{ loc: 'https://x/a?b=1&c=2' }])).toContain('https://x/a?b=1&amp;c=2');
    expect(() => buildUrlset(Array.from({ length: MAX_URLS_PER_SITEMAP + 1 }, () => ({ loc: 'https://x' })))).toThrow();
  });

  it('robots disallows every private application route', () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    for (const prefix of PRIVATE_ROUTE_PREFIXES) {
      expect(disallow).toContain(prefix);
      expect(disallow).toContain(`${prefix}/`);
    }
    expect(disallow).not.toContain('/knowledge');
  });

  it('every top-level app route is classified as public, localized or private', () => {
    const topLevel = fs
      .readdirSync(APP_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/${d.name}`);
    const classified = new Set<string>([
      ...PUBLIC_INDEXABLE_ROUTES,
      ...PRIVATE_ROUTE_PREFIXES,
      ...LOCALIZED_PUBLIC_SEGMENTS,
      ...SITEMAP_ROUTE_SEGMENTS,
    ]);
    for (const route of topLevel) {
      expect(classified.has(route), `${route} is not classified in lib/seo.ts`).toBe(true);
    }
    // The public homepage is the localized one; no stale root page may shadow it.
    expect(fs.existsSync(path.join(APP_DIR, 'page.tsx'))).toBe(false);
  });

  it('private route segments with a page export noindex metadata via a layout', () => {
    for (const prefix of PRIVATE_ROUTE_PREFIXES) {
      if (prefix === '/api') continue;
      const layout = path.join(APP_DIR, prefix.slice(1), 'layout.tsx');
      expect(fs.existsSync(layout), `${layout} missing`).toBe(true);
      expect(fs.readFileSync(layout, 'utf8')).toContain('PRIVATE_ROUTE_METADATA');
    }
  });

  it('every auth-required route is also private (noindex)', () => {
    for (const prefix of AUTH_REQUIRED_PREFIXES) {
      expect(PRIVATE_ROUTE_PREFIXES as readonly string[]).toContain(prefix);
    }
  });

  it('public metadata carries canonical, hreflang and Open Graph data', () => {
    const md = publicPageMetadata({ locale: 'de', path: '/pricing', title: 'Preise', description: 'd' });
    expect(md.alternates?.canonical).toBe('https://erppreflight.com/de/pricing');
    expect(md.alternates?.languages).toEqual({
      en: 'https://erppreflight.com/en/pricing',
      de: 'https://erppreflight.com/de/pricing',
      'x-default': 'https://erppreflight.com/en/pricing',
    });
    expect(md.openGraph).toMatchObject({ locale: 'de_DE', url: 'https://erppreflight.com/de/pricing' });
    expect(hreflangAlternates('/knowledge/x', ['de'])).toEqual({ de: 'https://erppreflight.com/de/knowledge/x' });
  });
});
