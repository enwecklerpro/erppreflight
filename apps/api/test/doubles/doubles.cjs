/* eslint-disable */
/**
 * Contract-faithful local test doubles for external systems (spec 00 §0.3).
 *
 * Each double is a real HTTP(S) server implementing the subset of the vendor API
 * that ERP Preflight adapters use, with the vendor's authentication scheme,
 * request validation and response shapes:
 *   - SAP Cloud ALM   (OAuth2 client credentials token endpoint + calm-projects / calm-tasks v1)
 *   - Jira Cloud      (REST API v3, Basic email:apiToken, ADF bodies)
 *   - Azure DevOps    (WIT REST 7.1, PAT Basic auth, JSON Patch)
 *   - ServiceNow      (Table API, Basic auth, { result } envelopes)
 *   - OData service   ($metadata EDMX V2 / V4, Basic auth)
 *   - OIDC IdP        (discovery, JWKS, authorize with PKCE, token endpoint, RS256 ID tokens)
 *   - DNS TXT server  (UDP, answers TXT queries from an in-memory zone)
 *   - Git smart HTTP  (git http-backend CGI over a bare repository)
 *   - Webhook receiver / Sentry envelope receiver (record requests)
 * Every double exposes `state` for assertions and `/__control/*` routes to
 * simulate human changes in the remote system (status changes, conflicts).
 *
 * Usable from vitest (require) and standalone: `node apps/api/test/doubles/run-doubles.cjs`.
 */
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function send(res, status, body, headers = {}) {
  const isObj = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...(isObj ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

function basicCreds(req) {
  const m = String(req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  const raw = Buffer.from(m[1], 'base64').toString('utf8');
  const i = raw.indexOf(':');
  return { user: raw.slice(0, i), pass: raw.slice(i + 1) };
}

function listen(handler, opts = {}) {
  const server = opts.tls ? https.createServer({ key: opts.tls.key, cert: opts.tls.cert }, handler) : http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(opts.port || 0, opts.host || '127.0.0.1', () => {
      const addr = server.address();
      const host = opts.publicHost || opts.host || '127.0.0.1';
      const url = `${opts.tls ? 'https' : 'http'}://${host}:${addr.port}`;
      resolve({ server, url, port: addr.port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

async function jsonBody(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// SAP Cloud ALM
// ---------------------------------------------------------------------------
async function startCloudAlmDouble(opts = {}) {
  const clientId = opts.clientId || 'calm-client';
  const clientSecret = opts.clientSecret || 'calm-secret';
  const state = {
    tokens: new Set(),
    tokenRequests: 0,
    projects: opts.projects || [
      { id: 'b5a1c0de-0000-4000-8000-000000000001', name: 'S/4HANA 2023 Upgrade' },
      { id: 'b5a1c0de-0000-4000-8000-000000000002', name: 'Clean Core Program' },
    ],
    tasks: new Map(),
    comments: [],
    seq: 1000,
  };
  // Pre-seeded requirements (the ALM side's own data, imported by ERP Preflight).
  for (const [i, title] of ['Output determination for billing documents', 'Custom field propagation to accounting'].entries()) {
    const id = crypto.randomUUID();
    state.tasks.set(id, {
      id,
      displayId: `REQ-${10 + i}`,
      projectId: state.projects[0].id,
      title,
      type: 'CALMREQU',
      status: 'CIPREQUAPPR',
      priorityId: 20,
      lastChangedDate: new Date().toISOString(),
    });
  }
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (req.method === 'POST' && p === '/oauth/token') {
      state.tokenRequests++;
      const creds = basicCreds(req);
      const form = new URLSearchParams((await readBody(req)).toString('utf8'));
      if (form.get('grant_type') !== 'client_credentials') return send(res, 400, { error: 'unsupported_grant_type' });
      if (!creds || creds.user !== clientId || creds.pass !== clientSecret) return send(res, 401, { error: 'invalid_client' });
      const token = crypto.randomBytes(24).toString('hex');
      state.tokens.add(token);
      return send(res, 200, { access_token: token, token_type: 'bearer', expires_in: 3599, scope: 'calm-api.read calm-api.write' });
    }
    if (p.startsWith('/__control/')) {
      const m = p.match(/^\/__control\/tasks\/([^/]+)$/);
      if (m && req.method === 'PATCH') {
        const t = state.tasks.get(m[1]);
        if (!t) return send(res, 404, {});
        Object.assign(t, await jsonBody(req), { lastChangedDate: new Date(Date.now() + 1000).toISOString() });
        return send(res, 200, t);
      }
      return send(res, 404, {});
    }
    const auth = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    if (!auth || !state.tokens.has(auth[1])) return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
    if (req.method === 'GET' && p === '/api/calm-projects/v1/projects') return send(res, 200, state.projects);
    if (p === '/api/calm-tasks/v1/tasks' && req.method === 'GET') {
      const projectId = u.searchParams.get('projectId');
      const type = u.searchParams.get('type');
      return send(res, 200, [...state.tasks.values()].filter((t) => (!projectId || t.projectId === projectId) && (!type || t.type === type)));
    }
    if (p === '/api/calm-tasks/v1/tasks' && req.method === 'POST') {
      const b = await jsonBody(req);
      if (!b || !b.projectId || !b.title || !b.type) return send(res, 400, { error: { code: 'BAD_REQUEST', message: 'projectId, title and type are required' } });
      if (!state.projects.some((pr) => pr.id === b.projectId)) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Project not found' } });
      const id = crypto.randomUUID();
      const t = { id, displayId: `TSK-${state.seq++}`, projectId: b.projectId, title: b.title, type: b.type, description: b.description, priorityId: b.priorityId, status: 'CIPTKOPEN', tags: b.tags || [], assigneeId: b.assigneeId || null, dueDate: b.dueDate || null, lastChangedDate: new Date().toISOString() };
      state.tasks.set(id, t);
      return send(res, 201, t);
    }
    let m = p.match(/^\/api\/calm-tasks\/v1\/tasks\/([^/]+)$/);
    if (m) {
      const t = state.tasks.get(m[1]);
      if (!t) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Task not found' } });
      if (req.method === 'GET') return send(res, 200, t);
      if (req.method === 'PATCH') {
        const b = await jsonBody(req);
        for (const k of ['title', 'description', 'priorityId', 'status', 'assigneeId', 'dueDate']) if (b && b[k] !== undefined) t[k] = b[k];
        t.lastChangedDate = new Date(Date.now() + 1).toISOString();
        return send(res, 200, t);
      }
    }
    m = p.match(/^\/api\/calm-tasks\/v1\/tasks\/([^/]+)\/comments$/);
    if (m && req.method === 'POST') {
      if (!state.tasks.has(m[1])) return send(res, 404, {});
      const b = await jsonBody(req);
      if (!b || !b.content) return send(res, 400, { error: { message: 'content required' } });
      const c = { id: crypto.randomUUID(), taskId: m[1], content: b.content };
      state.comments.push(c);
      return send(res, 201, c);
    }
    return send(res, 404, { error: { code: 'NOT_FOUND', message: `${req.method} ${p}` } });
  };
  const s = await listen(handler, opts);
  return { ...s, state, clientId, clientSecret, tokenUrl: `${s.url}/oauth/token` };
}

// ---------------------------------------------------------------------------
// Jira Cloud REST v3
// ---------------------------------------------------------------------------
async function startJiraDouble(opts = {}) {
  const email = opts.email || 'bot@example.com';
  const apiToken = opts.apiToken || 'jira-token';
  const state = { projects: { SAPS4: { id: '10000', key: 'SAPS4', name: 'S/4 Remediation' } }, issues: new Map(), comments: [], remoteLinks: [], seq: 1 };
  const statuses = {
    todo: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } },
    progress: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
    done: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } },
  };
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let m = p.match(/^\/__control\/issues\/([^/]+)$/);
    if (m && req.method === 'PATCH') {
      const issue = [...state.issues.values()].find((i) => i.key === m[1] || i.id === m[1]);
      if (!issue) return send(res, 404, {});
      const b = await jsonBody(req);
      if (b.status) issue.fields.status = statuses[b.status];
      if (b.summary) issue.fields.summary = b.summary;
      issue.fields.updated = new Date(Date.now() + 1000).toISOString();
      return send(res, 200, issue);
    }
    const c = basicCreds(req);
    if (!c || c.user !== email || c.pass !== apiToken) return send(res, 401, { errorMessages: ['Client must be authenticated to access this resource.'] });
    if (req.method === 'GET' && p === '/rest/api/3/myself') return send(res, 200, { accountId: '5b10a2844c20165700ede21g', emailAddress: email, displayName: 'ERP Preflight Bot', active: true });
    m = p.match(/^\/rest\/api\/3\/project\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const pr = state.projects[m[1]];
      return pr ? send(res, 200, pr) : send(res, 404, { errorMessages: [`No project could be found with key '${m[1]}'.`] });
    }
    if (p === '/rest/api/3/issue' && req.method === 'POST') {
      const b = await jsonBody(req);
      const f = b && b.fields;
      const errors = {};
      if (!f || !f.project || !state.projects[f.project.key]) errors.project = 'valid project is required';
      if (!f || !f.summary) errors.summary = 'You must specify a summary of the issue.';
      if (!f || !f.issuetype || !f.issuetype.name) errors.issuetype = 'valid issue type is required';
      if (f && f.description && f.description.type !== 'doc') errors.description = 'Operation value must be an Atlassian Document';
      if (Object.keys(errors).length) return send(res, 400, { errorMessages: [], errors });
      const id = String(10000 + state.seq);
      const key = `${f.project.key}-${state.seq++}`;
      const issue = { id, key, self: `/rest/api/3/issue/${id}`, fields: { summary: f.summary, description: f.description, labels: f.labels || [], priority: f.priority, status: statuses.todo, assignee: null, updated: new Date().toISOString() } };
      state.issues.set(id, issue);
      return send(res, 201, { id, key, self: issue.self });
    }
    m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)(\/comment|\/remotelink)?$/);
    if (m) {
      const issue = [...state.issues.values()].find((i) => i.key === m[1] || i.id === m[1]);
      if (!issue) return send(res, 404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
      if (!m[2] && req.method === 'GET') return send(res, 200, issue);
      if (!m[2] && req.method === 'PUT') {
        const b = await jsonBody(req);
        Object.assign(issue.fields, (b && b.fields) || {});
        issue.fields.updated = new Date(Date.now() + 1).toISOString();
        res.writeHead(204);
        return res.end();
      }
      if (m[2] === '/comment' && req.method === 'POST') {
        const b = await jsonBody(req);
        if (!b || !b.body || b.body.type !== 'doc') return send(res, 400, { errorMessages: ['Comment body must be ADF'] });
        state.comments.push({ issue: issue.key, body: b.body });
        return send(res, 201, { id: String(state.comments.length) });
      }
      if (m[2] === '/remotelink' && req.method === 'POST') {
        const b = await jsonBody(req);
        state.remoteLinks.push({ issue: issue.key, ...b });
        return send(res, 201, { id: state.remoteLinks.length });
      }
    }
    return send(res, 404, { errorMessages: [`${req.method} ${p}`] });
  };
  const s = await listen(handler, opts);
  return { ...s, state, email, apiToken };
}

// ---------------------------------------------------------------------------
// Azure DevOps WIT 7.1
// ---------------------------------------------------------------------------
async function startAzureDevOpsDouble(opts = {}) {
  const pat = opts.pat || 'ado-pat';
  const org = opts.organization || 'contoso';
  const project = opts.project || 'S4Upgrade';
  const state = { items: new Map(), comments: [], seq: 100 };
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = decodeURIComponent(u.pathname);
    let m = p.match(/^\/__control\/workitems\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      const wi = state.items.get(Number(m[1]));
      if (!wi) return send(res, 404, {});
      const b = await jsonBody(req);
      if (b.state) wi.fields['System.State'] = b.state;
      if (b.title) wi.fields['System.Title'] = b.title;
      wi.rev++;
      wi.fields['System.ChangedDate'] = new Date().toISOString();
      return send(res, 200, wi);
    }
    const c = basicCreds(req);
    if (!c || c.pass !== pat) return send(res, 401, '', { 'WWW-Authenticate': 'Basic realm="https://dev.azure.com/"' });
    if (u.searchParams.get('api-version') == null) return send(res, 400, { message: 'No api-version was supplied for the request.' });
    if (req.method === 'GET' && p === `/${org}/_apis/projects/${project}`) return send(res, 200, { id: 'e2b0a1f3-0000-4000-8000-00000000abcd', name: project, state: 'wellFormed', visibility: 'private' });
    if (req.method === 'GET' && p.startsWith(`/${org}/_apis/projects/`)) return send(res, 404, { message: 'TF200016: The following project does not exist' });
    m = p.match(new RegExp(`^/${org}/${project}/_apis/wit/workitems/\\$(.+)$`));
    if (m && req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json-patch+json')) return send(res, 415, { message: 'Content-Type must be application/json-patch+json' });
      const ops = await jsonBody(req);
      if (!Array.isArray(ops)) return send(res, 400, { message: 'Expected a JSON Patch document' });
      const fields = {};
      const relations = [];
      for (const op of ops) {
        if (op.op !== 'add') return send(res, 400, { message: `Unsupported op ${op.op}` });
        if (op.path.startsWith('/fields/')) fields[op.path.slice(8)] = op.value;
        else if (op.path === '/relations/-') relations.push(op.value);
      }
      if (!fields['System.Title']) return send(res, 400, { message: 'TF401320: Rule Error for field Title. Error code: Required.' });
      const id = state.seq++;
      const wi = { id, rev: 1, fields: { ...fields, 'System.WorkItemType': m[1], 'System.State': 'To Do', 'System.ChangedDate': new Date().toISOString() }, relations, _links: { html: { href: `https://dev.azure.com/${org}/${project}/_workitems/edit/${id}` } } };
      state.items.set(id, wi);
      return send(res, 200, wi);
    }
    m = p.match(new RegExp(`^/${org}/${project}/_apis/wit/workitems/(\\d+)$`));
    if (m) {
      const wi = state.items.get(Number(m[1]));
      if (!wi) return send(res, 404, { message: `TF401232: Work item ${m[1]} does not exist` });
      if (req.method === 'GET') return send(res, 200, wi);
      if (req.method === 'PATCH') {
        const ops = await jsonBody(req);
        for (const op of ops || []) if (op.path.startsWith('/fields/')) wi.fields[op.path.slice(8)] = op.value;
        wi.rev++;
        wi.fields['System.ChangedDate'] = new Date().toISOString();
        return send(res, 200, wi);
      }
    }
    m = p.match(new RegExp(`^/${org}/${project}/_apis/wit/workItems/(\\d+)/comments$`));
    if (m && req.method === 'POST') {
      if (!state.items.has(Number(m[1]))) return send(res, 404, {});
      const b = await jsonBody(req);
      state.comments.push({ id: Number(m[1]), text: b && b.text });
      return send(res, 200, { id: state.comments.length, text: b && b.text });
    }
    return send(res, 404, { message: `${req.method} ${p}` });
  };
  const s = await listen(handler, opts);
  return { ...s, state, pat, organization: org, project };
}

// ---------------------------------------------------------------------------
// ServiceNow Table API
// ---------------------------------------------------------------------------
async function startServiceNowDouble(opts = {}) {
  const username = opts.username || 'erp.integration';
  const password = opts.password || 'snow-pass';
  const state = { records: new Map(), seq: 10001 };
  const stateNames = { 1: 'New', 2: 'In Progress', 3: 'On Hold', 6: 'Resolved', 7: 'Closed', 8: 'Canceled' };
  const view = (r, displayAll) => {
    if (!displayAll) return r;
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k] = { value: v, display_value: k === 'state' ? stateNames[v] || v : v };
    return out;
  };
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let m = p.match(/^\/__control\/([a-z_]+)\/([0-9a-f]{32})$/);
    if (m && req.method === 'PATCH') {
      const r = state.records.get(m[2]);
      if (!r) return send(res, 404, {});
      Object.assign(r, await jsonBody(req));
      r.sys_mod_count++;
      r.sys_updated_on = new Date().toISOString().replace('T', ' ').slice(0, 19);
      return send(res, 200, r);
    }
    const c = basicCreds(req);
    const bearer = String(req.headers.authorization || '').startsWith('Bearer ');
    if (!bearer && (!c || c.user !== username || c.pass !== password)) return send(res, 401, { error: { message: 'User Not Authenticated', detail: 'Required to provide Auth information' }, status: 'failure' });
    const displayAll = u.searchParams.get('sysparm_display_value') === 'all';
    m = p.match(/^\/api\/now\/table\/([a-z_]+)(?:\/([0-9a-f]{32}))?$/);
    if (!m) return send(res, 400, { error: { message: 'Invalid table' }, status: 'failure' });
    const table = m[1];
    if (!m[2] && req.method === 'GET') {
      const rows = [...state.records.values()].filter((r) => r.sys_class_name === table).slice(0, Number(u.searchParams.get('sysparm_limit') || 100));
      return send(res, 200, { result: rows.map((r) => view(r, displayAll)) });
    }
    if (!m[2] && req.method === 'POST') {
      const b = await jsonBody(req);
      if (!b || !b.short_description) return send(res, 400, { error: { message: 'short_description is mandatory' }, status: 'failure' });
      const sysId = crypto.randomBytes(16).toString('hex');
      const r = { sys_id: sysId, number: `INC00${state.seq++}`, sys_class_name: table, state: '1', short_description: b.short_description, description: b.description || '', urgency: b.urgency || '3', impact: b.impact || '3', correlation_id: b.correlation_id || '', assignment_group: b.assignment_group || '', work_notes: '', sys_mod_count: 0, sys_updated_on: new Date().toISOString().replace('T', ' ').slice(0, 19), assigned_to: '' };
      state.records.set(sysId, r);
      return send(res, 201, { result: view(r, displayAll) });
    }
    const r = state.records.get(m[2]);
    if (!r || r.sys_class_name !== table) return send(res, 404, { error: { message: 'No Record found', detail: 'Record doesn\'t exist or ACL restricts the record retrieval' }, status: 'failure' });
    if (req.method === 'GET') return send(res, 200, { result: view(r, displayAll) });
    if (req.method === 'PATCH' || req.method === 'PUT') {
      const b = await jsonBody(req);
      for (const [k, v] of Object.entries(b || {})) {
        if (k === 'work_notes') r.work_notes = `${r.work_notes}\n${v}`.trim();
        else r[k] = v;
      }
      r.sys_mod_count++;
      r.sys_updated_on = new Date(Date.now() + 1000).toISOString().replace('T', ' ').slice(0, 19);
      return send(res, 200, { result: view(r, displayAll) });
    }
    return send(res, 405, {});
  };
  const s = await listen(handler, opts);
  return { ...s, state, username, password };
}

