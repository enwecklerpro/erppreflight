import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sitemap from '../app/sitemap';
import robots from '../app/robots';
import {
  LOCALIZED_PUBLIC_ROUTES,
  LOCALIZED_PUBLIC_SEGMENTS,
  PRIVATE_ROUTE_PREFIXES,
  PUBLIC_INDEXABLE_ROUTES,
  hreflangAlternates,
  publicPageMetadata,
} from '../lib/seo';
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
  it('sitemap lists localized pages in both locales plus English-only public pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const entries = await sitemap();
    expect(entries.length).toBe(LOCALIZED_PUBLIC_ROUTES.length * 2 + PUBLIC_INDEXABLE_ROUTES.length);
    for (const route of PUBLIC_INDEXABLE_ROUTES) expect(publicRouteExists(route), route).toBe(true);
    for (const route of LOCALIZED_PUBLIC_ROUTES) expect(localizedRouteExists(route), route).toBe(true);
    const urls = entries.map((e) => e.url);
    expect(urls).toContain('https://erppreflight.com');
    expect(urls).toContain('https://erppreflight.com/de');
    expect(urls).toContain('https://erppreflight.com/de/pricing');
    for (const bad of ['/lab', '/trust-center', '/projects', '/dashboard', '/en/pricing']) {
      expect(urls.some((u) => u.endsWith(bad))).toBe(false);
    }
  });

  it('sitemap adds published knowledge articles from the API with hreflang alternates', async () => {
    const item = (locale: string) => ({
      slug: 'change-pointers-bd52', locale, title: 't', summary: 's', relatedEngineTypes: [], targetReleases: [],
      reviewedAt: null, publishedAt: null, updatedAt: '2026-09-26T00:00:00.000Z', version: 1,
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const locale = new URL(url).searchParams.get('locale')!;
      return new Response(JSON.stringify({ locale, items: [item(locale)] }), { status: 200 });
    }));
    const entries = await sitemap();
    const article = entries.find((e) => e.url === 'https://erppreflight.com/de/knowledge/change-pointers-bd52');
    expect(article).toBeDefined();
    expect(article!.alternates?.languages).toMatchObject({
      en: 'https://erppreflight.com/knowledge/change-pointers-bd52',
      de: 'https://erppreflight.com/de/knowledge/change-pointers-bd52',
    });
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
      en: 'https://erppreflight.com/pricing',
      de: 'https://erppreflight.com/de/pricing',
      'x-default': 'https://erppreflight.com/pricing',
    });
    expect(md.openGraph).toMatchObject({ locale: 'de_DE', url: 'https://erppreflight.com/de/pricing' });
    expect(hreflangAlternates('/knowledge/x', ['de'])).toEqual({ de: 'https://erppreflight.com/de/knowledge/x' });
  });
});
