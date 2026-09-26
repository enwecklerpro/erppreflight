import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render } from '@testing-library/react';
import { resolveRoute, splitLocale, localizePath, alternatePaths } from '../lib/routing';
import { Markdown, parseMarkdown, parseInline, sanitizeHref } from '../components/public/markdown';
import { serializeJsonLd } from '../components/public/json-ld';
import { readLegalOperator } from '../lib/legal';
import { PUBLIC_PLANS } from '../lib/plans';
import { CANONICAL_ENGINES } from '../lib/api-client';
import { SOLUTION_SLUGS, enginesForSolution, solutionForEngine } from '../lib/solutions';

const noCookies = () => false;

describe('locale routing & navigation guard', () => {
  it('rewrites unprefixed public pages to the English locale segment', () => {
    expect(resolveRoute({ pathname: '/', hasCookie: noCookies })).toEqual({ action: 'rewrite', pathname: '/en', locale: 'en' });
    expect(resolveRoute({ pathname: '/knowledge/change-pointers-bd52', hasCookie: noCookies })).toEqual({
      action: 'rewrite',
      pathname: '/en/knowledge/change-pointers-bd52',
      locale: 'en',
    });
  });

  it('serves /de pages directly and redirects /en to the canonical root URL', () => {
    expect(resolveRoute({ pathname: '/de/pricing', hasCookie: noCookies })).toEqual({ action: 'next', locale: 'de' });
    expect(resolveRoute({ pathname: '/en/pricing', search: '?a=1', hasCookie: noCookies })).toEqual({
      action: 'redirect',
      location: '/pricing?a=1',
      status: 308,
    });
    expect(resolveRoute({ pathname: '/en', hasCookie: noCookies })).toMatchObject({ location: '/' });
  });

  it('redirects anonymous visitors of private routes to /login with a return path', () => {
    expect(resolveRoute({ pathname: '/projects/abc', search: '?tab=1', hasCookie: noCookies })).toEqual({
      action: 'redirect',
      location: `/login?next=${encodeURIComponent('/projects/abc?tab=1')}`,
      status: 307,
    });
    const signedIn = (name: string) => name === 'erp_auth';
    expect(resolveRoute({ pathname: '/projects', hasCookie: signedIn, preferredLocale: 'de' })).toEqual({ action: 'next', locale: 'de' });
    const apiSession = (name: string) => name === 'erppreflight_session';
    expect(resolveRoute({ pathname: '/dashboard', hasCookie: apiSession })).toEqual({ action: 'next', locale: 'en' });
  });

  it('leaves other routes alone and never treats /demo or /docs as locale prefixes', () => {
    expect(resolveRoute({ pathname: '/login', hasCookie: noCookies })).toEqual({ action: 'next', locale: 'en' });
    expect(resolveRoute({ pathname: '/demo', hasCookie: noCookies })).toEqual({ action: 'next', locale: 'en' });
    expect(splitLocale('/docs')).toEqual({ locale: null, path: '/docs' });
    expect(splitLocale('/de')).toEqual({ locale: 'de', path: '/' });
  });

  it('builds localized paths and alternates', () => {
    expect(localizePath('de', '/')).toBe('/de');
    expect(localizePath('en', '/pricing')).toBe('/pricing');
    expect(alternatePaths('/de/solutions/integration')).toEqual({ en: '/solutions/integration', de: '/de/solutions/integration' });
  });
});

describe('safe markdown renderer', () => {
  it('parses headings, lists, code and paragraphs', () => {
    const blocks = parseMarkdown('## Title\n\nText with `code`.\n\n- a\n- b\n\n1. one\n2. two\n\n```\nx < y\n```');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'code']);
    expect(blocks[3]).toMatchObject({ ordered: true });
  });

  it('never injects raw HTML and drops unsafe link targets', () => {
    const { container } = render(
      <Markdown source={'<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](/solutions/integration) [ext](https://help.sap.com/)'} />
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/solutions/integration', 'https://help.sap.com/']);
    expect(sanitizeHref('//evil.example')).toBeNull();
    expect(parseInline('**bold** and *em*').map((n) => n.type)).toEqual(['strong', 'text', 'em']);
  });
});

describe('structured data & operator data', () => {
  it('escapes script-breaking characters in JSON-LD', () => {
    const out = serializeJsonLd({ name: '</script><img src=x>' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out).name).toBe('</script><img src=x>');
  });

  it('reports unconfigured operator data instead of inventing it', () => {
    expect(readLegalOperator({}).configured).toBe(false);
    const op = readLegalOperator({
      NEXT_PUBLIC_LEGAL_COMPANY_NAME: 'Example GmbH',
      NEXT_PUBLIC_LEGAL_ADDRESS: 'Street 1|12345 City',
      NEXT_PUBLIC_LEGAL_EMAIL: 'legal@example.com',
    });
    expect(op).toMatchObject({ configured: true, address: ['Street 1', '12345 City'], vatId: null });
  });
});

describe('solutions and plans sources', () => {
  it('every canonical engine belongs to exactly one solution page', () => {
    const assigned = SOLUTION_SLUGS.flatMap((s) => enginesForSolution(s).map((e) => e.id));
    expect(assigned.sort()).toEqual(CANONICAL_ENGINES.map((e) => e.id).sort());
    for (const slug of SOLUTION_SLUGS) expect(enginesForSolution(slug).length).toBeGreaterThan(0);
    expect(solutionForEngine('MFS_BLACKBOX')).toBe('warehouse-automation');
    expect(solutionForEngine('NOPE')).toBeNull();
  });

  it('pricing adapter mirrors the tiers enforced by the API (no invented prices)', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../api/src/modules/billing/entitlements.service.ts'),
      'utf8'
    );
    const apiPrices = Array.from(source.matchAll(/priceEurMonthly:\s*([\d_]+)/g)).map((m) => Number(m[1].replace(/_/g, '')));
    const apiTiers = Array.from(source.matchAll(/^\s{4}tier:\s*'(\w+)'/gm)).map((m) => m[1]);
    expect(PUBLIC_PLANS.map((p) => p.tier)).toEqual(apiTiers);
    expect(PUBLIC_PLANS.map((p) => p.priceEurMonthly)).toEqual(apiPrices);
  });
});