// ---------------------------------------------------------------------------
// OData service ($metadata)
// ---------------------------------------------------------------------------
const EDMX_V2 = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:sap="http://www.sap.com/Protocols/SAPData">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="API_BUSINESS_PARTNER" xml:lang="en" sap:schema-version="1" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="A_BusinessPartnerType" sap:content-version="1">
        <Key><PropertyRef Name="BusinessPartner"/></Key>
        <Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10" sap:label="Business Partner"/>
        <Property Name="BusinessPartnerFullName" Type="Edm.String" MaxLength="81"/>
        <Property Name="YY1_LegacyId_bus" Type="Edm.String" MaxLength="20" sap:label="Legacy ID &amp; Ref"/>
        <NavigationProperty Name="to_BusinessPartnerAddress" Relationship="API_BUSINESS_PARTNER.assoc_BP_Address" FromRole="FromRole" ToRole="ToRole"/>
      </EntityType>
      <EntityType Name="A_BusinessPartnerAddressType">
        <Key><PropertyRef Name="BusinessPartner"/><PropertyRef Name="AddressID"/></Key>
        <Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="AddressID" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="CityName" Type="Edm.String" MaxLength="40"/>
      </EntityType>
      <EntityContainer Name="API_BUSINESS_PARTNER_Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="A_BusinessPartner" EntityType="API_BUSINESS_PARTNER.A_BusinessPartnerType"/>
        <EntitySet Name="A_BusinessPartnerAddress" EntityType="API_BUSINESS_PARTNER.A_BusinessPartnerAddressType"/>
        <FunctionImport Name="ValidateBusinessPartner" ReturnType="Edm.Boolean" m:HttpMethod="GET">
          <Parameter Name="BusinessPartner" Type="Edm.String" Mode="In"/>
        </FunctionImport>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

