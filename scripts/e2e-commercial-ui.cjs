// Browser test of the commercial & governance UI against a running web + API stack.
// Usage: WEB_URL=http://localhost:3300 API_BASE_URL=http://localhost:3301 \
//        SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... [CHROMIUM_PATH=...] \
//        node scripts/e2e-commercial-ui.cjs [screenshotDir]
// Sets up a throwaway tenant (project + analysed fixture) through the API, then drives the UI:
// report exports in every format incl. ZIP_ALL, billing page, audit log + chain verification,
// retention settings, and the super-admin business / incidents / support / feature-flag tabs.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '') + '/api/v1';
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-commercial-ui-'));
fs.mkdirSync(OUT, { recursive: true });
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

// Analyses/exports require a verified address; confirm it via the dev mailbox (MAIL_TRANSPORT=dev).
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

async function setupTenant() {
  const r = Date.now() % 1000000;
  const email = `uicom${r}@e2e.local`;
  const reg = await api('POST', '/auth/register', null, { email, password: 'UiCommercialPass!2026', fullName: 'UI Commercial', organizationName: `UI Commercial ${r}` });
  if (!reg.body.accessToken) throw new Error('register failed ' + JSON.stringify(reg.body));
  await verifyEmail(email);
  const token = reg.body.accessToken;
  const orgId = reg.body.user.organizationId;
  const proj = await api('POST', '/projects', token, { name: 'Commercial UI Project', description: 'ui', targetRelease: 'S4H_2023' });
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(ROOT, 'tests/fixtures/known_bad_billing_opd.xml'))], { type: 'application/xml' }), 'known_bad_billing_opd.xml');
  const up = await api('POST', `/projects/${proj.body.id}/files`, token, fd);
  const an = await api('POST', '/analyses', token, { projectId: proj.body.id, engineTypes: ['OPD_GUARD'], fileIds: [up.body.fileId] });
  let status;
  for (let i = 0; i < 60; i++) {
    status = (await api('GET', `/analyses/${an.body.analysisId}`, token)).body.status;
    if (['COMPLETED', 'FAILED', 'PARTIAL'].includes(status)) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  if (status !== 'COMPLETED') throw new Error('analysis did not complete: ' + status);
  return { token, orgId, projectId: proj.body.id, analysisId: an.body.analysisId };
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
    catch (e) { failures++; console.log('FAIL ', name, '::', e.message.split('\n')[0]); }
    await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {});
  };
  const loginAs = async (token, orgId) => {
    // Same state a real browser login leaves behind: the session JWT only in the API's
    // HttpOnly cookie (never in web storage), the active organization, the non-secret
    // route-guard marker and a stored cookie-consent choice. The web app obtains its
    // CSRF token from GET /auth/csrf.
    await page.context().addCookies([
      { name: 'erppreflight_session', value: token, url: API.replace(/\/api\/v1$/, ''), httpOnly: true, sameSite: 'Lax' },
      { name: 'erp_auth', value: '1', url: WEB },
      { name: 'erp_consent', value: 'necessary', url: WEB },
    ]);
    await page.goto(WEB + '/login');
    await page.evaluate((o) => { localStorage.setItem('erppreflight_tenant_id', o); }, orgId);
  };

  let t;
  await step('00 api setup (tenant, project, analysed fixture)', async () => { t = await setupTenant(); });
  if (!t) { await browser.close(); process.exit(1); }
  await loginAs(t.token, t.orgId);

  const magic = { PDF: '%PDF', XLSX: 'PK', CSV: '﻿', JSON_BUNDLE: '{', HTML_OFFLINE: '<!DOCTYPE', ZIP_ALL: 'PK' };
  await step('01 workspace run history -> open report exports', async () => {
    await page.goto(`${WEB}/projects/${t.projectId}`);
    await page.getByRole('button', { name: 'Run History', exact: true }).click();
    await page.getByTestId(`open-exports-${t.analysisId}`).click();
    await page.getByTestId(`export-panel-${t.analysisId}`).waitFor();
  });
  for (const fmt of Object.keys(magic)) {
    await step(`02 export ${fmt} via UI and download`, async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.getByTestId(`export-${fmt}`).click(),
      ]);
      const file = path.join(OUT, download.suggestedFilename());
      await download.saveAs(file);
      const head = fs.readFileSync(file).subarray(0, 12).toString('utf8');
      if (!head.startsWith(magic[fmt])) throw new Error(`unexpected file header for ${fmt}: ${JSON.stringify(head)}`);
      console.log(`      ${download.suggestedFilename()} (${fs.statSync(file).size} bytes)`);
      if (fmt === 'ZIP_ALL') {
        const buf = fs.readFileSync(file);
        const names = ['manifest.json', '.pdf', '.xlsx', '.csv', '.json', '.html'];
        for (const n of names) if (!buf.includes(Buffer.from(n))) throw new Error(`ZIP_ALL missing ${n}`);
      }
    });
  }
  await step('03 report history lists generated reports', async () => {
    await page.getByTestId('report-history').locator('li').nth(5).waitFor({ timeout: 15000 });
  });

  await step('04 billing page: plan, trial, meters, not-configured state', async () => {
    await page.goto(`${WEB}/settings/billing`);
    await page.getByTestId('current-plan').waitFor({ timeout: 15000 });
    await page.getByText('Billing is not configured on this deployment').waitFor();
    const trial = await page.getByTestId('trial-state').innerText();
    if (!/PROFESSIONAL trial/.test(trial)) throw new Error('trial state: ' + trial);
    const exportsMeter = await page.getByTestId('meter-exportsPerMonth').innerText();
    if (!/6 of/.test(exportsMeter)) throw new Error('exports meter: ' + exportsMeter);
    await page.getByText('Contact sales').first().waitFor();
  });

  await step('05 audit log: rows, filter, verify chain', async () => {
    await page.goto(`${WEB}/settings/audit`);
    await page.getByTestId('audit-table').waitFor({ timeout: 15000 });
    await page.getByLabel('Action').selectOption('report.');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForURL(/action=report\./);
    await page.waitForFunction(() => {
      const cells = [...document.querySelectorAll('[data-testid=audit-table] tbody tr td:nth-child(3) span.font-mono')];
      return cells.length > 0 && cells.every((c) => c.textContent.startsWith('report.'));
    }, null, { timeout: 15000 });
    await page.getByRole('button', { name: /Verify chain integrity/ }).click();
    const result = await page.getByTestId('verify-result').innerText({ timeout: 15000 });
    if (!/Chain intact/.test(result)) throw new Error('verify: ' + result);
  });

  await step('06 retention settings: change and save', async () => {
    await page.goto(`${WEB}/settings/retention`);
    await page.getByLabel('Uploaded artifacts').selectOption('7');
    await page.getByRole('button', { name: /Save retention policy/ }).click();
    await page.getByText('Retention settings saved').waitFor({ timeout: 15000 });
    const saved = await api('GET', '/retention/settings', t.token);
    if (saved.body.artifactRetentionDays !== 7) throw new Error('not persisted: ' + JSON.stringify(saved.body));
  });

  await step('07 support: submit ticket and grant access', async () => {
    await page.goto(`${WEB}/settings/support`);
    await page.getByLabel('Subject').fill('Export question from UI test');
    await page.getByLabel('Description').fill('Please explain the ZIP_ALL manifest checksums.');
    await page.getByRole('button', { name: /Submit ticket/ }).click();
    await page.getByText('Ticket submitted').waitFor({ timeout: 15000 });
    await page.getByLabel('Reason').fill('UI test support session');
    await page.getByRole('button', { name: /Grant access/ }).click();
    await page.getByRole('button', { name: /Revoke/ }).waitFor({ timeout: 15000 });
  });

  const sa = await api('POST', '/auth/login', null, { email: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD });
  if (!sa.body.accessToken) { console.log('FAIL  super admin login'); failures++; }
  else {
    await loginAs(sa.body.accessToken, sa.body.user.organizationId);
    await step('08 admin business tab', async () => {
      await page.goto(`${WEB}/admin`);
      await page.getByRole('button', { name: /Business & Usage/ }).click();
      await page.getByTestId('admin-business').getByText('Estimated MRR').waitFor({ timeout: 15000 });
    });
    await step('09 admin incidents tab (queues + engine registry)', async () => {
      await page.getByRole('button', { name: /Incidents & Jobs/ }).click();
      await page.getByTestId('admin-incidents').getByText('analysis-queue').waitFor({ timeout: 15000 });
      await page.getByTestId('engine-registry-summary').waitFor({ timeout: 15000 });
    });
    await step('10 admin support console: tenant lookup via grant', async () => {
      await page.getByRole('button', { name: /Support Console/ }).click();
      await page.getByLabel('Organization name, slug, id or member e-mail').fill(t.orgId);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('button', { name: 'Open' }).first().click();
      await page.getByTestId('tenant-detail').getByText('Access via tenant grant').waitFor({ timeout: 15000 });
    });
    await step('11 admin feature flags: create flag', async () => {
      await page.getByRole('button', { name: /Feature Flags/ }).click();
      await page.getByRole('button', { name: /New flag/ }).click();
      const key = `ui.flag-${Date.now() % 100000}`;
      await page.getByLabel('Key').fill(key);
      await page.getByLabel('Description').fill('Created by UI test');
      await page.getByLabel(/Enabled \(kill switch\)/).check();
      await page.getByRole('button', { name: 'Save flag' }).click();
      await page.getByTestId('admin-flags').getByText(key).waitFor({ timeout: 15000 });
      await api('DELETE', `/admin/feature-flags/${key}`, sa.body.accessToken);
    });
  }

  console.log('SCREENSHOTS', OUT);
  if (problems.length) console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  await browser.close();
  console.log(failures ? `${failures} STEP(S) FAILED` : 'ALL COMMERCIAL UI STEPS PASSED');
  process.exit(failures ? 1 : 0);
})();
