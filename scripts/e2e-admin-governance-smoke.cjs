// Live E2E of the platform governance screens (spec 10.9 Knowledge Admin, 10.10 Rule Admin,
// 10.11 AI Admin, 10.12 Source Sync Admin) against a running web + API + analysis stack.
//
// Usage: API_BASE_URL=http://localhost:3001 WEB_URL=http://localhost:3000 \
//        SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... [MAIL_DEV_OUTBOX_TOKEN=...] [CHROMIUM_PATH=...] \
//        node scripts/e2e-admin-governance-smoke.cjs [screenshotDir]
//
// Covers:
//   * SUPER_ADMIN-only access (a tenant owner gets 403 on every governance endpoint);
//   * Rule Admin: deterministic golden self-test (PASSED, identical digest on re-run), publish gate
//     (blocked without self-test / reviewer, allowed after), coverage-gap rule (NO_FIXTURES) cannot
//     be published, audit trail;
//   * AI Admin: a local OpenAI-compatible stub is configured as the self-hosted provider; a call
//     reaches it, the provider kill switch prevents the next call (stub hit count unchanged), the
//     monthly cost ceiling refuses calls before they are sent, spend ledger + audit;
//   * Knowledge Admin: EN draft -> technical review -> SEO review -> published -> visible on the
//     public docs (API + web page) -> archived; knowledge graph admin view;
//   * Source Sync Admin: stale alert for a critical never-synced source (alert + in-app notification
//     + e-mail when the dev mailbox is available) and its resolution, retry of the Cloudification sync
//     (a new ADMIN run is recorded);
//   * UI: every governance route renders real data for the super admin (Chromium).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = (process.env.API_BASE_URL || process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '') + '/api/v1';
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-governance-smoke-'));
const R = Date.now().toString(36);
let failures = 0;

const ok = (name, detail = '') => console.log(`OK    ${name}${detail ? ` — ${detail}` : ''}`);
const fail = (name, detail = '') => {
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name, detail) : fail(name, detail));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, token, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** OpenAI-compatible chat completions stub that counts calls (never contacted when a kill switch is on). */
function startLlmStub() {
  let hits = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits += 1;
      let model = 'stub-model';
      try {
        model = JSON.parse(body || '{}').model || model;
      } catch {
        /* keep default */
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          model,
          choices: [{ message: { content: '{"engines":[{"engine":"OPD_GUARD","reason":"governance smoke stub"}]}' } }],
          usage: { prompt_tokens: 120, completion_tokens: 40 },
        })
      );
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, hits: () => hits }))
  );
}

async function devMail(to) {
  if (!process.env.MAIL_DEV_OUTBOX_TOKEN) return null;
  const res = await fetch(`${API}/dev/mail/messages?to=${encodeURIComponent(to)}`, {
    headers: { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN },
  });
  if (!res.ok) return null;
  return (await res.json()).items ?? [];
}