async function startODataDouble(opts = {}) {
  const username = opts.username || 'ODATA_READER';
  const password = opts.password || 'odata-pass';
  const state = { requests: [], metadata: opts.metadata || EDMX_V2 };
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    state.requests.push({ method: req.method, path: u.pathname, search: u.search });
    if (u.pathname === '/__control/metadata' && req.method === 'PUT') {
      state.metadata = (await readBody(req)).toString('utf8');
      return send(res, 204, '');
    }
    const c = basicCreds(req);
    if (!c || c.user !== username || c.pass !== password) return send(res, 401, 'Logon failed', { 'WWW-Authenticate': 'Basic realm="SAP NetWeaver Application Server"' });
    if (req.method === 'GET' && u.pathname === '/sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata') {
      return send(res, 200, state.metadata, { 'Content-Type': 'application/xml', 'sap-server': 'true', dataserviceversion: '2.0' });
    }
    return send(res, 404, 'Not found');
  };
  const s = await listen(handler, opts);
  return { ...s, state, username, password, serviceRootUrl: `${s.url}/sap/opu/odata/sap/API_BUSINESS_PARTNER` };
}

// ---------------------------------------------------------------------------
// OIDC identity provider
// ---------------------------------------------------------------------------
async function startOidcIdp(opts = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = crypto.randomBytes(8).toString('hex');
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
  const clientId = opts.clientId || 'erppreflight-web';
  const clientSecret = opts.clientSecret || 'idp-client-secret';
  const state = {
    users: opts.users || { 'alice@acme-sso.test': { sub: 'idp|alice', name: 'Alice Architect', email_verified: true } },
    codes: new Map(),
    // Test knobs: which user logs in next, tamper modes
    nextLogin: opts.defaultLogin || 'alice@acme-sso.test',
    tamper: null, // 'nonce' | 'aud' | 'signature' | 'unverified-email'
    tokenRequests: [],
  };
  let base = '';
  const signJwt = (claims) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    let sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    if (state.tamper === 'signature') sig = sig.slice(0, -4) + 'AAAA';
    return `${header}.${payload}.${sig}`;
  };
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/.well-known/openid-configuration') {
      return send(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    }
    if (p === '/jwks') return send(res, 200, { keys: [jwk] });
    if (p === '/__control/login' && req.method === 'POST') {
      const b = await jsonBody(req);
      if (b.email) state.nextLogin = b.email;
      state.tamper = b.tamper || null;
      if (b.user) state.users[b.email] = b.user;
      return send(res, 200, { ok: true });
    }
    if (p === '/authorize') {
      const q = u.searchParams;
      if (q.get('client_id') !== clientId) return send(res, 400, 'unknown client');
      if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return send(res, 400, 'PKCE S256 required');
      const email = state.nextLogin;
      const code = crypto.randomBytes(16).toString('hex');
      state.codes.set(code, { email, challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), nonce: q.get('nonce'), used: false });
      const target = new URL(q.get('redirect_uri'));
      target.searchParams.set('code', code);
      target.searchParams.set('state', q.get('state'));
      res.writeHead(302, { Location: target.toString() });
      return res.end();
    }
    if (p === '/token' && req.method === 'POST') {
      const form = new URLSearchParams((await readBody(req)).toString('utf8'));
      state.tokenRequests.push(Object.fromEntries(form));
      const c = basicCreds(req);
      if (!c || decodeURIComponent(c.user) !== clientId || decodeURIComponent(c.pass) !== clientSecret) return send(res, 401, { error: 'invalid_client' });
      const entry = state.codes.get(form.get('code'));
      if (!entry || entry.used) return send(res, 400, { error: 'invalid_grant' });
      entry.used = true;
      if (form.get('redirect_uri') !== entry.redirectUri) return send(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      const verifier = form.get('code_verifier') || '';
      if (crypto.createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      const user = state.users[entry.email] || { sub: `idp|${entry.email}`, name: entry.email, email_verified: true };
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt({
        iss: base,
        sub: user.sub,
        aud: state.tamper === 'aud' ? 'someone-else' : clientId,
        exp: now + 300,
        iat: now,
        nonce: state.tamper === 'nonce' ? 'wrong-nonce' : entry.nonce,
        email: entry.email,
        email_verified: state.tamper === 'unverified-email' ? false : user.email_verified !== false,
        name: user.name,
      });
      return send(res, 200, { access_token: crypto.randomBytes(16).toString('hex'), token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    return send(res, 404, {});
  };
  const s = await listen(handler, opts);
  base = s.url;
  return { ...s, state, clientId, clientSecret, issuer: s.url };
}

// ---------------------------------------------------------------------------
// DNS TXT server (UDP) — answers TXT queries from an in-memory zone
// ---------------------------------------------------------------------------
function encodeName(name) {
  const parts = name.replace(/\.$/, '').split('.');
  const bufs = parts.map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p, 'ascii')]));
  return Buffer.concat([...bufs, Buffer.from([0])]);
}

