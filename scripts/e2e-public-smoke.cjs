// Browser smoke test of the public website (EN + DE) against a running web + API stack.
// Usage: WEB_URL=http://localhost:3000 [CHROMIUM_PATH=/path/to/chromium] node scripts/e2e-public-smoke.cjs [screenshotDir]
// Checks titles, <html lang>, canonical + hreflang, JSON-LD, the SAP independence
// disclaimer, pricing, solution and knowledge pages, the language switcher, the cookie
// banner, sitemap/robots, 404 handling and that private routes redirect to /login.
// Exits non-zero on any failure.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('@playwright/test');

const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-public-smoke-'));
let failures = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });

  const step = async (name, fn) => {
    try { await fn(); console.log('OK   ', name); }
    catch (e) { failures++; console.log('FAIL ', name, '::', e.message.split('\n')[0]); }
    try { await page.screenshot({ path: `${SHOTS}/${name.replace(/\W+/g, '_')}.png`, fullPage: true }); } catch { /* ignore */ }
  };

  const head = async () => page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    canonical: document.querySelector('link[rel=canonical]')?.getAttribute('href') || null,
    hreflang: Object.fromEntries(Array.from(document.querySelectorAll('link[rel=alternate][hreflang]')).map((l) => [l.getAttribute('hreflang'), l.getAttribute('href')])),
    jsonLdTypes: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap((s) => {
      const d = JSON.parse(s.textContent || 'null');
      return (Array.isArray(d) ? d : [d]).map((x) => x && x['@type']);
    }),
    disclaimer: document.querySelector('[data-testid=sap-disclaimer]')?.textContent || '',
    robots: document.querySelector('meta[name=robots]')?.getAttribute('content') || null,
  }));

  const checkPublicPage = async (url, { locale, titleIncludes, jsonLd = [], altPath }) => {
    const res = await page.goto(WEB + url, { waitUntil: 'domcontentloaded' });
    assert(res && res.status() === 200, `${url} returned HTTP ${res && res.status()}`);
    const h = await head();
    assert(h.lang === locale, `${url}: html lang=${h.lang}, expected ${locale}`);
    for (const part of [].concat(titleIncludes)) assert(h.title.includes(part), `${url}: title "${h.title}" lacks "${part}"`);
    assert(h.canonical && h.canonical.endsWith(url), `${url}: canonical ${h.canonical}`);
    assert(h.hreflang.en && h.hreflang.de && h.hreflang['x-default'], `${url}: hreflang incomplete ${JSON.stringify(h.hreflang)}`);
    assert(h.hreflang.en.endsWith(`/en${altPath}`) && h.hreflang.de.endsWith(`/de${altPath}`), `${url}: hreflang targets ${JSON.stringify(h.hreflang)}`);
    for (const type of jsonLd) assert(h.jsonLdTypes.includes(type), `${url}: JSON-LD ${type} missing (have ${h.jsonLdTypes})`);
    assert(/SAP SE/.test(h.disclaimer) && (/not affiliated/.test(h.disclaimer) || /keiner Verbindung/.test(h.disclaimer)), `${url}: SAP disclaimer missing`);
    assert(h.robots === null || !/noindex/.test(h.robots), `${url}: page is noindex`);
    return h;
  };

  await step('01 root redirects to a locale homepage', async () => {
    const res = await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
    assert(res.status() === 200, `status ${res.status()}`);
    assert(/\/en$/.test(page.url()), `landed on ${page.url()}`);
  });

  await step('02 cookie banner stores the choice', async () => {
    const banner = page.getByTestId('cookie-consent');
    await banner.waitFor({ timeout: 10000 });
    await banner.getByRole('button', { name: /Necessary only/i }).click();
    await banner.waitFor({ state: 'detached', timeout: 5000 });
    const cookies = await context.cookies(WEB);
    assert(cookies.some((c) => c.name === 'erp_consent' && c.value === 'necessary'), 'erp_consent cookie not stored');
  });

  for (const [locale, tagline] of [['en', 'Know what will break before production does'], ['de', 'Wissen, was bricht']]) {
    await step(`03 ${locale} home`, async () => {
      await checkPublicPage(`/${locale}`, { locale, titleIncludes: tagline, jsonLd: ['Organization', 'SoftwareApplication'], altPath: '' });
      assert(await page.locator('h1').first().textContent() === 'ERP Preflight', 'h1 is not the brand');
      assert(await page.locator('a[href="/signup"]').count() > 0, 'no signup CTA');
      assert(await page.locator('a[href="/demo"]').count() > 0, 'no demo CTA');
    });
    await step(`04 ${locale} pricing`, async () => {
      await checkPublicPage(`/${locale}/pricing`, { locale, titleIncludes: locale === 'en' ? 'Pricing' : 'Preise', jsonLd: ['BreadcrumbList'], altPath: '/pricing' });
      const plans = await page.locator('[data-testid^="plan-"]').count();
      assert(plans === 5, `expected 5 plans, found ${plans}`);
    });
    await step(`05 ${locale} solution page`, async () => {
      await checkPublicPage(`/${locale}/solutions/integration`, { locale, titleIncludes: 'Integration', jsonLd: ['BreadcrumbList'], altPath: '/solutions/integration' });
      await page.getByText('Change Pointer Coverage Auditor').first().waitFor({ timeout: 5000 });
      assert(await page.locator(`a[href="/${locale}/knowledge/change-pointers-bd52"]`).count() > 0, 'related knowledge link missing');
    });
    await step(`06 ${locale} knowledge index`, async () => {
      await checkPublicPage(`/${locale}/knowledge`, { locale, titleIncludes: locale === 'en' ? 'Knowledge base' : 'Wissensdatenbank', jsonLd: ['BreadcrumbList'], altPath: '/knowledge' });
      const items = await page.locator('[data-testid=knowledge-list] > li').count();
      assert(items >= 6, `expected >= 6 articles, found ${items}`);
    });
    await step(`07 ${locale} knowledge article`, async () => {
      const h = await checkPublicPage(`/${locale}/knowledge/change-pointers-bd52`, { locale, titleIncludes: 'BD52', jsonLd: ['TechArticle', 'BreadcrumbList'], altPath: '/knowledge/change-pointers-bd52' });
      assert(await page.locator('article h2').count() >= 3, 'article body headings not rendered');
      assert(await page.locator(`article a[href="/${locale}/solutions/integration"]`).count() > 0, 'solution link missing');
      assert(await page.locator('article script:not([type="application/ld+json"])').count() === 0, 'unexpected script in article');
      void h;
    });
  }

  await step('08 language switcher EN -> DE', async () => {
    await page.goto(WEB + '/en/pricing', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('lang-de').click();
    await page.waitForURL(/\/de\/pricing$/, { timeout: 10000 });
    assert((await head()).lang === 'de', 'html lang not de after switching');
  });

  await step('09 legal pages & operator notice', async () => {
    for (const doc of ['imprint', 'privacy', 'terms', 'cookies', 'subprocessors', 'dpa']) {
      const res = await page.goto(`${WEB}/de/legal/${doc}`, { waitUntil: 'domcontentloaded' });
      assert(res.status() === 200, `${doc}: HTTP ${res.status()}`);
    }
    await page.goto(`${WEB}/en/legal/imprint`, { waitUntil: 'domcontentloaded' });
    const configured = await page.getByTestId('operator-details').count();
    const notice = await page.getByTestId('operator-not-configured').count();
    assert(configured + notice === 1, 'imprint shows neither operator data nor the not-configured notice');
  });

  await step('10 unknown article is a 404', async () => {
    const res = await page.goto(WEB + '/en/knowledge/this-article-does-not-exist', { waitUntil: 'domcontentloaded' });
    assert(res.status() === 404, `status ${res.status()}`);
    await page.getByTestId('not-found').waitFor({ timeout: 5000 });
  });

  await step('11 private route redirects to login', async () => {
    const res = await page.goto(WEB + '/projects', { waitUntil: 'domcontentloaded' });
    assert(/\/login\?next=%2Fprojects/.test(page.url()), `landed on ${page.url()}`);
    assert(res.status() === 200, `login page status ${res.status()}`);
  });

  await step('12 sitemap and robots', async () => {
    const sitemap = await (await page.request.get(WEB + '/sitemap.xml')).text();
    for (const needle of ['/en/pricing', '/de/pricing', '/de/solutions/integration', '/en/knowledge/change-pointers-bd52', 'hreflang="de"']) {
      assert(sitemap.includes(needle), `sitemap lacks ${needle}`);
    }
    assert(!sitemap.includes('/projects'), 'sitemap lists a private route');
    const robots = await (await page.request.get(WEB + '/robots.txt')).text();
    assert(/Disallow: \/projects/.test(robots) && /Sitemap:/.test(robots), 'robots.txt incomplete');
  });

  await step('13 security headers & no CSP violations', async () => {
    const res = await page.request.get(WEB + '/en');
    const h = res.headers();
    assert(/script-src 'self' 'nonce-/.test(h['content-security-policy'] || ''), 'CSP header missing');
    assert(/frame-ancestors 'none'/.test(h['content-security-policy']), 'frame-ancestors missing');
    assert(h['x-content-type-options'] === 'nosniff', 'nosniff missing');
    assert(h['referrer-policy'] === 'strict-origin-when-cross-origin', 'referrer-policy missing');
    const violations = consoleErrors.filter((e) => /Content Security Policy/i.test(e));
    assert(violations.length === 0, `CSP violations: ${JSON.stringify(violations)}`);
  });

  console.log('CONSOLE ERRORS', JSON.stringify(consoleErrors.filter((e) => !/401|Unauthorized/.test(e)), null, 1));
  await browser.close();
  console.log(failures ? `${failures} STEP(S) FAILED (screenshots: ${SHOTS})` : 'ALL STEPS PASSED');
  process.exit(failures ? 1 : 0);
})();
