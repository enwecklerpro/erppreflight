import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SessionCookieService,
  csrfBinding,
  csrfCookieOptions,
  csrfTokenFor,
  csrfTokensEqual,
  deriveCsrfKey,
  hasBearerCredentials,
  isBrowserRequest,
  isValidCookieDomain,
  readCookie,
  resolveSessionCookieSettings,
  sessionCookieOptions,
  tokenMaxAgeMs,
} from '../src/modules/auth/session-cookie';
import {
  CsrfGuard,
  SKIP_CSRF_KEY,
  evaluateCsrf,
  isTrustedOrigin,
  requestSourceOrigin,
  resolveCorsOrigins,
  resolveTrustedOrigins,
} from '../src/modules/auth/csrf.guard';
import {
  MAGIC_LINK_MAX_PER_HOUR,
  MAGIC_LINK_REQUEST_RESPONSE,
  MAGIC_LINK_TTL_MINUTES,
  MagicLinkService,
  sanitizeNextPath,
} from '../src/modules/auth/magic-link.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { renderMagicLink } from '../src/modules/mail/mail.templates';
import { validateEnv } from '../src/config/env.validation';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789abcdef-0123456789';
const USER = '11111111-1111-4111-8111-111111111111';
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION = '22222222-2222-4222-8222-222222222222';
const TRUSTED = ['http://localhost:4100', 'https://erppreflight.com'];

const jwt = new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: '1h' } });
const config = { getOrThrow: (key: string) => (key === 'JWT_SECRET' ? JWT_SECRET : undefined) } as any;

function sessionToken(extra: Record<string, unknown> = {}) {
  return jwt.sign({ sub: USER, email: 'u@example.com', organizationId: ORG, role: 'VIEWER', tv: 0, jti: SESSION, ...extra });
}

function fakeResponse() {
  const cookies: Array<{ name: string; value: string; options: any }> = [];
  const cleared: Array<{ name: string; options: any }> = [];
  return {
    cookies,
    cleared,
    cookie: vi.fn((name: string, value: string, options: any) => cookies.push({ name, value, options })),
    clearCookie: vi.fn((name: string, options: any) => cleared.push({ name, options })),
  } as any;
}

