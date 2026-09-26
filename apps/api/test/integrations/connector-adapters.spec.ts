import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createConnectorHttp, ConnectorHttpError, TokenBucketLimiter } from '../../src/modules/connectors/connector-http';
import { CloudAlmAdapter } from '../../src/modules/connectors/adapters/cloud-alm.adapter';
import { JiraAdapter } from '../../src/modules/connectors/adapters/jira.adapter';
import { AzureDevOpsAdapter } from '../../src/modules/connectors/adapters/azure-devops.adapter';
import { ServiceNowAdapter } from '../../src/modules/connectors/adapters/servicenow.adapter';
import { ODataAdapter, HttpOpenApiAdapter, normalizeODataMetadata } from '../../src/modules/connectors/adapters/metadata.adapters';
import { GitAdapter } from '../../src/modules/connectors/adapters/git.adapter';
import { clearOAuthTokenCache } from '../../src/modules/connectors/adapters/oauth2';
import { ConnectorContext, WorkItemInput } from '../../src/modules/connectors/adapters/adapter.types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const doubles = require('../doubles/doubles.cjs');

process.env.CONNECTOR_ALLOW_LOOPBACK_IN_TESTS = 'true';

function ctx(type: any, config: any, credentials: any): ConnectorContext<any, any> {
  return {
    organizationId: '11111111-1111-4111-8111-111111111111',
    connectorId: `conn-${Math.random()}`,
    type,
    config,
    credentials,
    http: createConnectorHttp(`test-${Math.random()}`, {
      policy: { allowLoopbackInTests: true },
      limiter: new TokenBucketLimiter(1000, 1000),
      sleepImpl: async () => undefined,
    }),
  };
}

const input: WorkItemInput = {
  title: '[ERP Preflight] OPD_DETERMINATION_STEP_MISSING: Billing output has no determination step',
  body: 'Finding ID: f-1\nSeverity: CRITICAL\nEvidence:\n- billing.xml:23 (SHA-256 abc)',
  severity: 'CRITICAL',
  labels: ['erp-preflight', 'opd_guard', 'critical'],
  findingUrl: 'https://app.example.test/projects/p/findings?id=f-1',
};

