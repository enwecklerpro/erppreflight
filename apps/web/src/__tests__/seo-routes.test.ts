import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sitemap from '../app/sitemap';
import robots from '../app/robots';
import { PRIVATE_ROUTE_PREFIXES, PUBLIC_INDEXABLE_ROUTES } from '../lib/seo';

const APP_DIR = path.resolve(__dirname, '../app');

function routeExists(route: string): boolean {
  if (route === '/') return fs.existsSync(path.join(APP_DIR, 'page.tsx'));
  const dir = path.join(APP_DIR, route.replace(/^\//, ''));
  return fs.existsSync(path.join(dir, 'page.tsx')) || fs.existsSync(dir);
}

describe('SEO route inventory', () => {
  it('sitemap lists only existing public routes', () => {
    const entries = sitemap();
    expect(entries.length).toBe(PUBLIC_INDEXABLE_ROUTES.length);
    for (const route of PUBLIC_INDEXABLE_ROUTES) {
      expect(routeExists(route)).toBe(true);
    }
    const urls = entries.map((e) => e.url);
    for (const bad of ['/knowledge', '/lab', '/trust-center', '/projects']) {
      expect(urls.some((u) => u.endsWith(bad))).toBe(false);
    }
  });

  it('robots disallows every private application route', () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    for (const prefix of PRIVATE_ROUTE_PREFIXES) {
      expect(disallow).toContain(prefix);
      expect(disallow).toContain(`${prefix}/`);
    }
  });

  it('every top-level app route is classified as public or private', () => {
    const topLevel = fs
      .readdirSync(APP_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/${d.name}`);
    const classified = new Set<string>([...PUBLIC_INDEXABLE_ROUTES, ...PRIVATE_ROUTE_PREFIXES]);
    for (const route of topLevel) {
      expect(classified.has(route), `${route} is not classified in lib/seo.ts`).toBe(true);
    }
  });

  it('private route segments with a page export noindex metadata via a layout', () => {
    for (const prefix of PRIVATE_ROUTE_PREFIXES) {
      if (prefix === '/api' || prefix === '/knowledge') continue;
      const layout = path.join(APP_DIR, prefix.slice(1), 'layout.tsx');
      expect(fs.existsSync(layout), `${layout} missing`).toBe(true);
      expect(fs.readFileSync(layout, 'utf8')).toContain('PRIVATE_ROUTE_METADATA');
    }
  });
});
