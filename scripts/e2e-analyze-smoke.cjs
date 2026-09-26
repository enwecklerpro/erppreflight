// Browser + API smoke test of the Analyze experience, Problem Router, analysis progress,
// Full Project Preflight and the reports hub against a running web + API stack.
// Usage: WEB_URL=http://localhost:3000 API_BASE_URL=http://localhost:3001 MAIL_DEV_OUTBOX_TOKEN=... \
//        [CHROMIUM_PATH=...] node scripts/e2e-analyze-smoke.cjs [screenshotDir]
// Flow: describe the problem on /analyze -> router suggests OPD Guard -> upload the fixture ->
// run -> progress stepper reaches the final stage -> finding visible; Full Project Preflight on a
// project with several fixtures -> summary + correlated root cause -> drill-down; project context;
// reports hub generates, lists and downloads; SSE stream + cross-tenant denial on every new endpoint.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_ORIGIN = (process.env.API_BASE_URL || process.env.API_URL || WEB.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)).replace(/\/$/, '');
const API = API_ORIGIN + '/api/v1';
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-analyze-smoke-'));
fs.mkdirSync(OUT, { recursive: true });
const FIX = (p) => path.join(ROOT, 'tests', p);
let failures = 0;

async function api(method, p, token, body, extraHeaders = {}) {
  const headers = { Accept: 'application/json', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + p, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function verifyEmail(email) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${API}/dev/mail/messages?to=${encodeURIComponent(email)}`, {
      headers: { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN || '' },
    });
    if (res.status === 404) throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev');
    const { items } = await res.json();
    const link = items.filter((m) => m.template === 'EMAIL_VERIFICATION').flatMap((m) => m.links)[0];
    if (link) {
      const v = await api('POST', '/auth/verify-email', null, { token: link.split('token=')[1] });
      if (v.status >= 300) throw new Error('verify-email failed ' + JSON.stringify(v.body));
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no verification e-mail for ${email}`);
}

async function tenant(tag) {
  const r = `${Date.now() % 1000000}${Math.floor(Math.random() * 100)}`;
  const email = `analyze${tag}${r}@e2e.local`;
  const reg = await api('POST', '/auth/register', null, { email, password: 'AnalyzeSmokePass!2026', fullName: `Analyze ${tag}`, organizationName: `Analyze ${tag} ${r}` });
  if (!reg.body.accessToken) throw new Error('register failed ' + JSON.stringify(reg.body));
  await verifyEmail(email);
  const login = await api('POST', '/auth/login', null, { email, password: 'AnalyzeSmokePass!2026' });
  return { token: login.body.accessToken, orgId: login.body.user.organizationId };
}

async function upload(token, projectId, rel) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(FIX(rel))]), path.basename(rel));
  const up = await api('POST', `/projects/${projectId}/files`, token, fd);
  if (!up.body.fileId) throw new Error(`upload ${rel} failed ${JSON.stringify(up.body).slice(0, 300)}`);
  return up.body.fileId;
}

