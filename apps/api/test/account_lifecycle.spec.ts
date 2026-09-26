import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TenancyContext } from '@erppreflight/tenancy';
import { passwordPolicyViolations } from '@erppreflight/schemas';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotpSecret,
  hotp,
  timeStep,
  totp,
  verifyTotp,
} from '../src/modules/auth/crypto/totp';
import { SecretBox } from '../src/modules/auth/crypto/secret-box';
import {
  generateOpaqueToken,
  generateRecoveryCodes,
  hashOpaqueToken,
  hashRecoveryCode,
  isWellFormedOpaqueToken,
} from '../src/modules/auth/crypto/opaque-token';
import { AuthService, passwordHashNeedsRehash } from '../src/modules/auth/auth.service';
import { AccountSecurityService, FORGOT_PASSWORD_RESPONSE } from '../src/modules/auth/account-security.service';
import { VerifiedEmailGuard } from '../src/modules/auth/guards/verified-email.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { TenancyMiddleware, isMfaEnrollmentAllowedPath } from '../src/modules/tenancy/tenancy.middleware';
import { MembersService } from '../src/modules/organizations/members.service';
import { InvitationsService } from '../src/modules/organizations/invitations.service';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789abcdef-0123456789';
const USER = '11111111-1111-4111-8111-111111111111';
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION = '22222222-2222-4222-8222-222222222222';

function configWith(values: Record<string, any>) {
  return {
    get: vi.fn((key: string) => values[key]),
    getOrThrow: vi.fn((key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    }),
  } as any;
}

/** A pg PoolClient stand-in whose query() answers from a list of (regex -> rows) rules. */
function fakeClient(rules: Array<[RegExp, any[] | ((params: any[]) => any[])]>) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const client = {
    calls,
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      for (const [re, rows] of rules) {
        if (re.test(sql)) return { rows: typeof rows === 'function' ? rows(params) : rows };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return client;
}

// ---------------------------------------------------------------------------------------------
describe('TOTP (RFC 6238 / RFC 4226)', () => {
  // RFC 6238 Appendix B test secret for SHA-1: ASCII "12345678901234567890"
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC 6238 SHA-1 test vectors (6-digit truncation)', () => {
    expect(totp(secret, 59 * 1000)).toBe('287082');
    expect(totp(secret, 1111111109 * 1000)).toBe('081804');
    expect(totp(secret, 1234567890 * 1000)).toBe('005924');
    expect(totp(secret, 2000000000 * 1000)).toBe('279037');
  });

  it('matches RFC 4226 HOTP vectors', () => {
    const key = Buffer.from('12345678901234567890');
    expect(['755224', '287082', '359152'].map((_, i) => hotp(key, i))).toEqual(['755224', '287082', '359152']);
  });

  it('accepts +/-1 step drift, returns the matched step, rejects others', () => {
    const now = 1_790_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(secret, totp(secret, now), { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, totp(secret, now + 30_000), { nowMs: now })).toBe(step + 1);
    expect(verifyTotp(secret, totp(secret, now + 90_000), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { nowMs: now })).toBeNull();
  });

  it('base32 round-trips and generates 160-bit secrets', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it('builds a Key-Uri-Format otpauth URI', () => {
    const uri = buildOtpauthUri({ issuer: 'ERP Preflight', account: 'a@b.co', secret: 'JBSWY3DPEHPK3PXP' });
    expect(uri).toBe(
      'otpauth://totp/ERP%20Preflight:a%40b.co?secret=JBSWY3DPEHPK3PXP&issuer=ERP+Preflight&algorithm=SHA1&digits=6&period=30'
    );
  });
});