function parseQuestion(msg) {
  let off = 12;
  const labels = [];
  while (msg[off] !== 0) {
    const len = msg[off];
    labels.push(msg.slice(off + 1, off + 1 + len).toString('ascii'));
    off += len + 1;
  }
  off += 1;
  const qtype = msg.readUInt16BE(off);
  return { name: labels.join('.').toLowerCase(), qtype, end: off + 4 };
}

async function startDnsTxtServer(opts = {}) {
  const zone = new Map(); // name -> [txt]
  const socket = dgram.createSocket('udp4');
  socket.on('message', (msg, rinfo) => {
    try {
      const { name, qtype, end } = parseQuestion(msg);
      const answers = qtype === 16 ? zone.get(name) || [] : [];
      const header = Buffer.alloc(12);
      msg.copy(header, 0, 0, 2); // id
      header.writeUInt16BE(0x8180 | (answers.length ? 0 : 3), 2); // response, RD+RA, NXDOMAIN when empty
      header.writeUInt16BE(1, 4);
      header.writeUInt16BE(answers.length, 6);
      const question = msg.slice(12, end);
      const rrs = answers.map((txt) => {
        const data = Buffer.concat([Buffer.from([Buffer.byteLength(txt)]), Buffer.from(txt)]);
        const rr = Buffer.alloc(12);
        rr.writeUInt16BE(0xc00c, 0);
        rr.writeUInt16BE(16, 2);
        rr.writeUInt16BE(1, 4);
        rr.writeUInt32BE(60, 6);
        rr.writeUInt16BE(data.length, 10);
        return Buffer.concat([rr, data]);
      });
      socket.send(Buffer.concat([header, question, ...rrs]), rinfo.port, rinfo.address);
    } catch {
      /* ignore malformed */
    }
  });
  await new Promise((r) => socket.bind(opts.port || 0, opts.host || '127.0.0.1', r));
  const port = socket.address().port;
  return {
    port,
    server: `${opts.host || '127.0.0.1'}:${port}`,
    setTxt: (name, values) => zone.set(name.toLowerCase(), values),
    zone,
    close: () => new Promise((r) => socket.close(() => r())),
  };
}

