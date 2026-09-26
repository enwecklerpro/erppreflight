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
import { buildContentSecurityPolicy, generateNonce } from '../lib/csp';
import { CANONICAL_ENGINES } from '../lib/api-client';
import { SOLUTION_SLUGS, enginesForSolution, solutionForEngine } from '../lib/solutions';

const noCookies = () => false;

describe('locale routing & navigation guard', () => {
  it('delegates locale-prefixed and unprefixed public pages to next-intl', () => {
    for (const pathname of ['/', '/pricing', '/knowledge/change-pointers-bd52', '/en', '/de/pricing', '/en/legal/imprint']) {
      expect(resolveRoute({ pathname, hasCookie: noCookies }), pathname).toEqual({ action: 'intl' });
    }
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
    expect(localizePath('en', '/pricing')).toBe('/en/pricing');
    expect(alternatePaths('/de/solutions/integration')).toEqual({ en: '/en/solutions/integration', de: '/de/solutions/integration' });
    expect(alternatePaths('/en')).toEqual({ en: '/en', de: '/de' });
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

describe('content security policy', () => {
  it('uses a nonce, forbids framing/objects and allows only the API origin for connections', () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(generateNonce()).not.toBe(nonce);
    const csp = buildContentSecurityPolicy({ nonce, apiUrl: 'https://api.erppreflight.com/api/v1', upgradeInsecureRequests: true });
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).toContain("connect-src 'self' https://api.erppreflight.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('unsafe-eval');
    expect(buildContentSecurityPolicy({ nonce, dev: true })).toContain("'unsafe-eval'");
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
