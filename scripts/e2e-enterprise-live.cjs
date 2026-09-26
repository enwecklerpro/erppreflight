#!/usr/bin/env node
/* eslint-disable */
/**
 * Live end-to-end verification of the enterprise integration surface against a
 * running API and the contract test doubles (apps/api/test/doubles/run-doubles.cjs):
 * connectors (Cloud ALM, Jira, Azure DevOps, ServiceNow, OData, Git, SSRF, circuit
 * breaker), finding → work item workflow + sync/conflicts, traceability import,
 * webhooks (signed deliveries, log, replay), local agent (enroll/daemon/signed jobs/
 * revoke), OIDC SSO + SCIM, partner mode, observability, API reference and the CLI.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3701 DOUBLES_FILE=/tmp/erppf-doubles.json \
 *   DOUBLES_CONTROL=http://172.17.0.1:3721 NODE_EXTRA_CA_CERTS=<ca.pem> \
 *   METRICS_TOKEN=... DATABASE_URL=postgres://... node scripts/e2e-enterprise-live.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const API = (process.env.API_BASE_URL || 'http://localhost:3701').replace(/\/+$/, '');
const A = `${API}/api/v1`;
const D = JSON.parse(fs.readFileSync(process.env.DOUBLES_FILE, 'utf8'));
const CTRL = process.env.DOUBLES_CONTROL;
const R = crypto.randomBytes(3).toString('hex');
let fails = 0;
const transcript = [];

function log(line) {
  transcript.push(line);
  console.log(line);
}
function pass(name, detail = '') {
  log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
}
function fail(name, detail) {
  fails++;
  log(`FAIL  ${name}  :: ${typeof detail === 'string' ? detail : String(JSON.stringify(detail)).slice(0, 600)}`);
}
function check(name, cond, detail) {
  cond ? pass(name, typeof detail === 'string' ? detail : '') : fail(name, detail);
  return cond;
}

async function call(method, url, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${A}${url}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, headers: res.headers };
}
const ctrl = (method, p, body) => fetch(`${CTRL}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function register(label) {
  const email = `${label}.${R}@e2e-enterprise.test`;
  const r = await call('POST', '/auth/register', { body: { email, password: 'EnterprisePass!2026', fullName: `${label} ${R}`, organizationName: `${label} Org ${R}` } });
  return { email, token: r.json.accessToken, orgId: r.json.user.organizationId, userId: r.json.user.id };
}

async function pg(sql, params = []) {
  const { Client } = require(require.resolve('pg', { paths: [path.join(ROOT, 'apps/api')] }));
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

(async () => {
  log(`# ERP Preflight enterprise live verification — ${new Date().toISOString()} — API ${API}`);
  const alice = await register('alice'); // customer org owner
  const bob = await register('bob'); // partner org owner
  const carol = await register('carol'); // unrelated org
  check('register three organizations', alice.token && bob.token && carol.token);

  // ------------------------------------------------------------------ projects + real finding
  const proj = await call('POST', '/projects', { token: alice.token, body: { name: `Enterprise E2E ${R}`, targetRelease: 'S4H_2023' } });
  const projectId = proj.json.id;
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(path.join(ROOT, 'tests/fixtures/known_bad_billing_opd.xml'))], { type: 'application/xml' }), 'known_bad_billing_opd.xml');
  const up = await fetch(`${A}/projects/${projectId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: form }).then((r) => r.json());
  const an = await call('POST', '/analyses', { token: alice.token, body: { projectId, engineTypes: ['OPD_GUARD'], fileIds: [up.fileId] } });
  let st;
  for (let i = 0; i < 40; i++) {
    st = (await call('GET', `/analyses/${an.json.analysisId}`, { token: alice.token })).json.status;
    if (/COMPLETED|FAILED|PARTIAL/.test(st)) break;
    await sleep(1500);
  }
  const findings = (await call('GET', `/findings?projectId=${projectId}&pageSize=50`, { token: alice.token })).json;
  const finding = (findings.items || findings.data || findings)[0];
  check('analysis produced a real finding to work with', st === 'COMPLETED' && finding, `${finding && finding.ruleId} ${finding && finding.severity}`);

  // ------------------------------------------------------------------ webhooks first (to observe events)
  const wh = await call('POST', '/webhooks', { token: alice.token, body: { url: `${D.webhook.url}/erppreflight`, events: ['analysis.completed', 'finding.critical', 'connector.unhealthy', 'traceability.task_dispatched'] } });
  check('register webhook (secret returned once)', wh.status === 201 && /^whsec_/.test(wh.json.secret), `id ${wh.json && wh.json.id}`);
  const whList = await call('GET', '/webhooks', { token: alice.token });
  check('webhook list never returns the secret', !whList.text.includes(wh.json.secret) && !whList.text.includes('"secret"'));
  const [whRow] = await pg('SELECT secret FROM webhooks WHERE id = $1', [wh.json.id]);
  check('webhook signing secret encrypted at rest', whRow.secret.startsWith('v1.') && !whRow.secret.includes(wh.json.secret), whRow.secret.slice(0, 24) + '…');
  const catalog = await call('GET', '/webhooks/events', { token: alice.token });
  check('webhook event catalog', catalog.status === 200 && catalog.json.some((e) => e.type === 'connector.unhealthy'), `${catalog.json.length} event types`);
  const ping = await call('POST', `/webhooks/${wh.json.id}/test`, { token: alice.token });
  const received = await ctrl('GET', '/webhook');
  const last = received[received.length - 1];
  const expectedSig = 'sha256=' + crypto.createHmac('sha256', wh.json.secret).update(last.body).digest('hex');
  check('signed ping delivered and HMAC verifies at the receiver', ping.json.success && last.headers['x-hub-signature-256'] === expectedSig, `X-ERPPreflight-Signature ${last.headers['x-erppreflight-signature'].slice(0, 20)}…`);

  // ------------------------------------------------------------------ connector registry & Cloud ALM
  const types = await call('GET', '/connectors/types', { token: alice.token });
  check('connector registry exposes typed schemas + least-privilege scopes', types.json.length === 9 && types.json.find((t) => t.type === 'SAP_CLOUD_ALM').scopes.length === 3, types.json.map((t) => t.type).join(','));
  const calm = await call('POST', '/connectors', {
    token: alice.token,
    body: { type: 'SAP_CLOUD_ALM', name: `Cloud ALM ${R}`, config: { apiBaseUrl: D.cloudAlm.url, tokenUrl: D.cloudAlm.tokenUrl, defaultProjectId: D.cloudAlm.projects[0].id }, credentials: { clientId: D.cloudAlm.clientId, clientSecret: D.cloudAlm.clientSecret } },
  });
  check('create Cloud ALM connector (read-only by default)', calm.status === 201 && calm.json.accessMode === 'READ_ONLY' && calm.json.hasCredentials, `key id ${calm.json.credentialsKeyId}`);
  const calmGet = await call('GET', `/connectors/${calm.json.id}`, { token: alice.token });
  check('connector API never returns credentials', !calmGet.text.includes(D.cloudAlm.clientSecret));
  const [calmRow] = await pg('SELECT credentials_ciphertext FROM connector_instances WHERE id = $1', [calm.json.id]);
  check('connector credentials AES-256-GCM encrypted at rest', calmRow.credentials_ciphertext.startsWith('v1.') && !calmRow.credentials_ciphertext.includes(D.cloudAlm.clientSecret));
  const calmTest = await call('POST', `/connectors/${calm.json.id}/test`, { token: alice.token });
  check('Cloud ALM OAuth2 connection test + capability handshake', calmTest.json.ok && calmTest.json.connector.health.status === 'HEALTHY', calmTest.json.message);
  const wiReadOnly = await call('POST', '/connectors/work-items', { token: alice.token, body: { findingId: finding.id, connectorId: calm.json.id, confirm: true } });
  check('write refused while connector is read-only (Part 18.4)', wiReadOnly.status === 403, wiReadOnly.json && wiReadOnly.json.message);
  const noConfirm = await call('PATCH', `/connectors/${calm.json.id}`, { token: alice.token, body: { accessMode: 'READ_WRITE' } });
  check('granting write access requires confirmation and returns a permission diff', noConfirm.status === 400 && noConfirm.text.includes('permissionsAdded'));
  const grantWrite = await call('PATCH', `/connectors/${calm.json.id}`, { token: alice.token, body: { accessMode: 'READ_WRITE', confirmWriteAccess: true } });
  check('write access granted with confirmation', grantWrite.status === 200 && grantWrite.json.permissionDiff.riskIncrease, grantWrite.json.permissionDiff.permissionsAdded.join(','));
  const tasksBefore = (await ctrl('GET', '/calm/tasks')).length;
  const dry = await call('POST', '/connectors/work-items', { token: alice.token, body: { findingId: finding.id, connectorId: calm.json.id, dryRun: true } });
  check('dry run previews the Part 15.8 task body without writing', dry.json.dryRun && /Finding ID: .*\n/.test(dry.json.preview.body) && /SHA-256/.test(dry.json.preview.body) && (await ctrl('GET', '/calm/tasks')).length === tasksBefore);
  const noConf = await call('POST', '/connectors/work-items', { token: alice.token, body: { findingId: finding.id, connectorId: calm.json.id } });
  check('write without explicit confirm=true is refused', noConf.status === 400);
  const created = await call('POST', '/connectors/work-items', { token: alice.token, body: { findingId: finding.id, connectorId: calm.json.id, confirm: true } });
  const wi = created.json && created.json.workItem;
  check('Cloud ALM remediation task created from the finding', created.status === 201 && /^TSK-/.test(wi.externalKey), `${wi && wi.externalKey} ${wi && wi.externalUrl}`);
  const dup = await call('POST', '/connectors/work-items', { token: alice.token, body: { findingId: finding.id, connectorId: calm.json.id, confirm: true } });
  check('idempotent: second create returns the existing link', dup.json.alreadyLinked === true && dup.json.workItem.id === wi.id);
  const tasks = await ctrl('GET', '/calm/tasks');
  await fetch(`${D.cloudAlm.url}/__control/tasks/${wi.externalId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CIPTKCLSD' }) });
  const synced = await call('POST', `/connectors/work-items/${wi.id}/sync`, { token: alice.token });
  check('remote completion → PENDING_VERIFICATION (finding not auto-closed)', synced.json.statusCategory === 'DONE' && synced.json.remediationState === 'PENDING_VERIFICATION', `${synced.json.externalStatus}`);
  await fetch(`${D.cloudAlm.url}/__control/tasks/${wi.externalId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Renamed by a human in Cloud ALM' }) });
  const conflict = await call('PATCH', `/connectors/work-items/${wi.id}`, { token: alice.token, body: { title: 'ERP Preflight wants this title', confirm: true } });
  check('conflicting human change detected; nothing overwritten', conflict.json.conflict === true && (await ctrl('GET', '/calm/tasks')).find((t) => t.id === wi.externalId).title === 'Renamed by a human in Cloud ALM');
  const resolved = await call('POST', `/connectors/work-items/${wi.id}/resolve-conflict`, { token: alice.token, body: { resolution: 'ACCEPT_REMOTE' } });
  check('conflict resolved by keeping the remote change', resolved.json.conflictState === 'RESOLVED');
  const mapProj = await call('POST', `/connectors/${calm.json.id}/project-links`, { token: alice.token, body: { projectId, externalProjectId: D.cloudAlm.projects[0].id, syncDirection: 'BIDIRECTIONAL' } });
  const imp = await call('POST', `/projects/${projectId}/traceability/requirements/import`, { token: alice.token, body: { connectorId: calm.json.id } });
  const matrix = await call('GET', `/projects/${projectId}/traceability`, { token: alice.token });
  check('Cloud ALM requirements imported into the traceability matrix', mapProj.status === 201 && imp.json.created === 2 && matrix.json.summary.totalRequirements === 2 && matrix.json.summary.workItemsTotal === 1, JSON.stringify(matrix.json.summary));

  // ------------------------------------------------------------------ Jira / ADO / ServiceNow + findings endpoint
  const mk = async (type, name, config, credentials, accessMode = 'READ_WRITE') =>
    (await call('POST', '/connectors', { token: alice.token, body: { type, name, config, credentials, accessMode } })).json;
  const jira = await mk('JIRA', `Jira ${R}`, { baseUrl: D.jira.url, projectKey: 'SAPS4' }, { email: D.jira.email, apiToken: D.jira.apiToken });
  const ado = await mk('AZURE_DEVOPS', `ADO ${R}`, { baseUrl: D.azureDevOps.url, organization: D.azureDevOps.organization, project: D.azureDevOps.project }, { personalAccessToken: D.azureDevOps.pat });
  const snow = await mk('SERVICENOW', `ServiceNow ${R}`, { instanceUrl: D.serviceNow.url }, { username: D.serviceNow.username, password: D.serviceNow.password });
  for (const [label, c] of [['Jira', jira], ['Azure DevOps', ado], ['ServiceNow', snow]]) {
    const t = await call('POST', `/connectors/${c.id}/test`, { token: alice.token });
    const w = await call('POST', `/findings/${finding.id}/work-item`, { token: alice.token, body: { connectorId: c.id, confirm: true } });
    check(`${label}: connection test + work item via POST /findings/:id/work-item`, t.json.ok && w.json.success && w.json.status === 'CREATED', `${w.json.workItemId} → ${w.json.deepLink}`);
  }
  const multi = await call('POST', `/findings/${finding.id}/work-item`, { token: alice.token, body: { confirm: true } });
  check('no silent connector choice when several are configured', multi.json.status === 'CONNECTOR_SELECTION_REQUIRED');
  const carolWi = await call('POST', `/findings/${finding.id}/work-item`, { token: carol.token, body: { confirm: true } });
  check('other tenants cannot create work items for the finding', [403, 404].includes(carolWi.status), `HTTP ${carolWi.status}`);
  const carolConn = await call('GET', `/connectors/${calm.json.id}`, { token: carol.token });
  check('other tenants cannot read the connector (RLS)', carolConn.status === 404, `HTTP ${carolConn.status}`);

  // ------------------------------------------------------------------ OData, Git, SSRF, circuit breaker
  const odata = await mk('ODATA', `OData BP ${R}`, { serviceRootUrl: D.odata.serviceRootUrl, sapClient: '100', authType: 'BASIC' }, { username: D.odata.username, password: D.odata.password }, 'READ_ONLY');
  const m1 = await call('POST', `/connectors/${odata.id}/metadata`, { token: alice.token });
  const m2 = await call('POST', `/connectors/${odata.id}/metadata`, { token: alice.token });
  check('OData $metadata fetched, normalized and stored as a baseline', m1.status === 201 && m1.json.protocolVersion === 'V2' && m2.json.changedSincePrevious === false, `${JSON.stringify(m1.json.summary)} sha ${m1.json.contentSha256.slice(0, 12)}`);
  const git = (await call('POST', '/connectors', { token: alice.token, body: { type: 'GIT', name: `abapGit ${R}`, config: { repositoryUrl: D.git.repositoryUrl, branch: 'main', pathFilter: 'src' }, credentials: { token: D.git.token } } })).json;
  const gsnap = await call('POST', `/connectors/${git.id}/git/snapshot`, { token: alice.token });
  check('Git connector: shallow read-only clone over HTTPS + tree snapshot', gsnap.status === 201 && gsnap.json.abapFiles === 2, `${gsnap.json.commit && gsnap.json.commit.slice(0, 12)} ${JSON.stringify(gsnap.json.objectTypes)}`);
  const gingest = await call('POST', `/connectors/${git.id}/git/ingest`, { token: alice.token, body: { projectId } });
  check('Git ingestion runs every ABAP file through the ingestion pipeline', gingest.status === 201 && gingest.json.ingested.every((f) => f.status === 'CLEAN'), JSON.stringify(gingest.json.ingested.map((f) => `${f.path}:${f.status}`)));
  const ssrf = (await call('POST', '/connectors', { token: alice.token, body: { type: 'HTTP_OPENAPI', name: `Metadata ${R}`, config: { baseUrl: 'https://169.254.169.254', healthPath: '/latest/meta-data/' } } })).json;
  const ssrfTest = await call('POST', `/connectors/${ssrf.id}/test`, { token: alice.token });
  check('SSRF: cloud metadata endpoint blocked by the outbound policy', ssrfTest.json.ok === false && /SSRF/.test(ssrfTest.json.message), ssrfTest.json.message);
  const badJira = (await call('POST', '/connectors', { token: alice.token, body: { type: 'JIRA', name: `Jira broken ${R}`, config: { baseUrl: D.jira.url, projectKey: 'SAPS4' }, credentials: { email: D.jira.email, apiToken: 'revoked-token' } } })).json;
  let lastTest;
  for (let i = 0; i < 5; i++) lastTest = await call('POST', `/connectors/${badJira.id}/test`, { token: alice.token });
  const blocked = await call('POST', `/connectors/${badJira.id}/test`, { token: alice.token });
  check('circuit breaker opens after 5 failures and blocks further calls', lastTest.json.connector.health.circuitState === 'OPEN' && lastTest.json.connector.health.status === 'UNHEALTHY' && /circuit is open/.test(blocked.json.message), blocked.json.message);
  const syncLog = await call('GET', `/connectors/${badJira.id}/sync-log`, { token: alice.token });
  check('sync log records failures and blocked calls', syncLog.json.filter((e) => e.outcome === 'FAILED').length === 5 && syncLog.json.some((e) => e.outcome === 'BLOCKED'), syncLog.json[0].error);
  const badGit = (await call('POST', '/connectors', { token: alice.token, body: { type: 'GIT', name: `abapGit wrong token ${R}`, config: { repositoryUrl: D.git.repositoryUrl, branch: 'main' }, credentials: { token: 'wrong-git-token-value' } } })).json;
  const badGitSnap = await call('POST', `/connectors/${badGit.id}/git/snapshot`, { token: alice.token });
  check('remote failures surface as 503 with a secret-free message', badGitSnap.status === 503 && !badGitSnap.text.includes('wrong-git-token-value'), badGitSnap.json && badGitSnap.json.message);

  // ------------------------------------------------------------------ webhooks: events, log, replay
  await sleep(7000); // outbox dispatcher polls every 5 s
  const deliveries = await call('GET', `/webhooks/${wh.json.id}/deliveries`, { token: alice.token });
  const evTypes = new Set(deliveries.json.map((d) => d.eventType));
  check('domain events delivered as signed webhooks (delivery log)', evTypes.has('connector.unhealthy') && evTypes.has('traceability.task_dispatched'), [...evTypes].join(', '));
  await ctrl('POST', '/webhook/fail', { count: 1 });
  const replaySrc = deliveries.json.find((d) => d.eventType === 'connector.unhealthy');
  const replayFail = await call('POST', `/webhooks/${wh.json.id}/deliveries/${replaySrc.id}/replay`, { token: alice.token });
  const replayOk = await call('POST', `/webhooks/${wh.json.id}/deliveries/${replaySrc.id}/replay`, { token: alice.token });
  check('failed delivery recorded for retry; replay succeeds with the same event id', replayFail.json.status === 'FAILED' && replayFail.json.httpStatus === 503 && replayOk.json.status === 'SUCCEEDED');
  const rec = await ctrl('GET', '/webhook');
  const ids = rec.filter((r) => r.body.includes('connector.unhealthy') && r.body.includes(alice.orgId)).map((r) => r.headers['x-erppreflight-event-id']);
  check('replays keep X-ERPPreflight-Event-Id (receiver idempotency)', new Set(ids).size === 1 && ids.length >= 3 && ids[0] === replaySrc.eventId, `${ids.length} deliveries of event ${ids[0]}`);

  // ------------------------------------------------------------------ local agent
  execFileSync('pnpm', ['--filter', '@erppreflight/local-agent', 'build'], { cwd: ROOT, stdio: 'ignore' });
  const agentHome = fs.mkdtempSync(path.join(os.tmpdir(), 'erppf-agent-home-'));
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erppf-agent-scan-'));
  fs.writeFileSync(path.join(scanRoot, 'rfc_destinations.xml'), '<RfcDestinations>\n<Destination name="PRD_CENTRAL">\n<Host>sapprd01.corp</Host>\n<Password>RfcPassw0rd!Secret</Password>\n</Destination>\n</RfcDestinations>\n');
  fs.writeFileSync(path.join(scanRoot, 'known_bad_billing_opd.xml'), fs.readFileSync(path.join(ROOT, 'tests/fixtures/known_bad_billing_opd.xml')));
  const agentEnv = { ...process.env, ERP_PREFLIGHT_AGENT_HOME: agentHome, ERP_PREFLIGHT_AGENT_SCAN_ROOTS: scanRoot };
  const agent = (...args) => spawnSync('node', [path.join(ROOT, 'apps/local-agent/dist/cli.js'), ...args], { env: agentEnv, encoding: 'utf8', timeout: 60_000 });
  const tok = await call('POST', '/agents/enrollment-tokens', { token: alice.token, body: { label: 'plant-01', ttlMinutes: 30 } });
  const enroll = agent('enroll', API, tok.json.enrollmentToken, '--name', `plant-01-${R}`);
  check('agent enrollment with a locally generated Ed25519 key', enroll.status === 0, enroll.stdout.trim().split('\n')[0]);
  const reuse = agent('enroll', API, tok.json.enrollmentToken);
  check('enrollment token is single-use', reuse.status !== 0, reuse.stderr.trim());
  const identity = JSON.parse(fs.readFileSync(path.join(agentHome, 'agent-identity.json'), 'utf8'));
  check('identity file is 0600', (fs.statSync(path.join(agentHome, 'agent-identity.json')).mode & 0o777) === 0o600);
  await call('PATCH', `/agents/devices/${identity.deviceId}`, { token: alice.token, body: { egressPolicy: { redactSecrets: true, uploadRawFiles: true } } });
  const job = await call('POST', `/agents/devices/${identity.deviceId}/jobs`, { token: alice.token, body: { type: 'SCAN_DIRECTORY', payload: { directory: scanRoot, projectId } } });
  const probeJob = await call('POST', `/agents/devices/${identity.deviceId}/jobs`, { token: alice.token, body: { type: 'PROBE_URL', payload: { url: D.odata.url } } });
  const escape = await call('POST', `/agents/devices/${identity.deviceId}/jobs`, { token: alice.token, body: { type: 'SCAN_DIRECTORY', payload: { directory: '/etc' } } });
  const run = agent('daemon', '--once');
  check('agent daemon: signed heartbeat, jobs verified and executed', run.status === 0 && /2 job\(s\) executed/.test(run.stdout), run.stdout.trim().split('\n').pop());
  const jobs = (await call('GET', `/agents/devices/${identity.deviceId}/jobs`, { token: alice.token })).json;
  const scanRes = jobs.find((j) => j.id === job.json.id);
  const stored = scanRes.result.ingested.find((f) => f.relativePath === 'rfc_destinations.xml');
  check('scan result: redacted before upload, ingested through the pipeline', scanRes.status === 'COMPLETED' && scanRes.result.summary.secretsRedacted >= 1 && stored.status === 'CLEAN', JSON.stringify(scanRes.result.summary));
  const [storedFile] = await pg('SELECT file_name, redaction_status FROM uploaded_files WHERE id = $1', [stored.fileId]);
  check('uploaded agent file carries no raw secret (server-side redaction status recorded)', storedFile && storedFile.file_name === 'rfc_destinations.xml', JSON.stringify(storedFile));
  check('job outside the allowed scan roots is rejected by the agent', jobs.find((j) => j.id === escape.json.id).status === 'REJECTED', jobs.find((j) => j.id === escape.json.id).error);
  check('probe job executed on-premise', jobs.find((j) => j.id === probeJob.json.id).result.probe.isReachable === true, JSON.stringify(jobs.find((j) => j.id === probeJob.json.id).result.probe));
  const devices = (await call('GET', '/agents/devices', { token: alice.token })).json;
  const agentConn = (await call('GET', `/connectors/${identity.connectorId}`, { token: alice.token })).json;
  check('heartbeat → device last-seen + LOCAL_AGENT connector health', devices[0].lastSeenAt && agentConn.health.status === 'HEALTHY' && agentConn.type === 'LOCAL_AGENT', `version ${devices[0].agentVersion}`);
  await call('POST', `/agents/devices/${identity.deviceId}/revoke`, { token: alice.token });
  const afterRevoke = agent('daemon', '--once');
  check('revoked device is refused immediately', afterRevoke.status !== 0 && /403|revoked/i.test(afterRevoke.stdout + afterRevoke.stderr));
  const upd = agent('check-update');
  check('update check refuses nothing unsigned (no manifest published → 404 handled)', /No update published|Fatal/.test(upd.stdout + upd.stderr));

  // ------------------------------------------------------------------ SSO (OIDC) + domain verification + SCIM
  const ssoCfg = await call('PUT', '/sso/admin/config', { token: alice.token, body: { issuer: D.oidc.issuer, clientId: D.oidc.clientId, clientSecret: D.oidc.clientSecret, defaultRole: 'VIEWER' } });
  check('OIDC provider configured via discovery', ssoCfg.status === 200 && ssoCfg.json.provider.discovery.tokenEndpoint.endsWith('/token') && ssoCfg.json.provider.hasClientSecret, ssoCfg.json.redirectUri);
  const domain = `acme-${R}.test`;
  const dom = await call('POST', '/sso/admin/domains', { token: alice.token, body: { domain } });
  const v1 = await call('POST', `/sso/admin/domains/${dom.json.id}/verify`, { token: alice.token });
  check('domain unverified while the DNS TXT record is missing', v1.json.verified === false);
  await ctrl('POST', '/dns', { name: dom.json.dnsRecord.name, values: [dom.json.dnsRecord.value] });
  const v2 = await call('POST', `/sso/admin/domains/${dom.json.id}/verify`, { token: alice.token });
  check('domain verified via DNS TXT (node:dns resolver)', v2.json.verified === true && v2.json.status === 'VERIFIED', dom.json.dnsRecord.name);
  const carolDom = await call('POST', '/sso/admin/domains', { token: carol.token, body: { domain } });
  check('a verified domain cannot be claimed by another organization', carolDom.status === 409);
  const ssoUser = `dana.${R}@${domain}`;
  const doLogin = async () => {
    let r = await fetch(`${A}/sso/login?email=${encodeURIComponent(ssoUser)}`, { redirect: 'manual' });
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    r = await fetch(r.headers.get('location'), { redirect: 'manual' }); // IdP authorize
    r = await fetch(r.headers.get('location'), { redirect: 'manual', headers: { cookie } }); // callback
    return r.headers.get('location');
  };
  await fetch(`${D.oidc.issuer}/__control/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ssoUser, user: { sub: `idp|dana-${R}`, name: 'Dana Delivery', email_verified: true } }) });
  const done = await doLogin();
  const frag = new URLSearchParams(done.split('#')[1] || '');
  const ssoToken = frag.get('token');
  const me = await call('GET', '/auth/me', { token: ssoToken });
  check('OIDC code+PKCE login issues the regular session JWT (JIT user, VIEWER)', me.status === 200 && me.json.user.organizationId === alice.orgId && me.json.user.role === 'VIEWER', done.split('#')[0]);
  const viewerWrite = await call('POST', '/connectors', { token: ssoToken, body: { type: 'FILE', name: 'x' } });
  check('JIT-provisioned VIEWER is still bound by RolesGuard', viewerWrite.status === 403);
  await fetch(`${D.oidc.issuer}/__control/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ssoUser, tamper: 'nonce' }) });
  const bad = await doLogin();
  check('ID token with a wrong nonce is rejected', /sso_error=SSO_LOGIN_FAILED/.test(bad));
  await fetch(`${D.oidc.issuer}/__control/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `eve.${R}@evil-${R}.test`, tamper: null }) });
  const evil = await doLogin().catch(() => 'error');
  check('IdP cannot log in e-mails from unverified domains', /sso_error/.test(evil));
  const scimTok = await call('POST', '/sso/admin/scim-tokens', { token: alice.token, body: { name: 'Okta' } });
  const S = (m, p, body) => call(m, `/scim/v2${p}`, { headers: { Authorization: `Bearer ${scimTok.json.token}`, 'Content-Type': 'application/scim+json' }, body });
  const scimUser = `frank.${R}@${domain}`;
  const su = await S('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: scimUser, externalId: `okta-${R}`, name: { givenName: 'Frank', familyName: 'Finance' }, emails: [{ value: scimUser, primary: true }], active: true });
  check('SCIM create user → organization membership', su.status === 201 && su.json.active === true && su.json.roles[0].value === 'VIEWER', su.json.id);
  const sf = await S('GET', `/Users?filter=${encodeURIComponent(`userName eq "${scimUser}"`)}`);
  check('SCIM filter userName eq', sf.json.totalResults === 1);
  const sg = await S('POST', '/Groups', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: `SAP Architects ${R}`, members: [{ value: su.json.id }] });
  await call('PATCH', `/sso/admin/scim-groups/${sg.json.id}`, { token: alice.token, body: { role: 'LEAD_ARCHITECT' } });
  const su2 = await S('GET', `/Users/${su.json.id}`);
  check('SCIM group mapped to a role updates member roles', su2.json.roles[0].value === 'LEAD_ARCHITECT');
  const deact = await S('PATCH', `/Users/${su.json.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }] });
  const [mem] = await pg('SELECT COUNT(*)::int AS n FROM organization_members WHERE organization_id = $1 AND user_id = $2', [alice.orgId, su.json.id]);
  check('SCIM deprovisioning removes the membership immediately', deact.json.active === false && mem.n === 0);
  const badScim = await call('GET', '/scim/v2/Users', { headers: { Authorization: 'Bearer erppf_scim_invalid' } });
  check('SCIM rejects invalid tokens with a SCIM error body', badScim.status === 401 && badScim.json.schemas[0].includes('Error'));

  // ------------------------------------------------------------------ partner mode
  const bobOrg = await pg('SELECT slug FROM organizations WHERE id = $1', [bob.orgId]);
  const noAccess = await call('GET', '/projects', { token: bob.token, headers: { 'X-Tenant-Id': alice.orgId } });
  check('partner has no access before a grant', noAccess.status === 403);
  const grant = await call('POST', '/partners/grants', { token: alice.token, body: { partnerOrganizationSlug: bobOrg[0].slug, accessRole: 'ANALYST', expiresInDays: 7, reason: 'S/4 upgrade readiness engagement' } });
  check('customer grants time-limited ANALYST access to the partner', grant.status === 201 && grant.json.effectiveTenantRole === 'MIGRATION_CONSULTANT', `expires ${grant.json.expiresAt}`);
  const clients = await call('GET', '/partners/clients', { token: bob.token });
  check('partner overview lists the customer', clients.json.some((c) => c.customerOrganizationId === alice.orgId && c.status === 'ACTIVE'));
  const delegated = await call('GET', '/projects', { token: bob.token, headers: { 'X-Tenant-Id': alice.orgId } });
  check('delegated access via the membership-verified tenancy path', delegated.status === 200 && JSON.stringify(delegated.json).includes(projectId));
  const escalate = await call('POST', '/partners/grants', { token: bob.token, headers: { 'X-Tenant-Id': alice.orgId }, body: { partnerOrganizationId: carol.orgId, reason: 'escalation attempt' } });
  check('delegated role cannot administer the customer org', escalate.status === 403);
  const carolTry = await call('GET', '/projects', { token: carol.token, headers: { 'X-Tenant-Id': alice.orgId } });
  check('organizations without a grant stay isolated', carolTry.status === 403);
  await call('POST', `/partners/grants/${grant.json.id}/revoke`, { token: alice.token });
  const afterRev = await call('GET', '/projects', { token: bob.token, headers: { 'X-Tenant-Id': alice.orgId } });
  check('revocation removes access immediately', afterRev.status === 403);
  const audit = await call('GET', '/audit/events?limit=300', { token: alice.token });
  const actions = new Set((audit.json.items || audit.json || []).map((e) => e.action));
  check('audit trail records integration, identity and partner events', ['connector.created', 'connector.write_access_granted', 'work_item.created', 'agent.device_enrolled', 'agent.device_revoked', 'sso.login_succeeded', 'scim.user_deprovisioned', 'partner.access_granted', 'partner.delegated_access_used', 'partner.access_revoked'].every((a) => actions.has(a)), [...actions].filter((a) => /\./.test(a)).slice(0, 40).join(', '));
  const ledger = await call('GET', '/audit/verify', { token: alice.token });
  // Hash-chain integrity: no HASH_MISMATCH / BROKEN_LINK anomalies. (GAP_DETECTED is a known false
  // positive of the audit verifier: sequence_num is one global BIGSERIAL shared by all tenants.)
  const integrity = (ledger.json.anomalies || []).filter((a) => a.anomalyType !== 'GAP_DETECTED');
  check('audit hash chain intact (no hash/link anomalies)', integrity.length === 0, `${ledger.json.totalEventsVerified} events; anomalies: ${JSON.stringify((ledger.json.anomalies || []).map((a) => a.anomalyType))}`);

  // ------------------------------------------------------------------ observability + API reference
  const metrics = await fetch(`${A}/metrics`, { headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` } }).then((r) => r.text());
  const want = ['erppreflight_analyses_by_status', 'erppreflight_queue_jobs', 'erppreflight_engine_run_duration_seconds_bucket', 'erppreflight_upload_rejections', 'erppreflight_connectors_by_health', 'erppreflight_http_request_duration_seconds_bucket', 'erppreflight_webhook_deliveries_by_status', 'erppreflight_db_pool_connections'];
  check('business metrics exposed', want.every((m) => metrics.includes(m)), want.filter((m) => !metrics.includes(m)).join(',') || want.length + ' metric families');
  const sentry = await ctrl('GET', '/sentry');
  check('5xx responses reported to Sentry (envelope protocol)', sentry.some((s) => s.url === '/api/4242/envelope/' && s.body.includes('"statusCode":"503"')), `${sentry.length} envelope(s)`);
  const otlp = await ctrl('GET', '/otlp');
  check('OpenTelemetry spans exported over OTLP/HTTP', otlp.some((o) => o.url === '/v1/traces'), `${otlp.length} export request(s)`);
  const ref = await fetch(`${A}/reference`);
  const spec = await fetch(`${A}/openapi.json`).then((r) => r.json());
  check('Scalar API reference + OpenAPI document served', ref.status === 200 && (await ref.text()).includes('api-reference') && spec.paths['/api/v1/connectors'] && spec.paths['/api/v1/scim/v2/Users'] && spec.paths['/api/v1/connectors'].post.requestBody, `${Object.keys(spec.paths).length} paths`);

  // ------------------------------------------------------------------ CLI with an API key
  const key = await call('POST', '/api-keys', { token: bob.token, body: { name: `cli ${R}`, scopes: ['projects:read', 'projects:write', 'analysis:run', 'analysis:read', 'findings:read', 'reports:read'] } });
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'erppf-cli-'));
  const cliEnv = { ...process.env, ERP_PREFLIGHT_CONFIG_DIR: cliHome };
  delete cliEnv.ERP_PREFLIGHT_API_KEY;
  const cli = (...args) => spawnSync('node', [path.join(ROOT, 'packages/cli/bin/erp-preflight.js'), ...args], { env: cliEnv, encoding: 'utf8', timeout: 180_000 });
  const cl = cli('login', '--key', key.json.apiKey, '--api-url', API);
  check('CLI login with API key (config 0600)', cl.status === 0 && (fs.statSync(path.join(cliHome, 'config.json')).mode & 0o777) === 0o600, cl.stdout.trim());
  const cp = cli('project', 'create', '--name', `CLI project ${R}`, '--json');
  if (cp.status !== 0) log(`CLI project create failed: ${cp.stdout} ${cp.stderr}`);
  const cliProject = JSON.parse(cp.stdout);
  const cu = cli('upload', cliProject.id, path.join(ROOT, 'tests/fixtures/known_bad_billing_opd.xml'), '--json');
  check('CLI project create + upload', cp.status === 0 && cu.status === 0 && JSON.parse(cu.stdout)[0].status === 'CLEAN', cu.stdout.replace(/\s+/g, ' ').slice(0, 160));
  const ca = cli('analyze', cliProject.id, '--engines', 'OPD_GUARD', '--wait', '--json', '--fail-on', 'BLOCKER');
  const cliRun = JSON.parse(ca.stdout);
  check('CLI analyze --wait (server-side deterministic engine) + findings', ca.status === 0 && cliRun.status === 'COMPLETED' && cliRun.findings.length === 1, JSON.stringify(cliRun.summary));
  const gate = cli('analyze', cliProject.id, '--engines', 'OPD_GUARD', '--wait', '--json', '--fail-on', 'MAJOR,CRITICAL,BLOCKER');
  check('CLI quality gate exits 3 on --fail-on severities', gate.status === 3, gate.stderr.trim());
  const cf = cli('findings', '--analysis', cliRun.analysisId, '--json');
  const outPdf = path.join(cliHome, 'report.pdf');
  const cr = cli('report', 'export', cliProject.id, cliRun.analysisId, '--format', 'PDF', '--out', outPdf, '--json');
  check('CLI findings + report export (PDF)', cf.status === 0 && cr.status === 0 && fs.readFileSync(outPdf).slice(0, 4).toString() === '%PDF', cr.stdout.replace(/\s+/g, ' ').slice(0, 200));
  const cl2 = cli('project', 'list', '--json');
  check('CLI project list', cl2.status === 0 && JSON.parse(cl2.stdout).some((p) => p.id === cliProject.id));

  // ------------------------------------------------------------------ logs never contain secrets
  if (process.env.API_LOG_FILE) {
    const logs = fs.readFileSync(process.env.API_LOG_FILE, 'utf8');
    const secrets = [D.cloudAlm.clientSecret, D.jira.apiToken, D.azureDevOps.pat, D.serviceNow.password, D.oidc.clientSecret, wh.json.secret, key.json.apiKey, D.git.token, scimTok.json.token];
    const leaked = secrets.filter((s) => logs.includes(s));
    const lines = logs.split('\n').filter((l) => l.includes('"requestId"') && l.includes('"tenantId":"'));
    check('structured logs carry requestId + tenantId and contain none of the secrets used', leaked.length === 0 && lines.length > 0, `${lines.length} correlated lines; leaked: ${leaked.length}`);
  }

  log(fails === 0 ? '\nALL ENTERPRISE CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  if (process.env.TRANSCRIPT_FILE) fs.writeFileSync(process.env.TRANSCRIPT_FILE, transcript.join('\n') + '\n');
  process.exit(fails ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
