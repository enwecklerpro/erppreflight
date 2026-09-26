import { describe, it, expect, vi } from 'vitest';
import { ConflictException, ForbiddenException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DelayedError } from 'bullmq';
import { anyCidrContains, cidrContains, CidrError, normalizeIp, parseCidr } from '../src/modules/tenant-access/cidr';
import { clientIpOf } from '../src/modules/tenant-access/client-ip';
import { apiPath, decideMachineAccess, decideTenantAccess, isSuspensionExemptPath } from '../src/modules/tenant-access/tenant-access.policy';
import { decideImpersonationRequest } from '../src/modules/tenant-access/impersonation.policy';
import {
  IMPERSONATION_COOKIE_NAME,
  impersonationCookieOptions,
  isBrowserRequest,
  presentedImpersonationToken,
} from '../src/modules/tenant-access/impersonation-token';
import { gateJobForSuspendedTenant } from '../src/modules/tenant-access/suspended-jobs';
import { ImpersonationService, StartImpersonationSchema } from '../src/modules/tenant-access/impersonation.service';
import { IpAllowlistReplaceSchema, IpAllowlistService } from '../src/modules/tenant-access/ip-allowlist.service';
import { ExtendTrialSchema, SuspendTenantSchema, TenantAdminService } from '../src/modules/tenant-access/tenant-admin.service';
import { TenancyMiddleware } from '../src/modules/tenancy/tenancy.middleware';
import { ImpersonationMiddleware } from '../src/modules/tenant-access/impersonation.middleware';
import { ScimService } from '../src/modules/sso/scim.service';
import { SupportMailService } from '../src/modules/support/support-mail.service';
import { resolveTicketLocale } from '../src/modules/support/support-thread.service';
import {
  renderTenantSuspended,
  renderTicketCreated,
  renderTicketStatusChanged,
  renderTrialExtended,
} from '../src/modules/mail/operations.templates';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789abcdef-0123456789';
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMBER = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';

const config = { get: (k: string) => (k === 'JWT_SECRET' ? JWT_SECRET : undefined), getOrThrow: () => JWT_SECRET } as any;

// ---------------------------------------------------------------------------- CIDR

describe('cidr helpers (IP allowlist)', () => {
  it('canonicalises IPv4 and IPv6 entries; a bare address is a host entry', () => {
    expect(parseCidr('203.0.113.0/24').cidr).toBe('203.0.113.0/24');
    expect(parseCidr('198.51.100.7').cidr).toBe('198.51.100.7/32');
    expect(parseCidr('2001:DB8:0:0::/32').cidr).toBe('2001:db8::/32');
    expect(parseCidr('::1').cidr).toBe('::1/128');
    // IPv4-mapped IPv6 ranges are stored as the equivalent IPv4 range.
    expect(parseCidr('::ffff:10.0.0.0/104')).toMatchObject({ cidr: '10.0.0.0/8', family: 4 });
  });

  it('rejects host bits, /0, bad prefixes, zone ids and garbage', () => {
    expect(() => parseCidr('10.0.0.5/24')).toThrow(/network address 10\.0\.0\.0\/24/);
    expect(() => parseCidr('0.0.0.0/0')).toThrow(CidrError);
    expect(() => parseCidr('::/0')).toThrow(/every address/);
    expect(() => parseCidr('10.0.0.0/33')).toThrow(/at most 32/);
    expect(() => parseCidr('2001:db8::/129')).toThrow(/at most 128/);
    expect(() => parseCidr('fe80::1%eth0')).toThrow(/Zone/);
    expect(() => parseCidr('not-an-ip')).toThrow(CidrError);
    expect(() => parseCidr('10.0.0.0/2a')).toThrow(/prefix/);
    expect(() => parseCidr('')).toThrow(CidrError);
  });

  it('containment honours the family and IPv4-mapped peers', () => {
    const office = parseCidr('198.51.100.0/24');
    expect(cidrContains(office, '198.51.100.200')).toBe(true);
    expect(cidrContains(office, '::ffff:198.51.100.9')).toBe(true);
    expect(cidrContains(office, '198.51.101.1')).toBe(false);
    expect(cidrContains(parseCidr('2001:db8::/32'), '2001:db8:1::5')).toBe(true);
    expect(cidrContains(parseCidr('2001:db8::/32'), '2001:db9::5')).toBe(false);
    expect(cidrContains(office, null)).toBe(false);
    expect(anyCidrContains([], '198.51.100.1')).toBe(false);
  });

  it('normalizes client addresses', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('[2001:0db8::0001]')).toBe('2001:db8::1');
    expect(normalizeIp('fe80::1%lo0')).toBe('fe80::1');
    expect(normalizeIp('nonsense')).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });

  it('client address comes from Express req.ip (trust proxy), never raw X-Forwarded-For', () => {
    const req = { ip: '::ffff:192.0.2.10', headers: { 'x-forwarded-for': '198.51.100.1' }, socket: { remoteAddress: '192.0.2.10' } };
    expect(clientIpOf(req)).toBe('192.0.2.10');
    expect(clientIpOf({ headers: { 'x-forwarded-for': '198.51.100.1' }, socket: { remoteAddress: '::1' } })).toBe('::1');
  });
});