// ---------------------------------------------------------------------------
// Git smart HTTP (git http-backend CGI)
// ---------------------------------------------------------------------------
async function startGitHttpServer(opts = {}) {
  const projectRoot = opts.projectRoot; // directory containing <name>.git bare repos
  const token = opts.token || null;
  const state = { requests: [] };
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    state.requests.push({ method: req.method, path: u.pathname, auth: Boolean(req.headers.authorization) });
    if (token) {
      const c = basicCreds(req);
      if (!c || c.pass !== token) return send(res, 401, 'Authentication required', { 'WWW-Authenticate': 'Basic realm="git"' });
    }
    const body = await readBody(req);
    const env = {
      PATH: process.env.PATH,
      GIT_PROJECT_ROOT: projectRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: req.method,
      PATH_INFO: u.pathname,
      QUERY_STRING: u.search.slice(1),
      CONTENT_TYPE: req.headers['content-type'] || '',
      CONTENT_LENGTH: String(body.length),
      REMOTE_ADDR: '127.0.0.1',
      GIT_CONFIG_NOSYSTEM: '1',
      HTTP_GIT_PROTOCOL: req.headers['git-protocol'] || '',
    };
    const child = spawn('git', ['http-backend'], { env });
    const out = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stdin.end(body);
    child.on('close', () => {
      const buf = Buffer.concat(out);
      const sep = buf.indexOf('\r\n\r\n');
      const headerText = buf.slice(0, sep).toString('utf8');
      const payload = buf.slice(sep + 4);
      let status = 200;
      const headers = {};
      for (const line of headerText.split('\r\n')) {
        const i = line.indexOf(':');
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k.toLowerCase() === 'status') status = parseInt(v, 10);
        else if (k) headers[k] = v;
      }
      res.writeHead(status, headers);
      res.end(payload);
    });
  };
  const s = await listen(handler, opts);
  return { ...s, state };
}

