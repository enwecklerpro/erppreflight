// Live smoke of the platform hardening workstream against a running stack (NO mocks):
//   1. distributed rate limiting: TWO API processes sharing one Redis enforce ONE budget
//      (auth guard: exhaust on instance 1 -> instance 2 answers 429 with Retry-After);
//   2. usage metering: a presigned upload (PUT to object storage + confirm) records
//      ARTIFACT_UPLOAD / ARTIFACT_BYTES exactly once — a repeated confirm does not re-meter;
//      connector requests are metered as CONNECTOR_REQUEST (when contract doubles run);
//   3. finding assignment notification: in-app + e-mail (dev mailbox) in the assignee's
//      language with a deep link to the finding; the link opens the focused finding (Chromium);
//   4. FormDoctor evidence cites the real uploaded file names (XDP template + data XML).
//
// Usage:
//   API_URL=http://localhost:4701 API_URL_2=http://localhost:4703 WEB_URL=http://localhost:4700 \
//   MAIL_DEV_OUTBOX_TOKEN=... [CHROMIUM_PATH=/opt/pw-browsers/chromium] [DOUBLES_FILE=doubles.json] \
//   node scripts/e2e-platform-hardening-smoke.cjs [screenshotDir]
// API_URL_2 must be a second API process started with the same environment (same DATABASE_URL
// and REDIS_URL incl. db index). The API must run with MAIL_TRANSPORT=dev.
// Exits non-zero on any failure.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL || process.env.API_BASE_URL || WEB.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)).replace(/\/$/, '');
const API2 = (process.env.API_URL_2 || '').replace(/\/$/, '');
const S = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-hardening-smoke-'));
const R = `${Date.now() % 1000000}${Math.floor(Math.random() * 90 + 10)}`;
const FIX = path.join(ROOT, 'services/analysis-python/tests/fixtures/domain1');
const XDP = fs.readFileSync(path.join(FIX, 'form_template_xdp.xml'));
const DATA_XML = fs.readFileSync(path.join(FIX, 'form_data_missing_field.xml'));
const XDP_NAME = `ZRECHNUNG_FORMULAR_${R}.xdp`;
const XML_NAME = `rechnung_daten_${R}.xml`;
const PASSWORD = 'HardeningPass!2026';
let failures = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(base, method, p, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}/api/v1${p}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}
const api = (method, p, opts) => call(API, method, p, opts);

async function mailbox(to) {
  const res = await fetch(`${API}/api/v1/dev/mail/messages?to=${encodeURIComponent(to)}&limit=50`, {
    headers: { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN || '' },
  });
  if (res.status === 404) throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev');
  return (await res.json()).items || [];
}

async function waitMail(to, template) {
  for (let i = 0; i < 40; i++) {
    const m = (await mailbox(to)).find((x) => x.template === template);
    if (m) return m;
    await sleep(500);
  }
  throw new Error(`no ${template} e-mail for ${to}`);
}

async function account(tag) {
  const email = `${tag}${R}@e2e.local`;
  const reg = await api('POST', '/auth/register', { body: { email, password: PASSWORD, fullName: `${tag[0].toUpperCase()}${tag.slice(1)} Hardening`, organizationName: `Hardening ${tag} ${R}` } });
  if (reg.status !== 201) throw new Error(`register ${tag}: ${reg.status} ${JSON.stringify(reg.json).slice(0, 200)}`);
  const link = (await waitMail(email, 'EMAIL_VERIFICATION')).links[0];
  const v = await api('POST', '/auth/verify-email', { body: { token: link.split('token=')[1] } });
  if (!v.json?.verified) throw new Error(`verify ${tag}`);
  const login = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (!login.json?.accessToken) throw new Error(`login ${tag}: ${login.status}`);
  return { email, token: login.json.accessToken, id: login.json.user.id, orgId: login.json.user.organizationId };
}

async function overview(token) {
  const o = await api('GET', '/billing/overview', { token });
  if (o.status !== 200) throw new Error(`billing overview ${o.status}`);
  return o.json.metered || {};
}

async function waitClean(token, projectId, fileId) {
  for (let i = 0; i < 40; i++) {
    const f = await api('GET', `/projects/${projectId}/files/${fileId}`, { token });
    const st = f.json?.quarantineStatus ?? f.json?.quarantine_status;
    if (st === 'CLEAN') return f.json;
    if (['QUARANTINED', 'REJECTED'].includes(st)) throw new Error(`file ${st}`);
    await sleep(500);
  }
  throw new Error('file never became CLEAN');
}