describe('SAP Cloud ALM adapter against the contract double', () => {
  let calm: any;
  beforeAll(async () => {
    calm = await doubles.startCloudAlmDouble();
  });
  afterAll(async () => calm.close());

  const cfg = () => ({ apiBaseUrl: calm.url, tokenUrl: calm.tokenUrl, defaultProjectId: calm.state.projects[0].id, taskType: 'CALMTASK' as const });

  it('authenticates with OAuth2 client credentials, caches the token and lists projects', async () => {
    clearOAuthTokenCache();
    const adapter = new CloudAlmAdapter();
    const c = ctx('SAP_CLOUD_ALM', cfg(), { clientId: calm.clientId, clientSecret: calm.clientSecret });
    const res = await adapter.testConnection(c);
    expect(res.ok).toBe(true);
    expect(res.capabilities?.product).toBe('SAP Cloud ALM');
    await adapter.listProjects(c);
    expect(calm.state.tokenRequests).toBe(1); // token reused
  });

  it('rejects wrong client secrets with a 401 ConnectorHttpError', async () => {
    clearOAuthTokenCache();
    const adapter = new CloudAlmAdapter();
    const c = ctx('SAP_CLOUD_ALM', cfg(), { clientId: calm.clientId, clientSecret: 'wrong' });
    await expect(adapter.testConnection(c)).rejects.toMatchObject({ status: 401 });
  });

  it('creates a remediation task, links back via comment and syncs status changes', async () => {
    clearOAuthTokenCache();
    const adapter = new CloudAlmAdapter();
    const c = ctx('SAP_CLOUD_ALM', cfg(), { clientId: calm.clientId, clientSecret: calm.clientSecret });
    const created = await adapter.createWorkItem(c, input);
    expect(created.key).toMatch(/^TSK-\d+$/);
    expect(created.statusCategory).toBe('OPEN');
    const stored = calm.state.tasks.get(created.externalId);
    expect(stored.priorityId).toBe(20);
    expect(stored.description).toContain('SHA-256');
    expect(calm.state.comments.some((x: any) => x.content.includes(input.findingUrl))).toBe(true);

    await fetch(`${calm.url}/__control/tasks/${created.externalId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CIPTKCLSD' }) });
    const synced = await adapter.getWorkItem(c, created.externalId);
    expect(synced.statusCategory).toBe('DONE');
    expect(synced.version).not.toBe(created.version);
  });

  it('imports requirements of a project', async () => {
    clearOAuthTokenCache();
    const adapter = new CloudAlmAdapter();
    const c = ctx('SAP_CLOUD_ALM', cfg(), { clientId: calm.clientId, clientSecret: calm.clientSecret });
    const reqs = await adapter.listRequirements(c, calm.state.projects[0].id);
    expect(reqs.map((r) => r.displayId)).toEqual(expect.arrayContaining(['REQ-10', 'REQ-11']));
  });

  it('fails without a mapped project instead of inventing one', async () => {
    const adapter = new CloudAlmAdapter();
    const c = ctx('SAP_CLOUD_ALM', { ...cfg(), defaultProjectId: undefined }, { clientId: calm.clientId, clientSecret: calm.clientSecret });
    await expect(adapter.createWorkItem(c, input)).rejects.toThrow(/No Cloud ALM project mapped/);
  });
});

describe('Jira Cloud adapter against the contract double', () => {
  let jira: any;
  beforeAll(async () => {
    jira = await doubles.startJiraDouble();
  });
  afterAll(async () => jira.close());

  it('tests the connection, creates an ADF issue with remote link, comments and syncs status', async () => {
    const adapter = new JiraAdapter();
    const c = ctx('JIRA', { baseUrl: jira.url, projectKey: 'SAPS4', issueType: 'Task' }, { email: jira.email, apiToken: jira.apiToken });
    expect((await adapter.testConnection(c)).ok).toBe(true);
    const created = await adapter.createWorkItem(c, input);
    expect(created.key).toBe('SAPS4-1');
    expect(created.url).toBe(`${jira.url}/browse/SAPS4-1`);
    expect(jira.state.remoteLinks[0].object.url).toBe(input.findingUrl);
    const issue = [...jira.state.issues.values()][0] as any;
    expect(issue.fields.description.type).toBe('doc');
    expect(issue.fields.priority.name).toBe('High');
    await adapter.addComment(c, created.key!, 'Re-run scheduled');
    expect(jira.state.comments).toHaveLength(1);
    await fetch(`${jira.url}/__control/issues/SAPS4-1`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'progress' }) });
    expect((await adapter.getWorkItem(c, created.externalId)).statusCategory).toBe('IN_PROGRESS');
  });

  it('surfaces an unknown project as a 404 during the connection test', async () => {
    const adapter = new JiraAdapter();
    const c = ctx('JIRA', { baseUrl: jira.url, projectKey: 'NOPE', issueType: 'Task' }, { email: jira.email, apiToken: jira.apiToken });
    await expect(adapter.testConnection(c)).rejects.toBeInstanceOf(ConnectorHttpError);
  });
});

describe('Azure DevOps adapter against the contract double', () => {
  let ado: any;
  beforeAll(async () => {
    ado = await doubles.startAzureDevOpsDouble();
  });
  afterAll(async () => ado.close());

  it('creates a work item with JSON Patch, syncs state and detects the revision change', async () => {
    const adapter = new AzureDevOpsAdapter();
    const c = ctx('AZURE_DEVOPS', { baseUrl: ado.url, organization: ado.organization, project: ado.project, workItemType: 'Task' }, { personalAccessToken: ado.pat });
    expect((await adapter.testConnection(c)).ok).toBe(true);
    const created = await adapter.createWorkItem(c, input);
    expect(created.key).toBe(`#${created.externalId}`);
    expect(created.statusCategory).toBe('OPEN');
    const stored = ado.state.items.get(Number(created.externalId));
    expect(stored.fields['Microsoft.VSTS.Common.Priority']).toBe(1);
    expect(stored.relations[0].url).toBe(input.findingUrl);
    await fetch(`${ado.url}/__control/workitems/${created.externalId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'Done' }) });
    const synced = await adapter.getWorkItem(c, created.externalId);
    expect(synced.statusCategory).toBe('DONE');
    expect(synced.version).toBe('2');
    await adapter.addComment(c, created.externalId, 'Fixed <b>transport</b>');
    expect(ado.state.comments[0].text).toContain('&lt;b&gt;');
  });

  it('rejects an invalid PAT', async () => {
    const adapter = new AzureDevOpsAdapter();
    const c = ctx('AZURE_DEVOPS', { baseUrl: ado.url, organization: ado.organization, project: ado.project, workItemType: 'Task' }, { personalAccessToken: 'bad' });
    await expect(adapter.testConnection(c)).rejects.toMatchObject({ status: 401 });
  });
});

describe('ServiceNow adapter against the contract double', () => {
  let snow: any;
  beforeAll(async () => {
    snow = await doubles.startServiceNowDouble();
  });
  afterAll(async () => snow.close());

  it('creates an incident, adds work notes and maps state display values', async () => {
    const adapter = new ServiceNowAdapter();
    const c = ctx('SERVICENOW', { instanceUrl: snow.url, table: 'incident' }, { username: snow.username, password: snow.password });
    expect((await adapter.testConnection(c)).ok).toBe(true);
    const created = await adapter.createWorkItem(c, input);
    expect(created.key).toMatch(/^INC00\d+$/);
    expect(created.status).toBe('New');
    const rec = snow.state.records.get(created.externalId);
    expect(rec.urgency).toBe('1');
    await adapter.addComment(c, created.externalId, 'Evidence re-checked');
    expect(rec.work_notes).toContain('Evidence re-checked');
    await fetch(`${snow.url}/__control/incident/${created.externalId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: '6' }) });
    const synced = await adapter.getWorkItem(c, created.externalId);
    expect(synced.statusCategory).toBe('DONE');
    expect(synced.status).toBe('Resolved');
  });
});