describe('SecretBox (AES-256-GCM, HKDF from MASTER_ENCRYPTION_KEY)', () => {
  const key = 'k'.repeat(64);

  it('round-trips and never returns the plaintext in the ciphertext', () => {
    const box = new SecretBox(key, 'totp-secret/v1');
    const enc = box.encrypt('JBSWY3DPEHPK3PXP', USER);
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.decrypt(enc, USER)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('binds ciphertexts to the user (AAD), purpose and key; detects tampering', () => {
    const box = new SecretBox(key, 'totp-secret/v1');
    const enc = box.encrypt('secret', USER);
    expect(() => box.decrypt(enc, 'someone-else')).toThrow();
    expect(() => new SecretBox(key, 'other-purpose').decrypt(enc, USER)).toThrow();
    expect(() => new SecretBox('x'.repeat(64), 'totp-secret/v1').decrypt(enc, USER)).toThrow();
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.decrypt(parts.join('.'), USER)).toThrow();
    expect(() => new SecretBox('short', 'p')).toThrow();
  });
});

describe('Opaque tokens and recovery codes', () => {
  it('stores only a SHA-256 digest of 256-bit tokens', () => {
    const { token, hash } = generateOpaqueToken();
    expect(isWellFormedOpaqueToken(token)).toBe(true);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashOpaqueToken(token)).toBe(hash);
    expect(generateOpaqueToken().token).not.toBe(token);
    expect(isWellFormedOpaqueToken("x' OR 1=1 --")).toBe(false);
  });

  it('generates unique, formatted recovery codes hashed per user', () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    const c = codes[0];
    expect(hashRecoveryCode(USER, c)).toBe(hashRecoveryCode(USER, c.toUpperCase().replace('-', ' ')));
    expect(hashRecoveryCode(USER, c)).not.toBe(hashRecoveryCode(ORG, c));
  });
});