(async () => {
  const problems = [];
  let browser = null;
  let page = null;
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('OK   ', name);
    } catch (e) {
      failures++;
      console.log('FAIL ', name, '::', String(e.message).split('\n')[0]);
    }
    if (page) await page.screenshot({ path: `${S}/${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {});
  };

  // ------------------------------------------------------------------ 1. shared rate limit
  await step('01 two API processes share one Redis rate-limit budget', async () => {
    if (!API2) throw new Error('API_URL_2 is required: start a second API process with the same environment');
    for (const base of [API, API2]) {
      const live = await fetch(`${base}/health/liveness`);
      if (!live.ok) throw new Error(`${base} not live`);
    }
    // Sign-in attempts for an address without an account (401): pure limiter traffic. The login
    // rule has a 15-minute window and a per-IP budget 10x the per-address one, so reruns fit.
    const email = `ratelimit${R}@e2e.local`;
    let allowed = 0;
    let first429 = null;
    for (let i = 0; i < 2000; i++) {
      const r = await call(API, 'POST', '/auth/login', { body: { email, password: 'Wrong-Password-1' } });
      if (r.status === 429) {
        first429 = r;
        break;
      }
      if (r.status !== 401) throw new Error(`unexpected HTTP ${r.status} from instance 1`);
      allowed++;
    }
    if (!first429) throw new Error('instance 1 never limited the address');
    // The budget was consumed ONLY on instance 1; instance 2 must refuse immediately.
    const second = await call(API2, 'POST', '/auth/login', { body: { email, password: 'Wrong-Password-1' } });
    const retryAfter = Number(second.headers.get('retry-after'));
    if (second.status !== 429 || !(retryAfter > 0)) {
      throw new Error(`instance 2 answered ${second.status} (Retry-After ${retryAfter}) after ${allowed} requests on instance 1 — limit is per process`);
    }
    // A different address from the same client still passes on instance 2 (per IP+e-mail budget).
    const other = await call(API2, 'POST', '/auth/login', { body: { email: `other${R}@e2e.local`, password: 'Wrong-Password-1' } });
    if (other.status !== 401) throw new Error(`other address refused on instance 2: ${other.status}`);
    console.log(`      budget ${allowed} on :${new URL(API).port}, then :${new URL(API2).port} -> 429, Retry-After ${retryAfter}s`);
  });

  // ------------------------------------------------------------------ accounts, org membership
  let owner;
  let bob;
  let projectId;
  await step('02 owner + consultant (notification language German) in one organization', async () => {
    owner = await account('owner');
    bob = await account('bob');
    const loc = await api('PUT', '/notifications/locale', { token: bob.token, body: { locale: 'de' } });
    if (loc.status !== 200 || loc.json.locale !== 'de') throw new Error(`set locale ${loc.status}`);
    const bad = await api('PUT', '/notifications/locale', { token: bob.token, body: { locale: 'fr' } });
    if (bad.status !== 400) throw new Error(`invalid locale accepted: ${bad.status}`);
    const inv = await api('POST', '/organizations/invitations', { token: owner.token, body: { email: bob.email, role: 'MIGRATION_CONSULTANT' } });
    if (inv.json?.status !== 'PENDING') throw new Error(`invite ${inv.status} ${JSON.stringify(inv.json).slice(0, 200)}`);
    const itoken = (await waitMail(bob.email, 'ORGANIZATION_INVITATION')).links[0].split('token=')[1];
    const acc = await api('POST', '/invitations/accept', { token: bob.token, body: { token: itoken } });
    if (acc.json?.user?.organizationId !== owner.orgId) throw new Error(`accept ${acc.status}`);
    bob.token = acc.json.accessToken || bob.token;
    const p = await api('POST', '/projects', { token: owner.token, body: { name: `Hardening ${R}`, description: 'platform hardening smoke', targetRelease: 'S4H_2023' } });
    if (!p.json?.id) throw new Error(`project ${p.status}`);
    projectId = p.json.id;
  });

  // ------------------------------------------------------------------ 2. presigned upload metering
  let xmlFileId;
  let xdpFileId;
  await step('03 presigned upload (PUT + confirm) metered exactly once', async () => {
    const before = await overview(owner.token);
    const pre = await api('POST', `/projects/${projectId}/files/presign-upload`, {
      token: owner.token,
      body: { fileName: XML_NAME, fileSize: DATA_XML.length, mimeType: 'application/xml' },
    });
    if (!pre.json?.uploadUrl) throw new Error(`presign ${pre.status} ${JSON.stringify(pre.json).slice(0, 200)}`);
    xmlFileId = pre.json.fileId;
    const put = await fetch(pre.json.uploadUrl, { method: 'PUT', body: DATA_XML, headers: { 'Content-Type': 'application/xml' } });
    if (!put.ok) throw new Error(`PUT to object storage ${put.status}: ${(await put.text()).slice(0, 200)}`);
    const c1 = await api('POST', `/projects/${projectId}/files/${xmlFileId}/confirm`, { token: owner.token });
    if (c1.json?.status !== 'CLEAN') throw new Error(`confirm ${c1.status} ${JSON.stringify(c1.json).slice(0, 200)}`);
    const c2 = await api('POST', `/projects/${projectId}/files/${xmlFileId}/confirm`, { token: owner.token });
    if (c2.json?.status !== 'CLEAN' || c2.json.alreadyProcessed !== true) throw new Error(`repeated confirm: ${c2.status} ${JSON.stringify(c2.json).slice(0, 200)}`);
    const after = await overview(owner.token);
    const dUploads = (after.ARTIFACT_UPLOAD || 0) - (before.ARTIFACT_UPLOAD || 0);
    const dBytes = (after.ARTIFACT_BYTES || 0) - (before.ARTIFACT_BYTES || 0);
    if (dUploads !== 1 || dBytes !== DATA_XML.length) throw new Error(`metered ${dUploads} uploads / ${dBytes} bytes, expected 1 / ${DATA_XML.length}`);
    const file = await waitClean(owner.token, projectId, xmlFileId);
    if (Number(file.sizeBytes ?? file.file_size) !== DATA_XML.length) throw new Error(`stored size ${file.sizeBytes}`);
    console.log(`      +1 ARTIFACT_UPLOAD, +${dBytes} ARTIFACT_BYTES; second confirm returned alreadyProcessed`);
  });

  await step('04 multipart upload metered once as well', async () => {
    const before = await overview(owner.token);
    const form = new FormData();
    form.append('file', new Blob([XDP], { type: 'application/xml' }), XDP_NAME);
    const up = await api('POST', `/projects/${projectId}/files`, { token: owner.token, body: form });
    xdpFileId = up.json?.fileId;
    if (up.json?.status !== 'CLEAN') throw new Error(`upload ${up.status} ${JSON.stringify(up.json).slice(0, 200)}`);
    const after = await overview(owner.token);
    if ((after.ARTIFACT_UPLOAD || 0) - (before.ARTIFACT_UPLOAD || 0) !== 1 || (after.ARTIFACT_BYTES || 0) - (before.ARTIFACT_BYTES || 0) !== XDP.length) {
      throw new Error('multipart upload not metered exactly once');
    }
  });

  // ------------------------------------------------------------------ 4. FormDoctor file names
  let finding;
  await step('05 FormDoctor evidence cites the uploaded file names', async () => {
    const run = await api('POST', `/projects/${projectId}/full-preflight`, { token: owner.token, body: { engines: ['FORM_DOCTOR'] } });
    const analysisId = run.json?.analysisId;
    if (!analysisId) throw new Error(`full preflight ${run.status} ${JSON.stringify(run.json).slice(0, 300)}`);
    let status = null;
    for (let i = 0; i < 90 && !['COMPLETED', 'PARTIAL', 'FAILED'].includes(status); i++) {
      await sleep(1000);
      status = (await api('GET', `/analyses/${analysisId}`, { token: owner.token })).json?.status;
    }
    if (status !== 'COMPLETED') throw new Error(`analysis ${status}`);
    const list = await api('GET', `/findings?projectId=${projectId}&latest=true&engine=FORM_DOCTOR&pageSize=100`, { token: owner.token });
    const items = list.json?.items || [];
    finding = items.find((f) => f.ruleId === 'FORM_FIELD_MISSING_IN_XML');
    if (!finding) throw new Error(`no FORM_FIELD_MISSING_IN_XML finding (${items.map((f) => f.ruleId).join(',')})`);
    const paths = items.flatMap((f) => (f.evidence || []).map((e) => e.artifactPath));
    if (!paths.includes(XDP_NAME)) throw new Error(`evidence paths ${JSON.stringify([...new Set(paths)])} lack ${XDP_NAME}`);
    if (paths.some((p) => /invoice_template\.xdp|payload\.xml|^tenants\//.test(p || ''))) throw new Error(`template default / storage key in evidence: ${JSON.stringify([...new Set(paths)])}`);
    console.log(`      evidence: ${[...new Set(paths)].join(', ')}`);
  });

  // ------------------------------------------------------------------ 3. assignment notification
  let mail;
  await step('06 assignment notifies the assignee in-app + e-mail (German) with a deep link', async () => {
    const a = await api('POST', `/findings/${finding.id}/assign`, { token: owner.token, body: { assigneeId: bob.id, dueDate: '2030-06-30', note: 'Bitte vor dem Gate prüfen' } });
    if (a.status >= 300) throw new Error(`assign ${a.status} ${JSON.stringify(a.json).slice(0, 200)}`);
    mail = await waitMail(bob.email, 'FINDING_ASSIGNED');
    const deepLink = `/projects/${projectId}/findings?finding=`;
    if (!mail.subject.startsWith('[ERP Preflight] Befund zugewiesen:')) throw new Error(`subject: ${mail.subject}`);
    if (!/Schweregrad: Kritisch/.test(mail.text) || !/Fällig am: 30\.06\.2030/.test(mail.text)) throw new Error('mail lacks severity text / due date');
    if (!mail.links.some((l) => l.includes(deepLink))) throw new Error(`no deep link in ${JSON.stringify(mail.links)}`);
    let inbox = null;
    for (let i = 0; i < 20 && !inbox; i++) {
      const n = await api('GET', '/notifications?status=unread', { token: bob.token });
      inbox = (n.json?.items || []).find((x) => x.eventType === 'finding.assigned');
      if (!inbox) await sleep(500);
    }
    if (!inbox || !inbox.title.startsWith('Befund zugewiesen:') || !inbox.link.includes(deepLink) || inbox.severity !== 'CRITICAL') {
      throw new Error(`in-app notification ${JSON.stringify(inbox).slice(0, 300)}`);
    }
    // The assigner (self) is not notified; the assignment is only e-mailed once.
    const own = await api('GET', '/notifications?status=all', { token: owner.token });
    if ((own.json?.items || []).some((x) => x.eventType === 'finding.assigned')) throw new Error('assigner received the assignment notification');
    if ((await mailbox(bob.email)).filter((m) => m.template === 'FINDING_ASSIGNED').length !== 1) throw new Error('assignment e-mailed more than once');
  });

  await step('07 e-mail preference off: in-app only', async () => {
    const prefs = await api('PUT', '/notifications/preferences', { token: bob.token, body: { items: [{ eventType: 'finding.assigned', email: false }] } });
    if (prefs.status !== 200) throw new Error(`prefs ${prefs.status}`);
    const a = await api('POST', `/findings/${finding.id}/assign`, { token: owner.token, body: { assigneeId: bob.id, dueDate: '2030-07-31' } });
    if (a.status >= 300) throw new Error(`reassign ${a.status}`);
    let count = 0;
    for (let i = 0; i < 20 && count < 2; i++) {
      const n = await api('GET', '/notifications?status=all', { token: bob.token });
      count = (n.json?.items || []).filter((x) => x.eventType === 'finding.assigned').length;
      if (count < 2) await sleep(500);
    }
    if (count !== 2) throw new Error(`expected 2 in-app assignment notifications, got ${count}`);
    await sleep(1000);
    if ((await mailbox(bob.email)).filter((m) => m.template === 'FINDING_ASSIGNED').length !== 1) throw new Error('e-mail sent despite the preference');
  });

  // ------------------------------------------------------------------ connector metering (doubles)
  await step('08 connector outbound requests metered (CONNECTOR_REQUEST)', async () => {
    const file = process.env.DOUBLES_FILE;
    if (!file || !fs.existsSync(file) || fs.statSync(file).size === 0) {
      console.log('      (skipped: no contract doubles — run with DOUBLES_FILE to cover connector metering)');
      return;
    }
    const D = JSON.parse(fs.readFileSync(file, 'utf8'));
    const before = await overview(owner.token);
    const c = await api('POST', '/connectors', {
      token: owner.token,
      body: { type: 'JIRA', name: `Jira ${R}`, config: { baseUrl: D.jira.url, projectKey: 'SAPS4' }, credentials: { email: D.jira.email, apiToken: D.jira.apiToken } },
    });
    if (!c.json?.id) throw new Error(`connector ${c.status} ${JSON.stringify(c.json).slice(0, 200)}`);
    const t = await api('POST', `/connectors/${c.json.id}/test`, { token: owner.token });
    if (!t.json?.ok) throw new Error(`connection test ${t.status} ${JSON.stringify(t.json).slice(0, 200)}`);
    const after = await overview(owner.token);
    const d = (after.CONNECTOR_REQUEST || 0) - (before.CONNECTOR_REQUEST || 0);
    if (d < 1) throw new Error(`CONNECTOR_REQUEST did not increase (${before.CONNECTOR_REQUEST} -> ${after.CONNECTOR_REQUEST})`);
    console.log(`      +${d} CONNECTOR_REQUEST for the owner organization`);
  });

  // ------------------------------------------------------------------ UI: deep link, language, usage
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await context.addCookies([
      { name: 'erp_consent', value: 'necessary', url: WEB },
      { name: 'erp_locale', value: 'de', url: WEB },
    ]);
    page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200));
    });
    page.on('response', (r) => {
      if (r.url().includes('/api/v1/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    });
  } catch (e) {
    failures++;
    console.log('FAIL  browser launch ::', e.message);
  }

  if (page) {
    await step('09 assignee opens the e-mail deep link: focused finding with evidence', async () => {
      await page.goto(WEB + '/login');
      await page.locator('input[type="email"]').fill(bob.email);
      await page.locator('input[type="password"]').first().fill(PASSWORD);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL(/\/(projects|dashboard|onboarding)/, { timeout: 20000 });
      const link = mail.links.find((l) => l.includes('/findings?finding='));
      await page.goto(link);
      if (!link.includes(`org=${owner.orgId}`)) throw new Error(`deep link lacks the organization: ${link}`);
      const focused = page.getByTestId('focused-finding');
      await focused.waitFor({ timeout: 20000 });
      await focused.getByText('Befund aus Ihrer Benachrichtigung').waitFor({ timeout: 10000 });
      // Bob signed in to his own organization: the link offers an explicit switch to the owner's one.
      const sw = page.getByTestId('focused-finding-switch-org');
      await sw.waitFor({ timeout: 15000 });
      if (!/Zu Hardening owner/.test(await sw.innerText())) throw new Error(`switch button: ${await sw.innerText()}`);
      // The switch evicts the tenant cache and reloads the same deep link.
      await Promise.all([page.waitForEvent('load', { timeout: 20000 }), sw.click()]);
      await sw.waitFor({ state: 'detached', timeout: 15000 });
      await focused.getByText('FORM_FIELD_MISSING_IN_XML').first().waitFor({ timeout: 15000 });
      const text = await focused.innerText();
      if (!text.includes(XDP_NAME)) throw new Error(`evidence file name ${XDP_NAME} not shown`);
      if (!/Kritisch|Critical/.test(text)) throw new Error('severity text not shown');
      await focused.getByRole('button', { name: 'Alle Befunde anzeigen' }).click();
      await page.waitForFunction(() => !window.location.search.includes('finding='), null, { timeout: 15000 });
      for (let i = 0; i < 20 && (await focused.count()) > 0; i++) await sleep(500);
      if ((await focused.count()) > 0) throw new Error('focused finding still shown after closing');
    });

    await step('10 notifications page: German assignment entry + notification language', async () => {
      await page.goto(WEB + '/notifications');
      await page.getByText(/^Befund zugewiesen:/).first().waitFor({ timeout: 15000 });
      await page.getByText('Mir zugewiesener Befund').first().waitFor({ timeout: 10000 });
      const de = page.getByTestId('notification-locale-de');
      await de.waitFor({ timeout: 10000 });
      if (!(await de.isChecked())) throw new Error('German not selected');
      await page.getByTestId('notification-locale-en').check();
      await page.getByText('Sprache gespeichert.').waitFor({ timeout: 10000 });
      const loc = await api('GET', '/notifications/locale', { token: bob.token });
      if (loc.json?.locale !== 'en') throw new Error(`locale not persisted: ${JSON.stringify(loc.json)}`);
    });

    await step('11 usage page lists connector requests (EN/DE)', async () => {
      await page.goto(WEB + '/settings/billing');
      await page.getByTestId('usage-connector-requests').waitFor({ timeout: 20000 });
      const text = await page.getByTestId('usage-connector-requests').innerText();
      if (!/Connector-Anfragen/.test(text)) throw new Error(`usage line: ${text}`);
    });

    await step('12 no console errors or 5xx', async () => {
      const relevant = problems.filter((p) => !/favicon|Failed to load resource: the server responded with a status of 40[134]/.test(p));
      if (relevant.length) throw new Error(relevant.slice(0, 5).join(' | '));
    });
  }

  if (browser) await browser.close().catch(() => {});
  console.log(`\n${failures === 0 ? 'ALL PLATFORM HARDENING CHECKS PASSED' : `${failures} FAILURE(S)`} (screenshots: ${S})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
