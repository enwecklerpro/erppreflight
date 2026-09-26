// Live smoke test of the analysis run lifecycle (section C §15/§16/§18, KNOWN_LIMITATIONS P6/P8):
// analysis detail page, cancel (queued + running), rerun with identical inputs, findings immutability,
// Test Lab runs in the run history, generated test -> Test Lab promotion, role and tenant denials.
// Usage: WEB_URL=http://localhost:3000 API_BASE_URL=http://localhost:3001 MAIL_DEV_OUTBOX_TOKEN=... \
//        [CHROMIUM_PATH=...] node scripts/e2e-analysis-lifecycle-smoke.cjs [screenshotDir]
// Flow: run -> detail page renders real data -> cancel a queued run and a running run -> CANCELLED
// (no partial findings published) -> rerun -> new run completes with link (old findings untouched)
// -> lab run appears in history -> generated test promoted -> VIEWER 403 -> cross-tenant 404 ->
// UI: detail page (EN/DE, 375 px), cancel with confirm dialog, rerun button, history links.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_ORIGIN = (process.env.API_BASE_URL || process.env.API_URL || WEB.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)).replace(/\/$/, '');
const API = API_ORIGIN + '/api/v1';
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-lifecycle-smoke-'));
fs.mkdirSync(OUT, { recursive: true });
const FIX = (p) => path.join(ROOT, 'tests', 'e2e', 'fixtures', p);
const PASSWORD = 'LifecycleSmoke!2026';
const ALL_ENGINES = [
  'OPD_GUARD', 'FORM_DOCTOR', 'CUSTOM_FIELD_FLOW_DOCTOR', 'EXTENSION_IMPACT_GUARD', 'SPRO2CLOUD', 'ECC2CLOUD_NAVIGATOR',
  'SAP_GAP_RADAR', 'CLEAN_CORE_OBJECT_GUARD', 'CHANGE_POINTER_COVERAGE_AUDITOR', 'API_CHANGE_GUARD',
  'SOFTWARE_COLLECTION_DEPENDENCY_GUARD', 'TRANSPORT_DEPENDENCY_ANALYZER', 'SAFE_DECOMMISSION_PREFLIGHT',
  'FIORI_403_ROOT_CAUSE_DOCTOR', 'WORKFLOW_STUCK_EXPLAINER', 'IAM_COST_OPTIMIZER', 'ACCOUNT_DETERMINATION_PREFLIGHT',
  'SYSTEM_REFRESH_DELTA_GUARD', 'MFS_BLACKBOX',
];
const TERMINAL = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']);
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, auth, body) {
  const headers = { Accept: 'application/json' };
  if (auth) {
    headers.Authorization = `Bearer ${auth.token}`;
    if (auth.orgId) headers['X-Tenant-Id'] = auth.orgId;
  }
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

async function mailLink(email, template) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${API}/dev/mail/messages?to=${encodeURIComponent(email)}`, {
      headers: { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN || '' },
    });
    if (res.status === 404) throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev');
    const { items } = await res.json();
    const link = items.filter((m) => m.template === template).flatMap((m) => m.links)[0];
    if (link) return link;
    await sleep(500);
  }
  throw new Error(`no ${template} e-mail for ${email}`);
}

async function tenant(tag) {
  const r = `${Date.now() % 1000000}${Math.floor(Math.random() * 100)}`;
  const email = `lifecycle${tag}${r}@e2e.local`;
  const reg = await api('POST', '/auth/register', null, { email, password: PASSWORD, fullName: `Lifecycle ${tag}`, organizationName: `Lifecycle ${tag} ${r}` });
  if (!reg.body.accessToken) throw new Error('register failed ' + JSON.stringify(reg.body));
  const link = await mailLink(email, 'EMAIL_VERIFICATION');
  const v = await api('POST', '/auth/verify-email', null, { token: link.split('token=')[1] });
  if (v.status >= 300) throw new Error('verify-email failed ' + JSON.stringify(v.body));
  const login = await api('POST', '/auth/login', null, { email, password: PASSWORD });
  return { token: login.body.accessToken, orgId: login.body.user.organizationId, email };
}

async function viewerOf(owner) {
  const email = `lifecycleviewer${Date.now() % 1000000}@e2e.local`;
  const inv = await api('POST', '/organizations/invitations', owner, { email, role: 'VIEWER' });
  if (inv.status >= 300) throw new Error('invite failed ' + JSON.stringify(inv.body));
  const link = await mailLink(email, 'ORGANIZATION_INVITATION');
  const acc = await api('POST', '/invitations/accept-new', null, { token: link.split('token=')[1], password: PASSWORD, fullName: 'Viewer' });
  if (!acc.body.accessToken) throw new Error('accept-new failed ' + JSON.stringify(acc.body));
  return { token: acc.body.accessToken, orgId: owner.orgId };
}

async function upload(auth, projectId, rel, name) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(FIX(rel))]), name || path.basename(rel));
  const up = await api('POST', `/projects/${projectId}/files`, auth, fd);
  if (!up.body.fileId) throw new Error(`upload ${rel} failed ${JSON.stringify(up.body).slice(0, 300)}`);
  return up.body.fileId;
}

async function waitClean(auth, projectId, count) {
  for (let i = 0; i < 60; i++) {
    const res = await api('GET', `/projects/${projectId}/files`, auth);
    const list = Array.isArray(res.body) ? res.body : res.body.items || [];
    if (list.filter((f) => (f.quarantineStatus || f.quarantine_status) === 'CLEAN').length >= count) return;
    await sleep(1000);
  }
  throw new Error('artifacts did not become CLEAN');
}

async function waitStatus(auth, id, pred, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await api('GET', `/analyses/${id}`, auth);
    if (last.status === 200 && pred(last.body.status, last.body)) return last.body;
    await sleep(150);
  }
  throw new Error(`analysis ${id} did not reach the expected state (last ${JSON.stringify(last && last.body).slice(0, 200)})`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
    catch (e) { failures++; console.log('FAIL ', name, '::', String((e && e.message) || e).split('\n')[0]); }
    await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {});
  };

  let A, B, V, projectId;
  const files = {};
  let queuedRun, runningRun, completedRun, rerunOfCancelled, rerunOfCompleted, labAnalysisId;
  let completedFindingIds = [];

  await step('00 setup: tenants A and B (verified), VIEWER in A, project with CLEAN fixtures', async () => {
    A = await tenant('a');
    B = await tenant('b');
    V = await viewerOf(A);
    const p = await api('POST', '/projects', A, { name: 'Lifecycle Smoke', targetRelease: 'S4H_2023' });
    projectId = p.body.id;
    assert(projectId, 'project create failed ' + JSON.stringify(p.body));
    files.opd = await upload(A, projectId, 'opd/opd_po_missing_recipient.json');
    files.tr = await upload(A, projectId, 'transport/tr_collision.json');
    files.cp = await upload(A, projectId, 'change_pointer/cp_missing_groes.json');
    files.xdp = await upload(A, projectId, 'forms/invoice_template.xdp');
    files.xml = await upload(A, projectId, 'forms/invoice_payload.xml');
    files.abap = await upload(A, projectId, 'clean_core/clean_core_legacy.abap');
    await waitClean(A, projectId, 6);
  });
  if (!A || !B || !projectId) { await browser.close(); process.exit(1); }
  const allFiles = Object.values(files);

  await step('01 a completed run: detail endpoint returns inputs with SHA-256, telemetry, calls, findings', async () => {
    const r = await api('POST', '/analyses', A, { projectId, engineTypes: ['OPD_GUARD'], fileIds: [files.opd] });
    assert(r.status === 201 || r.status === 202, 'launch ' + r.status + JSON.stringify(r.body));
    completedRun = r.body.analysisId;
    const done = await waitStatus(A, completedRun, (s) => TERMINAL.has(s));
    assert(done.status === 'COMPLETED', 'status ' + done.status);
    const d = (await api('GET', `/analyses/${completedRun}/detail`, A)).body;
    assert(d.analysis.status === 'COMPLETED' && d.analysis.kind === 'STANDARD', 'detail analysis');
    assert(d.inputs.recorded && d.inputs.files.length === 1 && /^[0-9a-f]{64}$/.test(d.inputs.files[0].sha256), 'inputs + sha256 ' + JSON.stringify(d.inputs.files));
    assert(d.inputs.files[0].currentStatus === 'CLEAN', 'current artifact status');
    assert(d.telemetry.engineCalls === 1 && d.calls[0].engine === 'OPD_GUARD' && d.calls[0].outcome === 'COMPLETED', 'calls');
    assert(d.analysis.startedAt && d.analysis.completedAt && d.analysis.durationMs >= 0, 'timing');
    assert(d.permissions.canRerun && !d.permissions.canCancel && d.permissions.canExport, 'permissions');
    const f = await api('GET', `/analyses/${completedRun}/findings`, A);
    completedFindingIds = f.body.map((x) => x.id).sort();
    assert(completedFindingIds.length > 0 && completedFindingIds.length === d.analysis.findingsCount, 'findings');
  });

  await step('02 cancel a QUEUED run: BullMQ job removed, CANCELLED at once, idempotent, no findings', async () => {
    // A long run occupies the worker; the second run waits in the queue.
    const long = await api('POST', '/analyses', A, { projectId, engineTypes: ALL_ENGINES, fileIds: allFiles });
    runningRun = long.body.analysisId;
    const q = await api('POST', '/analyses', A, { projectId, engineTypes: ['OPD_GUARD'], fileIds: [files.opd] });
    queuedRun = q.body.analysisId;
    const before = await api('GET', `/analyses/${queuedRun}`, A);
    assert(before.body.status === 'QUEUED', 'second run should still be queued, is ' + before.body.status);
    const c = await api('POST', `/analyses/${queuedRun}/cancel`, A, { reason: 'Wrong artifact selected' });
    assert(c.status === 200 && c.body.outcome === 'CANCELLED' && c.body.status === 'CANCELLED', 'cancel ' + c.status + JSON.stringify(c.body));
    const again = await api('POST', `/analyses/${queuedRun}/cancel`, A, {});
    assert(again.status === 200 && again.body.outcome === 'ALREADY_CANCELLED', 'idempotent ' + JSON.stringify(again.body));
    const p = (await api('GET', `/analyses/${queuedRun}/progress`, A)).body;
    assert(p.status === 'CANCELLED' && p.terminal && Object.values(p.stages).some((s) => s.state === 'CANCELLED'), 'progress ' + JSON.stringify(p).slice(0, 200));
    const d = (await api('GET', `/analyses/${queuedRun}/detail`, A)).body;
    assert(d.cancellation && d.cancellation.reason === 'Wrong artifact selected' && d.cancellation.cancelledAt, 'cancellation detail');
    assert(d.analysis.findingsCount === 0 && d.telemetry.engineCalls === 0, 'the queued run never executed');
  });

  await step('03 cancel a RUNNING run cooperatively: stops between engine steps, partial findings not published', async () => {
    await waitStatus(A, runningRun, (s) => s === 'RUNNING' || TERMINAL.has(s), 60000);
    const c = await api('POST', `/analyses/${runningRun}/cancel`, A, {});
    assert(c.status === 200, 'cancel ' + c.status + JSON.stringify(c.body));
    assert(['CANCELLATION_REQUESTED', 'CANCELLED'].includes(c.body.outcome), 'outcome ' + c.body.outcome);
    const done = await waitStatus(A, runningRun, (s) => TERMINAL.has(s), 60000);
    assert(done.status === 'CANCELLED', 'final status ' + done.status);
    const f = await api('GET', `/analyses/${runningRun}/findings`, A);
    assert(Array.isArray(f.body) && f.body.length === 0, `partial findings published: ${f.body.length}`);
    const d = (await api('GET', `/analyses/${runningRun}/detail`, A)).body;
    assert(d.telemetry.engineCalls < ALL_ENGINES.length * allFiles.length, `run was not stopped early (${d.telemetry.engineCalls} calls)`);
    assert(d.cancellation && d.cancellation.cancelledAt, 'cancellation recorded');
    const late = await api('POST', `/analyses/${completedRun}/cancel`, A, {});
    assert(late.status === 409 && late.body.code === 'ANALYSIS_NOT_CANCELLABLE', 'finished run cancel ' + late.status);
    console.log(`      running run stopped after ${d.telemetry.engineCalls} of ${ALL_ENGINES.length * allFiles.length} engine calls; ${d.cancellation.discardedFindings} finding(s) discarded`);
  });

  await step('04 rerun the cancelled run: new run, identical inputs, rerun link, completes', async () => {
    const r = await api('POST', `/analyses/${runningRun}/rerun`, A, {});
    assert(r.status === 202 && r.body.rerunOfAnalysisId === runningRun && r.body.analysisId !== runningRun, 'rerun ' + r.status + JSON.stringify(r.body));
    rerunOfCancelled = r.body.analysisId;
    const done = await waitStatus(A, rerunOfCancelled, (s) => TERMINAL.has(s), 120000);
    assert(['COMPLETED', 'PARTIAL'].includes(done.status), 'rerun status ' + done.status);
    const src = (await api('GET', `/analyses/${runningRun}/detail`, A)).body;
    const d = (await api('GET', `/analyses/${rerunOfCancelled}/detail`, A)).body;
    assert(d.lineage.rerunOf && d.lineage.rerunOf.id === runningRun, 'lineage.rerunOf');
    assert(src.lineage.reruns.some((x) => x.id === rerunOfCancelled), 'source lists the rerun');
    const ids = (x) => x.inputs.files.map((f) => `${f.fileId}:${f.sha256}`).sort().join();
    assert(ids(d) === ids(src), 'artifacts differ');
    assert(JSON.stringify([...d.analysis.engineTypes].sort()) === JSON.stringify([...src.analysis.engineTypes].sort()), 'engines differ');
    assert(JSON.stringify(d.inputs.requestedConfiguration) === JSON.stringify(src.inputs.requestedConfiguration), 'configuration differs');
    assert(d.telemetry.engineCalls === ALL_ENGINES.length * allFiles.length, 'rerun did not execute every engine call');
    const src2 = await api('GET', `/analyses/${runningRun}`, A);
    assert(src2.body.status === 'CANCELLED' && src2.body.findingsCount === 0, 'source run changed');
  });

  await step('05 rerun a completed run: old findings stay untouched (immutability), plan limits apply', async () => {
    const r = await api('POST', `/analyses/${completedRun}/rerun`, A, {});
    assert(r.status === 202, 'rerun ' + r.status);
    rerunOfCompleted = r.body.analysisId;
    const done = await waitStatus(A, rerunOfCompleted, (s) => TERMINAL.has(s));
    assert(done.status === 'COMPLETED', 'status ' + done.status);
    const oldIds = (await api('GET', `/analyses/${completedRun}/findings`, A)).body.map((x) => x.id).sort();
    const newIds = (await api('GET', `/analyses/${rerunOfCompleted}/findings`, A)).body.map((x) => x.id).sort();
    assert(JSON.stringify(oldIds) === JSON.stringify(completedFindingIds), 'old findings changed');
    assert(newIds.length === oldIds.length && !newIds.some((id) => oldIds.includes(id)), 'rerun findings must be new rows');
    const active = await api('POST', '/analyses', A, { projectId, engineTypes: ALL_ENGINES, fileIds: allFiles });
    const busy = await api('POST', `/analyses/${active.body.analysisId}/rerun`, A, {});
    assert(busy.status === 409 && busy.body.code === 'ANALYSIS_STILL_ACTIVE', 'rerun of an active run ' + busy.status);
    await api('POST', `/analyses/${active.body.analysisId}/cancel`, A, {});
    await waitStatus(A, active.body.analysisId, (s) => TERMINAL.has(s), 60000);
    const usage = await api('GET', '/billing/entitlements', A);
    if (usage.status === 200) assert(Number(usage.body.analysesThisMonthCount) >= 6, 'reruns are metered as analysis runs');
  });

  await step('06 VIEWER may read but not cancel or rerun (403)', async () => {
    const d = await api('GET', `/analyses/${completedRun}/detail`, V);
    assert(d.status === 200 && d.body.permissions.canRerun === false, 'viewer detail ' + d.status);
    const c = await api('POST', `/analyses/${completedRun}/cancel`, V, {});
    const r = await api('POST', `/analyses/${completedRun}/rerun`, V, {});
    assert(c.status === 403 && r.status === 403, `viewer cancel ${c.status} / rerun ${r.status}`);
  });

  await step('07 cross-tenant: tenant B cannot read, cancel or rerun tenant A runs (404)', async () => {
    const codes = [
      (await api('GET', `/analyses/${completedRun}/detail`, B)).status,
      (await api('POST', `/analyses/${completedRun}/cancel`, B, {})).status,
      (await api('POST', `/analyses/${completedRun}/rerun`, B, {})).status,
      (await api('GET', `/lab/generated-tests?analysisId=${completedRun}`, B)).status,
    ];
    assert(codes.slice(0, 3).every((c) => c === 404), 'codes ' + codes.join(','));
    const list = await api('GET', `/lab/generated-tests?analysisId=${completedRun}`, B);
    assert(list.status === 200 && list.body.items.length === 0, 'foreign generated tests must be invisible');
    const x = await api('POST', `/analyses/${completedRun}/cancel`, { token: B.token, orgId: A.orgId }, {});
    assert(x.status === 403 || x.status === 404, 'tenant header spoofing ' + x.status);
  });

  await step('08 Test Lab: regression runs create LAB_REGRESSION analyses in the run history', async () => {
    const f = (await api('GET', `/analyses/${completedRun}/findings`, A)).body[0];
    const tc = await api('POST', '/lab/regression-tests', A, { findingId: f.id, expectedOutcome: 'FINDING_PRESENT' });
    assert(tc.status === 201 || tc.status === 200, 'create regression test ' + tc.status + JSON.stringify(tc.body).slice(0, 200));
    const run = await api('POST', `/lab/regression-tests/${tc.body.id}/run`, A, {});
    assert(run.body.analysisId && run.body.status === 'PASSED', 'lab run ' + JSON.stringify(run.body).slice(0, 200));
    labAnalysisId = run.body.analysisId;
    const hist = (await api('GET', `/analyses?projectId=${projectId}`, A)).body;
    const lab = hist.find((a) => a.id === labAnalysisId);
    assert(lab && lab.kind === 'LAB_REGRESSION' && lab.status === 'COMPLETED' && lab.findingsCount === 0, 'lab analysis in history ' + JSON.stringify(lab));
    const d = (await api('GET', `/analyses/${labAnalysisId}/detail`, A)).body;
    assert(d.labResults.length === 1 && d.labResults[0].status === 'PASSED' && d.lab.total === 1 && d.inputs.testCaseIds[0] === tc.body.id, 'lab detail');
    const batch = await api('POST', '/lab/regression-tests/batch-run', A, { projectId });
    assert(batch.body.analysisId && batch.body.analysisStatus === 'COMPLETED', 'batch analysis ' + JSON.stringify(batch.body).slice(0, 200));
    const rr = await api('POST', `/analyses/${labAnalysisId}/rerun`, A, {});
    assert(rr.status === 202 && rr.body.kind === 'LAB_REGRESSION' && rr.body.rerunOfAnalysisId === labAnalysisId, 'lab rerun ' + JSON.stringify(rr.body));
    const kinds = (await api('GET', `/analyses?projectId=${projectId}&kind=LAB_REGRESSION`, A)).body;
    assert(kinds.length === 3, 'three lab runs expected, got ' + kinds.length);
    const drift = await api('GET', `/projects/${projectId}/drift`, A);
    assert(drift.status !== 500, 'drift still works');
  });

  await step('09 generated tests are promoted into Test Lab regression cases (idempotent, linked both ways)', async () => {
    const list = (await api('GET', `/lab/generated-tests?analysisId=${rerunOfCancelled}`, A)).body.items;
    assert(list.length > 0, 'the full rerun generated no regression tests');
    const g = list.find((x) => x.promotable) || list[0];
    const p1 = await api('POST', `/lab/generated-tests/${g.id}/promote`, A, {});
    assert(p1.status === 200 && p1.body.created === true && p1.body.regressionTestCaseId, 'promote ' + p1.status + JSON.stringify(p1.body));
    const p2 = await api('POST', `/lab/generated-tests/${g.id}/promote`, A, {});
    assert(p2.body.created === false && p2.body.regressionTestCaseId === p1.body.regressionTestCaseId, 'promotion is not idempotent');
    const cases = (await api('GET', `/lab/regression-tests?projectId=${projectId}`, A)).body.items;
    const c = cases.find((x) => x.id === p1.body.regressionTestCaseId);
    assert(c && c.generatedTestId === g.id && c.originAnalysisId === rerunOfCancelled, 'case not linked back ' + JSON.stringify(c).slice(0, 200));
    const after = (await api('GET', `/lab/generated-tests/${g.id}`, A)).body;
    assert(after.status === 'PROMOTED' && after.promotion.regressionTestCaseId === c.id, 'generated test not marked PROMOTED');
    const vp = await api('POST', `/lab/generated-tests/${g.id}/promote`, V, {});
    assert(vp.status === 403, 'viewer promote ' + vp.status);
  });

  await step('10 notifications deep-link to the analysis detail page', async () => {
    let n;
    for (let i = 0; i < 20 && !n; i++) {
      const res = await api('GET', '/notifications?limit=50', A);
      const items = (res.body && (res.body.items || res.body)) || [];
      n = Array.isArray(items) ? items.find((x) => typeof x.link === 'string' && x.link.includes('/analyses/')) : null;
      if (!n) await sleep(500);
    }
    assert(n && /^\/projects\/[0-9a-f-]{36}\/analyses\/[0-9a-f-]{36}$/.test(n.link), 'no analysis notification with a detail link');
  });

  // ------------------------------------------------------------------------------------ UI
  await page.goto(WEB + '/login');
  await page.evaluate(([t, o]) => { localStorage.setItem('erppreflight_token', t); localStorage.setItem('erppreflight_tenant_id', o); }, [A.token, A.orgId]);
  await context.addCookies([{ name: 'erp_auth', value: '1', url: WEB }, { name: 'erp_consent', value: 'necessary', url: WEB }, { name: 'erp_locale', value: 'en', url: WEB }]);

  await step('11 UI: detail page renders real data (status, inputs + SHA-256, calls, findings, lineage, exports)', async () => {
    await page.goto(`${WEB}/projects/${projectId}/analyses/${rerunOfCancelled}`);
    await page.getByTestId('analysis-detail').waitFor({ timeout: 20000 });
    await page.getByTestId('analysis-status').filter({ hasText: /Completed|Partially completed/ }).waitFor({ timeout: 15000 });
    const sha = await page.getByTestId('analysis-input-sha').first().textContent();
    assert(/[0-9a-f]{12}/.test(sha || ''), 'sha not shown');
    assert((await page.getByTestId('analysis-input-row').count()) === allFiles.length, 'input rows');
    await page.getByTestId('analysis-call-row').first().waitFor();
    await page.getByTestId('analysis-rerun-of').waitFor();
    await page.getByRole('grid').first().waitFor({ timeout: 15000 });
    await page.getByTestId('analysis-exports').waitFor();
    await page.getByTestId('analysis-generated-tests').waitFor();
    await page.getByTestId('analysis-progress').waitFor();
  });

  await step('12 UI: run history links to the detail page and shows the Test Lab run', async () => {
    await page.goto(`${WEB}/projects/${projectId}`);
    await page.getByRole('button', { name: /Run History/ }).first().click();
    const lab = page.getByTestId(`run-kind-${labAnalysisId}`);
    await lab.waitFor({ timeout: 15000 });
    await page.getByTestId(`run-detail-link-${completedRun}`).click();
    await page.waitForURL(new RegExp(`/projects/${projectId}/analyses/${completedRun}$`), { timeout: 15000 });
    await page.getByTestId('analysis-detail').waitFor();
  });

  await step('13 UI: cancel a running run with the confirm dialog, then rerun it from the detail page', async () => {
    const r = await api('POST', '/analyses', A, { projectId, engineTypes: ALL_ENGINES, fileIds: allFiles });
    const id = r.body.analysisId;
    await page.goto(`${WEB}/projects/${projectId}/analyses/${id}`);
    await page.getByTestId('analysis-cancel').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByLabel(/Reason/).fill('Smoke test cancel');
    await page.screenshot({ path: `${OUT}/13a_cancel_dialog.png` });
    await dialog.getByTestId('analysis-cancel-confirm').click();
    await page.getByTestId('analysis-status').filter({ hasText: /Cancelled/ }).waitFor({ timeout: 60000 });
    const after = await api('GET', `/analyses/${id}`, A);
    assert(after.body.status === 'CANCELLED', 'API status ' + after.body.status);
    await page.getByTestId('analysis-rerun').click();
    await page.getByRole('dialog').getByTestId('analysis-rerun-confirm').click();
    await page.waitForURL((u) => /\/analyses\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(id), { timeout: 20000 });
    await page.getByTestId('analysis-rerun-of').waitFor({ timeout: 15000 });
    const newId = page.url().split('/').pop();
    await waitStatus(A, newId, (s) => TERMINAL.has(s), 120000);
  });

  await step('14 UI: German locale and 375 px without horizontal scroll', async () => {
    await context.addCookies([{ name: 'erp_locale', value: 'de', url: WEB }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${WEB}/projects/${projectId}/analyses/${labAnalysisId}`);
    await page.getByTestId('analysis-detail').waitFor({ timeout: 20000 });
    await page.getByRole('heading', { name: /Testlabor-Lauf|Analyselauf/ }).first().waitFor({ timeout: 15000 });
    await page.getByTestId('analysis-lab-results').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, `horizontal overflow ${overflow}px at 375 px`);
    await page.screenshot({ path: `${OUT}/14a_lab_run_de_375.png`, fullPage: true });
    await page.goto(`${WEB}/projects/${projectId}/analyses/00000000-0000-4000-8000-000000000000`);
    await page.getByTestId('analysis-not-found').waitFor({ timeout: 15000 });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await context.addCookies([{ name: 'erp_locale', value: 'en', url: WEB }]);
  });

  await step('15 no 5xx and no console errors in the browser', async () => {
    const serious = problems.filter((p) => !/Failed to load resource: the server responded with a status of 404/.test(p));
    assert(serious.length === 0, serious.slice(0, 5).join(' | '));
  });

  await browser.close();
  console.log(failures === 0 ? `ALL PASSED (screenshots: ${OUT})` : `${failures} FAILED (screenshots: ${OUT})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