async function main() {
  if (!process.env.SUPER_ADMIN_EMAIL || !process.env.SUPER_ADMIN_PASSWORD) {
    console.log('FAIL  SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD are required for the governance smoke');
    process.exit(1);
  }
  const login = await call('POST', '/auth/login', null, { email: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD });
  if (!login.json?.accessToken) {
    fail('super admin login', JSON.stringify(login.json).slice(0, 200));
    process.exit(1);
  }
  const SA = login.json.accessToken;
  const saOrg = login.json.user.organizationId;
  ok('super admin login');

  // ---------------------------------------------------------------- access control
  const reg = await call('POST', '/auth/register', null, {
    email: `gov${R}@e2e.local`,
    password: 'GovernanceSmoke!2026',
    fullName: 'Governance Smoke',
    organizationName: `Governance Smoke ${R}`,
  });
  const tenantToken = reg.json?.accessToken;
  if (tenantToken) {
    const denied = await Promise.all(
      ['/admin/rules', '/admin/ai', '/admin/sources', '/admin/knowledge-graph/summary', '/admin/knowledge'].map((p) => call('GET', p, tenantToken))
    );
    check('tenant owner is denied on every governance endpoint (403)', denied.every((r) => r.status === 403), denied.map((r) => r.status).join(','));
    const kill = await call('PUT', '/admin/ai/providers/OPENAI', tenantToken, { killSwitch: true, reason: 'not allowed' });
    check('tenant owner cannot flip an AI kill switch', kill.status === 403, String(kill.status));
  } else fail('register tenant owner', JSON.stringify(reg.json).slice(0, 200));

  // ---------------------------------------------------------------- Rule Admin
  const inv = await call('GET', '/admin/rules', SA);
  check('rule inventory covers all engines', inv.status === 200 && inv.json.summary.engines >= 19 && inv.json.summary.rules >= 200,
    inv.status === 200 ? `${inv.json.summary.rules} rules / ${inv.json.summary.engines} engines, ${inv.json.summary.coverageGaps} gaps` : String(inv.status));
  const items = inv.json?.items ?? [];
  const passRule =
    items.find((r) => r.coverage.covered && !r.inputValidationRule && !r.latestSelfTest && r.status === 'DRAFT') ||
    items.find((r) => r.coverage.covered && !r.inputValidationRule && r.status !== 'PUBLISHED');
  const gapRule = items.find((r) => !r.coverage.covered && !r.inputValidationRule) || items.find((r) => !r.coverage.covered);
  if (!passRule || !gapRule) fail('rule candidates available', `pass=${passRule?.ruleCode} gap=${gapRule?.ruleCode}`);
  else {
    const code = passRule.ruleCode;
    const toReview = async (c, status) => {
      if (status === 'DEPRECATED') await call('POST', `/admin/rules/${c}/transition`, SA, { to: 'DRAFT' });
      if (status !== 'IN_REVIEW') return call('POST', `/admin/rules/${c}/transition`, SA, { to: 'IN_REVIEW', note: 'governance smoke' });
      return { status: 200 };
    };
    const rv = await toReview(code, passRule.status);
    check(`rule ${code} submitted for review`, rv.status === 200, String(rv.status));
    await call('PATCH', `/admin/rules/${code}`, SA, { author: 'Governance Smoke', reviewer: null });
    if (!passRule.latestSelfTest) {
      const early = await call('POST', `/admin/rules/${code}/transition`, SA, { to: 'PUBLISHED' });
      check('publish without a self-test is blocked (409)', early.status === 409 && early.json.code === 'RULE_PUBLISH_BLOCKED_NO_SELF_TEST', `${early.status} ${early.json.code}`);
    }
    const st1 = await call('POST', `/admin/rules/${code}/self-test`, SA);
    const st2 = await call('POST', `/admin/rules/${code}/self-test`, SA);
    check('golden self-test passes (positive fires, negatives silent)', st1.status === 200 && st1.json.status === 'PASSED',
      `${st1.json.status} ${st1.json.positiveCount}+/${st1.json.negativeCount}- ${st1.json.durationMs}ms`);
    check('self-test is deterministic (identical result digest)', st1.json.resultDigest && st1.json.resultDigest === st2.json.resultDigest, String(st1.json.resultDigest).slice(0, 16));
    const noReviewer = await call('POST', `/admin/rules/${code}/transition`, SA, { to: 'PUBLISHED' });
    check('publish without a reviewer is blocked (409)', noReviewer.status === 409 && noReviewer.json.code === 'RULE_PUBLISH_BLOCKED_REVIEWER_REQUIRED', `${noReviewer.status} ${noReviewer.json.code}`);
    await call('PATCH', `/admin/rules/${code}`, SA, { reviewer: 'Smoke Reviewer' });
    const pub = await call('POST', `/admin/rules/${code}/transition`, SA, { to: 'PUBLISHED', note: 'self-test passed' });
    check('publish after a passing self-test of the current version', pub.status === 200 && pub.json.status === 'PUBLISHED' && pub.json.publishedVersion === pub.json.version,
      `${pub.status} ${pub.json.publishedVersion}`);
    check('rule history records self-tests, the blocked attempt and the publication',
      ['SELF_TEST', 'PUBLISH_BLOCKED', 'TRANSITION'].every((e) => (pub.json.history ?? []).some((h) => h.eventType === e)));
    // Leave the rule deprecated -> draft so the next run can use it again for the gate (history is kept).
    await call('POST', `/admin/rules/${code}/transition`, SA, { to: 'DEPRECATED', note: 'smoke cleanup' });
    await call('POST', `/admin/rules/${code}/transition`, SA, { to: 'DRAFT', note: 'smoke cleanup' });

    const g = gapRule.ruleCode;
    await toReview(g, gapRule.status);
    await call('PATCH', `/admin/rules/${g}`, SA, { reviewer: 'Smoke Reviewer' });
    const gst = await call('POST', `/admin/rules/${g}/self-test`, SA);
    check(`coverage-gap rule ${g} self-test reports NO_FIXTURES`, gst.status === 200 && gst.json.status === 'NO_FIXTURES' && gst.json.passed === false, `${gst.json.status} ${gst.json.coverageGap}`);
    const gpub = await call('POST', `/admin/rules/${g}/transition`, SA, { to: 'PUBLISHED' });
    check('coverage-gap rule cannot be published (409)', gpub.status === 409 && gpub.json.code === 'RULE_PUBLISH_BLOCKED_COVERAGE_GAP', `${gpub.status} ${gpub.json.code}`);
    await call('POST', `/admin/rules/${g}/transition`, SA, { to: 'DRAFT', note: 'smoke cleanup' });
  }

  // ---------------------------------------------------------------- AI Admin
  const stub = await startLlmStub();
  const task = 'intent_classification';
  const taskBody = (over = {}) => ({
    enabled: true,
    provider: 'OLLAMA_LOCAL',
    primaryModel: 'governance-smoke-model',
    fallbackProvider: null,
    fallbackModel: null,
    maxTokens: 256,
    temperature: 0.1,
    privacyMode: 'SELF_HOSTED_ONLY',
    costCeilingEurMonthly: null,
    inputPriceEurPer1k: 0,
    outputPriceEurPer1k: 0,
    ...over,
  });
  try {
    const ep = await call('PUT', '/admin/ai/providers/OLLAMA_LOCAL', SA, { killSwitch: false, endpointUrl: stub.url });
    const cfg = await call('PUT', `/admin/ai/tasks/${task}`, SA, taskBody());
    check('AI task configured (self-hosted provider, model, token cap, temperature, privacy mode)', ep.status === 200 && cfg.status === 200 && cfg.json.config.effectiveModel === 'governance-smoke-model',
      `${ep.status}/${cfg.status}`);
    const classify = () => call('POST', '/ai/classify-intent', SA, { problemDescription: 'Billing output is not sent to the customer' });
    const before = stub.hits();
    const c1 = await classify();
    check('AI call reaches the configured provider', c1.status === 200 && c1.json.providerUsed === 'OLLAMA_LOCAL' && stub.hits() === before + 1, `${c1.json.providerUsed} hits=${stub.hits()}`);
    const kill = await call('PUT', '/admin/ai/providers/OLLAMA_LOCAL', SA, { killSwitch: true, reason: 'governance smoke incident' });
    check('kill switch activated', kill.status === 200 && kill.json.killSwitch === true);
    const hitsAtKill = stub.hits();
    const c2 = await classify();
    check('kill switch: provider is never called, deterministic fallback answers', c2.status === 200 && c2.json.providerUsed === 'DETERMINISTIC_FALLBACK' && c2.json.aiUnavailableReason === 'KILL_SWITCH' && stub.hits() === hitsAtKill,
      `${c2.json.providerUsed} ${c2.json.aiUnavailableReason} hits=${stub.hits()}`);
    check('AI confidence stays capped at 0.60', c1.json.confidenceScore <= 0.6 && c2.json.confidenceScore <= 0.6);
    await call('PUT', '/admin/ai/providers/OLLAMA_LOCAL', SA, { killSwitch: false });
    await call('PUT', `/admin/ai/tasks/${task}`, SA, taskBody({ costCeilingEurMonthly: 0.01, inputPriceEurPer1k: 1, outputPriceEurPer1k: 1 }));
    const hitsAtCeiling = stub.hits();
    const c3 = await classify();
    check('cost ceiling refuses the call before it is sent', c3.json.aiUnavailableReason === 'COST_CEILING' && stub.hits() === hitsAtCeiling, `${c3.json.aiUnavailableReason} hits=${stub.hits()}`);
    const ov = await call('GET', '/admin/ai', SA);
    const t = (ov.json.tasks ?? []).find((x) => x.task === task);
    check('spend ledger counts calls and governance refusals', t && t.spend.requests >= 1 && t.spend.blockedRequests >= 2, t ? `requests=${t.spend.requests} blocked=${t.spend.blockedRequests}` : 'missing');
  } finally {
    await call('DELETE', `/admin/ai/tasks/${task}`, SA);
    await call('PUT', '/admin/ai/providers/OLLAMA_LOCAL', SA, { killSwitch: false, endpointUrl: null });
    stub.server.close();
  }
  const audit = await call('GET', '/audit/events?limit=300', SA);
  const actions = new Set((Array.isArray(audit.json) ? audit.json : audit.json?.items ?? audit.json?.events ?? []).map((e) => e.action));
  check('governance changes are in the audit trail', ['rule.published', 'rule.self_test_run', 'ai.provider_kill_switch_activated', 'ai.task_config_updated'].every((a) => actions.has(a)),
    [...actions].filter((a) => /^(rule|ai)\./.test(a)).join(','));

  // ---------------------------------------------------------------- Knowledge Admin
  const slug = `governance-smoke-${R}`;
  const title = `Governance smoke article ${R}`;
  const draft = await call('POST', '/admin/knowledge', SA, {
    slug,
    locale: 'en',
    title,
    summary: 'A short article created by the governance smoke to verify the editorial workflow end to end.',
    bodyMarkdown: '## Purpose\n\nThis article verifies draft, technical review, SEO review and publication of knowledge content.',
    sources: [{ title: 'SAP Help Portal', url: 'https://help.sap.com/' }],
  });
  check('knowledge draft created', draft.status === 201 || draft.status === 200, `${draft.status} ${draft.json.status}`);
  if (draft.json?.id) {
    const hidden = await call('GET', `/public/knowledge/${slug}?locale=en`);
    check('draft is not public', hidden.status === 404, String(hidden.status));
    let last;
    for (const to of ['TECHNICAL_REVIEW', 'SEO_REVIEW', 'PUBLISHED']) last = await call('POST', `/admin/knowledge/${draft.json.id}/transition`, SA, { to });
    check('draft -> technical review -> SEO review -> published', last.status === 200 && last.json.status === 'PUBLISHED', `${last.status} ${last.json.status}`);
    const pub = await call('GET', `/public/knowledge/${slug}?locale=en`);
    check('published article is served by the public knowledge API', pub.status === 200 && pub.json.title === title, String(pub.status));
    const page = await fetch(`${WEB}/en/knowledge/${slug}`);
    const html = await page.text();
    check('published article is visible on the public docs page', page.status === 200 && html.includes(title), String(page.status));
    await call('DELETE', `/admin/knowledge/${draft.json.id}`, SA);
    const gone = await call('GET', `/public/knowledge/${slug}?locale=en`);
    check('archived article is no longer public', gone.status === 404, String(gone.status));
  }
  const kg = await call('GET', '/admin/knowledge-graph/summary', SA);
  const objs = await call('GET', '/admin/knowledge-graph/objects?limit=5', SA);
  check('knowledge graph admin view (objects, sources, release validity, verification, conflicts)',
    kg.status === 200 && objs.status === 200 && Array.isArray(kg.json.sources) && typeof kg.json.conflicts.facts === 'number',
    `${kg.json.objects?.total} objects, ${kg.json.sources?.length} sources, ${objs.json.items?.[0]?.releaseValidity?.releases ?? 0} releases on first record`);

  // ---------------------------------------------------------------- Source Sync Admin
  const rosa = 'ROSA_FILE_IMPORT';
  const src0 = await call('GET', '/admin/sources', SA);
  const rosaState = (src0.json.adapters ?? []).find((a) => a.adapterId === rosa);
  check('source adapters listed with freshness, errors, items and changes', src0.status === 200 && (src0.json.adapters ?? []).length >= 2,
    (src0.json.adapters ?? []).map((a) => `${a.adapterId}:${a.freshness}`).join(' '));
  if (rosaState && rosaState.freshness !== 'FRESH') {
    await call('PUT', `/admin/sources/${rosa}/settings`, SA, { critical: true, freshnessThresholdHours: 1, alertsEnabled: true });
    const chk = await call('POST', '/admin/sources/freshness-check', SA);
    const opened = (chk.json.opened ?? []).find((o) => o.adapterId === rosa);
    check('stale alert opened for a critical never-synced source', chk.status === 200 && opened && opened.notifiedUsers >= 1, JSON.stringify(opened ?? chk.json).slice(0, 160));
    const again = await call('POST', '/admin/sources/freshness-check', SA);
    check('freshness check is idempotent (one open alert per source)', !(again.json.opened ?? []).some((o) => o.adapterId === rosa));
    const notes = await call('GET', '/notifications?status=all', SA);
    check('super admin received an in-app stale notification', (notes.json.items ?? []).some((n) => n.eventType === 'knowledge.source_stale' && n.link === '/admin/sources'));
    const mails = await devMail(process.env.SUPER_ADMIN_EMAIL);
    if (mails) check('super admin received a stale e-mail', mails.some((m) => m.template === 'KNOWLEDGE_SOURCE_STALE'));
    await call('PUT', `/admin/sources/${rosa}/settings`, SA, { critical: false, freshnessThresholdHours: 720, alertsEnabled: true });
    const res = await call('POST', '/admin/sources/freshness-check', SA);
    check('alert resolved when the source is no longer critical', (res.json.resolved ?? []).some((r) => r.adapterId === rosa && r.reason === 'NOT_CRITICAL'));
  } else console.log(`SKIP  stale alert (${rosa} is fresh in this environment)`);
  const notRetriable = await call('POST', `/admin/sources/${rosa}/retry`, SA);
  check('file-import source cannot be retried (409)', notRetriable.status === 409 && notRetriable.json.code === 'SOURCE_NOT_RETRIABLE', String(notRetriable.status));
  const cr = 'SAP_CLOUDIFICATION_REPOSITORY';
  const runsBefore = (await call('GET', `/admin/sources/${cr}/runs`, SA)).json ?? [];
  const retry = await call('POST', `/admin/sources/${cr}/retry`, SA);
  check('source retry queued', retry.status === 202 && retry.json.queued === true, `${retry.status} job ${retry.json.jobId}`);
  let newRun = null;
  for (let i = 0; i < 90 && !newRun; i++) {
    await sleep(2000);
    const runs = (await call('GET', `/admin/sources/${cr}/runs`, SA)).json ?? [];
    newRun = runs.find((r) => !runsBefore.some((b) => b.id === r.id) && r.trigger === 'ADMIN' && r.status !== 'RUNNING') ?? null;
  }
  check('retry executed a new admin sync run', Boolean(newRun) && ['NOOP', 'PUBLISHED', 'FAILED'].includes(newRun.status),
    newRun ? `${newRun.status}${newRun.error ? `: ${newRun.error.slice(0, 80)}` : ''} (${newRun.triggeredBy})` : 'no run within 180 s');

  // ---------------------------------------------------------------- UI (Chromium)
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${WEB}/login`);
    await page.evaluate(([tok, org]) => {
      localStorage.setItem('erppreflight_token', tok);
      localStorage.setItem('erppreflight_tenant_id', org);
    }, [SA, saOrg]);
    await context.addCookies([
      { name: 'erp_auth', value: '1', url: WEB },
      { name: 'erp_consent', value: 'necessary', url: WEB },
    ]);
    const ui = async (name, fn) => {
      try {
        await fn();
        ok(name);
      } catch (err) {
        fail(name, String(err?.message ?? err).split('\n')[0]);
        await page.screenshot({ path: path.join(OUT, `${name.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true }).catch(() => undefined);
      }
    };
    await ui('UI admin portal links to the governance screens', async () => {
      await page.goto(`${WEB}/admin`);
      await page.getByTestId('governance-links').getByRole('link', { name: /Rule Admin/ }).waitFor({ timeout: 20000 });
    });
    await ui('UI Rule Admin: inventory table, manage a rule, self-test result and gate', async () => {
      await page.goto(`${WEB}/admin/rules`);
      await page.getByRole('table').waitFor({ timeout: 30000 });
      await page.getByLabel('Search rule code or title').fill(passRule.ruleCode);
      await page.getByRole('button', { name: `Manage rule ${passRule.ruleCode}` }).click();
      const detail = page.getByTestId('rule-detail');
      await detail.getByText(`Rule ${passRule.ruleCode}`).waitFor({ timeout: 15000 });
      await detail.getByText('Must fire').first().waitFor({ timeout: 15000 });
      await page.screenshot({ path: path.join(OUT, 'rule-admin.png'), fullPage: true });
    });
    await ui('UI AI Admin: providers, kill switch state and task spend', async () => {
      await page.goto(`${WEB}/admin/ai`);
      await page.getByRole('heading', { name: 'Providers and kill switches' }).waitFor({ timeout: 20000 });
      await page.locator('[data-provider="OLLAMA_LOCAL"]').getByText('Active').waitFor();
      await page.locator('[data-task="intent_classification"]').getByText(/Spend/).waitFor();
      await page.screenshot({ path: path.join(OUT, 'ai-admin.png'), fullPage: true });
    });
    await ui('UI Knowledge Admin: articles workflow and knowledge graph tab', async () => {
      await page.goto(`${WEB}/admin/knowledge`);
      await page.getByRole('tab', { name: /Articles/ }).waitFor({ timeout: 20000 });
      await page.getByRole('table').first().waitFor({ timeout: 20000 });
      await page.getByRole('tab', { name: /Knowledge graph/ }).click();
      await page.getByTestId('kg-admin').getByRole('heading', { name: 'Evidence sources' }).waitFor({ timeout: 20000 });
      await page.screenshot({ path: path.join(OUT, 'knowledge-admin.png'), fullPage: true });
    });
    await ui('UI Source Sync Admin: adapters, freshness and alerts', async () => {
      await page.goto(`${WEB}/admin/sources`);
      await page.locator(`[data-adapter="${cr}"]`).getByText(/Fresh|Stale|Never synced/).first().waitFor({ timeout: 20000 });
      await page.getByTestId('source-alerts').waitFor();
      await page.screenshot({ path: path.join(OUT, 'source-admin.png'), fullPage: true });
    });
    await ui('UI governance routes are localized (DE)', async () => {
      await context.addCookies([{ name: 'erp_locale', value: 'de', url: WEB }]);
      await page.goto(`${WEB}/admin/sources`);
      await page.getByRole('heading', { name: 'Quellen-Synchronisierung' }).waitFor({ timeout: 20000 });
      await page.goto(`${WEB}/admin/rules`);
      await page.getByRole('heading', { name: 'Regelverwaltung' }).waitFor({ timeout: 20000 });
    });
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? 'admin governance smoke: ALL PASSED' : `admin governance smoke: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAIL  unexpected error', err);
  process.exit(1);
});