describe('Password policy (shared @erppreflight/schemas)', () => {
  it('enforces length, character classes, common passwords and e-mail reuse', () => {
    expect(passwordPolicyViolations('Correct-Horse-42')).toEqual([]);
    expect(passwordPolicyViolations('short1A!').join()).toMatch(/at least 12/);
    expect(passwordPolicyViolations('alllowercaseletters').join()).toMatch(/three of/);
    expect(passwordPolicyViolations('P@ssw0rd1234').join()).toMatch(/too common/);
    expect(passwordPolicyViolations('Jonathan-2026x', { email: 'jonathan@example.com' }).join()).toMatch(/e-mail/);
    expect(passwordPolicyViolations('A1!' + 'a'.repeat(200)).join()).toMatch(/at most 128/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('Spec §51 — password security migration', () => {
  let db: any;
  let service: AuthService;
  const sessions = { create: vi.fn().mockResolvedValue(undefined) };
  const verification = { issueSafely: vi.fn().mockResolvedValue(undefined) };
  const jwt = new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: '1h' } });

  beforeEach(() => {
    db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    service = new AuthService(db, jwt, verification as any, sessions as any);
  });

  it('never stores the plaintext and stores Argon2id (not SHA-256)', async () => {
    await service.register({ email: 'new@example.com', password: 'Correct-Horse-42', organizationName: 'Acme' });
    const insertUser = db.query.mock.calls.find((c: any[]) => /INSERT INTO users/.test(c[0]));
    const params: any[] = insertUser[1];
    expect(params).not.toContain('Correct-Horse-42');
    const stored = params[2] as string;
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(stored).not.toBe(createHash('sha256').update('Correct-Horse-42').digest('hex'));
  });

  it('salts: the same password hashes differently every time', async () => {
    const a = await service.hashPassword('Correct-Horse-42');
    const b = await service.hashPassword('Correct-Horse-42');
    expect(a).not.toBe(b);
    expect(await service.verifyPassword('Correct-Horse-42', a)).toBe(true);
    expect(await service.verifyPassword('Correct-Horse-42', b)).toBe(true);
    expect(await service.verifyPassword('Correct-Horse-43', a)).toBe(false);
  });

  it('legacy SHA-256 hashes never authenticate and are flagged for replacement', async () => {
    const legacy = createHash('sha256').update('Correct-Horse-42').digest('hex');
    expect(await service.verifyPassword('Correct-Horse-42', legacy)).toBe(false);
    expect(passwordHashNeedsRehash(legacy)).toBe(true);
    db.query.mockResolvedValueOnce({ rows: [{ id: USER, password_hash: legacy, status: 'ACTIVE', token_version: 0 }] });
    await expect(service.login({ email: 'legacy@example.com', password: 'Correct-Horse-42' })).rejects.toThrow(
      UnauthorizedException
    );
  });

  it('rehashes on login when Argon2 parameters changed', async () => {
    const { hash } = await import('@node-rs/argon2');
    const weak = await hash('Correct-Horse-42', { algorithm: 2, memoryCost: 8192, timeCost: 1, parallelism: 1 });
    expect(passwordHashNeedsRehash(weak)).toBe(true);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: USER, password_hash: weak, status: 'ACTIVE', token_version: 0 }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE password_hash
      .mockResolvedValueOnce({
        rows: [{ id: USER, email: 'u@example.com', status: 'ACTIVE', system_role: 'USER', organization_id: ORG, role: 'VIEWER' }],
      });
    const result: any = await service.login({ email: 'u@example.com', password: 'Correct-Horse-42' });
    expect(result.accessToken).toBeTruthy();
    const update = db.query.mock.calls[1];
    expect(update[0]).toMatch(/UPDATE users SET password_hash/);
    expect(passwordHashNeedsRehash(update[1][0])).toBe(false);
  });

  it('uses the constant-time library path (dummy Argon2 verify) for unknown accounts', async () => {
    const burn = vi.spyOn(service, 'burnPasswordCheck');
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(service.login({ email: 'nobody@example.com', password: 'x' })).rejects.toThrow(UnauthorizedException);
    expect(burn).toHaveBeenCalledWith('x');
  });

  it('forced reset path: a legacy-hash account recovers via reset and gets an Argon2id hash', async () => {
    const tokens = {
      peek: vi.fn().mockResolvedValue({ id: 't', user_id: USER, email: 'legacy@example.com', expires_at: new Date() }),
      consume: vi.fn().mockResolvedValue({ id: 't', user_id: USER, email: 'legacy@example.com', expires_at: new Date() }),
      revokeAll: vi.fn().mockResolvedValue(undefined),
    };
    const client = fakeClient([
      [/UPDATE users\s+SET password_hash/, [{ id: USER, email: 'legacy@example.com', full_name: 'L' }]],
    ]);
    const poolDb: any = { getPool: () => ({ connect: async () => client }), query: vi.fn() };
    const mail = { sendInBackground: vi.fn(), link: vi.fn().mockReturnValue('https://app/x') };
    const audit = { recordForUser: vi.fn().mockResolvedValue(undefined) };
    const sessionSvc = { revokeAll: vi.fn().mockResolvedValue(1) };
    const svc = new AccountSecurityService(poolDb, service, tokens as any, mail as any, audit as any, sessionSvc as any);

    await expect(svc.resetPassword('a'.repeat(43), 'weak', {})).rejects.toThrow();
    await svc.resetPassword('a'.repeat(43), 'Brand-New-Pass-77', {});

    const update = client.calls.find((c) => /UPDATE users\s+SET password_hash/.test(c.sql))!;
    expect(update.sql).toMatch(/token_version = token_version \+ 1/);
    const newHash = update.params[0];
    expect(newHash).toMatch(/^\$argon2id\$/);
    expect(await service.verifyPassword('Brand-New-Pass-77', newHash)).toBe(true);
    expect(sessionSvc.revokeAll).toHaveBeenCalledWith(USER, 'PASSWORD_RESET', client);
    expect(client.calls.map((c) => c.sql)).toContain('COMMIT');
  });
});

describe('Forgot password (no account enumeration)', () => {
  it('returns the identical response for known and unknown addresses', async () => {
    const db: any = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: USER, email: 'k@example.com', full_name: null }] })
        .mockResolvedValue({ rows: [] }),
    };
    const tokens = {
      countRecent: vi.fn().mockResolvedValue(0),
      issue: vi.fn().mockResolvedValue({ token: 't'.repeat(43), expiresAt: new Date() }),
    };
    const mail = { send: vi.fn().mockResolvedValue({}), link: vi.fn().mockReturnValue('https://app/reset') };
    const audit = { recordForUser: vi.fn().mockResolvedValue(undefined) };
    const svc = new AccountSecurityService(db, {} as any, tokens as any, mail as any, audit as any, {} as any);
    const known = await svc.forgotPassword('K@example.com');
    const unknown = await svc.forgotPassword('nobody@example.com');
    expect(known).toEqual(FORGOT_PASSWORD_RESPONSE);
    expect(unknown).toEqual(FORGOT_PASSWORD_RESPONSE);
    await new Promise((r) => setTimeout(r, 10));
    expect(tokens.issue).toHaveBeenCalledTimes(1);
    expect(tokens.issue).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'PASSWORD_RESET', ttlMinutes: 60 }));
  });

  it('stops issuing after 5 reset e-mails per hour', async () => {
    const tokens = { countRecent: vi.fn().mockResolvedValue(5), issue: vi.fn() };
    const svc = new AccountSecurityService({} as any, {} as any, tokens as any, {} as any, {} as any, {} as any);
    expect(await svc.issuePasswordReset({ id: USER, email: 'k@example.com', full_name: null })).toBe(false);
    expect(tokens.issue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
describe('VerifiedEmailGuard (unverified users cannot run analyses / exports)', () => {
  const ctx = (user: any) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;
  const guard = new VerifiedEmailGuard();
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('blocks unverified users with a machine-readable code', () => {
    try {
      guard.canActivate(ctx({ id: USER, emailVerified: false }));
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse().code).toBe('EMAIL_NOT_VERIFIED');
    }
  });

  it('allows verified users, API keys and super admins; can be disabled explicitly', () => {
    expect(guard.canActivate(ctx({ emailVerified: true }))).toBe(true);
    expect(guard.canActivate(ctx({ role: 'API_CLIENT' }))).toBe(true);
    expect(guard.canActivate(ctx({ systemRole: 'SUPER_ADMIN' }))).toBe(true);
    process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
    expect(guard.canActivate(ctx({ emailVerified: false }))).toBe(true);
  });
});

describe('JwtStrategy session / token-version revocation', () => {
  const sessions = { touch: vi.fn() };
  const make = (row: any) => {
    const db: any = { query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) };
    return new JwtStrategy(configWith({ JWT_SECRET }), db, sessions as any);
  };
  const future = new Date(Date.now() + 3600_000);
  const base = { sub: USER, organizationId: ORG, email: 'u@example.com', role: 'VIEWER', tv: 2, jti: SESSION };

  it('accepts an active session with the current token_version', async () => {
    const s = make({ status: 'ACTIVE', token_version: 2, email_verified_at: new Date(), session_id: SESSION, expires_at: future });
    const user = await s.validate(base as any);
    expect(user).toMatchObject({ id: USER, emailVerified: true, mfaEnabled: false, jti: SESSION });
  });

  it('rejects revoked, expired or unknown sessions and stale token versions', async () => {
    await expect(
      make({ status: 'ACTIVE', token_version: 2, session_id: SESSION, revoked_at: new Date(), expires_at: future }).validate(base as any)
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      make({ status: 'ACTIVE', token_version: 2, session_id: SESSION, expires_at: new Date(Date.now() - 1000) }).validate(base as any)
    ).rejects.toThrow(UnauthorizedException);
    await expect(make({ status: 'ACTIVE', token_version: 2, session_id: null }).validate(base as any)).rejects.toThrow(
      UnauthorizedException
    );
    await expect(
      make({ status: 'ACTIVE', token_version: 3, session_id: SESSION, expires_at: future }).validate(base as any)
    ).rejects.toThrow(/revoked/);
    await expect(make({ status: 'DELETED', token_version: 2 }).validate(base as any)).rejects.toThrow(/not active/);
  });

  it('never accepts 2FA challenge tokens or malformed session ids as sessions', async () => {
    const s = make({ status: 'ACTIVE', token_version: 0 });
    await expect(s.validate({ sub: USER, typ: 'mfa_challenge', organizationId: ORG } as any)).rejects.toThrow();
    await expect(s.validate({ ...base, jti: "x' OR '1'='1" } as any)).rejects.toThrow();
  });
});

describe('Organization "require 2FA" enforcement (TenancyMiddleware)', () => {
  const token = new JwtService({ secret: JWT_SECRET }).sign({ sub: USER, organizationId: ORG, tv: 0 });

  async function run(url: string, method: string, row: any) {
    const db: any = { query: vi.fn().mockResolvedValue({ rows: [row] }) };
    const mw = new TenancyMiddleware(db, configWith({ JWT_SECRET }));
    let seen: any = 'next-not-called';
    await mw.use(
      { headers: { authorization: `Bearer ${token}` }, originalUrl: url, method } as any,
      {} as any,
      () => {
        seen = TenancyContext.get() ?? null;
      }
    );
    return seen;
  }
  const member = { status: 'ACTIVE', system_role: 'USER', member_role: 'VIEWER', token_version: 0 };

  it('blocks tenant routes until the member enrolls in 2FA', async () => {
    await expect(run('/api/v1/projects', 'GET', { ...member, require_2fa: true, totp_enabled_at: null })).rejects.toThrow(
      ForbiddenException
    );
    const ok = await run('/api/v1/auth/2fa/setup', 'POST', { ...member, require_2fa: true, totp_enabled_at: null });
    expect(ok?.tenantId).toBe(ORG);
    const enrolled = await run('/api/v1/projects', 'GET', { ...member, require_2fa: true, totp_enabled_at: new Date() });
    expect(enrolled?.tenantId).toBe(ORG);
  });

  it('ignores tokens whose token_version was bumped (revoked)', async () => {
    const seen = await run('/api/v1/projects', 'GET', { ...member, token_version: 1 });
    expect(seen).toBeNull();
  });

  it('only allows auth/account/invitation routes and read-only org routes during enrollment', () => {
    expect(isMfaEnrollmentAllowedPath('/api/v1/auth/2fa/enable', 'POST')).toBe(true);
    expect(isMfaEnrollmentAllowedPath('/api/v1/account/export', 'GET')).toBe(true);
    expect(isMfaEnrollmentAllowedPath('/api/v1/organizations', 'GET')).toBe(true);
    expect(isMfaEnrollmentAllowedPath('/api/v1/organizations/current', 'PATCH')).toBe(false);
    expect(isMfaEnrollmentAllowedPath('/api/v1/authz', 'GET')).toBe(false);
    expect(isMfaEnrollmentAllowedPath('/api/v1/projects?x=/auth/', 'GET')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('MembersService owner protection', () => {
  const audit = { recordForOrganization: vi.fn().mockResolvedValue(undefined) };
  function svcWith(members: any[]) {
    const client = fakeClient([[/FOR UPDATE/, members]]);
    const db: any = { withTenantTransaction: vi.fn(async (_t: string, fn: any) => fn(client)), query: vi.fn() };
    return { svc: new MembersService(db, audit as any), client };
  }
  const owner = { id: 'm1', user_id: 'u1', role: 'ORGANIZATION_OWNER' };
  const admin = { id: 'm2', user_id: 'u2', role: 'SECURITY_ADMIN' };

  it('refuses to demote or remove the last owner', async () => {
    const { svc } = svcWith([owner, admin]);
    await expect(svc.updateRole(ORG, { id: 'u1', role: 'ORGANIZATION_OWNER' }, 'm1', 'VIEWER')).rejects.toThrow(/last owner/);
    await expect(svc.remove(ORG, { id: 'u1', role: 'ORGANIZATION_OWNER' }, 'm1')).rejects.toThrow(/last owner/);
  });

  it('only owners may grant or revoke the owner role', async () => {
    const { svc } = svcWith([owner, admin]);
    await expect(svc.updateRole(ORG, { id: 'u2', role: 'SECURITY_ADMIN' }, 'm2', 'ORGANIZATION_OWNER')).rejects.toThrow(
      ForbiddenException
    );
    await expect(svc.remove(ORG, { id: 'u2', role: 'SECURITY_ADMIN' }, 'm1')).rejects.toThrow(ForbiddenException);
  });

  it('allows demoting an owner when another owner remains, and transfers ownership atomically', async () => {
    const second = { id: 'm3', user_id: 'u3', role: 'ORGANIZATION_OWNER' };
    const { svc, client } = svcWith([owner, admin, second]);
    const res = await svc.updateRole(ORG, { id: 'u1', role: 'ORGANIZATION_OWNER' }, 'm3', 'AUDITOR');
    expect(res.role).toBe('AUDITOR');
    expect(client.calls.some((c) => /UPDATE organization_members SET role/.test(c.sql))).toBe(true);

    const t = svcWith([owner, admin]);
    await t.svc.transferOwnership(ORG, { id: 'u1', role: 'ORGANIZATION_OWNER' }, 'm2');
    const updates = t.client.calls.filter((c) => /UPDATE organization_members SET role/.test(c.sql));
    expect(updates[0].params).toEqual(['ORGANIZATION_OWNER', 'm2', ORG]);
    expect(updates[1].sql).toMatch(/SECURITY_ADMIN/);
  });
});

describe('InvitationsService acceptance', () => {
  const token = generateOpaqueToken().token;
  const invitation = {
    id: 'inv1',
    organization_id: ORG,
    email: 'invited@example.com',
    role: 'AUDITOR',
    organization_name: 'Org',
    expires_at: new Date(Date.now() + 86400_000),
  };

  function setup(userEmail: string) {
    const client = fakeClient([
      [/FROM organization_invitations i/, [invitation]],
      [/SELECT id, email, status FROM users/, [{ id: USER, email: userEmail, status: 'ACTIVE' }]],
      [/INSERT INTO organization_members/, [{ id: 'm' }]],
    ]);
    const db: any = { getPool: () => ({ connect: async () => client }), query: vi.fn() };
    const auth = { createSession: vi.fn().mockResolvedValue({ accessToken: 'tok', user: {} }) };
    const audit = { recordForOrganization: vi.fn().mockResolvedValue(undefined) };
    return { svc: new InvitationsService(db, {} as any, auth as any, audit as any), client, auth };
  }

  it('rejects a signed-in account whose e-mail differs from the invitation', async () => {
    const { svc, client } = setup('someone-else@example.com');
    await expect(svc.acceptAsExistingUser(token, USER)).rejects.toThrow(/invited@example.com/);
    expect(client.calls.map((c) => c.sql)).toContain('ROLLBACK');
  });

  it('joins with the invited role, consumes the invitation and marks the e-mail verified', async () => {
    const { svc, client, auth } = setup('Invited@Example.com');
    await svc.acceptAsExistingUser(token, USER);
    const sqls = client.calls.map((c) => c.sql);
    expect(sqls.some((s) => /INSERT INTO organization_members/.test(s))).toBe(true);
    expect(sqls.some((s) => /SET accepted_at = NOW\(\)/.test(s))).toBe(true);
    expect(sqls.some((s) => /email_verified_at = COALESCE/.test(s))).toBe(true);
    expect(client.calls.find((c) => /FROM organization_invitations i/.test(c.sql))!.params[0]).toBe(hashOpaqueToken(token));
    expect(auth.createSession).toHaveBeenCalledWith(USER, expect.objectContaining({ preferredOrganizationId: ORG }));
  });

  it('never queries the database for malformed tokens', async () => {
    const { svc, client } = setup('invited@example.com');
    await expect(svc.acceptAsExistingUser('not-a-token', USER)).rejects.toThrow(/invalid/);
    expect(client.calls.some((c) => /organization_invitations/.test(c.sql))).toBe(false);
  });
});
