// Browser smoke test of the finding lifecycle and the regression Test Lab
// (Part 01 §1.7/§1.8, Part 04 §4.10/§4.11, Part 05 §5.5) against a running web + API stack.
// Usage: WEB_URL=http://localhost:3000 [API_URL=http://localhost:3001] MAIL_DEV_OUTBOX_TOKEN=...
//        [CHROMIUM_PATH=/path/to/chromium] node scripts/e2e-findings-smoke.cjs [screenshotDir]
// The API must run with MAIL_TRANSPORT=dev. Journey:
//   analyse golden OPD fixture -> acknowledge -> comment -> assign -> accept risk with reason
//   -> re-run analysis shows the status carried over -> create regression test -> run it (fails)
//   -> upload corrected fixture -> use it as the fixture -> test passes and finding RESOLVED.
// Exits non-zero on any failure.
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL || process.env.API_BASE_URL || WEB.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)).replace(/\/$/, '');
const A = `${API}/api/v1`;
const S = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'erp-findings-smoke-'));
const R = Date.now() % 1000000;
const BAD = fs.readFileSync(path.join(ROOT, 'tests/fixtures/known_bad_billing_opd.xml'));
// Corrected fixture: the Channel decision table gets a rule for billing type F2.
const GOOD = Buffer.from(
  BAD.toString('utf-8').replace('<COND_BillingType>RE</COND_BillingType>', '<COND_BillingType>F2</COND_BillingType>'),
  'utf-8'
);
const ARTIFACT = 'billing_output_determination.xml';
let failures = 0;
let token = null;

async function api(method, p, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(A + p, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function mailLink(to, template) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${A}/dev/mail/messages?to=${encodeURIComponent(to)}`, {
      headers: { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN || '' },
    });
    if (res.ok) {
      const { items } = await res.json();
      const link = items.filter((m) => m.template === template).flatMap((m) => m.links)[0];
      if (link) return link;
    } else if (res.status === 404) throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${template} e-mail for ${to}`);
}

