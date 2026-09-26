// Browser smoke test of the core user journey against a running web + API stack.
// Usage: WEB_URL=http://localhost:3000 [API_URL=http://localhost:3001] [MAIL_DEV_OUTBOX_TOKEN=...] [CHROMIUM_PATH=/path/to/chromium] node scripts/e2e-ui-smoke.cjs [screenshotDir]
// The API must run with MAIL_TRANSPORT=dev: the new account is verified by following the
// verification link from the dev mailbox (analyses are locked until the e-mail is verified).
// Signs up a throwaway tenant, creates a project, uploads the golden OPD fixture, runs the
// analysis from the UI and opens the finding with its evidence. Exits non-zero on any failure.
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const ROOT = path.resolve(__dirname, '..');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
// Default API origin: same host, web port + 1 (3000 -> 3001, 3200 -> 3201).
const API = (process.env.API_URL || WEB.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)).replace(/\/$/, '');
async function mailLink(to, template) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${API}/api/v1/dev/mail/messages?to=${encodeURIComponent(to)}`, {
      headers: { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN || '' },
    });
    if (res.ok) {
      const { items } = await res.json();
      const link = items.filter((m) => m.template === template).flatMap((m) => m.links)[0];
      if (link) return link;
    } else if (res.status === 404) {
      throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${template} e-mail for ${to}`);
}
const S = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'erp-ui-smoke-'));
let failures = 0;
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  // Pre-answer the cookie banner so it does not overlay controls near the bottom edge.
  await context.addCookies([{ name: 'erp_consent', value: 'necessary', url: WEB }]);
  const page = await context.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200)); });
  page.on('response', r => { if (r.url().includes('/api/v1/') && r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  const step = async (name, fn) => {
    try { await fn(); console.log('OK   ', name); }
    catch (e) { failures++; console.log('FAIL ', name, '::', e.message.split('\n')[0]); }
    await page.screenshot({ path: `${S}/${name.replace(/\W+/g,'_')}.png`, fullPage: true });
  };
  const R = Date.now() % 100000;
  await step('01 signup', async () => {
    await page.goto(WEB + '/signup');
    await page.getByPlaceholder('Acme Global Industries').fill(`UI Org ${R}`);
    await page.getByPlaceholder('Jane Doe').fill('Ui Tester');
    await page.getByLabel(/Work Email/).fill(`ui${R}@e2e.local`);
    const pw = page.getByPlaceholder('••••••••••••');
    await pw.nth(0).fill('UiTesterPass!2026'); await pw.nth(1).fill('UiTesterPass!2026');
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/(projects|onboarding)/, { timeout: 15000 });
  });
  await step('01b verify e-mail from the verification link', async () => {
    await page.getByText(/Verify your e-?mail address/).first().waitFor({ timeout: 15000 });
    const link = await mailLink(`ui${R}@e2e.local`, 'EMAIL_VERIFICATION');
    await page.goto(link);
    await page.getByText('E-mail verified').first().waitFor({ timeout: 15000 });
  });
  await step('02 projects page', async () => {
    await page.goto(WEB + '/projects');
    await page.getByText('New Project').click();
    await page.getByPlaceholder('e.g. S/4HANA 2023 Enterprise Migration Preflight').fill('UI E2E Project');
    await page.locator('form button[type=submit]').click();
    await page.getByText('UI E2E Project').first().waitFor({ timeout: 15000 });
  });
  await step('03 open project', async () => {
    await page.getByText('Enter Workspace').first().click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  });
  await step('04 upload artifact', async () => {
    await page.getByText('Artifact Dropzone').first().click();
    await page.locator('input[type=file]').first().setInputFiles(path.join(ROOT, 'tests/fixtures/known_bad_billing_opd.xml'));
    await page.getByText(/known_bad_billing_opd\.xml/).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2000);
  });
  await step('05 select file and launch', async () => {
    await page.waitForTimeout(3000);
    await page.getByText('Analysis Launcher').first().click();
    await page.waitForTimeout(1500);
    const cb = page.locator('input[type=checkbox]');
    console.log('   checkboxes:', await cb.count());
    if (await cb.count()) { await cb.first().check(); }
    const launch = page.getByRole('button', { name: /Execute Preflight Run/i }).first();
    console.log('   launch button:', await launch.textContent());
    await launch.click();
    await page.waitForTimeout(10000);
  });
  await step('06 findings visible', async () => {
    await page.getByText('Findings').first().click();
    await page.waitForTimeout(1500);
    await page.getByText('Open Full Findings Ledger').first().click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(2000);
    await page.getByText(/OPD_DETERMINATION_STEP_MISSING|Output Type Determination Failed/).first().waitFor({ timeout: 20000 });
  });
  await step('07 finding detail with evidence', async () => {
    await page.getByText(/Output Type Determination Failed|OPD_DETERMINATION_STEP_MISSING/).first().click();
    await page.waitForTimeout(1500);
    await page.getByText(/known_bad_billing_opd\.xml/).first().waitFor({ timeout: 10000 });
  });
  const cspViolations = problems.filter((p) => /Content Security Policy/i.test(p));
  if (cspViolations.length) { failures++; console.log('FAIL  CSP violations', JSON.stringify(cspViolations)); }
  else console.log('OK    no CSP violations');
  console.log('URL', page.url());
  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  await browser.close();
  console.log(failures ? `${failures} STEP(S) FAILED (screenshots: ${S})` : 'ALL STEPS PASSED');
  process.exit(failures ? 1 : 0);
})();