describe('OData metadata connector', () => {
  let odata: any;
  beforeAll(async () => {
    odata = await doubles.startODataDouble();
  });
  afterAll(async () => odata.close());

  it('fetches $metadata with sap-client and normalizes it deterministically', async () => {
    const adapter = new ODataAdapter();
    const c = ctx('ODATA', { serviceRootUrl: odata.serviceRootUrl, odataVersion: 'AUTO', sapClient: '100', authType: 'BASIC' }, { username: odata.username, password: odata.password });
    const a = await adapter.fetchMetadata(c);
    const b = await adapter.fetchMetadata(c);
    expect(a.protocolVersion).toBe('V2');
    expect(a.contentSha256).toBe(b.contentSha256);
    expect(a.summary).toMatchObject({ entityTypes: 2, entitySets: 2, operations: 1 });
    const bp = (a.normalized as any).entityTypes.find((e: any) => e.name.endsWith('A_BusinessPartnerType'));
    expect(bp.key).toEqual(['BusinessPartner']);
    expect(bp.properties.find((p: any) => p.name === 'YY1_LegacyId_bus')).toBeTruthy();
    expect(odata.state.requests.at(-1).search).toBe('?sap-client=100');
  });

  it('detects a changed service contract through a different hash', async () => {
    const adapter = new ODataAdapter();
    const c = ctx('ODATA', { serviceRootUrl: odata.serviceRootUrl, odataVersion: 'AUTO', authType: 'BASIC' }, { username: odata.username, password: odata.password });
    const before = await adapter.fetchMetadata(c);
    await fetch(`${odata.url}/__control/metadata`, { method: 'PUT', body: doubles.EDMX_V2.replace('<Property Name="CityName" Type="Edm.String" MaxLength="40"/>', '') });
    const after = await adapter.fetchMetadata(c);
    expect(after.contentSha256).not.toBe(before.contentSha256);
  });

  it('refuses DTD / entity declarations (XXE, billion laughs)', () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><edmx:Edmx Version="4.0" xmlns:edmx="x">&e;</edmx:Edmx>`;
    expect(() => normalizeODataMetadata(xxe)).toThrow(/DTD/);
    expect(() => normalizeODataMetadata('<edmx:Edmx Version="4.0">&undefined;</edmx:Edmx>')).toThrow(/entity/i);
  });

  it('rejects unauthenticated metadata reads', async () => {
    const adapter = new ODataAdapter();
    const c = ctx('ODATA', { serviceRootUrl: odata.serviceRootUrl, odataVersion: 'AUTO', authType: 'BASIC' }, { username: 'x', password: 'y' });
    await expect(adapter.fetchMetadata(c)).rejects.toMatchObject({ status: 401 });
  });
});

describe('HTTP / OpenAPI connector', () => {
  let rec: any;
  beforeAll(async () => {
    rec = await doubles.startRecorder();
  });
  afterAll(async () => rec.close());

  it('probes the health path with the configured API key header', async () => {
    const adapter = new HttpOpenApiAdapter();
    const c = ctx('HTTP_OPENAPI', { baseUrl: rec.url, healthPath: '/health', authType: 'API_KEY_HEADER', apiKeyHeader: 'X-Api-Key' }, { apiKey: 'k-123' });
    const res = await adapter.testConnection(c);
    expect(res.ok).toBe(true);
    expect(rec.state.requests.at(-1).headers['x-api-key']).toBe('k-123');
  });
});

describe('Git connector (read-only abapGit clone over smart HTTP)', () => {
  let git: any;
  let root: string;
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'erppf-gitsrv-'));
    const work = path.join(root, 'work');
    fs.mkdirSync(path.join(work, 'src'), { recursive: true });
    fs.writeFileSync(path.join(work, '.abapgit.xml'), '<?xml version="1.0"?><asx:abap><asx:values><DATA><STARTING_FOLDER>/src/</STARTING_FOLDER></DATA></asx:values></asx:abap>');
    fs.writeFileSync(path.join(work, 'src', 'zcl_billing.clas.abap'), 'CLASS zcl_billing DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_billing IMPLEMENTATION.\nENDCLASS.\n');
    fs.writeFileSync(path.join(work, 'src', 'zcl_billing.clas.xml'), '<?xml version="1.0"?><abapGit/>');
    fs.writeFileSync(path.join(work, 'src', 'z_report.prog.abap'), 'REPORT z_report.\nUPDATE bkpf SET bktxt = space.\n');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: work, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: root } });
    g('init', '-q', '-b', 'main');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'abapGit export');
    execFileSync('git', ['clone', '-q', '--bare', work, path.join(root, 'repo.git')]);
    git = await doubles.startGitHttpServer({ projectRoot: root, token: 'git-token' });
  });
  afterAll(async () => {
    await git.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the branch head and snapshots the abapGit tree (sandbox removed afterwards)', async () => {
    const adapter = new GitAdapter();
    const c = ctx('GIT', { repositoryUrl: `${git.url}/repo.git`, branch: 'main', pathFilter: 'src', maxRepoBytes: 5 * 1024 * 1024 }, { token: 'git-token' });
    const test = await adapter.testConnection(c);
    expect(test.ok).toBe(true);
    const snap = await adapter.snapshot(c);
    expect(snap.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(snap.files.map((f) => f.path)).toEqual(['src/z_report.prog.abap', 'src/zcl_billing.clas.abap', 'src/zcl_billing.clas.xml']);
    expect(snap.objectTypes).toEqual({ PROG: 1, CLAS: 2 });
    expect(git.state.requests.every((r: any) => r.auth)).toBe(true);
    const leftovers = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('erppf-git-'));
    expect(leftovers.length).toBe(0);
  });

  it('fails cleanly with a wrong token and never leaks it in the error', async () => {
    const adapter = new GitAdapter();
    const c = ctx('GIT', { repositoryUrl: `${git.url}/repo.git`, branch: 'main', pathFilter: '', maxRepoBytes: 5 * 1024 * 1024 }, { token: 'wrong-token-value' });
    const err = await adapter.snapshot(c).catch((e) => e);
    expect(err.message).toMatch(/git exited/);
    expect(err.message).not.toContain('wrong-token-value');
  });

  it('refuses non-http(s) transports and blocked hosts', async () => {
    const adapter = new GitAdapter();
    await expect(adapter.resolvePinnedTarget('file:///etc')).rejects.toThrow();
    await expect(adapter.resolvePinnedTarget('https://169.254.169.254/repo.git')).rejects.toThrow();
  });
});