async function uploadClean(projectId, name, buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/xml' }), name);
  const up = await api('POST', `/projects/${projectId}/files`, form);
  const fileId = up.json?.fileId || up.json?.id;
  if (!fileId) throw new Error(`upload failed: ${up.status} ${JSON.stringify(up.json).slice(0, 200)}`);
  for (let i = 0; i < 40; i++) {
    const files = await api('GET', `/projects/${projectId}/files`);
    const list = Array.isArray(files.json) ? files.json : files.json?.items ?? [];
    const f = list.find((x) => x.id === fileId);
    if (f?.quarantineStatus === 'CLEAN') return fileId;
    if (f && ['QUARANTINED', 'REJECTED'].includes(f.quarantineStatus)) throw new Error(`file ${f.quarantineStatus}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('file never became CLEAN');
}

async function analyse(projectId, fileId) {
  const an = await api('POST', '/analyses', { projectId, engineTypes: ['OPD_GUARD'], fileIds: [fileId] });
  if (!an.json?.analysisId) throw new Error(`analysis trigger failed: ${an.status} ${JSON.stringify(an.json).slice(0, 200)}`);
  for (let i = 0; i < 60; i++) {
    const a = await api('GET', `/analyses/${an.json.analysisId}`);
    if (['COMPLETED', 'FAILED', 'PARTIAL'].includes(a.json?.status)) {
      if (a.json.status !== 'COMPLETED') throw new Error(`analysis ${a.json.status}`);
      return an.json.analysisId;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('analysis timeout');
}

async function currentFinding(projectId) {
  const res = await api('GET', `/findings?projectId=${projectId}&latest=true`);
  const f = res.json?.items?.find((x) => x.ruleId === 'OPD_DETERMINATION_STEP_MISSING');
  if (!f) throw new Error(`finding not found: ${JSON.stringify(res.json).slice(0, 200)}`);
  return f;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  await context.addCookies([{ name: 'erp_consent', value: 'necessary', url: WEB }]);
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200));
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('OK   ', name);
    } catch (e) {
      failures++;
      console.log('FAIL ', name, '::', String(e.message).split('\n')[0]);
    }
    await page.screenshot({ path: `${S}/${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {});
  };

  const email = `lifecycle${R}@e2e.local`;
  const password = 'LifecyclePass!2026';
  let projectId = null;
  let userId = null;
  let testCaseId = null;

  // Expands the finding row of the current OPD finding on the findings ledger.
  const openFinding = async () => {
    await page.goto(`${WEB}/projects/${projectId}/findings`);
    await page.getByText('OPD_DETERMINATION_STEP_MISSING').first().waitFor({ timeout: 20000 });
    await page.getByText('OPD_DETERMINATION_STEP_MISSING').first().click();
    await page.getByTestId('finding-lifecycle-panel').waitFor({ timeout: 15000 });
  };
  const panel = () => page.getByTestId('finding-lifecycle-panel');
  const statusIs = async (label) =>
    panel().getByRole('status', { name: new RegExp(`Finding status: ${label}`) }).first().waitFor({ timeout: 15000 });

  await step('01 account, project, golden fixture analysed', async () => {
    const reg = await api('POST', '/auth/register', {
      email,
      password,
      fullName: 'Lifecycle Tester',
      organizationName: `Lifecycle Org ${R}`,
    });
    if (reg.status !== 201) throw new Error(`register ${reg.status}`);
    const link = await mailLink(email, 'EMAIL_VERIFICATION');
    const v = await api('POST', '/auth/verify-email', { token: link.split('token=')[1] });
    if (!v.json?.verified) throw new Error('verification failed');
    const login = await api('POST', '/auth/login', { email, password });
    token = login.json.accessToken;
    userId = login.json.user.id;
    const p = await api('POST', '/projects', { name: `Lifecycle ${R}`, description: 'finding lifecycle smoke', targetRelease: 'S4H_2023' });
    projectId = p.json.id;
    const fileId = await uploadClean(projectId, ARTIFACT, BAD);
    await analyse(projectId, fileId);
    const f = await currentFinding(projectId);
    if (!f.engineVersion || !f.ruleVersion || f.targetRelease !== 'S4H_2023') throw new Error('finding lacks engine/rule version or target release');
  });

  await step('02 sign in through the UI', async () => {
    await page.goto(WEB + '/login');
    await page.getByLabel(/Work Email/).fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: /Sign In/ }).click();
    await page.waitForURL(/\/(projects|dashboard|onboarding)/, { timeout: 20000 });
  });

  await step('03 evidence-first card (why it matters, release, first detected, last evaluated)', async () => {
    await openFinding();
    for (const label of ['Why it matters', 'Target release', 'First detected', 'Last evaluated', 'Rule version', 'Official source / provenance']) {
      await page.getByText(label, { exact: true }).first().waitFor({ timeout: 10000 });
    }
    await statusIs('Open');
    await page.getByTestId('evidence-only-toggle').check();
    if (await panel().count()) throw new Error('lifecycle panel still visible in evidence-only mode');
    await page.getByText('Cryptographic Evidence Chain').first().waitFor({ timeout: 5000 });
    await page.getByTestId('evidence-only-toggle').uncheck();
    await panel().waitFor({ timeout: 10000 });
  });

  await step('04 acknowledge', async () => {
    await panel().locator('[data-transition="ACKNOWLEDGED"]').click();
    await panel().getByRole('button', { name: /Confirm: Acknowledged/ }).click();
    await statusIs('Acknowledged');
  });

  await step('05 comment', async () => {
    await panel().getByLabel('Add a comment').fill('Channel table has no F2 rule; output management owns the fix.');
    await panel().getByRole('button', { name: /^Comment$/ }).click();
    await panel().getByText('Channel table has no F2 rule; output management owns the fix.').waitFor({ timeout: 10000 });
  });

  await step('06 assign owner and due date', async () => {
    await panel().getByLabel('Assignee').selectOption(userId);
    await panel().getByLabel('Due date', { exact: true }).fill('2030-06-30');
    await panel().getByRole('button', { name: 'Save assignment' }).click();
    await panel().getByText('Assignment saved').waitFor({ timeout: 10000 });
  });

  await step('07 accept risk requires a reason, then succeeds', async () => {
    await panel().locator('[data-transition="ACCEPTED_RISK"]').click();
    await panel().getByRole('button', { name: /Confirm: Accepted risk/ }).click();
    await panel().getByText('Enter at least 10 characters').waitFor({ timeout: 5000 });
    await panel().getByLabel(/^Reason/).fill('Accepted until wave 2 go-live; invoices are printed manually meanwhile.');
    await panel().getByRole('button', { name: /Confirm: Accepted risk/ }).click();
    await statusIs('Accepted risk');
  });

  await step('08 re-run analysis carries the status over', async () => {
    const files = await api('GET', `/projects/${projectId}/files`);
    const list = Array.isArray(files.json) ? files.json : files.json?.items ?? [];
    await analyse(projectId, list[0].id);
    const f = await currentFinding(projectId);
    if (f.lifecycle.status !== 'ACCEPTED_RISK' || f.lifecycle.detectionCount < 2) {
      throw new Error(`expected carried-over ACCEPTED_RISK, got ${JSON.stringify(f.lifecycle)}`);
    }
    await openFinding();
    await statusIs('Accepted risk');
    await page.locator('[data-history-event="CARRIED_OVER"]').first().waitFor({ timeout: 10000 });
    await panel().getByText('Channel table has no F2 rule; output management owns the fix.').waitFor({ timeout: 10000 });
  });

  await step('09 re-open and create a regression test', async () => {
    await panel().locator('[data-transition="OPEN"]').click();
    await panel().getByLabel(/^Reason/).fill('Fix scheduled for this sprint');
    await panel().getByRole('button', { name: /Confirm: Open/ }).click();
    await statusIs('Open');
    await panel().getByLabel('Expected outcome').selectOption('FINDING_ABSENT');
    await panel().getByRole('button', { name: 'Create regression test' }).click();
    await panel().getByText(/Regression test created — run it from the Test Lab/).waitFor({ timeout: 15000 });
    await statusIs('Regression test created');
  });

  await step('10 run the regression test in the Test Lab (fails: finding present)', async () => {
    await page.goto(`${WEB}/projects/${projectId}/lab`);
    const item = page.locator('[data-regression-test-id]').first();
    await item.waitFor({ timeout: 20000 });
    testCaseId = await item.getAttribute('data-regression-test-id');
    await item.locator('[data-action="run-regression-test"]').click();
    await item.locator('[data-run-status="FAILED"]').first().waitFor({ timeout: 30000 });
    await item.getByText('Finding present').first().waitFor({ timeout: 5000 });
  });

  await step('11 export machine-readable fixture', async () => {
    const res = await api('GET', `/lab/regression-tests/${testCaseId}/fixture`);
    if (res.json?.schema !== 'erppreflight.regression-fixture/v1' || !res.json.input?.content) {
      throw new Error(`fixture export invalid: ${JSON.stringify(res.json).slice(0, 200)}`);
    }
    const item = page.locator(`[data-regression-test-id="${testCaseId}"]`);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      item.getByRole('button', { name: 'Export fixture (JSON)' }).click(),
    ]);
    const saved = path.join(S, 'fixture.json');
    await download.saveAs(saved);
    if (JSON.parse(fs.readFileSync(saved, 'utf-8')).testCase.id !== testCaseId) throw new Error('downloaded fixture mismatch');
  });

  await step('12 corrected fixture: test passes and the finding is RESOLVED', async () => {
    const goodId = await uploadClean(projectId, `corrected_${ARTIFACT}`, GOOD);
    await page.reload();
    const item = page.locator(`[data-regression-test-id="${testCaseId}"]`);
    await item.waitFor({ timeout: 20000 });
    await item.getByRole('button', { name: 'Runs' }).click();
    await item.getByLabel('Update fixture').selectOption(goodId);
    await item.locator('[data-action="update-fixture"]').click();
    await item.getByText('Fixture v2').first().waitFor({ timeout: 15000 });
    await item.locator('[data-action="run-regression-test"]').click();
    await item.getByText('The source finding was resolved by this run.').waitFor({ timeout: 30000 });
    const f = await currentFinding(projectId);
    if (f.lifecycle.status !== 'RESOLVED') throw new Error(`expected RESOLVED, got ${f.lifecycle.status}`);
    await openFinding();
    await statusIs('Resolved');
    await page.locator('[data-history-event="RESOLVED_BY_TEST"]').first().waitFor({ timeout: 10000 });
  });

  await step('13 findings table: status filter and bulk assign with confirmation', async () => {
    await page.goto(`${WEB}/projects/${projectId}/findings?status=RESOLVED`);
    await page.getByText('OPD_DETERMINATION_STEP_MISSING').first().waitFor({ timeout: 20000 });
    await page.goto(`${WEB}/projects/${projectId}/findings?status=OPEN`);
    await page.getByText(/No matching (findings|records)|Zero Preflight Defects/).first().waitFor({ timeout: 20000 });
    await page.goto(`${WEB}/projects/${projectId}/findings`);
    await page.getByLabel('Select finding OPD_DETERMINATION_STEP_MISSING').first().check();
    const bar = page.getByTestId('findings-bulk-actions');
    await bar.getByRole('button', { name: 'Assign' }).click();
    await bar.getByRole('dialog').waitFor({ timeout: 5000 });
    await bar.getByLabel('Due date', { exact: true }).fill('2031-01-15');
    await bar.getByRole('button', { name: 'Confirm' }).click();
    await page.getByText('2031-01-15').first().waitFor({ timeout: 15000 });
  });

  await step('14 tenant isolation of the lifecycle API', async () => {
    const f = await currentFinding(projectId);
    const own = token;
    const other = `intruder${R}@e2e.local`;
    await api('POST', '/auth/register', { email: other, password, fullName: 'Intruder', organizationName: `Intruder ${R}` });
    token = null;
    const login = await api('POST', '/auth/login', { email: other, password });
    token = login.json.accessToken;
    const read = await api('GET', `/findings/${f.id}/lifecycle`);
    const write = await api('POST', `/findings/${f.id}/comments`, { body: 'cross-tenant' });
    const test = await api('GET', `/lab/regression-tests/${testCaseId}`);
    token = own;
    if (![403, 404].includes(read.status) || ![403, 404].includes(write.status) || ![403, 404].includes(test.status)) {
      throw new Error(`cross-tenant access not denied: ${read.status}/${write.status}/${test.status}`);
    }
  });

  console.log('PROJECT', projectId, 'TEST', testCaseId);
  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  await browser.close();
  console.log(failures ? `${failures} STEP(S) FAILED (screenshots: ${S})` : 'ALL STEPS PASSED');
  process.exit(failures ? 1 : 0);
})();