const ENV_KEYS = ['SESSION_COOKIE_DOMAIN', 'SESSION_COOKIE_SAMESITE', 'SESSION_COOKIE_SECURE', 'NODE_ENV', 'CORS_ORIGIN', 'APP_PUBLIC_URL'];
let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ---------------------------------------------------------------------------------------------
describe('Session cookie attributes (spec C §8.2)', () => {
  it('HttpOnly session cookie, readable CSRF cookie, SameSite=Lax, Secure in production, host-only by default', () => {
    const prod = resolveSessionCookieSettings({ NODE_ENV: 'production' } as any);
    expect(prod).toEqual({ sameSite: 'lax', secure: true });
    const session = sessionCookieOptions(prod, 1000);
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 1000 });
    expect(session).not.toHaveProperty('domain');
    expect(csrfCookieOptions(prod).httpOnly).toBe(false);
    expect(resolveSessionCookieSettings({ NODE_ENV: 'development' } as any).secure).toBe(false);
  });

  it('SESSION_COOKIE_DOMAIN scopes both cookies to the shared parent domain; SameSite=None forces Secure', () => {
    const s = resolveSessionCookieSettings({ SESSION_COOKIE_DOMAIN: '.ErpPreflight.com', SESSION_COOKIE_SAMESITE: 'none', SESSION_COOKIE_SECURE: 'false' } as any);
    expect(s).toEqual({ domain: 'erppreflight.com', sameSite: 'none', secure: true });
    expect(sessionCookieOptions(s).domain).toBe('erppreflight.com');
    expect(csrfCookieOptions(s).domain).toBe('erppreflight.com');
  });

  it('validates SESSION_COOKIE_DOMAIN and rejects insecure production settings at boot', () => {
    expect(isValidCookieDomain('erppreflight.com')).toBe(true);
    expect(isValidCookieDomain(undefined)).toBe(true);
    expect(isValidCookieDomain('https://erppreflight.com')).toBe(false);
    expect(isValidCookieDomain('erppreflight.com:443')).toBe(false);
    expect(() => validateEnv({ SESSION_COOKIE_DOMAIN: 'https://x.example/path' })).toThrow();
    expect(() => validateEnv({ SESSION_COOKIE_SAMESITE: 'none', SESSION_COOKIE_SECURE: 'false' })).toThrow();
    expect(() => validateEnv({ SESSION_COOKIE_SAMESITE: 'sometimes' })).toThrow();
    expect(validateEnv({ SESSION_COOKIE_DOMAIN: 'erppreflight.com', SESSION_COOKIE_SAMESITE: 'Strict' }).SESSION_COOKIE_SAMESITE).toBe('strict');
  });

  it('cookie lifetime follows the token expiry', () => {
    const now = 1_700_000_000_000;
    expect(tokenMaxAgeMs({ exp: now / 1000 + 3600 }, now)).toBe(3_600_000);
    expect(tokenMaxAgeMs({}, now)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('readCookie parses the Cookie header exactly (no prefix matches)', () => {
    const req = { headers: { cookie: 'x_erppreflight_session=evil; erppreflight_session=abc%2Edef; erp_csrf=t' } };
    expect(readCookie(req, SESSION_COOKIE_NAME)).toBe('abc.def');
    expect(readCookie(req, CSRF_COOKIE_NAME)).toBe('t');
    expect(readCookie({ headers: {} }, SESSION_COOKIE_NAME)).toBeNull();
  });

  it('detects browser requests by Origin / Sec-Fetch metadata and usable bearer credentials', () => {
    expect(isBrowserRequest({ headers: { origin: 'http://localhost:4100' } })).toBe(true);
    expect(isBrowserRequest({ headers: { 'sec-fetch-site': 'same-site' } })).toBe(true);
    // Node's fetch (undici) sends Sec-Fetch-Mode but is not a browser (CLI, local agent, scripts).
    expect(isBrowserRequest({ headers: { 'sec-fetch-mode': 'cors', 'user-agent': 'node' } })).toBe(false);
    expect(isBrowserRequest({ headers: { 'user-agent': 'curl/8' } })).toBe(false);
    expect(hasBearerCredentials({ headers: { authorization: 'Bearer abc' } })).toBe(true);
    expect(hasBearerCredentials({ headers: { authorization: 'Bearer ' } })).toBe(false);
    expect(hasBearerCredentials({ headers: { authorization: 'Device abc' } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('SessionCookieService', () => {
  const svc = new SessionCookieService(config, jwt);

  it('browser responses carry the user and csrfToken but never the access token', () => {
    const res = fakeResponse();
    const token = sessionToken();
    const body: any = svc.present({ headers: { origin: 'http://localhost:4100' } }, res, { accessToken: token, user: { id: USER } });
    expect(body.accessToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body.user.id).toBe(USER);
    expect(body.csrfToken).toBe(csrfTokenFor(deriveCsrfKey(JWT_SECRET), `jti:${SESSION}`));
    const session = res.cookies.find((c: any) => c.name === SESSION_COOKIE_NAME);
    const csrf = res.cookies.find((c: any) => c.name === CSRF_COOKIE_NAME);
    expect(session.value).toBe(token);
    expect(session.options.httpOnly).toBe(true);
    expect(csrf.value).toBe(body.csrfToken);
    expect(csrf.options.httpOnly).toBe(false);
  });

  it('non-browser clients (CLI, scripts) still receive the bearer token', () => {
    const token = sessionToken();
    const body: any = svc.present({ headers: {} }, fakeResponse(), { accessToken: token, user: { id: USER } });
    expect(body.accessToken).toBe(token);
  });

  it('only a valid, signed access token in the cookie counts as a cookie session', () => {
    const token = sessionToken();
    expect(svc.verifiedCookieSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } })?.csrfToken).toBe(
      svc.csrfTokenForAccessToken(token)
    );
    const forged = new JwtService({ secret: 'another-secret-0123456789abcdef0123456789' }).sign({ sub: USER, jti: SESSION });
    expect(svc.verifiedCookieSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=${forged}` } })).toBeNull();
    const challenge = jwt.sign({ sub: USER, typ: 'mfa_challenge', jti: SESSION });
    expect(svc.verifiedCookieSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=${challenge}` } })).toBeNull();
    expect(svc.verifiedCookieSession({ headers: {} })).toBeNull();
  });

  it('clears both cookies with the configured attributes (and host-only leftovers when a domain is set)', () => {
    process.env.SESSION_COOKIE_DOMAIN = 'erppreflight.com';
    const scoped = new SessionCookieService(config, jwt);
    const res = fakeResponse();
    scoped.clearSessionCookies(res);
    expect(res.cleared.map((c: any) => `${c.name}:${c.options.domain ?? 'host'}`)).toEqual([
      `${SESSION_COOKIE_NAME}:erppreflight.com`,
      `${CSRF_COOKIE_NAME}:erppreflight.com`,
      `${SESSION_COOKIE_NAME}:host`,
      `${CSRF_COOKIE_NAME}:host`,
    ]);
    expect(res.cleared.every((c: any) => c.options.maxAge === undefined)).toBe(true);
  });

  it('CSRF tokens are bound to the session id and differ per session', () => {
    const key = deriveCsrfKey(JWT_SECRET);
    const a = csrfTokenFor(key, csrfBinding({ sub: USER, jti: SESSION })!);
    const b = csrfTokenFor(key, csrfBinding({ sub: USER, jti: '33333333-3333-4333-8333-333333333333' })!);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrfTokenFor(deriveCsrfKey('other-secret-0123456789abcdef0123456789'), `jti:${SESSION}`)).not.toBe(a);
    expect(csrfTokensEqual(a, a)).toBe(true);
    expect(csrfTokensEqual(b, a)).toBe(false);
    expect(csrfTokensEqual('', a)).toBe(false);
    expect(csrfTokensEqual(undefined, a)).toBe(false);
    expect(csrfBinding({ jti: SESSION })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe('CSRF decision (OWASP signed double-submit + Origin check)', () => {
  const expected = 'expected-token-value';
  const base = { trustedOrigins: TRUSTED, host: 'localhost:4101', tokenAuthenticated: false, expectedToken: expected };

  it('safe methods and skipped routes pass', () => {
    expect(evaluateCsrf({ ...base, method: 'GET', origin: 'https://evil.example' })).toEqual({ ok: true, reason: 'SAFE_METHOD' });
    expect(evaluateCsrf({ ...base, method: 'HEAD' }).ok).toBe(true);
    expect(evaluateCsrf({ ...base, method: 'POST', skip: true, origin: 'https://evil.example' })).toEqual({ ok: true, reason: 'SKIPPED' });
  });

  it('cookie-authenticated POST without X-CSRF-Token is rejected', () => {
    expect(evaluateCsrf({ ...base, method: 'POST', origin: TRUSTED[0] })).toEqual({ ok: false, reason: 'TOKEN_MISSING' });
    expect(evaluateCsrf({ ...base, method: 'DELETE', origin: TRUSTED[0], presentedToken: '  ' })).toEqual({ ok: false, reason: 'TOKEN_MISSING' });
  });

  it('a wrong token is rejected; the right token from a trusted origin passes', () => {
    expect(evaluateCsrf({ ...base, method: 'PATCH', origin: TRUSTED[0], presentedToken: 'forged' })).toEqual({ ok: false, reason: 'TOKEN_INVALID' });
    expect(evaluateCsrf({ ...base, method: 'PUT', origin: TRUSTED[0], presentedToken: expected })).toEqual({ ok: true, reason: 'TOKEN_VALID' });
    expect(evaluateCsrf({ ...base, method: 'POST', origin: TRUSTED[0], presentedToken: [expected] }).ok).toBe(true);
  });

  it('a foreign Origin is rejected even with a valid token; Origin null too', () => {
    expect(evaluateCsrf({ ...base, method: 'POST', origin: 'https://evil.example', presentedToken: expected })).toEqual({
      ok: false,
      reason: 'ORIGIN_NOT_ALLOWED',
    });
    expect(evaluateCsrf({ ...base, method: 'POST', origin: 'null', presentedToken: expected }).ok).toBe(false);
    expect(evaluateCsrf({ ...base, method: 'POST', origin: 'https://erppreflight.com.evil.example', presentedToken: expected }).ok).toBe(false);
  });

  it('falls back to the Referer origin when Origin is absent', () => {
    expect(evaluateCsrf({ ...base, method: 'POST', referer: 'https://evil.example/page', presentedToken: expected }).ok).toBe(false);
    expect(evaluateCsrf({ ...base, method: 'POST', referer: 'http://localhost:4100/projects?x=1', presentedToken: expected }).ok).toBe(true);
    expect(requestSourceOrigin(undefined, undefined)).toBeUndefined();
    expect(requestSourceOrigin('not a url', undefined)).toBe('null');
  });

  it('login-CSRF: a foreign-origin POST is rejected even without a session cookie', () => {
    expect(evaluateCsrf({ ...base, expectedToken: null, method: 'POST', origin: 'https://evil.example' })).toEqual({
      ok: false,
      reason: 'ORIGIN_NOT_ALLOWED',
    });
    expect(evaluateCsrf({ ...base, expectedToken: null, method: 'POST', origin: TRUSTED[1] })).toEqual({ ok: true, reason: 'NO_COOKIE_SESSION' });
    // Non-browser client without cookie and without Origin (CLI, Stripe, local agent).
    expect(evaluateCsrf({ ...base, expectedToken: null, method: 'POST' })).toEqual({ ok: true, reason: 'NO_COOKIE_SESSION' });
  });

  it('Bearer / API-key requests are exempt (cross-site pages cannot attach those headers)', () => {
    expect(evaluateCsrf({ ...base, method: 'POST', tokenAuthenticated: true, origin: 'https://evil.example' })).toEqual({ ok: true, reason: 'TOKEN_AUTH' });
  });

  it('same-host requests (API reference UI) are trusted', () => {
    expect(isTrustedOrigin('http://localhost:4101', TRUSTED, 'localhost:4101')).toBe(true);
    expect(isTrustedOrigin('http://localhost:4199', TRUSTED, 'localhost:4101')).toBe(false);
  });

  it('trusted origins = CORS allowlist + APP_PUBLIC_URL (normalised)', () => {
    expect(resolveTrustedOrigins({ CORS_ORIGIN: 'https://a.example/, https://b.example', APP_PUBLIC_URL: 'https://app.example/x' } as any)).toEqual([
      'https://a.example',
      'https://b.example',
      'https://app.example',
    ]);
    expect(resolveCorsOrigins({ NODE_ENV: 'production' } as any)).toEqual(['https://erppreflight.com', 'https://www.erppreflight.com']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('CsrfGuard (403 CSRF_REJECTED)', () => {
  const cookies = new SessionCookieService(config, jwt);
  const token = sessionToken();
  const csrf = cookies.csrfTokenForAccessToken(token)!;

  function run(req: any, skip = false) {
    process.env.CORS_ORIGIN = TRUSTED.join(',');
    const reflector = { getAllAndOverride: vi.fn((key: string) => (key === SKIP_CSRF_KEY ? skip : undefined)) } as unknown as Reflector;
    const guard = new CsrfGuard(reflector, cookies);
    const ctx = {
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return guard.canActivate(ctx);
  }

  const cookieReq = (headers: Record<string, string> = {}, method = 'POST') => ({
    method,
    originalUrl: '/api/v1/projects',
    headers: { host: 'localhost:4101', cookie: `${SESSION_COOKIE_NAME}=${token}`, ...headers },
  });

  const rejected = (fn: () => unknown) => {
    try {
      fn();
    } catch (err: any) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse().code).toBe('CSRF_REJECTED');
      return true;
    }
    return false;
  };

  it('rejects cookie-auth POST without the header and with a foreign origin', () => {
    expect(rejected(() => run(cookieReq({ origin: TRUSTED[0] })))).toBe(true);
    expect(rejected(() => run(cookieReq({ origin: 'https://evil.example', 'x-csrf-token': csrf })))).toBe(true);
  });

  it('accepts the session-bound header, bearer calls, GETs and skipped routes', () => {
    expect(run(cookieReq({ origin: TRUSTED[0], 'x-csrf-token': csrf }))).toBe(true);
    expect(run(cookieReq({ authorization: `Bearer ${token}`, origin: 'https://evil.example' }))).toBe(true);
    expect(run(cookieReq({ origin: 'https://evil.example' }, 'GET'))).toBe(true);
    expect(run(cookieReq({ origin: 'https://evil.example' }), true)).toBe(true);
  });

  it('a CSRF token of another session does not unlock this session', () => {
    const other = cookies.csrfTokenForAccessToken(sessionToken({ jti: '44444444-4444-4444-8444-444444444444' }))!;
    expect(rejected(() => run(cookieReq({ origin: TRUSTED[0], 'x-csrf-token': other })))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('Magic-link sign-in (spec 10.2)', () => {
  const OPEN = { id: 't', user_id: USER, email: 'k@example.com', expires_at: new Date(Date.now() + 60_000) };

  function build(opts: { user?: any; consumed?: any; ssoEnforced?: boolean } = {}) {
    const userRow = opts.user ?? {
      id: USER,
      email: 'k@example.com',
      status: 'ACTIVE',
      token_version: 3,
      totp_enabled_at: null,
      email_verified_at: new Date(),
    };
    const clientCalls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        clientCalls.push(sql);
        if (/FROM users/.test(sql)) return { rows: userRow ? [userRow] : [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const db: any = {
      getPool: () => ({ connect: async () => client }),
      query: vi.fn(async (sql: string) => {
        if (/UPDATE users SET email_verified_at/.test(sql)) return { rows: [{ id: USER }] };
        if (/FROM users WHERE email/.test(sql)) return { rows: [{ id: USER, email: 'k@example.com', full_name: 'K' }] };
        return { rows: [] };
      }),
    };
    const auth = {
      assertPasswordLoginAllowed: vi.fn(async () => {
        if (opts.ssoEnforced) throw new ForbiddenException({ message: 'SSO', code: 'SSO_REQUIRED' });
      }),
      signMfaChallenge: vi.fn(() => 'challenge'),
      createSession: vi.fn(async () => ({ accessToken: 'jwt', user: { id: USER, organizationId: ORG } })),
    };
    const tokens = {
      countRecent: vi.fn().mockResolvedValue(0),
      issue: vi.fn().mockResolvedValue({ token: 'x'.repeat(43), expiresAt: new Date() }),
      peek: vi.fn().mockResolvedValue(OPEN),
      consume: vi.fn().mockResolvedValue(opts.consumed === undefined ? OPEN : opts.consumed),
      revokeAll: vi.fn().mockResolvedValue(undefined),
    };
    const mail = { send: vi.fn().mockResolvedValue({}), link: vi.fn((p: string, q: any) => `https://app${p}?${new URLSearchParams(q)}`) };
    const audit = { recordForUser: vi.fn().mockResolvedValue(undefined) };
    const svc = new MagicLinkService(db, auth as unknown as AuthService, tokens as any, mail as any, audit as any);
    return { svc, db, auth, tokens, mail, audit, client, clientCalls };
  }

  it('answers known and unknown addresses identically and issues a 15-minute MAGIC_LINK token for known ones', async () => {
    const known = build();
    expect(await known.svc.request('K@example.com', {}, '/projects/1')).toEqual(MAGIC_LINK_REQUEST_RESPONSE);
    await new Promise((r) => setTimeout(r, 10));
    expect(known.tokens.issue).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'MAGIC_LINK', ttlMinutes: MAGIC_LINK_TTL_MINUTES }));
    expect(known.mail.link).toHaveBeenCalledWith('/login/magic', { token: 'x'.repeat(43), next: '/projects/1' });
    expect(known.audit.recordForUser).toHaveBeenCalledWith(USER, 'USER_MAGIC_LINK_REQUESTED', {}, {});

    const unknown = build();
    unknown.db.query = vi.fn().mockResolvedValue({ rows: [] });
    expect(await unknown.svc.request('nobody@example.com')).toEqual(MAGIC_LINK_REQUEST_RESPONSE);
    await new Promise((r) => setTimeout(r, 10));
    expect(unknown.tokens.issue).not.toHaveBeenCalled();
  });

  it('stops issuing after the per-account hourly cap', async () => {
    const { svc, tokens } = build();
    tokens.countRecent.mockResolvedValue(MAGIC_LINK_MAX_PER_HOUR);
    expect(await svc.issue({ id: USER, email: 'k@example.com', full_name: null })).toBe(false);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('signs in with a session (auth method MAGIC_LINK) and revokes other open links in the same transaction', async () => {
    const { svc, auth, tokens, clientCalls } = build();
    const result: any = await svc.signIn('a'.repeat(43), { ip: '1.2.3.4' });
    expect(result.accessToken).toBe('jwt');
    expect(auth.createSession).toHaveBeenCalledWith(USER, { meta: { ip: '1.2.3.4' }, authMethod: 'MAGIC_LINK' });
    expect(tokens.consume).toHaveBeenCalledWith('a'.repeat(43), 'MAGIC_LINK', expect.anything());
    expect(tokens.revokeAll).toHaveBeenCalledWith(USER, 'MAGIC_LINK', expect.anything());
    expect(clientCalls).toContain('COMMIT');
  });

  it('rejects used, expired or unknown links with 401 MAGIC_LINK_INVALID', async () => {
    const { svc, auth } = build({ consumed: null });
    await expect(svc.signIn('a'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
    try {
      await svc.signIn('a'.repeat(43));
    } catch (err: any) {
      expect(err.getResponse().code).toBe('MAGIC_LINK_INVALID');
    }
    expect(auth.createSession).not.toHaveBeenCalled();
  });

  it('rejects deactivated accounts even with a valid link', async () => {
    const { svc } = build({ user: { id: USER, email: 'k@example.com', status: 'SUSPENDED' } });
    await expect(svc.signIn('a'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('SSO-enforced organizations are blocked exactly like password login (403 SSO_REQUIRED, audited)', async () => {
    const { svc, auth, audit } = build({ ssoEnforced: true });
    await expect(svc.signIn('a'.repeat(43))).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.createSession).not.toHaveBeenCalled();
    expect(audit.recordForUser).toHaveBeenCalledWith(USER, 'USER_MAGIC_LINK_BLOCKED_SSO', { code: 'SSO_REQUIRED' }, {});
  });

  it('2FA users continue to the TOTP step with a MAGIC_LINK challenge', async () => {
    const { svc, auth } = build({
      user: { id: USER, email: 'k@example.com', status: 'ACTIVE', token_version: 3, totp_enabled_at: new Date(), email_verified_at: new Date() },
    });
    const result: any = await svc.signIn('a'.repeat(43));
    expect(result).toEqual({ mfaRequired: true, challengeToken: 'challenge', expiresIn: 300 });
    expect(auth.signMfaChallenge).toHaveBeenCalledWith(USER, 3, 'MAGIC_LINK');
    expect(auth.createSession).not.toHaveBeenCalled();
  });

  it('an unverified address becomes verified (mailbox control proven) and is audited', async () => {
    const { svc, db, audit, tokens } = build({
      user: { id: USER, email: 'k@example.com', status: 'ACTIVE', token_version: 0, totp_enabled_at: null, email_verified_at: null },
    });
    await svc.signIn('a'.repeat(43));
    expect(db.query.mock.calls.some((c: any[]) => /UPDATE users SET email_verified_at = NOW\(\)/.test(c[0]))).toBe(true);
    expect(tokens.revokeAll).toHaveBeenCalledWith(USER, 'EMAIL_VERIFICATION');
    expect(audit.recordForUser).toHaveBeenCalledWith(USER, 'USER_EMAIL_VERIFIED', { via: 'MAGIC_LINK' }, {});
  });

  it('preview does not consume the link', async () => {
    const { svc, tokens } = build();
    expect(await svc.preview('a'.repeat(43))).toMatchObject({ valid: true, email: 'k@example.com' });
    expect(tokens.consume).not.toHaveBeenCalled();
    tokens.peek.mockResolvedValue(null);
    expect(await svc.preview('a'.repeat(43))).toEqual({ valid: false });
  });

  it('keeps only same-site relative next paths', () => {
    expect(sanitizeNextPath('/projects/abc?tab=findings')).toBe('/projects/abc?tab=findings');
    expect(sanitizeNextPath('//evil.example')).toBeUndefined();
    expect(sanitizeNextPath('https://evil.example')).toBeUndefined();
    expect(sanitizeNextPath('/\\evil.example')).toBeUndefined();
    expect(sanitizeNextPath('/x"><script>')).toBeUndefined();
    expect(sanitizeNextPath(undefined)).toBeUndefined();
  });

  it('e-mail template states expiry and single use', () => {
    const mail = renderMagicLink({ name: 'Ann', url: 'https://app/login/magic?token=t', expiresMinutes: 15 });
    expect(mail.template).toBe('MAGIC_LINK');
    expect(mail.text).toContain('15 minutes');
    expect(mail.text).toContain('https://app/login/magic?token=t');
  });
});

// ---------------------------------------------------------------------------------------------
describe('MFA challenge remembers the first factor', () => {
  it('magic-link challenges produce MAGIC_LINK_2FA sessions; password challenges stay PASSWORD_2FA', () => {
    const service = new AuthService({} as any, jwt, {} as any, {} as any);
    expect(service.verifyMfaChallenge(service.signMfaChallenge(USER, 1, 'MAGIC_LINK')).firstFactor).toBe('MAGIC_LINK');
    expect(service.verifyMfaChallenge(service.signMfaChallenge(USER, 1)).firstFactor).toBe('PASSWORD');
  });
});
