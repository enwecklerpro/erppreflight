// Browser smoke test of the free tools, programmatic SEO pages, sitemaps and docs (EN + DE)
// against a running web + API + analysis stack with a synced knowledge graph.
// Usage: WEB_URL=http://localhost:3000 [API_BASE_URL=http://localhost:3001] [CHROMIUM_PATH=...]
//        [SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=...] node scripts/e2e-tools-smoke.cjs [screenshotDir]
// Covers: every tool in EN and DE (real API answers, provenance + CTA), result states are noindex,
// a programmatic SEO page (canonical, hreflang, TechArticle + BreadcrumbList JSON-LD), a
// low-information object page is noindex, the migration view 404s where no data exists, the
// sitemap index + child sitemaps are valid and list only gated pages, docs pages render
// (engine catalog from the live analysis service, FAQPage JSON-LD), legacy lookup URLs redirect,
// and — with super-admin credentials — the knowledge content workflow endpoints.
// Exits non-zero on any failure.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('@playwright/test');

const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_BASE_URL || '').replace(/\/$/, '');
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-tools-smoke-'));
let failures = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Dismiss the cookie banner up front so it never covers tool controls.
  await context.addCookies([{ name: 'erp_consent', value: 'necessary', url: WEB }]);
  const page = await context.newPage();
  const consoleErrors = [];
  const apiProblems = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.url().includes('/api/v1/public/') && r.status() >= 500) apiProblems.push(`${r.status()} ${r.url()}`); });

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
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap((s) => {
      const d = JSON.parse(s.textContent || 'null');
      return Array.isArray(d) ? d : [d];
    }),
    robots: document.querySelector('meta[name=robots]')?.getAttribute('content') || null,
  }));

  const openTool = async (locale, slug, query = '') => {
    const res = await page.goto(`${WEB}/${locale}/tools/${slug}${query}`, { waitUntil: 'domcontentloaded' });
    assert(res && res.status() === 200, `${slug}: HTTP ${res && res.status()}`);
    const h = await head();
    assert(h.lang === locale, `${slug}: html lang ${h.lang}`);
    assert(h.canonical && h.canonical.endsWith(`/${locale}/tools/${slug}`), `${slug}: canonical ${h.canonical}`);
    assert(h.hreflang.en && h.hreflang.de && h.hreflang['x-default'], `${slug}: hreflang incomplete`);
    assert(h.jsonLd.some((d) => d['@type'] === 'WebApplication') && h.jsonLd.some((d) => d['@type'] === 'BreadcrumbList'), `${slug}: JSON-LD missing`);
    const prov = page.getByTestId('tool-provenance');
    await prov.waitFor({ timeout: 10000 });
    assert((await page.getByTestId('provenance-source').textContent()).length > 20, `${slug}: data source not stated`);
    assert((await page.getByTestId('provenance-trust').textContent()).length > 10, `${slug}: trust level not stated`);
    assert(await page.getByTestId('tool-cta').locator('a[href="/signup"]').count() === 1, `${slug}: CTA to create a workspace missing`);
    return h;
  };

  await step('01 tools hub EN + DE', async () => {
    for (const locale of ['en', 'de']) {
      const res = await page.goto(`${WEB}/${locale}/tools`, { waitUntil: 'domcontentloaded' });
      assert(res.status() === 200, `HTTP ${res.status()}`);
      const items = await page.locator('[data-testid=tools-list] > li').count();
      assert(items === 6, `${locale}: expected 6 tools, found ${items}`);
      const date = await page.getByTestId('provenance-date').textContent();
      assert(/#\d+/.test(date), `${locale}: snapshot number not shown (${date})`);
    }
  });

  for (const locale of ['en', 'de']) {
    await step(`02 ${locale} Clean Core lookup`, async () => {
      await openTool(locale, 'clean-core-lookup');
      await page.fill('#clean-core-q', 'MARA');
      const first = page.getByTestId('lookup-result').first();
      await first.waitFor({ timeout: 15000 });
      assert(/MARA/.test(await first.textContent()), 'MARA not in results');
      assert((await page.locator(`a[href="/${locale}/sap/clean-core/mara"]`).count()) === 1, 'result does not link the object page');
      await page.waitForURL(/\?q=MARA/, { timeout: 5000 });
    });

    await step(`03 ${locale} cloud successor`, async () => {
      await openTool(locale, 'cloud-successor');
      await page.fill('#successor-q', 'BSEG');
      const card = page.getByTestId('successor-result').first();
      await card.waitFor({ timeout: 15000 });
      assert((await card.getByTestId('verdict').getAttribute('data-verdict')) === 'SUCCESSOR_AVAILABLE', 'BSEG verdict');
      assert(/I_OPERATIONALACCTGDOCITEM/.test(await card.textContent()), 'BSEG successor missing');
      await page.fill('#successor-q', 'VA01');
      await page.getByTestId('tool-empty').waitFor({ timeout: 15000 });
      await page.getByTestId('tcode-coverage').waitFor({ timeout: 5000 });
    });

    await step(`04 ${locale} API deprecation lookup + release diff`, async () => {
      await openTool(locale, 'api-deprecations');
      await page.fill('#api-q', 'I_PURCHASEORDERTP_2');
      await page.getByTestId('api-result').first().waitFor({ timeout: 15000 });
      await page.getByTestId('api-mode-deprecated').click();
      await page.getByTestId('deprecated-count').waitFor({ timeout: 15000 });
      assert(/\d+/.test(await page.getByTestId('deprecated-count').textContent()), 'deprecated count missing');
      await page.getByTestId('api-mode-diff').click();
      const from = page.getByTestId('diff-from');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=diff-from] option').length > 3, null, { timeout: 15000 });
      const values = await from.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })));
      const r2022 = values.find((o) => /S\/4HANA 2022$/.test(o.t));
      const r2023 = values.find((o) => /2023 FPS00/.test(o.t));
      assert(r2022 && r2023, 'releases 2022 / 2023 FPS00 not offered');
      await from.selectOption(r2022.v);
      await page.waitForURL(/from=/, { timeout: 5000 });
      await page.getByTestId('diff-to').selectOption(r2023.v);
      await page.getByTestId('diff-result').waitFor({ timeout: 20000 });
    });

    await step(`05 ${locale} XML field checker`, async () => {
      await openTool(locale, 'xml-field-checker');
      await page.fill('#xml-doc', '<data xmlns:po="urn:sap:po"><po:Header><po:PurchaseOrder>4500000017</po:PurchaseOrder></po:Header><Items><Item pos="10"/><Item pos="20"/></Items></data>');
      await page.fill('#xml-path', 'data/Header');
      await page.locator('#xml-path').blur();
      await page.locator('#xml-path-error, [id$=xml-path-error]').first().waitFor({ timeout: 5000 }).catch(() => {});
      assert(await page.getByTestId('xml-submit').isDisabled(), 'invalid path not rejected on the client');
      await page.fill('#xml-path', '/data/Header/PurchaseOrder');
      await page.getByTestId('xml-submit').click();
      const result = page.getByTestId('xml-result');
      await result.waitFor({ timeout: 15000 });
      assert((await result.getAttribute('data-exists')) === 'true', 'path should exist');
      assert((await page.getByTestId('xml-value').first().textContent()).includes('4500000017'), 'value not shown');
      assert(/UNPREFIXED_STEP_IN_NAMESPACE/.test(await page.getByTestId('xml-issues').textContent()), 'namespace issue not reported');
      await page.fill('#xml-doc', '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>');
      await page.fill('#xml-path', '/r');
      await page.getByTestId('xml-submit').click();
      await page.locator('[data-testid=xml-result][data-exists=false]').waitFor({ timeout: 15000 });
    });

    await step(`06 ${locale} Fiori 403 decision tree`, async () => {
      await openTool(locale, 'fiori-403');
      for (const answer of ['http', 'read', 'nothing', 'inactive']) {
        await page.locator(`[data-testid=fiori-question] button[data-answer="${answer}"]`).click();
      }
      const outcome = page.getByTestId('fiori-outcome');
      await outcome.waitFor({ timeout: 5000 });
      assert((await outcome.getAttribute('data-outcome')) === 'icf', 'wrong outcome');
      assert(/FIORI_ICF_INACTIVE/.test(await outcome.textContent()), 'engine finding code missing');
      assert(page.url().includes('path=http%2Cread%2Cnothing%2Cinactive') || page.url().includes('path=http,read,nothing,inactive'), `path not in URL: ${page.url()}`);
      await page.getByTestId('fiori-back').click();
      await page.getByTestId('fiori-question').waitFor({ timeout: 5000 });
      assert((await page.getByTestId('fiori-question').getAttribute('data-question')) === 'icf', 'back did not return to the ICF question');
      // A crawler loading the shareable result URL gets noindex.
      await page.goto(page.url(), { waitUntil: 'domcontentloaded' });
      await page.getByTestId('fiori-answers').waitFor({ timeout: 5000 });
      const h = await head();
      assert(/noindex/.test(h.robots || ''), 'tool result state must be noindex');
    });

    await step(`07 ${locale} knowledge & error search`, async () => {
      await openTool(locale, 'search');
      await page.fill('#search-q', locale === 'en' ? 'output determination' : 'BRFplus');
      await page.getByTestId('search-articles').waitFor({ timeout: 15000 });
      await page.fill('#search-q', '403');
      await page.waitForFunction(
        () => /FIORI_/.test(document.querySelector('[data-testid=search-rules]')?.textContent || ''),
        null,
        { timeout: 15000 }
      );
    });
  }

  await step('08 tool result URLs are noindex, the tool page itself is indexable', async () => {
    await page.goto(`${WEB}/en/tools/search?q=mara`, { waitUntil: 'domcontentloaded' });
    let h = await head();
    assert(/noindex/.test(h.robots || ''), `result state robots ${h.robots}`);
    assert(h.canonical.endsWith('/en/tools/search'), 'result state canonical must point to the tool');
    await page.goto(`${WEB}/en/tools/search`, { waitUntil: 'domcontentloaded' });
    h = await head();
    assert(!/noindex/.test(h.robots || ''), 'tool page must be indexable');
  });

  for (const [locale, slug] of [['en', 'mara'], ['de', 'bseg']]) {
    await step(`09 ${locale} programmatic SEO page /sap/clean-core/${slug}`, async () => {
      const res = await page.goto(`${WEB}/${locale}/sap/clean-core/${slug}`, { waitUntil: 'domcontentloaded' });
      assert(res.status() === 200, `HTTP ${res.status()}`);
      const h = await head();
      assert(h.lang === locale, 'lang');
      assert(h.canonical && h.canonical.endsWith(`/${locale}/sap/clean-core/${slug}`), `canonical ${h.canonical}`);
      assert(h.hreflang.en.endsWith(`/en/sap/clean-core/${slug}`) && h.hreflang.de.endsWith(`/de/sap/clean-core/${slug}`) && h.hreflang['x-default'], 'hreflang');
      assert(!/noindex/.test(h.robots || ''), `indexable page is noindex (${h.robots})`);
      const article = h.jsonLd.find((d) => d['@type'] === 'TechArticle');
      assert(article && article.dateModified && Array.isArray(article.citation) && article.citation.length > 0, 'TechArticle incomplete');
      assert(h.jsonLd.some((d) => d['@type'] === 'BreadcrumbList'), 'BreadcrumbList missing');
      assert((await page.getByTestId('sap-object-page').getAttribute('data-indexable')) === 'true', 'page not gated as indexable');
      const related = await page.locator('[data-testid=related-objects] li').count();
      assert(related >= 2, `expected >= 2 graph-derived related objects, found ${related}`);
      assert(/Cloudification Repository/.test(await page.getByTestId('evidence').textContent()), 'evidence source missing');
      assert(await page.locator(`a[href="/${locale}/sap/cloud/migration/${slug}"]`).count() > 0, 'migration view not linked');
    });
  }

  await step('10 migration view with successor data', async () => {
    const res = await page.goto(`${WEB}/en/sap/cloud/migration/bapi-po-create1`, { waitUntil: 'domcontentloaded' });
    assert(res.status() === 200, `HTTP ${res.status()}`);
    const h = await head();
    assert(/I_PURCHASEORDERTP_2/.test(h.title), `title lacks successor: ${h.title}`);
    assert(h.canonical.endsWith('/en/sap/cloud/migration/bapi-po-create1'), 'canonical');
    const missing = await page.goto(`${WEB}/en/sap/cloud/migration/i-product`, { waitUntil: 'domcontentloaded' });
    assert(missing.status() === 404, `released object must have no migration page (HTTP ${missing.status()})`);
    const unknown = await page.goto(`${WEB}/en/sap/clean-core/va01`, { waitUntil: 'domcontentloaded' });
    assert(unknown.status() === 404, `object without data must 404 (HTTP ${unknown.status()})`);
  });

  await step('11 low-information object page is noindex', async () => {
    const res = await page.goto(`${WEB}/en/sap/clean-core/abap-boolean`, { waitUntil: 'domcontentloaded' });
    assert(res.status() === 200, `HTTP ${res.status()}`);
    const h = await head();
    assert(/noindex/.test(h.robots || ''), `robots ${h.robots}`);
    await page.getByTestId('low-info-notice').waitFor({ timeout: 5000 });
  });

  await step('12 sitemap index + child sitemaps', async () => {
    const index = await page.request.get(`${WEB}/sitemap.xml`);
    assert(index.status() === 200 && /xml/.test(index.headers()['content-type']), 'index content type');
    const indexXml = await index.text();
    assert(/<sitemapindex/.test(indexXml), 'not a sitemap index');
    const children = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert(children.some((c) => c.endsWith('/sitemaps/pages.xml')) && children.some((c) => c.endsWith('/sitemaps/knowledge.xml')), 'pages/knowledge sitemaps missing');
    const sapChildren = children.filter((c) => /sap-objects-\d+\.xml$/.test(c));
    assert(sapChildren.length >= 1, 'no SAP object sitemap');
    const all = [];
    for (const child of children) {
      const res = await page.request.get(child.replace(/^https?:\/\/[^/]+/, WEB));
      assert(res.status() === 200, `${child}: HTTP ${res.status()}`);
      const xml = await res.text();
      assert(/<urlset[^>]*xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9"/.test(xml), `${child}: not a urlset`);
      const locs = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      assert(locs.length > 0 && locs.length <= 50000, `${child}: ${locs.length} URLs`);
      all.push(...locs);
    }
    for (const needle of ['/en/pricing', '/de/tools/xml-field-checker', '/en/docs/getting-started', '/en/docs/engines/OPD_GUARD', '/en/knowledge/change-pointers-bd52', '/en/sap/clean-core/mara', '/de/sap/cloud/migration/bseg']) {
      assert(all.some((u) => u.endsWith(needle)), `sitemaps lack ${needle}`);
    }
    for (const bad of ['/sap/clean-core/abap-boolean', '/sap/cloud/migration/i-product', '/projects', '/knowledge-graph/lookup']) {
      assert(!all.some((u) => u.endsWith(bad)), `sitemaps list non-indexable ${bad}`);
    }
    // Every listed SAP object page is really indexable (spot check).
    const sample = all.filter((u) => /\/en\/sap\/clean-core\//.test(u)).filter((_, i) => i % 97 === 0).slice(0, 4);
    for (const u of sample) {
      await page.goto(u.replace(/^https?:\/\/[^/]+/, WEB), { waitUntil: 'domcontentloaded' });
      const h = await head();
      assert(!/noindex/.test(h.robots || ''), `${u} is in the sitemap but noindex`);
    }
    const robots = await (await page.request.get(`${WEB}/robots.txt`)).text();
    assert(/Sitemap: .*\/sitemap\.xml/.test(robots), 'robots.txt does not reference the sitemap index');
  });

  for (const locale of ['en', 'de']) {
    await step(`13 ${locale} documentation`, async () => {
      for (const p of ['/docs', '/docs/getting-started', '/docs/security', '/docs/api-cli', '/docs/local-agent', '/docs/faq', '/docs/file-formats', '/docs/engines', '/docs/engines/FIORI_403_ROOT_CAUSE_DOCTOR']) {
        const res = await page.goto(`${WEB}/${locale}${p}`, { waitUntil: 'domcontentloaded' });
        assert(res.status() === 200, `${p}: HTTP ${res.status()}`);
        await page.getByTestId('docs-page').waitFor({ timeout: 10000 });
        const h = await head();
        assert(h.lang === locale && h.canonical.endsWith(`/${locale}${p}`), `${p}: lang/canonical`);
        assert(h.hreflang.en && h.hreflang.de, `${p}: hreflang`);
      }
      await page.goto(`${WEB}/${locale}/docs/engines`, { waitUntil: 'domcontentloaded' });
      const engines = await page.locator('[data-testid=engine-list] > li').count();
      assert(engines >= 19, `engine catalog lists ${engines} engines`);
      await page.goto(`${WEB}/${locale}/docs/faq`, { waitUntil: 'domcontentloaded' });
      assert((await head()).jsonLd.some((d) => d['@type'] === 'FAQPage'), 'FAQPage JSON-LD missing');
      await page.goto(`${WEB}/${locale}/docs/api-cli`, { waitUntil: 'domcontentloaded' });
      assert(/\/api\/v1\/reference$/.test(await page.getByTestId('api-reference-link').getAttribute('href')), 'API reference link');
    });
  }

  await step('14 legacy URLs redirect to the new tools', async () => {
    await page.goto(`${WEB}/knowledge-graph/lookup?q=BSEG`, { waitUntil: 'domcontentloaded' });
    assert(/\/(en|de)\/tools\/clean-core-lookup\?q=BSEG$/.test(page.url()), `landed on ${page.url()}`);
    await page.goto(`${WEB}/knowledge-graph/lookup/TABL/MARA`, { waitUntil: 'domcontentloaded' });
    assert(/\/(en|de)\/sap\/clean-core\/mara$/.test(page.url()), `landed on ${page.url()}`);
    await page.goto(`${WEB}/docs`, { waitUntil: 'domcontentloaded' });
    assert(/\/(en|de)\/docs$/.test(page.url()), `landed on ${page.url()}`);
  });

  if (API && process.env.SUPER_ADMIN_EMAIL && process.env.SUPER_ADMIN_PASSWORD) {
    await step('15 knowledge content workflow (admin API)', async () => {
      const req = page.request;
      const login = await req.post(`${API}/api/v1/auth/login`, { data: { email: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD } });
      const token = (await login.json()).accessToken;
      assert(token, `admin login failed (${login.status()})`);
      const H = { Authorization: `Bearer ${token}` };
      const wf = await (await req.get(`${API}/api/v1/admin/knowledge/workflow`, { headers: H })).json();
      assert(wf.transitions && wf.transitions.TECHNICAL_REVIEW.includes('SEO_REVIEW'), 'workflow transitions');
      const slug = `smoke-workflow-${Date.now() % 100000}`;
      const body = { slug, locale: 'en', title: 'Smoke workflow article', summary: 'A summary that is long enough for validation.', bodyMarkdown: '## Heading\n\n' + 'Body text for the smoke workflow article. '.repeat(3), sources: [{ title: 'SAP Help Portal', url: 'https://help.sap.com/' }] };
      const created = await req.post(`${API}/api/v1/admin/knowledge`, { headers: H, data: body });
      assert(created.status() === 201, `create: HTTP ${created.status()}`);
      const id = (await created.json()).id;
      const bad = await req.post(`${API}/api/v1/admin/knowledge/${id}/transition`, { headers: H, data: { to: 'PUBLISHED' } });
      assert(bad.status() === 400, `draft -> published must be rejected (HTTP ${bad.status()})`);
      for (const to of ['TECHNICAL_REVIEW', 'SEO_REVIEW', 'PUBLISHED']) {
        const r = await req.post(`${API}/api/v1/admin/knowledge/${id}/transition`, { headers: H, data: { to } });
        assert(r.status() === 200 && (await r.json()).status === to, `transition to ${to}: HTTP ${r.status()}`);
      }
      const flag = await req.post(`${API}/api/v1/admin/knowledge/${id}/transition`, { headers: H, data: { to: 'UPDATE_REQUIRED', reason: 'Smoke test flag' } });
      assert(flag.status() === 200, `flag: HTTP ${flag.status()}`);
      const res = await page.goto(`${WEB}/en/knowledge/${slug}`, { waitUntil: 'domcontentloaded' });
      assert(res.status() === 200, `article HTTP ${res.status()}`);
      await page.getByTestId('article-update-required').waitFor({ timeout: 10000 });
      await page.getByTestId('article-provenance').waitFor({ timeout: 5000 });
      assert(/noindex/.test((await head()).robots || ''), 'UPDATE_REQUIRED article must be noindex');
      const archived = await req.delete(`${API}/api/v1/admin/knowledge/${id}`, { headers: H });
      assert(archived.status() === 200, `archive: HTTP ${archived.status()}`);
      const revisions = await (await req.get(`${API}/api/v1/admin/knowledge/${id}/revisions`, { headers: H })).json();
      assert(revisions.some((r) => r.transition === 'SEO_REVIEW->PUBLISHED'), 'revision history lacks the transitions');
    });
  } else {
    console.log('SKIP  15 knowledge content workflow (set API_BASE_URL, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)');
  }

  await step('16 no CSP violations and no public API 5xx', async () => {
    const csp = consoleErrors.filter((e) => /Content Security Policy/i.test(e));
    assert(csp.length === 0, `CSP violations: ${JSON.stringify(csp)}`);
    assert(apiProblems.length === 0, `public API errors: ${JSON.stringify(apiProblems)}`);
  });

  console.log('CONSOLE ERRORS', JSON.stringify(consoleErrors.filter((e) => !/401|Unauthorized|404/.test(e)).slice(0, 10), null, 1));
  await browser.close();
  console.log(failures ? `${failures} STEP(S) FAILED (screenshots: ${SHOTS})` : 'ALL STEPS PASSED');
  process.exit(failures ? 1 : 0);
})();