async function waitClean(token, projectId, count) {
  for (let i = 0; i < 40; i++) {
    const res = await api('GET', `/projects/${projectId}/files`, token);
    const list = Array.isArray(res.body) ? res.body : res.body.items || [];
    const clean = list.filter((f) => (f.quarantineStatus || f.quarantine_status) === 'CLEAN').length;
    if (clean >= count) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('artifacts did not become CLEAN');
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  const step = async (name, fn) => {
    try { await fn(); console.log('OK   ', name); }
    catch (e) { failures++; console.log('FAIL ', name, '::', String(e && e.message || e).split('\n')[0]); }
    await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {});
  };

  let A, B, projectId, analysisId, fppId;
  await step('00 api setup (tenants A and B, verified)', async () => {
    A = await tenant('a');
    B = await tenant('b');
  });
  if (!A || !B) { await browser.close(); process.exit(1); }

  // Browser session exactly as after a real login: the JWT only in the API's HttpOnly cookie
  // (never in web storage), the active organization, the route-guard marker and the
  // cookie-consent choice. The web app fetches its CSRF token from GET /auth/csrf.
  await context.addCookies([
    { name: 'erppreflight_session', value: A.token, url: API_ORIGIN, httpOnly: true, sameSite: 'Lax' },
    { name: 'erp_auth', value: '1', url: WEB },
    { name: 'erp_consent', value: 'necessary', url: WEB },
  ]);
  await page.goto(WEB + '/login');
  await page.evaluate((o) => { localStorage.setItem('erppreflight_tenant_id', o); }, A.orgId);

  await step('01 navbar: Analyze -> /analyze, Reports in the primary nav', async () => {
    await page.goto(WEB + '/dashboard');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'Analyze' }).waitFor({ timeout: 15000 });
    if ((await nav.getByRole('link', { name: 'Analyze' }).getAttribute('href')) !== '/analyze') throw new Error('Analyze does not link to /analyze');
    if ((await nav.getByRole('link', { name: 'Reports' }).getAttribute('href')) !== '/reports') throw new Error('Reports missing');
  });

  await step('02 /analyze: describe problem + create project inline', async () => {
    await page.goto(WEB + '/analyze');
    await page.getByRole('heading', { name: 'What do you want to check?' }).waitFor({ timeout: 15000 });
    await page.getByTestId('analyze-problem').fill('Purchase order is created but supplier email is not sent.');
    await page.getByRole('button', { name: 'Create a new project' }).click();
    await page.getByLabel(/New project name/).fill('Analyze Smoke Project');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForFunction(() => {
      const s = document.querySelector('[data-testid="analyze-project"]');
      return s && s.value && s.value.length === 36;
    }, null, { timeout: 15000 });
    projectId = await page.getByTestId('analyze-project').inputValue();
  });

  await step('03 upload fixture on /analyze and wait for CLEAN', async () => {
    await page.getByTestId('analyze-upload').setInputFiles(FIX('e2e/fixtures/opd/opd_po_missing_recipient.json'));
    await page.locator('[data-testid="analyze-files"] li', { hasText: 'opd_po_missing_recipient.json' }).getByText('CLEAN').waitFor({ timeout: 30000 });
  });

  await step('04 router suggests OPD Guard as primary with required inputs', async () => {
    await page.getByTestId('analyze-suggest').click();
    const first = page.locator('[data-testid="router-suggestions"] li[data-engine]').first();
    await first.waitFor({ timeout: 15000 });
    if ((await first.getAttribute('data-engine')) !== 'OPD_GUARD') throw new Error('first suggestion is ' + (await first.getAttribute('data-engine')));
    if ((await first.getAttribute('data-role')) !== 'PRIMARY') throw new Error('OPD Guard is not primary');
    await first.getByText(/decision table/i).first().waitFor({ timeout: 5000 });
    const txt = await page.getByTestId('analyze-engine-count').textContent();
    if (!/[1-9]/.test(txt || '')) throw new Error('suggested engines not preselected: ' + txt);
  });

  await step('05 run -> progress stepper reaches Finalizing -> finding visible', async () => {
    await page.getByTestId('analyze-launch').click();
    await page.locator('[data-testid="analysis-progress"][data-status="COMPLETED"]').waitFor({ timeout: 90000 });
    const finalState = await page.locator('[data-testid="analysis-progress"] li[data-stage="FINALIZING"]').getAttribute('data-state');
    if (finalState !== 'COMPLETED') throw new Error('FINALIZING state ' + finalState);
    const states = await page.locator('[data-testid="analysis-progress"] li[data-stage]').evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
    if (states.some((s) => !['COMPLETED', 'SKIPPED'].includes(s))) throw new Error('stages ' + states.join(','));
    await page.locator('[data-testid="analyze-finding"][data-rule="OPD_DETERMINATION_STEP_MISSING"]').waitFor({ timeout: 20000 });
    const list = await api('GET', `/analyses?projectId=${projectId}`, A.token);
    analysisId = list.body[0].id;
  });

  await step('06 SSE stream (bearer JWT) replays stages and ends', async () => {
    const res = await fetch(`${API}/analyses/${analysisId}/events`, { headers: { Authorization: `Bearer ${A.token}`, Accept: 'text/event-stream' } });
    if (res.status !== 200 || !String(res.headers.get('content-type')).includes('text/event-stream')) throw new Error('SSE status ' + res.status);
    const body = await res.text();
    for (const s of ['UPLOAD_VALIDATED', 'PARSING', 'RUNNING_RULES', 'MATCHING_EVIDENCE', 'FINALIZING']) if (!body.includes(`"stage":"${s}"`)) throw new Error('missing stage ' + s);
    if (!body.includes('event: end')) throw new Error('no end event');
    const poll = await api('GET', `/analyses/${analysisId}/progress`, A.token);
    if (poll.body.percent !== 100 || !poll.body.terminal) throw new Error('poll fallback ' + JSON.stringify(poll.body).slice(0, 200));
  });

  await step('07 project context form saves source/target/modules', async () => {
    await page.goto(`${WEB}/projects/${projectId}`);
    await page.getByTestId('tab-context').click();
    const formEl = page.getByTestId('project-context-form');
    await formEl.getByLabel('Source ERP').selectOption('SAP_ECC');
    await formEl.getByLabel('Target product').selectOption('S4HANA_CLOUD_PUBLIC');
    await formEl.getByLabel('Deployment').selectOption('PUBLIC_CLOUD');
    await formEl.getByLabel('Countries').fill('DE, FR');
    await formEl.getByLabel('Modules').fill('FI, MM, SD');
    await page.getByTestId('project-context-save').click();
    await formEl.getByText('Project context saved.').waitFor({ timeout: 15000 });
    const p = await api('GET', `/projects/${projectId}`, A.token);
    if (p.body.context.sourceErp !== 'SAP_ECC' || p.body.context.modules.join() !== 'FI,MM,SD') throw new Error(JSON.stringify(p.body.context));
  });

  await step('08 full project preflight -> summary + correlated root cause + drill-down', async () => {
    for (const f of [
      'e2e/fixtures/preflight/po_supplier_vat_template.xdp',
      'e2e/fixtures/preflight/po_supplier_vat_payload.xml',
      'e2e/fixtures/preflight/custom_field_supplier_vat.json',
      'e2e/fixtures/clean_core/clean_core_legacy.abap',
      'e2e/fixtures/transport/tr_collision.json',
    ]) await upload(A.token, projectId, f);
    await waitClean(A.token, projectId, 6);
    await page.goto(`${WEB}/projects/${projectId}`);
    await page.getByTestId('open-full-preflight').click();
    await page.getByTestId('run-full-preflight').click();
    await page.getByTestId('full-preflight-summary').waitFor({ timeout: 120000 });
    await page.locator('[data-testid="fpp-correlations"] li[data-kind="FORM_DATA_PATH"]').waitFor({ timeout: 10000 });
    const cat = await page.locator('[data-category="MIGRATION_BLOCKERS"]').textContent();
    if (!/\d/.test(cat || '')) throw new Error('no category counts');
    await page.locator('[data-testid="fpp-engines"] li[data-engine="FORM_DOCTOR"] button').click();
    await page.locator('[data-testid="fpp-engines"] li[data-engine="FORM_DOCTOR"] [data-testid="fpp-finding"]').first().waitFor({ timeout: 15000 });
    const latest = await api('GET', `/projects/${projectId}/full-preflight/latest`, A.token);
    fppId = latest.body.analysis.id;
    const s = latest.body.summary;
    if (!s || s.totals.correlatedGroups < 1 || latest.body.plan.stages.length < 2) throw new Error('summary ' + JSON.stringify(s && s.totals));
    if (!latest.body.plan.missingInputs.some((m) => m.engine === 'ECC2CLOUD_NAVIGATOR')) throw new Error('context-derived missing inputs absent');
  });

  await step('09 reports hub: generate from finished analysis, list, download', async () => {
    await page.goto(`${WEB}/reports`);
    await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor({ timeout: 15000 });
    const gen = page.getByTestId('reports-generate');
    await page.getByTestId('gen-project').selectOption(projectId);
    await page.waitForFunction((id) => !!document.querySelector(`[data-testid="gen-analysis"] option[value="${id}"]`), fppId, { timeout: 15000 });
    await page.getByTestId('gen-analysis').selectOption(fppId);
    await gen.getByLabel('Report type').selectOption('EXECUTIVE');
    await gen.getByLabel('Format').selectOption('PDF');
    await page.getByTestId('gen-submit').click();
    await gen.getByText(/generated\./).waitFor({ timeout: 30000 });
    const row = page.getByTestId('report-row').first();
    await row.waitFor({ timeout: 15000 });
    if (!/Full Preflight/.test((await row.textContent()) || '')) throw new Error('row not tagged as Full Preflight');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), row.getByTestId('report-download').click()]);
    const file = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(file);
    if (fs.readFileSync(file).subarray(0, 4).toString() !== '%PDF') throw new Error('download is not a PDF');
    await page.getByTestId('reports-filter-project').selectOption(projectId);
    await page.getByTestId('report-row').first().waitFor({ timeout: 10000 });
    const hub = await api('GET', `/reports?projectId=${projectId}&format=PDF`, A.token);
    if (hub.body.pagination.total < 1) throw new Error('hub API empty');
  });

  await step('10 cross-tenant denial on every new endpoint', async () => {
    const checks = [
      ['GET', `/analyses/${analysisId}/progress`],
      ['GET', `/analyses/${analysisId}/events`],
      ['GET', `/analyses/${fppId}/orchestration`],
      ['GET', `/projects/${projectId}/full-preflight/latest`],
      ['POST', `/projects/${projectId}/full-preflight`, {}],
      ['PUT', `/projects/${projectId}/context`, { modules: ['FI'] }],
      ['POST', '/router/route', { problem: 'supplier email is not sent', projectId }],
    ];
    for (const [m, p, b] of checks) {
      const r = await api(m, p, B.token, b);
      if (![403, 404].includes(r.status)) throw new Error(`${m} ${p} -> ${r.status}`);
    }
    const spoof = await api('GET', `/analyses/${analysisId}/progress`, B.token, undefined, { 'X-Tenant-Id': A.orgId });
    if (spoof.status !== 403) throw new Error('spoofed tenant header -> ' + spoof.status);
    const hubB = await api('GET', '/reports', B.token);
    if (hubB.body.pagination.total !== 0) throw new Error('tenant B sees reports: ' + hubB.body.pagination.total);
  });

  await step('11 German UI strings on /analyze', async () => {
    await context.addCookies([{ name: 'erp_locale', value: 'de', url: WEB }]);
    await page.goto(WEB + '/analyze');
    await page.getByRole('heading', { name: 'Was möchten Sie prüfen?' }).waitFor({ timeout: 15000 });
    await context.addCookies([{ name: 'erp_locale', value: 'en', url: WEB }]);
  });

  const csp = problems.filter((p) => /Content Security Policy/i.test(p));
  if (csp.length) { failures++; console.log('FAIL  CSP violations', JSON.stringify(csp)); } else console.log('OK    no CSP violations');
  const serverErrors = problems.filter((p) => p.startsWith('HTTP 5'));
  if (serverErrors.length) { failures++; console.log('FAIL  server errors', JSON.stringify(serverErrors)); }
  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  await browser.close();
  console.log(failures ? `${failures} STEP(S) FAILED (screenshots: ${OUT})` : 'ALL STEPS PASSED');
  process.exit(failures ? 1 : 0);
})();