// ---------------------------------------------------------------------------
// Generic recorder (webhook receiver, Sentry envelope endpoint)
// ---------------------------------------------------------------------------
async function startRecorder(opts = {}) {
  const state = { requests: [], failNext: 0, status: opts.status || 200 };
  const handler = async (req, res) => {
    const body = (await readBody(req)).toString('utf8');
    state.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === '/__control/fail' && req.method === 'POST') {
      state.failNext = Number(JSON.parse(body || '{}').count || 1);
      return send(res, 200, { ok: true });
    }
    if (state.failNext > 0) {
      state.failNext--;
      return send(res, 503, { error: 'temporarily unavailable' });
    }
    return send(res, state.status, { ok: true, id: crypto.randomUUID() });
  };
  const s = await listen(handler, opts);
  return { ...s, state };
}

/** Self-signed CA + server certificate (for HTTPS doubles in production-mode runs). */
function createTestCertificates(hosts, dir) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n);
  if (!fs.existsSync(f('ca.pem'))) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=ERP Preflight Test CA', '-keyout', f('ca-key.pem'), '-out', f('ca.pem')], { stdio: 'ignore' });
    const san = hosts.map((h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? `IP:${h}` : `DNS:${h}`)).join(',');
    fs.writeFileSync(f('ext.cnf'), `subjectAltName=${san}\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
    execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${hosts[0]}`, '-keyout', f('server-key.pem'), '-out', f('server.csr')], { stdio: 'ignore' });
    execFileSync('openssl', ['x509', '-req', '-in', f('server.csr'), '-CA', f('ca.pem'), '-CAkey', f('ca-key.pem'), '-CAcreateserial', '-days', '30', '-extfile', f('ext.cnf'), '-out', f('server.pem')], { stdio: 'ignore' });
  }
  return { ca: f('ca.pem'), key: fs.readFileSync(f('server-key.pem')), cert: fs.readFileSync(f('server.pem')) };
}

module.exports = {
  startCloudAlmDouble,
  startJiraDouble,
  startAzureDevOpsDouble,
  startServiceNowDouble,
  startODataDouble,
  startOidcIdp,
  startDnsTxtServer,
  startGitHttpServer,
  startRecorder,
  createTestCertificates,
  EDMX_V2,
};