// ---------------------------------------------------------------------------- tenant access policy

describe('tenant access policy (suspension, IP allowlist)', () => {
  const active = { status: 'ACTIVE', allowlistCount: 0, ipAllowed: false };
  const suspended = { status: 'SUSPENDED', allowlistCount: 0, ipAllowed: false };
  const member = (path: string, method = 'GET') => ({ path, method, systemRole: 'USER', clientIp: '192.0.2.1' });

  it('strips the API prefix and query', () => {
    expect(apiPath('/api/v1/projects?x=1')).toBe('/projects');
    expect(apiPath('/api/v1//support/tickets/')).toBe('/support/tickets');
    expect(apiPath('/api/v1')).toBe('/');
  });

  it('folds letter case like the Express router does (case-insensitive routing)', () => {
    expect(apiPath('/api/v1/API-KEYS')).toBe('/api-keys');
    expect(apiPath('/API/V1/Account/Export?x=1')).toBe('/account/export');
    expect(apiPath('//api/v1//Organizations/current/export/')).toBe('/organizations/current/export');
  });

  it('machine credentials (agent devices, SCIM) stop while suspended; agents honour the allowlist', () => {
    const list = { status: 'ACTIVE', allowlistCount: 1, ipAllowed: false };
    expect(decideMachineAccess(suspended, { ipAllowlist: false, clientIp: null })?.code).toBe('TENANT_SUSPENDED');
    expect(decideMachineAccess(active, { ipAllowlist: true, clientIp: '192.0.2.1' })).toBeNull();
    expect(decideMachineAccess(list, { ipAllowlist: true, clientIp: '192.0.2.1' })?.code).toBe('IP_NOT_ALLOWED');
    expect(decideMachineAccess(list, { ipAllowlist: false, clientIp: null })).toBeNull();
    expect(decideMachineAccess({ ...list, ipAllowed: true }, { ipAllowlist: true, clientIp: '192.0.2.1' })).toBeNull();
  });

  it('members of a suspended tenant get TENANT_SUSPENDED on tenant routes', () => {
    expect(decideTenantAccess(suspended, member('/projects'))?.code).toBe('TENANT_SUSPENDED');
    expect(decideTenantAccess(suspended, member('/projects', 'POST'))?.code).toBe('TENANT_SUSPENDED');
    expect(decideTenantAccess(active, member('/projects'))).toBeNull();
  });

  it('sign-in, account (GDPR export), org list, status and support stay reachable while suspended', () => {
    for (const [p, m] of [
      ['/auth/me', 'GET'],
      ['/account/export', 'GET'],
      ['/organizations', 'GET'],
      ['/tenant-access/status', 'GET'],
      ['/support/tickets', 'POST'],
      ['/impersonation/current', 'GET'],
    ] as const) {
      expect(isSuspensionExemptPath(p, m)).toBe(true);
      expect(decideTenantAccess(suspended, member(p, m))).toBeNull();
    }
    expect(isSuspensionExemptPath('/organizations', 'POST')).toBe(false);
    expect(isSuspensionExemptPath('/support/access-grants', 'POST')).toBe(false);
  });

  it('operators (SUPER_ADMIN, impersonation) may inspect a suspended tenant', () => {
    expect(decideTenantAccess(suspended, { ...member('/projects'), systemRole: 'SUPER_ADMIN' })).toBeNull();
    expect(decideTenantAccess(suspended, { ...member('/projects'), impersonating: true })).toBeNull();
  });

  it('a non-empty allowlist blocks other addresses for everybody (IP_NOT_ALLOWED)', () => {
    const list = { status: 'ACTIVE', allowlistCount: 2, ipAllowed: false };
    expect(decideTenantAccess(list, member('/projects'))?.code).toBe('IP_NOT_ALLOWED');
    expect(decideTenantAccess(list, { ...member('/projects'), systemRole: 'SUPER_ADMIN' })?.code).toBe('IP_NOT_ALLOWED');
    expect(decideTenantAccess(list, member('/account/export'))?.code).toBe('IP_NOT_ALLOWED');
    expect(decideTenantAccess(list, member('/auth/me'))).toBeNull();
    expect(decideTenantAccess(list, member('/tenant-access/status'))).toBeNull();
    expect(decideTenantAccess({ ...list, ipAllowed: true }, member('/projects'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------- impersonation policy

describe('impersonation policy', () => {
  it('reads are allowed, writes refused in read-only mode', () => {
    expect(decideImpersonationRequest('GET', '/projects', true)).toEqual({ allowed: true });
    expect(decideImpersonationRequest('POST', '/projects', true)).toMatchObject({ allowed: false, code: 'IMPERSONATION_READ_ONLY' });
    expect(decideImpersonationRequest('DELETE', '/projects/x', true)).toMatchObject({ code: 'IMPERSONATION_READ_ONLY' });
  });

  it('secrets are never reachable, whatever the mode or method', () => {
    for (const [m, p] of [
      ['GET', '/api-keys'],
      ['GET', '/auth/sessions'],
      ['POST', '/auth/password/change'],
      ['GET', '/account/export'],
      ['GET', '/sso/admin/config'],
      ['POST', '/webhooks/abc/rotate-secret'],
      ['GET', '/agents/signing-key'],
      ['GET', '/organizations/current/export'],
      ['GET', '/admin/overview'],
      ['GET', '/landscapes/x/credentials'],
      ['GET', '/connectors/x/secret'],
    ] as const) {
      expect(decideImpersonationRequest(m, p, false)).toMatchObject({ allowed: false, code: 'IMPERSONATION_SECRET_ACCESS_DENIED' });
    }
  });

  it('letter case never bypasses the deny lists (Express routes case-insensitively)', () => {
    for (const p of ['/API-KEYS', '/Auth/sessions', '/Account/export', '/Organizations/current/export', '/SSO/Admin/scim-tokens', '/Admin/overview']) {
      expect(decideImpersonationRequest('GET', p, false)).toMatchObject({ allowed: false, code: 'IMPERSONATION_SECRET_ACCESS_DENIED' });
      expect(decideImpersonationRequest('GET', apiPath(`/api/v1${p}`), false)).toMatchObject({ allowed: false });
    }
    expect(decideImpersonationRequest('POST', '/Billing/portal', false)).toMatchObject({ allowed: false });
  });

  it('identity reads and session control stay available', () => {
    expect(decideImpersonationRequest('GET', '/auth/me', true)).toEqual({ allowed: true });
    expect(decideImpersonationRequest('POST', '/impersonation/end', true)).toEqual({ allowed: true });
    expect(decideImpersonationRequest('POST', '/auth/logout', true)).toEqual({ allowed: true });
  });

  it('read-write mode still refuses billing, membership, allowlist and credential writes', () => {
    expect(decideImpersonationRequest('POST', '/projects', false)).toEqual({ allowed: true });
    for (const p of [
      '/billing/portal',
      '/organizations/members/x',
      '/organizations/current/ip-allowlist',
      '/support/access-grants',
      '/connectors/x',
      '/agents/devices/x/revoke',
      '/invitations/accept',
      '/retention/purge',
      '/retention/settings',
    ]) {
      expect(decideImpersonationRequest('POST', p, false)).toMatchObject({ allowed: false, code: 'IMPERSONATION_SECRET_ACCESS_DENIED' });
    }
  });
});

// ---------------------------------------------------------------------------- token transport

describe('impersonation token transport', () => {
  const jwt = new JwtService({ secret: JWT_SECRET });
  const impToken = jwt.sign({ typ: 'impersonation', sub: MEMBER, imp: SESSION });
  const sessionToken = jwt.sign({ sub: MEMBER });

  it('the HttpOnly cookie takes precedence; Bearer only when typ=impersonation', () => {
    expect(presentedImpersonationToken({ headers: { cookie: `a=1; ${IMPERSONATION_COOKIE_NAME}=${impToken}`, authorization: `Bearer ${sessionToken}` } })).toEqual({
      token: impToken,
      source: 'cookie',
    });
    expect(presentedImpersonationToken({ headers: { authorization: `Bearer ${impToken}` } })).toEqual({ token: impToken, source: 'bearer' });
    expect(presentedImpersonationToken({ headers: { authorization: `Bearer ${sessionToken}` } })).toBeNull();
    expect(presentedImpersonationToken({ headers: {} })).toBeNull();
  });

  it('cookie attributes follow the session cookie policy', () => {
    expect(impersonationCookieOptions({ NODE_ENV: 'production' } as any)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(impersonationCookieOptions({ SESSION_COOKIE_SAMESITE: 'none', SESSION_COOKIE_SECURE: 'false' } as any)).toMatchObject({ secure: true, sameSite: 'none' });
    expect(impersonationCookieOptions({ SESSION_COOKIE_DOMAIN: 'evil domain' } as any).domain).toBeUndefined();
  });

  it('browser detection uses forbidden headers only', () => {
    expect(isBrowserRequest({ headers: { origin: 'http://localhost:3000' } })).toBe(true);
    expect(isBrowserRequest({ headers: { 'sec-fetch-site': 'same-site' } })).toBe(true);
    expect(isBrowserRequest({ headers: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------------------- queue gate

describe('queued jobs of suspended tenants', () => {
  const logger = { warn: vi.fn() };
  const job = () => ({ id: 'j1', name: 'analysis', moveToDelayed: vi.fn().mockResolvedValue(undefined) });

  it('runs jobs of active tenants and jobs without tenant', async () => {
    expect(await gateJobForSuspendedTenant(job(), 't', ORG, { isSuspended: async () => false }, logger)).toBe('run');
    expect(await gateJobForSuspendedTenant(job(), 't', undefined, { isSuspended: async () => true }, logger)).toBe('run');
  });

  it('skips repeatable firings of suspended tenants', async () => {
    expect(await gateJobForSuspendedTenant(job(), 't', ORG, { isSuspended: async () => true }, logger, { repeatable: true })).toBe('skip');
  });

  it('parks one-off jobs (moved to delayed, attempt not consumed)', async () => {
    const j = job();
    await expect(gateJobForSuspendedTenant(j, 'lock-token', ORG, { isSuspended: async () => true }, logger)).rejects.toBeInstanceOf(DelayedError);
    expect(j.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'lock-token');
  });

  it('without a lock token the job fails instead of running', async () => {
    await expect(gateJobForSuspendedTenant(job(), undefined, ORG, { isSuspended: async () => true }, logger)).rejects.toThrow(/TENANT_SUSPENDED/);
  });
});

// ---------------------------------------------------------------------------- DTOs

describe('admin action DTOs', () => {
  it('require a reason of at least 10 characters and bound the numbers', () => {
    expect(SuspendTenantSchema.safeParse({ reason: 'short' }).success).toBe(false);
    expect(SuspendTenantSchema.safeParse({ reason: 'Unpaid invoices since July' }).success).toBe(true);
    expect(SuspendTenantSchema.safeParse({ reason: 'Unpaid invoices since July', extra: 1 }).success).toBe(false);
    expect(ExtendTrialSchema.safeParse({ days: 0, reason: 'Pilot extended by sales' }).success).toBe(false);
    expect(ExtendTrialSchema.safeParse({ days: 91, reason: 'Pilot extended by sales' }).success).toBe(false);
    expect(ExtendTrialSchema.safeParse({ days: 30, reason: 'Pilot extended by sales' }).success).toBe(true);
    const imp = StartImpersonationSchema.safeParse({ organizationId: ORG, userId: MEMBER, reason: 'Ticket 4711 reproduce' });
    expect(imp.success && imp.data.durationMinutes === 15 && imp.data.mode === 'READ_ONLY').toBe(true);
    expect(StartImpersonationSchema.safeParse({ organizationId: ORG, userId: MEMBER, reason: 'Ticket 4711 reproduce', durationMinutes: 31 }).success).toBe(false);
    expect(IpAllowlistReplaceSchema.safeParse({ entries: Array.from({ length: 51 }, () => ({ cidr: '10.0.0.0/8' })) }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------- IP allowlist service

describe('IpAllowlistService', () => {
  it('rejects duplicates after canonicalisation with IP_ALLOWLIST_INVALID', () => {
    expect(() => IpAllowlistService.validateEntries([{ cidr: '2001:DB8::/32' }, { cidr: '2001:db8:0::/32' }])).toThrow(/listed twice/);
    expect(() => IpAllowlistService.validateEntries([{ cidr: '10.0.0.5/24' }])).toThrow(/host bits/);
  });

  it('lockout protection: a list excluding the caller is refused unless confirmed', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      withTenantTransaction: vi.fn(async (_t: string, fn: any) => fn(client)),
    } as any;
    const svc = new IpAllowlistService(db);
    await expect(svc.replace(ORG, MEMBER, { entries: [{ cidr: '203.0.113.0/24' }], confirmLockout: false }, '192.0.2.1')).rejects.toMatchObject({
      response: { code: 'IP_ALLOWLIST_LOCKOUT' },
    });
    expect(db.withTenantTransaction).not.toHaveBeenCalled();
    const saved = await svc.replace(ORG, MEMBER, { entries: [{ cidr: '203.0.113.0/24' }], confirmLockout: true }, '192.0.2.1');
    expect(saved.lockoutConfirmed).toBe(true);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO organization_ip_allowlist'), [ORG, '203.0.113.0/24', null, MEMBER]);
    // Containing the caller: no confirmation needed.
    const ok = await svc.replace(ORG, MEMBER, { entries: [{ cidr: '192.0.2.0/24' }], confirmLockout: false }, '192.0.2.1');
    expect(ok.lockoutConfirmed).toBe(false);
  });
});

// ---------------------------------------------------------------------------- impersonation service

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    organization_id: ORG,
    organization_name: 'Acme',
    impersonator_id: OPERATOR,
    impersonator_email: 'ops@example.com',
    impersonator_organization_id: OTHER_ORG,
    target_user_id: MEMBER,
    target_email: 'member@example.com',
    target_full_name: 'Member',
    reason: 'Ticket 4711 reproduce',
    read_only: true,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    ended_at: null,
    end_reason: null,
    request_count: 0,
    target_status: 'ACTIVE',
    target_system_role: 'USER',
    member_role: 'ANALYST',
    operator_status: 'ACTIVE',
    operator_system_role: 'SUPER_ADMIN',
    ...overrides,
  };
}

describe('ImpersonationService', () => {
  const jwt = new JwtService({ secret: JWT_SECRET });
  const token = (claims: Record<string, unknown> = {}) =>
    jwt.sign({ typ: 'impersonation', sub: MEMBER, organizationId: ORG, imp: SESSION, act: OPERATOR, exp: Math.floor(Date.now() / 1000) + 600, ...claims });

  function make(row: any) {
    const db = { query: vi.fn().mockImplementation(async (sql: string) => (sql.includes('UPDATE impersonation_sessions s SET ended_at') ? { rows: [{ ...row, ended_at: new Date().toISOString() }] } : { rows: row ? [row] : [] })) } as any;
    const platformAudit = { record: vi.fn().mockResolvedValue(undefined) } as any;
    const audit = { recordEvent: vi.fn().mockResolvedValue(undefined) } as any;
    return { svc: new ImpersonationService(db, config, platformAudit, audit), db, audit, platformAudit };
  }

  it('accepts an active session and exposes the impersonator', async () => {
    const { svc } = make(sessionRow());
    const out = await svc.authenticate({ token: token(), source: 'bearer' });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.ctx).toMatchObject({ targetUserId: MEMBER, impersonatorId: OPERATOR, readOnly: true, memberRole: 'ANALYST' });
    }
  });

  it('rejects forged and foreign tokens', async () => {
    const { svc } = make(sessionRow());
    const forged = new JwtService({ secret: 'another-secret-another-secret-0123456789' }).sign({ typ: 'impersonation', sub: MEMBER, imp: SESSION });
    expect((await svc.authenticate({ token: forged, source: 'bearer' })).kind).toBe('invalid');
    const mismatch = await svc.authenticate({ token: token({ sub: OPERATOR }), source: 'bearer' });
    expect(mismatch).toMatchObject({ kind: 'invalid', code: 'IMPERSONATION_ENDED' });
  });

  it('expiry revokes the session (401 IMPERSONATION_EXPIRED) and ends it once', async () => {
    const { svc, db } = make(sessionRow({ expires_at: new Date(Date.now() - 1000).toISOString() }));
    const out = await svc.authenticate({ token: token({ exp: Math.floor(Date.now() / 1000) - 1 }), source: 'cookie' });
    expect(out).toMatchObject({ kind: 'invalid', code: 'IMPERSONATION_EXPIRED', returnOrganizationId: OTHER_ORG });
    expect(db.query.mock.calls.some((c: any[]) => String(c[0]).includes('UPDATE impersonation_sessions s SET ended_at') && c[1][1] === 'EXPIRED')).toBe(true);
  });

  it('an ended session stays ended', async () => {
    const { svc } = make(sessionRow({ ended_at: new Date().toISOString(), end_reason: 'ENDED_BY_IMPERSONATOR' }));
    expect(await svc.authenticate({ token: token(), source: 'bearer' })).toMatchObject({ kind: 'invalid', code: 'IMPERSONATION_ENDED' });
  });

  it('demoted operators and deactivated targets end the session', async () => {
    const demoted = make(sessionRow({ operator_system_role: 'USER' }));
    expect(await demoted.svc.authenticate({ token: token(), source: 'bearer' })).toMatchObject({ kind: 'invalid', code: 'IMPERSONATION_ENDED' });
    const inactive = make(sessionRow({ target_status: 'SUSPENDED' }));
    expect((await inactive.svc.authenticate({ token: token(), source: 'bearer' })).kind).toBe('invalid');
  });

  it('request auditing is fail-closed (503 when the ledger is unavailable)', async () => {
    const { svc, audit } = make(sessionRow());
    const out = await svc.authenticate({ token: token(), source: 'bearer' });
    if (out.kind !== 'valid') throw new Error('expected valid');
    audit.recordEvent.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.recordRequest(out.ctx, { method: 'GET', path: '/projects' }, { allowed: true }, {})).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('records allowed and denied requests with the impersonator as actor', async () => {
    const { svc, audit, platformAudit } = make(sessionRow());
    const out = await svc.authenticate({ token: token(), source: 'bearer' });
    if (out.kind !== 'valid') throw new Error('expected valid');
    await svc.recordRequest(out.ctx, { method: 'POST', path: '/projects' }, decideImpersonationRequest('POST', '/projects', true), { clientIp: '192.0.2.1' });
    expect(audit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'impersonation.request.denied', actorId: OPERATOR, organizationId: ORG, payload: expect.objectContaining({ denialCode: 'IMPERSONATION_READ_ONLY' }) })
    );
    expect(platformAudit.record).toHaveBeenCalledWith(expect.objectContaining({ impersonationId: SESSION, actorId: OPERATOR }));
  });

  it('refuses self-impersonation and platform administrators as targets', async () => {
    const { svc } = make({ id: MEMBER, email: 'x@example.com', status: 'ACTIVE', system_role: 'SUPER_ADMIN', member_role: 'ANALYST', organization_name: 'Acme' });
    const dto = StartImpersonationSchema.parse({ organizationId: ORG, userId: MEMBER, reason: 'Ticket 4711 reproduce' });
    await expect(svc.start({ id: MEMBER, email: 'x@example.com', organizationId: ORG }, dto, {})).rejects.toMatchObject({
      response: { code: 'IMPERSONATION_TARGET_NOT_ALLOWED' },
    });
    await expect(svc.start({ id: OPERATOR, email: 'ops@example.com', organizationId: OTHER_ORG }, dto, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------- tenancy binding

describe('TenancyMiddleware: impersonation is bound to its tenant', () => {
  const ctx = { id: SESSION, organizationId: ORG, targetUserId: MEMBER, memberRole: 'ANALYST' };
  const mw = new TenancyMiddleware({} as any, config) as any;

  it('Bearer clients naming another tenant get 403 IMPERSONATION_TENANT_MISMATCH', () => {
    expect(() => mw.resolveImpersonatedTenant({ impersonation: ctx, impersonationSource: 'bearer' }, { imp: SESSION, sub: MEMBER }, OTHER_ORG)).toThrow(ForbiddenException);
  });

  it('browsers (cookie) always act in the impersonated tenant', () => {
    const v = mw.resolveImpersonatedTenant({ impersonation: ctx, impersonationSource: 'cookie' }, { imp: SESSION, sub: MEMBER }, OTHER_ORG);
    expect(v).toMatchObject({ tenantId: ORG, userId: MEMBER, systemRole: 'USER', impersonating: true });
  });

  it('an unverified impersonation token never establishes a tenant', () => {
    expect(() => mw.resolveImpersonatedTenant({}, { imp: SESSION, sub: MEMBER }, undefined)).toThrow(/not active/);
  });
});

// ---------------------------------------------------------------------------- trial extension

describe('TenantAdminService.extendTrial', () => {
  function make(org: Record<string, unknown>, updateRows: any[]) {
    const db = {
      query: vi.fn().mockImplementation(async (sql: string) => (sql.trim().startsWith('WITH cur') ? { rows: updateRows } : { rows: [org] })),
    } as any;
    const platformAudit = { record: vi.fn() } as any;
    const notifier = { notifyTrialExtended: vi.fn().mockResolvedValue(1) } as any;
    return new TenantAdminService(db, platformAudit, notifier, {} as any, {} as any);
  }
  const trialOrg = { id: ORG, name: 'Acme', status: 'ACTIVE', trial_tier: 'PROFESSIONAL', trial_ends_at: new Date().toISOString(), subscription_status: 'NONE' };

  it('refuses paid tenants and tenants without a trial (409 TRIAL_NOT_APPLICABLE)', async () => {
    await expect(make({ ...trialOrg, subscription_status: 'ACTIVE' }, []).extendTrial(ORG, { days: 5, reason: 'Pilot extended by sales', notifyOwners: false }, { id: OPERATOR, email: null })).rejects.toBeInstanceOf(ConflictException);
    await expect(make({ ...trialOrg, trial_tier: null }, []).extendTrial(ORG, { days: 5, reason: 'Pilot extended by sales', notifyOwners: false }, { id: OPERATOR, email: null })).rejects.toMatchObject({
      response: { code: 'TRIAL_NOT_APPLICABLE' },
    });
  });

  it('beyond 90 days after the original end -> 422 TRIAL_EXTENSION_LIMIT', async () => {
    await expect(make(trialOrg, []).extendTrial(ORG, { days: 90, reason: 'Pilot extended by sales', notifyOwners: false }, { id: OPERATOR, email: null })).rejects.toBeInstanceOf(
      UnprocessableEntityException
    );
  });
});

// ---------------------------------------------------------------------------- e-mails

describe('tenant access and support e-mails', () => {
  const ctx = {
    locale: 'de' as const,
    audience: 'requester' as const,
    ticketId: 'abcdef12-0000-4000-8000-000000000000',
    subject: 'Dashboard <leer>',
    category: 'BUG',
    organizationName: 'Acme',
    requesterEmail: 'member@example.com',
    url: 'http://localhost:3000/settings/support?ticket=x',
  };

  it('ticket e-mails use the ticket language and escape user text', () => {
    const mail = renderTicketCreated(ctx, 'Script <script>alert(1)</script>');
    expect(mail.subject).toBe('[Ticket #ABCDEF12] Eingangsbestätigung: Dashboard <leer>');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    const en = renderTicketStatusChanged({ ...ctx, locale: 'en', audience: 'inbox' }, { from: 'OPEN', to: 'WAITING_ON_CUSTOMER' });
    expect(en.text).toContain('"Open" to "Waiting for your reply"');
    expect(en.text).toContain('support console');
  });

  it('owner notices are bilingual and carry the reason', () => {
    const mail = renderTenantSuspended({ organizationName: 'Acme', reason: 'Unpaid invoices', when: '2026-09-26 10:00', exportUrl: 'http://x/settings/account' });
    expect(mail.subject).toMatch(/gesperrt.*suspended/);
    expect(mail.text).toContain('Unpaid invoices');
    const trial = renderTrialExtended({ organizationName: 'Acme', days: 1, trialTier: 'PROFESSIONAL', endsAtDe: '1. Oktober 2026', endsAtEn: '1 October 2026', billingUrl: 'http://x' });
    expect(trial.text).toContain('um 1 Tag verlängert');
    expect(trial.text).toContain('extended by 1 day');
  });

  it('support e-mails go to requester and inbox, never to the author of the message', () => {
    const mail = { sendInBackground: vi.fn(), link: (p: string) => `http://app${p}` } as any;
    const svc = new SupportMailService({ get: (k: string) => (k === 'SUPPORT_INBOX_EMAIL' ? 'support@example.com' : undefined) } as any, mail);
    const facts = { id: ctx.ticketId, subject: 's', description: 'd', category: 'BUG', locale: 'de', organizationName: 'Acme', requesterEmail: 'member@example.com' };
    expect(svc.ticketReplied(facts, { authorRole: 'CUSTOMER', authorEmail: 'member@example.com', body: 'b' })).toEqual({ requester: false, inbox: true });
    expect(svc.ticketCreated(facts)).toEqual({ requester: true, inbox: true });
    const noInbox = new SupportMailService({ get: () => undefined } as any, mail);
    expect(noInbox.ticketCreated(facts)).toEqual({ requester: true, inbox: false });
  });

  it('ticket language: explicit, else cookie, else Accept-Language', () => {
    expect(resolveTicketLocale('de', {})).toBe('de');
    expect(resolveTicketLocale(undefined, { headers: { cookie: 'erp_locale=de' } })).toBe('de');
    expect(resolveTicketLocale(undefined, { headers: { 'accept-language': 'de-DE,de;q=0.9' } })).toBe('de');
    expect(resolveTicketLocale(undefined, { headers: {} })).toBe('en');
  });
});

// ---------------------------------------------------------------------------- review fixes

describe('ImpersonationMiddleware: credential conflicts and case folding', () => {
  const ctx = { id: SESSION, organizationId: ORG, targetUserId: MEMBER, impersonatorId: OPERATOR, impersonatorEmail: 'op@x', readOnly: true };
  function make() {
    const impersonation = {
      authenticate: vi.fn().mockResolvedValue({ kind: 'valid', ctx }),
      recordRequest: vi.fn().mockResolvedValue(undefined),
      end: vi.fn(),
      clearCookie: vi.fn(),
    } as any;
    return { mw: new ImpersonationMiddleware(impersonation), impersonation };
  }
  const req = (method: string, url: string, headers: Record<string, string> = {}) =>
    ({ method, originalUrl: url, url, headers: { cookie: `${IMPERSONATION_COOKIE_NAME}=tok`, ...headers }, socket: {} }) as any;

  it('an API key next to an impersonation credential is refused and audited as denied', async () => {
    const { mw, impersonation } = make();
    const next = vi.fn();
    await expect(mw.use(req('GET', '/api/v1/projects', { 'x-api-key': 'erppf_key' }), {} as any, next)).rejects.toMatchObject({
      response: { code: 'IMPERSONATION_CREDENTIAL_CONFLICT' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(impersonation.recordRequest.mock.calls[0][2]).toMatchObject({ allowed: false });
  });

  it('upper-case secret paths are denied before any handler runs', async () => {
    const { mw } = make();
    const next = vi.fn();
    await expect(mw.use(req('GET', '/API/V1/Account/Export'), {} as any, next)).rejects.toBeInstanceOf(ForbiddenException);
    expect(next).not.toHaveBeenCalled();
    await mw.use(req('GET', '/api/v1/Projects'), {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('machine credentials of suspended tenants', () => {
  it('SCIM tokens of a suspended organization get a SCIM 403', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 't1', organization_id: ORG }] }) } as any;
    const tenantAccess = { machineDenial: vi.fn().mockResolvedValue({ code: 'TENANT_SUSPENDED', message: 'suspended' }) } as any;
    const scim = new ScimService(db, {} as any, tenantAccess);
    await expect(scim.authenticate('Bearer erppf_scim_abc')).rejects.toMatchObject({ status: 403 });
    expect(tenantAccess.machineDenial).toHaveBeenCalledWith(ORG, null, { ipAllowlist: false });
    tenantAccess.machineDenial.mockResolvedValue(null);
    await expect(scim.authenticate('Bearer erppf_scim_abc')).resolves.toMatchObject({ organizationId: ORG });
  });
});
