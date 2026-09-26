// Live E2E of the engines-completion workstream against a running web + API + analysis stack:
//  - Gap Radar rejects plain prose through its input contract (no UNKNOWN verdict), legitimate
//    requirement lists are still classified;
//  - API Change Guard stored baselines: register (OpenAPI + EDMX) from uploads, list, activate, delete,
//    cross-tenant denial, analysis against the active and an explicitly selected baseline with
//    oasdiff-level breaking-change categories, JSON pointer / XPath + SHA-256 evidence;
//  - MFS BlackBox: a > threshold telegram log is streamed from object storage to the analysis service
//    (transport STREAM) and evaluated; a small log stays inline;
//  - UI: baselines panel on the project Artifacts tab and the baseline selector in the launcher.
// Usage: WEB_URL=http://localhost:3000 API_BASE_URL=http://localhost:3001 MAIL_DEV_OUTBOX_TOKEN=... \
//        [CHROMIUM_PATH=...] [MFS_STREAM_LOG_MB=12] node scripts/e2e-engines-smoke.cjs [screenshotDir]
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_ORIGIN = (process.env.API_BASE_URL || process.env.API_URL || WEB.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)).replace(/\/$/, '');
const API = API_ORIGIN + '/api/v1';
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-engines-smoke-'));
fs.mkdirSync(OUT, { recursive: true });
const PYFIX = (p) => path.join(ROOT, 'services', 'analysis-python', 'tests', 'fixtures', p);
const LOG_MB = Math.max(9, Number(process.env.MFS_STREAM_LOG_MB) || 12);
let failures = 0;

async function api(method, p, token, body) {
  const headers = { Accept: 'application/json' };
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
  const email = `engines${tag}${r}@e2e.local`;
  const password = 'EnginesSmokePass!2026';
  const reg = await api('POST', '/auth/register', null, { email, password, fullName: `Engines ${tag}`, organizationName: `Engines ${tag} ${r}` });
  if (!reg.body.accessToken) throw new Error('register failed ' + JSON.stringify(reg.body));
  await verifyEmail(email);
  const login = await api('POST', '/auth/login', null, { email, password });
  return { token: login.body.accessToken, orgId: login.body.user.organizationId };
}

async function uploadBuffer(token, projectId, name, buffer) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), name);
  const up = await api('POST', `/projects/${projectId}/files`, token, fd);
  if (up.body.status !== 'CLEAN' || !up.body.fileId) throw new Error(`upload ${name} not CLEAN: ${JSON.stringify(up.body).slice(0, 300)}`);
  return up.body.fileId;
}

async function runAnalysis(token, body, timeoutMs = 180000) {
  const q = await api('POST', '/analyses', token, body);
  if (q.status !== 201 && q.status !== 200) throw new Error(`queue failed ${q.status} ${JSON.stringify(q.body).slice(0, 300)}`);
  const id = q.body.analysisId;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const a = await api('GET', `/analyses/${id}`, token);
    if (['COMPLETED', 'FAILED', 'PARTIAL'].includes(a.body.status)) {
      const orch = await api('GET', `/analyses/${id}/orchestration`, token);
      const findings = await api('GET', `/analyses/${id}/findings`, token);
      const list = Array.isArray(findings.body) ? findings.body : findings.body.items || findings.body.data || [];
      return { id, status: a.body.status, orchestration: orch.body, findings: list };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`analysis ${id} did not finish within ${timeoutMs} ms`);
}

