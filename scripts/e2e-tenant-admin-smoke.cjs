// Live E2E suite: tenant access administration (spec 10.2 IP allowlists, 10.7 suspend /
// extend trial, 10.8 + C §24 safe impersonation, 10.14 / C §62 support ticket e-mails).
// Usage:
//   API_BASE_URL=http://localhost:3001 WEB_URL=http://localhost:3000 MAIL_DEV_OUTBOX_TOKEN=... \
//   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... [CHROMIUM_PATH=...] [REDIS_URL=redis://...] \
//   node scripts/e2e-tenant-admin-smoke.cjs [screenshotDir]
// The API must run with MAIL_TRANSPORT=dev. WEB_URL enables the browser checks (admin dialogs,
// impersonation banner, suspended screen, IP allowlist settings, ticket conversation).
// REDIS_URL (the API's Redis) enables the "queued job of a suspended tenant is not processed" check.
// Covers the negative cases: impersonation write -> 403, secret endpoint -> 403, ended/expired
// impersonation -> 401, blocked IP -> 403, suspended tenant -> 403 and unsuspend restores access.
// Exits non-zero on any failure.
const path = require('path');
const fs = require('fs');
const os = require('os');

const API = (process.env.API_BASE_URL || process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '').replace(/\/api\/v1$/, '');
const A = `${API}/api/v1`;
const WEB = (process.env.WEB_URL || '').replace(/\/$/, '');
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-tenant-admin-smoke-'));
fs.mkdirSync(SHOTS, { recursive: true });
const MAIL_TOKEN = process.env.MAIL_DEV_OUTBOX_TOKEN || '';
const R = `${Date.now() % 1000000}${Math.floor(Math.random() * 90 + 10)}`;
const PASSWORD = 'TenantAdminPass!2026';
let failures = 0;
let passes = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, { token, body, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(A + p, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

function expectStatus(res, status, code, label) {
  const got = `${res.status}${res.json?.code ? ' ' + res.json.code : ''}`;
  if (res.status !== status || (code && res.json?.code !== code)) {
    throw new Error(`${label}: expected ${status}${code ? ' ' + code : ''}, got ${got} ${JSON.stringify(res.json).slice(0, 220)}`);
  }
}

async function step(name, fn) {
  try {
    await fn();
    passes++;
    console.log('OK   ', name);
  } catch (e) {
    failures++;
    console.log('FAIL ', name, '::', String(e && e.message).split('\n')[0]);
  }
}

async function mails(to) {
  const res = await fetch(`${A}/dev/mail/messages?to=${encodeURIComponent(to)}`, { headers: { 'X-Dev-Mailbox-Token': MAIL_TOKEN } });
  if (res.status === 404) throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev');
  const j = await res.json();
  return j.items || [];
}

/** Waits for `count` messages of `template` to `to` (optionally matching a predicate). */
async function waitMail(to, template, { count = 1, match } = {}) {
  let last = [];
  for (let i = 0; i < 30; i++) {
    last = (await mails(to)).filter((m) => m.template === template && (!match || match(m)));
    if (last.length >= count) return last;
    await sleep(400);
  }
  throw new Error(`expected ${count} ${template} e-mail(s) for ${to}, found ${last.length}`);
}

async function createTenant(tag) {
  const email = `tenantadmin-${tag}-${R}@e2e.local`;
  const reg = await call('POST', '/auth/register', {
    body: { email, password: PASSWORD, fullName: `Tenant ${tag} Owner`, organizationName: `Tenant Admin ${tag} ${R}` },
  });
  expect(reg.status === 201, `register ${tag}: ${reg.status} ${JSON.stringify(reg.json).slice(0, 200)}`);
  const verification = await waitMail(email, 'EMAIL_VERIFICATION');
  const link = verification[0].links.find((l) => l.includes('token='));
  const v = await call('POST', '/auth/verify-email', { body: { token: decodeURIComponent(link.split('token=')[1]) } });
  expect(v.status < 300, `verify ${tag}: ${v.status}`);
  const login = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  expect(login.json?.accessToken, `login ${tag}: ${login.status}`);
  return { email, token: login.json.accessToken, userId: login.json.user.id, orgId: login.json.user.organizationId };
}

async function auditActions(tenant) {
  const res = await call('GET', '/audit/events?limit=500', { token: tenant.token });
  expect(res.status === 200, `audit events ${res.status}`);
  return res.json;
}

(async () => {
  console.log(`tenant-admin smoke against ${A}${WEB ? ` and ${WEB}` : ''} (screenshots: ${SHOTS})`);
  const sa = await call('POST', '/auth/login', { body: { email: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD } });
  if (!sa.json?.accessToken) {
    console.log('FAIL  super admin login', sa.status);
    process.exit(1);
  }
  const admin = { token: sa.json.accessToken, userId: sa.json.user.id, orgId: sa.json.user.organizationId, email: process.env.SUPER_ADMIN_EMAIL };
  let a; // tenant under test
  let b; // second tenant (isolation)
  await step('00 two tenants with verified owners', async () => {
    a = await createTenant('a');
    b = await createTenant('b');
    const p = await call('POST', '/projects', { token: a.token, body: { name: `Access ${R}`, description: 'tenant admin smoke', targetRelease: 'S4H_2023' } });
    expect(p.status === 201, `project ${p.status}`);
    a.projectId = p.json.id;
  });
  if (!a || !b) {
    console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(1);
  }

  // ---------------------------------------------------------------- impersonation
  let imp;
  await step('10 impersonation requires SUPER_ADMIN, a reason, <= 30 min and a USER target', async () => {
    expectStatus(await call('POST', '/admin/impersonations', { token: a.token, body: { organizationId: a.orgId, userId: a.userId, reason: 'owner tries' } }), 403, null, 'non-admin');
    expectStatus(await call('POST', '/admin/impersonations', { token: admin.token, body: { organizationId: a.orgId, userId: a.userId, reason: 'short' } }), 400, 'VALIDATION_FAILED', 'short reason');
    expectStatus(
      await call('POST', '/admin/impersonations', { token: admin.token, body: { organizationId: a.orgId, userId: a.userId, reason: 'Ticket 4711 reproduce', durationMinutes: 31 } }),
      400,
      'VALIDATION_FAILED',
      'duration 31'
    );
    expectStatus(
      await call('POST', '/admin/impersonations', { token: admin.token, body: { organizationId: admin.orgId, userId: admin.userId, reason: 'Impersonate myself?' } }),
      400,
      'IMPERSONATION_TARGET_NOT_ALLOWED',
      'self'
    );
    expectStatus(
      await call('POST', '/admin/impersonations', { token: admin.token, body: { organizationId: b.orgId, userId: a.userId, reason: 'Wrong organization test' } }),
      404,
      'IMPERSONATION_TARGET_NOT_FOUND',
      'non-member'
    );
    expectStatus(
      await call('POST', '/admin/impersonations', {
        token: admin.token,
        body: { organizationId: a.orgId, userId: a.userId, reason: 'Write mode without consent', mode: 'READ_WRITE' },
      }),
      403,
      'SUPPORT_GRANT_REQUIRED',
      'read-write without grant'
    );
  });

  await step('11 start read-only impersonation: distinct token, HttpOnly cookie, banner data', async () => {
    const res = await call('POST', '/admin/impersonations', {
      token: admin.token,
      body: { organizationId: a.orgId, userId: a.userId, reason: 'Support ticket: reproduce empty dashboard', durationMinutes: 5 },
    });
    expectStatus(res, 201, null, 'start');
    imp = { id: res.json.impersonation.id, token: res.json.accessToken };
    expect(imp.token, 'non-browser client receives the token in the body');
    const claims = JSON.parse(Buffer.from(imp.token.split('.')[1], 'base64url').toString());
    expect(claims.typ === 'impersonation' && claims.imp === imp.id && claims.act === admin.userId && claims.sub === a.userId, 'claims');
    expect(claims.exp - Math.floor(Date.now() / 1000) <= 5 * 60 + 5, 'exp bound to the session expiry');
    const setCookie = res.headers.get('set-cookie') || '';
    expect(/erppreflight_impersonation=/.test(setCookie) && /HttpOnly/i.test(setCookie), `cookie: ${setCookie.slice(0, 120)}`);
    const cur = await call('GET', '/impersonation/current', { token: imp.token });
    expect(cur.json?.active === true && cur.json.session.targetEmail === a.email && cur.json.session.mode === 'READ_ONLY', 'current');
    expect(cur.json.session.impersonatorEmail === admin.email, 'impersonator shown');
  });

  await step('12 impersonation reads tenant data as the member', async () => {
    const me = await call('GET', '/auth/me', { token: imp.token });
    expect(me.status === 200 && (me.json?.user?.email ?? me.json?.email) === a.email, `me ${me.status}`);
    const projects = await call('GET', '/projects', { token: imp.token });
    expect(projects.status === 200, `projects ${projects.status}`);
    const list = Array.isArray(projects.json) ? projects.json : projects.json?.items ?? [];
    expect(list.some((p) => p.id === a.projectId), 'tenant project visible');
    const status = await call('GET', '/tenant-access/status', { token: imp.token });
    expect(status.json?.impersonating === true && status.json.organizationId === a.orgId, 'status says impersonating');
  });

  await step('13 impersonation write -> 403 IMPERSONATION_READ_ONLY', async () => {
    expectStatus(await call('POST', '/projects', { token: imp.token, body: { name: 'Should not exist', targetRelease: 'S4H_2023' } }), 403, 'IMPERSONATION_READ_ONLY', 'create project');
    expectStatus(await call('DELETE', `/projects/${a.projectId}`, { token: imp.token }), 403, 'IMPERSONATION_READ_ONLY', 'delete project');
    expectStatus(await call('POST', '/billing/portal', { token: imp.token, body: {} }), 403, 'IMPERSONATION_READ_ONLY', 'billing mutation');
    const projects = await call('GET', '/projects', { token: a.token });
    const list = Array.isArray(projects.json) ? projects.json : projects.json?.items ?? [];
    expect(!list.some((p) => p.name === 'Should not exist'), 'nothing was written');
  });

  await step('14 secret endpoints -> 403 IMPERSONATION_SECRET_ACCESS_DENIED', async () => {
    for (const [method, p] of [
      ['GET', '/api-keys'],
      ['GET', '/auth/sessions'],
      ['GET', '/auth/2fa'],
      ['POST', '/auth/password/change'],
      ['GET', '/account/export'],
      ['GET', '/sso/admin/config'],
      ['GET', '/organizations/current/export'],
      ['GET', '/admin/overview'],
    ]) {
      expectStatus(await call(method, p, { token: imp.token, body: method === 'POST' ? {} : undefined }), 403, 'IMPERSONATION_SECRET_ACCESS_DENIED', `${method} ${p}`);
    }
  });

  await step('15 impersonation is bound to its tenant (X-Tenant-Id of another org -> 403)', async () => {
    expectStatus(await call('GET', '/projects', { token: imp.token, headers: { 'X-Tenant-Id': b.orgId } }), 403, 'IMPERSONATION_TENANT_MISMATCH', 'foreign tenant');
  });

  await step('16 the impersonation cookie overrides the operator session (browser semantics)', async () => {
    const me = await call('GET', '/auth/me', { token: admin.token, cookie: `erppreflight_impersonation=${imp.token}` });
    expect((me.json?.user?.email ?? me.json?.email) === a.email, 'cookie request acts as the member');
    expectStatus(await call('GET', '/admin/tenants', { token: admin.token, cookie: `erppreflight_impersonation=${imp.token}` }), 403, 'IMPERSONATION_SECRET_ACCESS_DENIED', 'admin API while impersonating');
  });

  await step('17 every impersonated request is in the tenant hash chain and the platform ledger', async () => {
    const events = await auditActions(a);
    const reqs = events.filter((e) => e.action === 'impersonation.request');
    const denied = events.filter((e) => e.action === 'impersonation.request.denied');
    expect(reqs.length >= 4, `tenant chain has ${reqs.length} impersonation.request events`);
    expect(denied.length >= 10, `tenant chain has ${denied.length} denied events`);
    const sample = reqs[0];
    const actor = sample.actorId ?? sample.actor_id;
    const payload = typeof sample.payload === 'string' ? JSON.parse(sample.payload) : sample.payload;
    expect(actor === admin.userId && payload.impersonationId === imp.id && payload.impersonatorEmail === admin.email, 'actor is the impersonator');
    expect(events.some((e) => e.action === 'impersonation.started'), 'start recorded');
    const verify = await call('GET', '/audit/verify', { token: a.token });
    expect(verify.json?.isValid === true, `chain valid: ${JSON.stringify(verify.json).slice(0, 160)}`);
    const ledger = await call('GET', `/admin/impersonations/${imp.id}/requests`, { token: admin.token });
    expect(ledger.status === 200 && ledger.json.events.length >= 14, `platform ledger ${ledger.json?.events?.length}`);
    expect(ledger.json.events.every((e) => e.actorId === admin.userId && e.impersonationId === imp.id), 'platform rows carry the impersonator');
    expect(ledger.json.session.requestCount >= 14, 'request counter');
  });

  await step('18 end revokes the token (401), ended cookie is cleared', async () => {
    const end = await call('POST', '/impersonation/end', { token: imp.token });
    expect(end.status === 200 && end.json.ended === true && end.json.returnOrganizationId === admin.orgId, `end ${end.status}`);
    expectStatus(await call('GET', '/projects', { token: imp.token }), 401, 'IMPERSONATION_ENDED', 'after end');
    const cur = await call('GET', '/impersonation/current', { cookie: `erppreflight_impersonation=${imp.token}` });
    expect(cur.json?.active === false && cur.json.ended?.code === 'IMPERSONATION_ENDED', 'current reports the end');
    expect(/erppreflight_impersonation=;/.test(cur.headers.get('set-cookie') || ''), 'cookie cleared');
    const list = await call('GET', `/admin/impersonations?organizationId=${a.orgId}`, { token: admin.token });
    expect(list.json.find((s) => s.id === imp.id)?.status === 'ENDED', 'listed as ENDED');
  });

  // ---------------------------------------------------------------- suspension
  await step('20 suspension requires SUPER_ADMIN and a reason', async () => {
    expectStatus(await call('POST', `/admin/tenants/${a.orgId}/suspend`, { token: a.token, body: { reason: 'I suspend myself now' } }), 403, null, 'owner');
    expectStatus(await call('POST', `/admin/tenants/${a.orgId}/suspend`, { token: admin.token, body: { reason: 'short' } }), 400, 'VALIDATION_FAILED', 'short reason');
  });

  await step('21 suspend -> members get 403 TENANT_SUSPENDED, owner e-mailed', async () => {
    const res = await call('POST', `/admin/tenants/${a.orgId}/suspend`, { token: admin.token, body: { reason: 'Unpaid invoices since 2026-07 (smoke test)' } });
    expectStatus(res, 200, null, 'suspend');
    expect(res.json.status === 'SUSPENDED' && res.json.ownersNotified === 1, 'suspended + 1 owner notified');
    expectStatus(await call('GET', '/projects', { token: a.token }), 403, 'TENANT_SUSPENDED', 'projects');
    expectStatus(await call('POST', '/projects', { token: a.token, body: { name: 'x', targetRelease: 'S4H_2023' } }), 403, 'TENANT_SUSPENDED', 'create');
    expectStatus(await call('POST', `/admin/tenants/${a.orgId}/suspend`, { token: admin.token, body: { reason: 'Second suspension attempt' } }), 409, 'TENANT_ALREADY_SUSPENDED', 'twice');
    const mail = await waitMail(a.email, 'TENANT_SUSPENDED');
    expect(/gesperrt/.test(mail[0].subject) && /suspended/.test(mail[0].subject), 'bilingual subject');
    expect(mail[0].text.includes('Unpaid invoices since 2026-07'), 'reason in mail');
  });

  await step('22 suspended: login, tenant status, GDPR export still work', async () => {
    const login = await call('POST', '/auth/login', { body: { email: a.email, password: PASSWORD } });
    expect(login.status === 200 && login.json.user.organizationId === a.orgId, `login ${login.status}`);
    a.token = login.json.accessToken;
    const status = await call('GET', '/tenant-access/status', { token: a.token });
    expect(status.json?.suspended === true && /Unpaid invoices/.test(status.json.suspensionReason), 'status');
    const exp = await fetch(`${A}/account/export`, { headers: { Authorization: `Bearer ${a.token}` } });
    expect(exp.status === 200, `account export ${exp.status}`);
    const orgs = await call('GET', '/organizations', { token: a.token });
    expect(orgs.status === 200, `organization list ${orgs.status}`);
  });

  await step('23 queued job of a suspended tenant is not processed', async () => {
    if (!process.env.REDIS_URL) {
      console.log('      (REDIS_URL not set: queue check skipped; covered by apps/api/test/tenant_access.spec.ts)');
      return;
    }
    const { Queue } = require(require.resolve('bullmq', { paths: [path.join(__dirname, '../apps/api')] }));
    const url = new URL(process.env.REDIS_URL);
    const queue = new Queue('analysis-queue', {
      connection: { host: url.hostname, port: Number(url.port || 6379), db: Number(url.pathname.slice(1) || 0), password: url.password || undefined },
    });
    // A probe job of the suspended tenant: the worker must park it (delayed) without running it.
    const job = await queue.add('smoke-suspended-probe', {
      analysisId: '00000000-0000-4000-8000-000000000000',
      organizationId: a.orgId,
      projectId: a.projectId,
      userId: a.userId,
      engineTypes: ['OPD_GUARD'],
      targetRelease: 'S4H_2023',
      files: [],
    });
    let state = 'unknown';
    for (let i = 0; i < 30; i++) {
      state = await job.getState();
      if (state === 'delayed') break;
      await sleep(300);
    }
    const fresh = await queue.getJob(job.id);
    const attempts = fresh?.attemptsMade ?? -1;
    await fresh?.remove().catch(() => undefined);
    await queue.close();
    expect(state === 'delayed' && attempts === 0, `job state ${state}, attempts ${attempts} (expected delayed, 0)`);
  });

  await step('24 unsuspend restores access; owner e-mailed; both actions in the tenant ledger', async () => {
    const res = await call('POST', `/admin/tenants/${a.orgId}/unsuspend`, { token: admin.token, body: { reason: 'Invoices paid on 2026-09-26' } });
    expectStatus(res, 200, null, 'unsuspend');
    expect((await call('GET', '/projects', { token: a.token })).status === 200, 'access restored');
    expectStatus(await call('POST', `/admin/tenants/${a.orgId}/unsuspend`, { token: admin.token, body: { reason: 'Not suspended any more' } }), 409, 'TENANT_NOT_SUSPENDED', 'twice');
    await waitMail(a.email, 'TENANT_REACTIVATED');
    const events = await auditActions(a);
    for (const action of ['admin.tenant.suspended', 'admin.tenant.reactivated']) {
      const e = events.find((x) => x.action === action);
      expect(e && (e.actorId ?? e.actor_id) === admin.userId, `${action} in the tenant ledger with the operator`);
    }
    const ledger = await call('GET', `/admin/tenants/${a.orgId}/platform-audit`, { token: admin.token });
    expect(['tenant.suspended', 'tenant.reactivated'].every((x) => ledger.json.some((e) => e.action === x)), 'platform ledger');
  });

  // ---------------------------------------------------------------- trial extension
  await step('30 trial extension: bounded to 90 days, reflected in entitlements at once', async () => {
    const before = await call('GET', `/admin/tenants/${a.orgId}/access`, { token: admin.token });
    expect(before.status === 200 && before.json.trial.extendable === true && before.json.trial.endsAt, 'trial extendable');
    const oldEnd = new Date(before.json.trial.endsAt).getTime();
    expectStatus(await call('POST', `/admin/tenants/${a.orgId}/trial-extension`, { token: admin.token, body: { days: 0, reason: 'Pilot extended by sales' } }), 400, 'VALIDATION_FAILED', 'days 0');
    expectStatus(await call('POST', `/admin/tenants/${a.orgId}/trial-extension`, { token: admin.token, body: { days: 91, reason: 'Pilot extended by sales' } }), 400, 'VALIDATION_FAILED', 'days 91');
    expectStatus(await call('POST', `/admin/tenants/${a.orgId}/trial-extension`, { token: a.token, body: { days: 5, reason: 'Pilot extended by myself' } }), 403, null, 'owner');
    const ext = await call('POST', `/admin/tenants/${a.orgId}/trial-extension`, { token: admin.token, body: { days: 10, reason: 'Pilot extended by sales (smoke)' } });
    expectStatus(ext, 200, null, 'extend 10');
    const newEnd = new Date(ext.json.trialEndsAt).getTime();
    expect(Math.round((newEnd - oldEnd) / 86_400_000) === 10, `end moved by ${(newEnd - oldEnd) / 86_400_000} days`);
    expect(ext.json.trialExtendedDays === 10, 'cumulative 10');
    const overview = await call('GET', '/billing/overview', { token: a.token });
    const trialEnd = overview.json?.trial?.endsAt ?? overview.json?.usage?.trial?.endsAt;
    expect(trialEnd && new Date(trialEnd).getTime() === newEnd, `billing overview shows the new end (${trialEnd})`);
    expectStatus(await call('POST', `/admin/tenants/${a.orgId}/trial-extension`, { token: admin.token, body: { days: 85, reason: 'Too long extension attempt' } }), 422, 'TRIAL_EXTENSION_LIMIT', 'beyond 90');
    const mail = await waitMail(a.email, 'TRIAL_EXTENDED');
    expect(/verlängert/.test(mail[0].text) && /extended by 10 days/.test(mail[0].text), 'bilingual mail');
    const events = await auditActions(a);
    expect(events.some((e) => e.action === 'admin.tenant.trial_extended'), 'tenant ledger');
  });

  // ---------------------------------------------------------------- IP allowlist
  let clientIp = null;
  await step('40 IP allowlist is an Enterprise feature (403 PLAN_FEATURE_REQUIRED)', async () => {
    const view = await call('GET', '/organizations/current/ip-allowlist', { token: a.token });
    expect(view.status === 200 && view.json.featureAvailable === false && view.json.enforced === false, `view ${view.status}`);
    clientIp = view.json.clientIp;
    expect(clientIp, 'API reports the client address');
    expectStatus(await call('PUT', '/organizations/current/ip-allowlist', { token: a.token, body: { entries: [{ cidr: '10.0.0.0/8' }] } }), 403, 'PLAN_FEATURE_REQUIRED', 'not entitled');
    expectStatus(await call('PATCH', `/admin/tenants/${a.orgId}/plan`, { token: admin.token, body: { planTier: 'ENTERPRISE' } }), 200, null, 'plan ENTERPRISE');
  });

  await step('41 validation: CIDR syntax, host bits, /0, duplicates, max 50 entries', async () => {
    for (const bad of ['10.0.0.5/24', 'not-an-ip', '0.0.0.0/0', '2001:db8::/129']) {
      expectStatus(await call('PUT', '/organizations/current/ip-allowlist', { token: a.token, body: { entries: [{ cidr: bad }] } }), 400, 'IP_ALLOWLIST_INVALID', bad);
    }
    expectStatus(
      await call('PUT', '/organizations/current/ip-allowlist', { token: a.token, body: { entries: [{ cidr: '10.0.0.0/8' }, { cidr: '10.0.0.0/8' }] } }),
      400,
      'IP_ALLOWLIST_INVALID',
      'duplicate'
    );
    const many = Array.from({ length: 51 }, (_, i) => ({ cidr: `10.${i}.0.0/16` }));
    expectStatus(await call('PUT', '/organizations/current/ip-allowlist', { token: a.token, body: { entries: many } }), 400, 'VALIDATION_FAILED', '51 entries');
  });

  await step('42 lockout protection: a list without the caller -> 409 unless confirmed', async () => {
    const res = await call('PUT', '/organizations/current/ip-allowlist', { token: a.token, body: { entries: [{ cidr: '203.0.113.0/24' }] } });
    expectStatus(res, 409, 'IP_ALLOWLIST_LOCKOUT', 'lockout');
    expect(res.json.details?.clientIp === clientIp, 'caller address reported');
    expect((await call('GET', '/projects', { token: a.token })).status === 200, 'nothing saved');
  });

  await step('43 allowlist containing the caller (IPv4 + IPv6) keeps access', async () => {
    const res = await call('PUT', '/organizations/current/ip-allowlist', {
      token: a.token,
      body: { entries: [{ cidr: '127.0.0.1', label: 'loopback v4' }, { cidr: '::1/128', label: 'loopback v6' }, { cidr: '2001:DB8:0:0::/32', label: 'docs' }] },
    });
    expectStatus(res, 200, null, 'save');
    expect(res.json.enforced === true && res.json.clientIpAllowed === true, 'enforced, caller allowed');
    expect(res.json.entries.map((e) => e.cidr).includes('2001:db8::/32'), 'IPv6 canonicalised');
    expect((await call('GET', '/projects', { token: a.token })).status === 200, 'access kept');
  });

  await step('44 blocked IP -> 403 IP_NOT_ALLOWED (also API keys, spoofed X-Forwarded-For ignored)', async () => {
    const key = await call('POST', '/api-keys', { token: a.token, body: { name: `allowlist probe ${R}`, scopes: ['projects:read'] } });
    expect(key.status === 201 && key.json.apiKey, `api key ${key.status}`);
    const res = await call('PUT', '/organizations/current/ip-allowlist', {
      token: a.token,
      body: { entries: [{ cidr: '198.51.100.0/24', label: 'office' }], confirmLockout: true },
    });
    expectStatus(res, 200, null, 'confirmed lockout save');
    expect(res.json.lockoutConfirmed === true, 'lockout flagged');
    expectStatus(await call('GET', '/projects', { token: a.token }), 403, 'IP_NOT_ALLOWED', 'projects');
    expectStatus(await call('GET', '/projects', { headers: { 'X-Api-Key': key.json.apiKey } }), 403, 'IP_NOT_ALLOWED', 'api key');
    // The client address follows the API's TRUST_PROXY setting. Behind a trusted proxy hop the
    // forwarded address counts (inside the list -> allowed, outside -> blocked); without one a
    // forged X-Forwarded-For must not unlock access.
    const probe = await call('GET', '/tenant-access/status', { token: a.token, headers: { 'X-Forwarded-For': '203.0.113.9' } });
    const proxied = probe.json?.ipAllowlist?.clientIp === '203.0.113.9';
    console.log(`      (API ${proxied ? 'trusts' : 'does not trust'} X-Forwarded-For from this peer, TRUST_PROXY)`);
    expectStatus(await call('GET', '/projects', { token: a.token, headers: { 'X-Forwarded-For': '203.0.113.9' } }), 403, 'IP_NOT_ALLOWED', 'XFF outside the list');
    const inside = await call('GET', '/projects', { token: a.token, headers: { 'X-Forwarded-For': '198.51.100.10' } });
    if (proxied) expectStatus(inside, 200, null, 'forwarded address inside the list (trusted proxy)');
    else expectStatus(inside, 403, 'IP_NOT_ALLOWED', 'forged XFF without trusted proxy');
    expectStatus(await call('GET', '/organizations/current/ip-allowlist', { token: a.token }), 403, 'IP_NOT_ALLOWED', 'allowlist itself');
    const status = await call('GET', '/tenant-access/status', { token: a.token });
    expect(status.status === 200 && status.json.ipAllowlist.clientIpAllowed === false, 'status explains the block');
    const me = await call('GET', '/auth/me', { token: a.token });
    expect(me.status === 200, 'auth/me still reachable');
    expectStatus(await call('GET', '/projects', { token: b.token }), 200, null, 'other tenant unaffected');
  });

  await step('45 super-admin break-glass clears the allowlist; tenant ledger records it', async () => {
    expectStatus(await call('POST', `/admin/tenants/${a.orgId}/ip-allowlist/clear`, { token: admin.token, body: { reason: 'short' } }), 400, 'VALIDATION_FAILED', 'reason');
    const res = await call('POST', `/admin/tenants/${a.orgId}/ip-allowlist/clear`, { token: admin.token, body: { reason: 'Customer locked out, ticket 815' } });
    expect(res.status === 200 && res.json.removed === 1, `clear ${res.status}`);
    expect((await call('GET', '/projects', { token: a.token })).status === 200, 'access restored');
    const events = await auditActions(a);
    for (const action of ['organization.ip_allowlist.updated', 'admin.tenant.ip_allowlist_cleared']) {
      expect(events.some((e) => e.action === action), `${action} in ledger`);
    }
    const again = await call('PUT', '/organizations/current/ip-allowlist', { token: a.token, body: { entries: [{ cidr: '127.0.0.0/8' }, { cidr: '::1' }] } });
    expectStatus(again, 200, null, 're-save');
    const del = await call('DELETE', '/organizations/current/ip-allowlist', { token: a.token });
    expect(del.status === 200 && del.json.removed === 2, 'owner removes the list');
  });

  // ---------------------------------------------------------------- support ticket e-mails
  let ticketId = null;
  let inbox = null;
  await step('50 ticket created -> e-mails to requester (ticket language) and support inbox', async () => {
    const cfg = await call('GET', '/admin/support/config', { token: admin.token });
    expect(cfg.status === 200, `support config ${cfg.status}`);
    inbox = cfg.json.inboxConfigured ? cfg.json.inboxEmail : null;
    if (!inbox) console.log('      (SUPPORT_INBOX_EMAIL not configured on this API: inbox e-mails not checked)');
    const res = await call('POST', '/support/tickets', {
      token: a.token,
      body: { subject: `Dashboard leer ${R}`, description: 'Nach dem Upload bleibt das Dashboard leer.', category: 'BUG', locale: 'de' },
    });
    expectStatus(res, 201, null, 'create');
    ticketId = res.json.id;
    expect(res.json.locale === 'de', 'ticket language stored');
    const mine = await waitMail(a.email, 'SUPPORT_TICKET_CREATED', { match: (m) => m.subject.includes(R) });
    expect(/Eingangsbestätigung/.test(mine[0].subject), `German requester subject: ${mine[0].subject}`);
    if (inbox) await waitMail(inbox, 'SUPPORT_TICKET_CREATED', { match: (m) => m.subject.includes(R) });
  });

  await step('51 support reply + status change -> requester and inbox e-mailed', async () => {
    const res = await call('POST', `/admin/support/tickets/${ticketId}/messages`, {
      token: admin.token,
      body: { body: 'Bitte laden Sie die Datei erneut hoch.', status: 'WAITING_ON_CUSTOMER' },
    });
    expectStatus(res, 201, null, 'support reply');
    expect(res.json.statusChange?.to === 'WAITING_ON_CUSTOMER', 'status changed');
    const reply = await waitMail(a.email, 'SUPPORT_TICKET_REPLY', { match: (m) => m.subject.includes(R) });
    expect(reply[0].text.includes('Bitte laden Sie die Datei erneut hoch.'), 'reply text');
    const statusMail = await waitMail(a.email, 'SUPPORT_TICKET_STATUS_CHANGED', { match: (m) => m.subject.includes(R) });
    expect(/Wartet auf Ihre Antwort/.test(statusMail[0].text), 'German status label');
    if (inbox) {
      await waitMail(inbox, 'SUPPORT_TICKET_REPLY', { match: (m) => m.subject.includes(R) });
      await waitMail(inbox, 'SUPPORT_TICKET_STATUS_CHANGED', { match: (m) => m.subject.includes(R) });
    }
  });

  await step('52 customer reply -> inbox e-mailed, not the author; ticket re-opened', async () => {
    const res = await call('POST', `/support/tickets/${ticketId}/messages`, { token: a.token, body: { body: 'Erneut hochgeladen, leider gleiches Ergebnis.' } });
    expectStatus(res, 201, null, 'customer reply');
    if (inbox) await waitMail(inbox, 'SUPPORT_TICKET_REPLY', { count: 2, match: (m) => m.subject.includes(R) });
    await sleep(1000);
    const own = (await mails(a.email)).filter((m) => m.template === 'SUPPORT_TICKET_REPLY' && m.subject.includes(R));
    expect(own.length === 1, `author received ${own.length} reply mails (expected only the support reply)`);
    const thread = await call('GET', `/support/tickets/${ticketId}/messages`, { token: a.token });
    expect(thread.status === 200 && thread.json.length === 2 && thread.json[0].authorRole === 'SUPPORT', 'thread');
    const tickets = await call('GET', '/support/tickets', { token: a.token });
    expect(tickets.json.find((t) => t.id === ticketId)?.status === 'OPEN', 'customer answer re-opens the ticket');
  });

  await step('53 status change -> e-mails; other tenants cannot read the thread', async () => {
    const res = await call('PATCH', `/admin/support/tickets/${ticketId}`, { token: admin.token, body: { status: 'RESOLVED' } });
    expectStatus(res, 200, null, 'status');
    await waitMail(a.email, 'SUPPORT_TICKET_STATUS_CHANGED', { count: 2, match: (m) => m.subject.includes(R) });
    expectStatus(await call('GET', `/support/tickets/${ticketId}/messages`, { token: b.token }), 404, null, 'cross-tenant thread');
    expectStatus(await call('POST', `/support/tickets/${ticketId}/messages`, { token: b.token, body: { body: 'hijack' } }), 404, null, 'cross-tenant reply');
    const events = await auditActions(a);
    for (const action of ['support.ticket.created', 'support.ticket.replied', 'support.ticket.status_changed']) {
      expect(events.some((e) => e.action === action), `${action} in ledger`);
    }
  });

  // ---------------------------------------------------------------- browser
  if (WEB) {
    await require('./e2e-tenant-admin-ui.cjs').run({ A, API, WEB, SHOTS, admin, a, b, R, PASSWORD, step, call, waitMail, expect, expectStatus });
  } else {
    console.log('      (WEB_URL not set: browser checks skipped)');
  }

  // ---------------------------------------------------------------- expiry (last)
  // Started after the browser checks (a new impersonation by the same operator supersedes an
  // open one), checked >= 61 s later.
  let expiring = null;
  await step('89 start a 1-minute impersonation (expiry checked below)', async () => {
    const res = await call('POST', '/admin/impersonations', {
      token: admin.token,
      body: { organizationId: b.orgId, userId: b.userId, reason: 'Expiry check of the live suite', durationMinutes: 1 },
    });
    expectStatus(res, 201, null, 'start');
    expiring = { id: res.json.impersonation.id, token: res.json.accessToken, startedAt: Date.now() };
    expect((await call('GET', '/projects', { token: expiring.token })).status === 200, 'usable before expiry');
  });

  await step('90 expired impersonation -> 401 IMPERSONATION_EXPIRED', async () => {
    expect(expiring, 'expiring session was started');
    const wait = expiring.startedAt + 62_000 - Date.now();
    if (wait > 0) {
      console.log(`      waiting ${Math.ceil(wait / 1000)} s for the 1-minute impersonation to expire`);
      await sleep(wait);
    }
    expectStatus(await call('GET', '/projects', { token: expiring.token }), 401, 'IMPERSONATION_EXPIRED', 'after expiry');
    const list = await call('GET', `/admin/impersonations?organizationId=${b.orgId}`, { token: admin.token });
    expect(list.json.find((s) => s.id === expiring.id)?.status === 'EXPIRED', 'listed as EXPIRED');
    const events = await auditActions(b);
    expect(events.some((e) => e.action === 'impersonation.expired'), 'expiry in the tenant ledger');
  });

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