const ruleOf = (f) => f.ruleId || f.rule_id;
const details = (f) => f.technicalDetails || f.technical_details || {};
const evidenceOf = (f) => (Array.isArray(f.evidence) ? f.evidence : []);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Deterministic MFS telegram log (CSV) of at least `bytes`, with a topology jump and a sequence gap. */
function mfsLog(bytes) {
  const lines = ['timestamp,type,hu_id,cp,seq_no,sender_plc,receiver_plc,status,time_sec', 'EDGE,CP01,CP02', 'EDGE,CP02,CP03', 'EDGE,CP03,CP01'];
  let size = lines.join('\n').length + 1;
  let seq = 0;
  let t = 0;
  let cycle = 0;
  const route = ['CP01', 'CP02', 'CP03'];
  while (size < bytes) {
    const hu = `HU_${String(cycle % 2000).padStart(5, '0')}`;
    for (let step = 0; step < route.length; step++) {
      t += 0.5;
      seq += cycle === 5000 && step === 1 ? 5 : 1; // sequence gap
      const cp = cycle === 3000 && step === 2 ? 'CP99' : route[step]; // impossible topology jump
      const a = `2026-09-24T00:00:00Z,MOVE,${hu},${cp},${seq},PLC01,EWM,OK,${t.toFixed(3)}`;
      const b = `2026-09-24T00:00:00Z,ACK,${hu},${cp},,EWM,PLC01,OK,${(t + 0.1).toFixed(3)}`;
      lines.push(a, b);
      size += a.length + b.length + 2;
    }
    cycle++;
  }
  return Buffer.from(lines.join('\n') + '\n', 'utf-8');
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  const step = async (name, fn) => {
    try { await fn(); console.log('OK   ', name); }
    catch (e) { failures++; console.log('FAIL ', name, '::', String((e && e.message) || e).split('\n')[0]); }
  };
  const ui = async (name, fn) => step(name, async () => {
    try { await fn(); } finally { await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {}); }
  });

  let A, B, projectId;
  const ids = {};
  await step('00 api setup (tenants A and B, verified) + project', async () => {
    A = await tenant('a');
    B = await tenant('b');
    const p = await api('POST', '/projects', A.token, { name: 'Engines Smoke Project', targetRelease: 'S4HANA_CLOUD_2408' });
    if (!p.body.id) throw new Error('project create failed ' + JSON.stringify(p.body));
    projectId = p.body.id;
  });
  if (!A || !B || !projectId) { await browser.close(); process.exit(1); }

  // ------------------------------------------------------------------------------------------- Gap Radar
  await step('01 gap radar: plain prose is rejected by the input contract (no UNKNOWN verdict)', async () => {
    const fileId = await uploadBuffer(A.token, projectId, 'offsite-notes.txt', fs.readFileSync(PYFIX('domain2/gap_radar_non_sap_prose.txt')));
    const run = await runAnalysis(A.token, { projectId, engineTypes: ['SAP_GAP_RADAR'], fileIds: [fileId] });
    if (run.status !== 'FAILED') throw new Error(`expected FAILED, got ${run.status}`);
    const call = run.orchestration.calls.find((c) => c.engine === 'SAP_GAP_RADAR');
    if (!call || !/not an SAP business or technical requirement/.test(call.error || '')) throw new Error('missing contract rejection: ' + JSON.stringify(call));
    if (run.findings.some((f) => ruleOf(f) === 'GAP_RADAR_UNKNOWN_REQUIREMENT')) throw new Error('UNKNOWN verdict persisted for prose');
  });

  await step('02 gap radar: an SAP requirement list is classified per item', async () => {
    const fileId = await uploadBuffer(A.token, projectId, 'requirements.txt', fs.readFileSync(PYFIX('domain2/gap_radar_requirement_list.txt')));
    const run = await runAnalysis(A.token, { projectId, engineTypes: ['SAP_GAP_RADAR'], fileIds: [fileId] });
    if (run.status !== 'COMPLETED') throw new Error(`expected COMPLETED, got ${run.status}`);
    const codes = run.findings.map(ruleOf).sort();
    for (const c of ['GAP_RADAR_SUPPORTED_CONFIGURATION', 'GAP_RADAR_SUPPORTED_KEY_USER', 'GAP_RADAR_SUPPORTED_BUSINESS_EVENT', 'GAP_RADAR_BLOCKED_CLEAN_CORE_VIOLATION']) {
      if (!codes.includes(c)) throw new Error(`missing ${c} in ${codes}`);
    }
  });

  // ------------------------------------------------------------------------------------------- API baselines
  const oasBase = fs.readFileSync(PYFIX('domain3/api_oasdiff_baseline.json'));
  const oasCand = fs.readFileSync(PYFIX('domain3/api_oasdiff_candidate.json'));
  const edmxBase = fs.readFileSync(PYFIX('domain3/api_edmx_structure_baseline.xml'));
  const edmxCand = fs.readFileSync(PYFIX('domain3/api_edmx_structure_candidate.xml'));

  await step('03 api baselines: register an OpenAPI baseline (first one becomes active)', async () => {
    ids.oasBaseFile = await uploadBuffer(A.token, projectId, 'salesorder-v1.json', oasBase);
    const r = await api('POST', `/projects/${projectId}/api-baselines`, A.token, { fileId: ids.oasBaseFile, name: 'Sales Order API' });
    if (r.status !== 201) throw new Error(`create ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    const b = r.body;
    ids.oasBaseline = b.id;
    if (b.format !== 'OPENAPI' || b.version !== '1.4.0' || b.specVersion !== '3.0.3' || !b.isActive) throw new Error('unexpected baseline ' + JSON.stringify(b));
    if (b.sha256 !== sha256(oasBase)) throw new Error(`sha256 ${b.sha256} != file ${sha256(oasBase)}`);
    if (b.surface.paths !== 3 || b.surface.operations !== 5) throw new Error('surface ' + JSON.stringify(b.surface));
    if ('storageKey' in b) throw new Error('storage key leaked');
    const dup = await api('POST', `/projects/${projectId}/api-baselines`, A.token, { fileId: ids.oasBaseFile, name: 'Sales Order API' });
    if (dup.status !== 409 || dup.body.code !== 'API_BASELINE_EXISTS') throw new Error(`duplicate -> ${dup.status} ${JSON.stringify(dup.body)}`);
  });

  await step('04 api baselines: non-spec uploads and invalid bodies are rejected', async () => {
    const proseId = await uploadBuffer(A.token, projectId, 'readme.txt', Buffer.from('This is a note about purchase orders, not an API specification.\n'));
    const bad = await api('POST', `/projects/${projectId}/api-baselines`, A.token, { fileId: proseId, name: 'Not a spec' });
    if (bad.status !== 422 || bad.body.code !== 'API_BASELINE_UNSUPPORTED_FORMAT') throw new Error(`prose -> ${bad.status} ${JSON.stringify(bad.body)}`);
    const invalid = await api('POST', `/projects/${projectId}/api-baselines`, A.token, { fileId: 'x', name: '' });
    if (invalid.status !== 400) throw new Error(`invalid body -> ${invalid.status}`);
  });

  await step('05 api baselines: tenant B cannot list, read, activate or delete tenant A baselines', async () => {
    const checks = [
      await api('GET', `/projects/${projectId}/api-baselines`, B.token),
      await api('GET', `/projects/${projectId}/api-baselines/${ids.oasBaseline}`, B.token),
      await api('POST', `/projects/${projectId}/api-baselines/${ids.oasBaseline}/activate`, B.token),
      await api('DELETE', `/projects/${projectId}/api-baselines/${ids.oasBaseline}`, B.token),
      await api('POST', `/projects/${projectId}/api-baselines`, B.token, { fileId: ids.oasBaseFile, name: 'steal' }),
    ];
    for (const c of checks) if (![403, 404].includes(c.status)) throw new Error(`cross-tenant status ${c.status} ${JSON.stringify(c.body).slice(0, 200)}`);
    const own = await api('GET', `/projects/${projectId}/api-baselines`, A.token);
    if (own.body.length !== 1) throw new Error('baseline list changed');
  });

  await step('06 api change guard: candidate vs ACTIVE stored baseline -> oasdiff-level categories with evidence', async () => {
    const cand = await uploadBuffer(A.token, projectId, 'salesorder-v2.json', oasCand);
    const run = await runAnalysis(A.token, { projectId, engineTypes: ['API_CHANGE_GUARD'], fileIds: [cand] });
    if (run.status !== 'COMPLETED') throw new Error(`status ${run.status} ${JSON.stringify(run.orchestration.calls)}`);
    if (!run.orchestration.apiBaseline || run.orchestration.apiBaseline.selection !== 'ACTIVE' || run.orchestration.apiBaseline.id !== ids.oasBaseline) {
      throw new Error('apiBaseline not recorded ' + JSON.stringify(run.orchestration.apiBaseline));
    }
    const cats = new Set(run.findings.map((f) => details(f).changeCategory));
    for (const c of ['api-path-removed', 'api-operation-removed', 'request-parameter-renamed', 'request-parameter-became-required',
      'request-parameter-type-changed', 'request-parameter-format-changed', 'request-parameter-enum-value-removed',
      'response-property-removed', 'response-success-status-removed', 'operation-security-changed', 'security-scheme-removed',
      'schema-property-removed', 'property-format-changed', 'property-became-non-nullable', 'enum-value-removed']) {
      if (!cats.has(c)) throw new Error(`missing category ${c}; got ${[...cats].join(',')}`);
    }
    const baseSha = sha256(oasBase);
    const candSha = sha256(oasCand);
    for (const f of run.findings) {
      const d = details(f);
      const ev = evidenceOf(f)[0];
      if (!ev || !ev.sha256 || !ev.lineNumber) throw new Error(`${ruleOf(f)} without evidence`);
      if (!String(d.jsonPointer || '').startsWith('/')) throw new Error(`${ruleOf(f)} without JSON pointer`);
      const expected = d.specRole === 'baseline' ? baseSha : candSha;
      if (ev.sha256 !== expected) throw new Error(`${ruleOf(f)} evidence hash ${ev.sha256} != ${d.specRole} ${expected}`);
      if (/BREAKING/.test(ruleOf(f)) && !/NON_BREAKING/.test(ruleOf(f)) && (f.confidenceClass || f.confidence) !== 'VERIFIED') {
        throw new Error(`${ruleOf(f)} is not VERIFIED`);
      }
    }
    const renamed = run.findings.find((f) => details(f).changeCategory === 'request-parameter-renamed');
    if (details(renamed).previousName !== 'companyCode' || details(renamed).jsonPointer !== '/paths/~1salesOrders/get/parameters/0') {
      throw new Error('rename details ' + JSON.stringify(details(renamed)));
    }
  });

  await step('07 api change guard: EXPLICIT EDMX baseline (not active) -> OData structure categories', async () => {
    const baseFile = await uploadBuffer(A.token, projectId, 'API_SALES_ORDER_SRV_v1.xml', edmxBase);
    const r = await api('POST', `/projects/${projectId}/api-baselines`, A.token, { fileId: baseFile, name: 'Sales Order OData', version: '2408' });
    if (r.status !== 201 || r.body.isActive || r.body.format !== 'EDMX') throw new Error('edmx baseline ' + JSON.stringify(r.body).slice(0, 300));
    ids.edmxBaseline = r.body.id;
    const cand = await uploadBuffer(A.token, projectId, 'API_SALES_ORDER_SRV_v2.xml', edmxCand);
    const run = await runAnalysis(A.token, { projectId, engineTypes: ['API_CHANGE_GUARD'], fileIds: [cand], apiBaselineId: ids.edmxBaseline });
    if (run.status !== 'COMPLETED') throw new Error(`status ${run.status}`);
    if (run.orchestration.apiBaseline?.selection !== 'EXPLICIT') throw new Error('selection ' + JSON.stringify(run.orchestration.apiBaseline));
    const cats = new Set(run.findings.map((f) => details(f).changeCategory));
    for (const c of ['edmx-entity-type-removed', 'edmx-entity-set-removed', 'edmx-property-removed', 'edmx-navigation-property-removed', 'edmx-entity-key-changed', 'property-became-non-nullable']) {
      if (!cats.has(c)) throw new Error(`missing ${c}; got ${[...cats].join(',')}`);
    }
    const key = run.findings.find((f) => details(f).changeCategory === 'edmx-entity-key-changed');
    if (details(key).xmlPath !== "//EntityType[@Name='A_SalesOrderItemType']/Key") throw new Error('xmlPath ' + details(key).xmlPath);
  });

  await step('08 trigger validation: apiBaselineId needs API_CHANGE_GUARD; foreign ids are 404', async () => {
    const r1 = await api('POST', '/analyses', A.token, { projectId, engineTypes: ['OPD_GUARD'], fileIds: [ids.oasBaseFile], apiBaselineId: ids.oasBaseline });
    if (r1.status !== 400 || r1.body.code !== 'API_BASELINE_REQUIRES_API_CHANGE_GUARD') throw new Error(`r1 ${r1.status} ${JSON.stringify(r1.body)}`);
    const r2 = await api('POST', '/analyses', A.token, { projectId, engineTypes: ['API_CHANGE_GUARD'], fileIds: [ids.oasBaseFile], apiBaselineId: crypto.randomUUID() });
    if (r2.status !== 404) throw new Error(`r2 ${r2.status}`);
  });

  await step('09 api baselines: activate + delete (audited)', async () => {
    const act = await api('POST', `/projects/${projectId}/api-baselines/${ids.edmxBaseline}/activate`, A.token);
    if (act.status !== 201 && act.status !== 200) throw new Error(`activate ${act.status}`);
    const list = (await api('GET', `/projects/${projectId}/api-baselines`, A.token)).body;
    const active = list.filter((b) => b.isActive).map((b) => b.id);
    if (active.length !== 1 || active[0] !== ids.edmxBaseline) throw new Error('active set ' + JSON.stringify(active));
    const del = await api('DELETE', `/projects/${projectId}/api-baselines/${ids.oasBaseline}`, A.token);
    if (del.status !== 200 || del.body.deleted !== true) throw new Error(`delete ${del.status} ${JSON.stringify(del.body)}`);
    const after = (await api('GET', `/projects/${projectId}/api-baselines`, A.token)).body;
    if (after.some((b) => b.id === ids.oasBaseline)) throw new Error('baseline still listed');
    const audit = await api('GET', '/audit/events?limit=200', A.token);
    const actions = JSON.stringify(audit.body);
    for (const a of ['api_baseline.created', 'api_baseline.activated', 'api_baseline.deleted']) {
      if (!actions.includes(a)) throw new Error(`audit event ${a} missing`);
    }
  });

  // ------------------------------------------------------------------------------------------- MFS streaming
  await step(`10 mfs blackbox: ${LOG_MB} MB telegram log is streamed from object storage (bounded memory)`, async () => {
    const log = mfsLog(LOG_MB * 1024 * 1024);
    const fileId = await uploadBuffer(A.token, projectId, 'mfs-telegrams.csv', log);
    const run = await runAnalysis(A.token, { projectId, engineTypes: ['MFS_BLACKBOX'], fileIds: [fileId] }, 300000);
    if (run.status !== 'COMPLETED') throw new Error(`status ${run.status} ${JSON.stringify(run.orchestration.calls)}`);
    const call = run.orchestration.calls.find((c) => c.engine === 'MFS_BLACKBOX');
    if (!call || call.transport !== 'STREAM') throw new Error('not streamed: ' + JSON.stringify(call));
    if (call.bytes !== log.length) throw new Error(`streamed ${call.bytes} bytes, log has ${log.length}`);
    if (typeof call.peakMemoryBytes !== 'number' || call.peakMemoryBytes > 256 * 1024 * 1024) throw new Error(`peak memory ${call.peakMemoryBytes}`);
    const codes = new Set(run.findings.map(ruleOf));
    for (const c of ['MFS_IMPOSSIBLE_TOPOLOGY_JUMP', 'MFS_OUT_OF_ORDER_SEQUENCE', 'MFS_FIRST_CAUSAL_DIVERGENCE']) {
      if (!codes.has(c)) throw new Error(`missing ${c}: ${[...codes]}`);
    }
    const jump = run.findings.find((f) => ruleOf(f) === 'MFS_IMPOSSIBLE_TOPOLOGY_JUMP');
    const ev = evidenceOf(jump)[0];
    const line = log.toString('utf-8').split('\n')[ev.lineNumber - 1];
    if (!line || !line.includes('CP99') || ev.sha256 !== sha256(line)) throw new Error(`evidence line/hash mismatch at ${ev.lineNumber}`);
    console.log(`      streamed ${call.bytes} bytes, ${run.findings.length} findings, peak ${call.peakMemoryBytes} bytes, ${call.durationMs} ms`);
  });

  await step('11 mfs blackbox: a small log stays inline and yields the same verdict', async () => {
    const small = mfsLog(64 * 1024);
    const fileId = await uploadBuffer(A.token, projectId, 'mfs-small.csv', small);
    const run = await runAnalysis(A.token, { projectId, engineTypes: ['MFS_BLACKBOX'], fileIds: [fileId] });
    const call = run.orchestration.calls.find((c) => c.engine === 'MFS_BLACKBOX');
    if (run.status !== 'COMPLETED' || call?.transport !== 'INLINE') throw new Error(`small log: ${run.status} ${JSON.stringify(call)}`);
  });

  // ------------------------------------------------------------------------------------------- UI
  await page.goto(WEB + '/login');
  await page.evaluate(([t, o]) => { localStorage.setItem('erppreflight_token', t); localStorage.setItem('erppreflight_tenant_id', o); }, [A.token, A.orgId]);
  await context.addCookies([{ name: 'erp_auth', value: '1', url: WEB }, { name: 'erp_consent', value: 'necessary', url: WEB }]);

  await ui('12 ui: baselines panel lists the registered baseline as active (text + icon)', async () => {
    await page.goto(`${WEB}/projects/${projectId}`);
    await page.getByTestId('tab-artifacts').click();
    const panel = page.getByTestId('api-baselines');
    await panel.waitFor({ timeout: 20000 });
    const row = panel.locator('tr[data-baseline="Sales Order OData"]');
    await row.getByText('Active').waitFor({ timeout: 15000 });
    await panel.getByTestId('api-baseline-form').waitFor();
  });

  await ui('13 ui: register a baseline through the form', async () => {
    const panel = page.getByTestId('api-baselines');
    const select = panel.getByLabel(/Specification file/);
    const option = await select.locator('option', { hasText: 'salesorder-v2.json' }).first().getAttribute('value');
    await select.selectOption(option);
    await panel.getByLabel(/^Name/).fill('Sales Order API v2');
    await panel.getByRole('button', { name: 'Register baseline' }).click();
    await panel.getByText('Baseline Sales Order API v2 @ 2.0.0 registered.').waitFor({ timeout: 15000 });
    await panel.locator('tr[data-baseline="Sales Order API v2"]').getByText('Inactive').waitFor({ timeout: 15000 });
  });

  await ui('14 ui: launcher offers the baseline selector for API Change Guard', async () => {
    await page.getByTestId('tab-launcher').click();
    await page.getByRole('button', { name: /API Change Guard/ }).click();
    const selector = page.getByTestId('api-baseline-selector');
    await selector.waitFor({ timeout: 15000 });
    const sel = selector.getByLabel('API baseline');
    await sel.locator('option', { hasText: 'Active baseline: Sales Order OData @ 2408' }).waitFor({ state: 'attached', timeout: 15000 });
    if ((await sel.locator('option').count()) !== 3) throw new Error('expected active + 2 baselines');
  });

  await step('15 no browser console errors or 5xx responses', async () => {
    if (problems.length) throw new Error(problems.slice(0, 5).join(' | '));
  });

  await browser.close();
  console.log(failures ? `\n${failures} step(s) FAILED (screenshots: ${OUT})` : `\nALL STEPS PASSED (screenshots: ${OUT})`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
