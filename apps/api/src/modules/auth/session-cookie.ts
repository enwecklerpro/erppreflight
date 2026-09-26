import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Browser session transport (spec C §8.2 / §68: no primary auth token in localStorage).
 *
 * - The access token (JWT bound to a server-side session, `jti`) travels ONLY in the
 *   HttpOnly cookie `erppreflight_session`. Responses to browser requests never
 *   contain it in the body, so script code (including injected script) cannot read
 *   or exfiltrate it.
 * - CSRF defence for cookie-authenticated unsafe requests is the OWASP
 *   "signed double-submit cookie" pattern: the CSRF token is an HMAC of the session
 *   id under a server key. It is handed to the web app in the non-HttpOnly
 *   `erp_csrf` cookie (readable when web and API share a cookie scope), in the body
 *   of every session-issuing response (`csrfToken`) and by `GET /auth/csrf`, and
 *   must come back in the `X-CSRF-Token` header (see csrf.guard.ts).
 * - Non-browser clients (CLI, local agent, scripts) keep receiving `accessToken` in
 *   the body and authenticate with `Authorization: Bearer` (or an API key).
 */

export const SESSION_COOKIE_NAME = 'erppreflight_session';
export const CSRF_COOKIE_NAME = 'erp_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
/** Fallback cookie lifetime when the token expiry cannot be decoded (matches JWT_EXPIRES_IN default). */
export const DEFAULT_SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface SessionCookieSettings {
  /** Parent domain shared by web and API (e.g. `erppreflight.com`); unset = host-only cookies. */
  domain?: string;
  sameSite: CookieSameSite;
  secure: boolean;
}

const SAME_SITE_VALUES: readonly CookieSameSite[] = ['lax', 'strict', 'none'];
/** A bare registrable domain / hostname: labels of [a-z0-9-], no scheme, port or path. */
const COOKIE_DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function normalizeCookieDomain(raw: string | undefined | null): string | undefined {
  const value = String(raw ?? '').trim().toLowerCase().replace(/^\./, '');
  return value ? value : undefined;
}

export function isValidCookieDomain(raw: string | undefined | null): boolean {
  const value = normalizeCookieDomain(raw);
  return value === undefined || COOKIE_DOMAIN_RE.test(value);
}

/**
 * Cookie attributes from SESSION_COOKIE_DOMAIN / SESSION_COOKIE_SAMESITE /
 * SESSION_COOKIE_SECURE (validated in config/env.validation.ts). Secure defaults to
 * true in production; SameSite=None always forces Secure (browsers require it).
 */
export function resolveSessionCookieSettings(env: NodeJS.ProcessEnv = process.env): SessionCookieSettings {
  const rawSameSite = String(env.SESSION_COOKIE_SAMESITE || 'lax').trim().toLowerCase() as CookieSameSite;
  const sameSite = SAME_SITE_VALUES.includes(rawSameSite) ? rawSameSite : 'lax';
  const secureRaw = String(env.SESSION_COOKIE_SECURE ?? '').trim().toLowerCase();
  const secure =
    secureRaw === 'true' ? true : secureRaw === 'false' ? false : env.NODE_ENV === 'production';
  const domain = normalizeCookieDomain(env.SESSION_COOKIE_DOMAIN);
  return {
    ...(domain && isValidCookieDomain(domain) ? { domain } : {}),
    sameSite,
    secure: sameSite === 'none' ? true : secure,
  };
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: CookieSameSite;
  path: string;
  maxAge?: number;
  domain?: string;
}

export function sessionCookieOptions(settings: SessionCookieSettings, maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: settings.secure,
    sameSite: settings.sameSite,
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
    ...(settings.domain ? { domain: settings.domain } : {}),
  };
}

/** The CSRF cookie is deliberately readable by script (it is not a credential on its own). */
export function csrfCookieOptions(settings: SessionCookieSettings, maxAgeMs?: number): CookieOptions {
  return { ...sessionCookieOptions(settings, maxAgeMs), httpOnly: false };
}

/** Remaining lifetime of a JWT in milliseconds (bounded to 1 s .. 400 days). */
export function tokenMaxAgeMs(payload: { exp?: number } | null | undefined, now = Date.now()): number {
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp <= 0) return DEFAULT_SESSION_COOKIE_MAX_AGE_MS;
  return Math.min(Math.max(exp * 1000 - now, 1000), 400 * 24 * 60 * 60 * 1000);
}

// ------------------------------------------------------------------------ CSRF tokens

/** Key for CSRF tokens, derived from JWT_SECRET with a distinct label (never the JWT key itself). */
export function deriveCsrfKey(secret: string): Buffer {
  return createHmac('sha256', String(secret)).update('erppreflight:csrf-token:v1').digest();
}

/** Stable session identifier a CSRF token is bound to: the server-side session id (jti). */
export function csrfBinding(payload: { sub?: unknown; jti?: unknown; iat?: unknown } | null | undefined): string | null {
  if (!payload || typeof payload.sub !== 'string' || !payload.sub) return null;
  if (typeof payload.jti === 'string' && payload.jti) return `jti:${payload.jti}`;
  return `sub:${payload.sub}:${String(payload.iat ?? '')}`;
}

export function csrfTokenFor(key: Buffer, binding: string): string {
  return createHmac('sha256', key).update(binding, 'utf8').digest('base64url');
}

/** Constant-time comparison of two CSRF tokens. */
export function csrfTokensEqual(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string' || presented.length === 0 || presented.length > 256) return false;
  const a = createHmac('sha256', 'cmp').update(presented).digest();
  const b = createHmac('sha256', 'cmp').update(expected).digest();
  return timingSafeEqual(a, b);
}

// ------------------------------------------------------------------------ request helpers

export function readCookie(req: Pick<Request, 'headers'> | any, name: string): string | null {
  if (!req) return null;
  if (req.cookies && typeof req.cookies[name] === 'string' && req.cookies[name]) return req.cookies[name];
  const header = req.headers?.cookie;
  if (typeof header !== 'string' || !header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const value = part.slice(idx + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * True for requests issued by a web browser. Browsers attach `Origin` to every
 * POST (same- and cross-origin) and `Sec-Fetch-Site` to every request; page script
 * can neither remove nor forge them (forbidden header names). `Sec-Fetch-Mode` is
 * deliberately ignored: server-side fetch implementations (Node/undici) send it too.
 */
export function isBrowserRequest(req: Pick<Request, 'headers'> | any): boolean {
  const h = req?.headers ?? {};
  return typeof h.origin === 'string' || typeof h['sec-fetch-site'] === 'string';
}

/** A usable `Authorization: Bearer <token>` header (an empty token does not count). */
export function hasBearerCredentials(req: Pick<Request, 'headers'> | any): boolean {
  const auth = req?.headers?.authorization;
  return typeof auth === 'string' && /^Bearer\s+\S+/i.test(auth);
}

export function hasApiKeyCredentials(req: Pick<Request, 'headers'> | any): boolean {
  const key = req?.headers?.['x-api-key'];
  return typeof key === 'string' && key.length > 0;
}

export interface IssuedSession {
  accessToken: string;
}

export type PresentedSession<T extends IssuedSession> = Omit<T, 'accessToken'> & {
  accessToken?: string;
  csrfToken: string;
};

/**
 * Issues and clears the session + CSRF cookies with one consistent set of
 * attributes (a cookie set with a Domain can only be cleared with the same Domain).
 */
@Injectable()
export class SessionCookieService {
  private readonly csrfKey: Buffer;
  private readonly settings: SessionCookieSettings;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService
  ) {
    this.csrfKey = deriveCsrfKey(config.getOrThrow<string>('JWT_SECRET'));
    this.settings = resolveSessionCookieSettings();
  }

  get cookieSettings(): SessionCookieSettings {
    return this.settings;
  }

  /** CSRF token bound to the session inside `accessToken` (null for an undecodable token). */
  csrfTokenForAccessToken(accessToken: string): string | null {
    let payload: any = null;
    try {
      payload = this.jwt.decode(accessToken);
    } catch {
      payload = null;
    }
    const binding = csrfBinding(payload);
    return binding ? csrfTokenFor(this.csrfKey, binding) : null;
  }

  /**
   * The session presented in the `erppreflight_session` cookie, if it is a valid
   * (signed, unexpired) access token. Session revocation is checked later by
   * JwtStrategy; CSRF only needs to know the cookie would authenticate the request.
   */
  verifiedCookieSession(req: any): { payload: any; csrfToken: string } | null {
    const token = readCookie(req, SESSION_COOKIE_NAME);
    if (!token) return null;
    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch {
      return null;
    }
    if (!payload || payload.typ) return null;
    const binding = csrfBinding(payload);
    if (!binding) return null;
    return { payload, csrfToken: csrfTokenFor(this.csrfKey, binding) };
  }

  /** Sets the session + CSRF cookies for `accessToken`; returns the CSRF token. */
  setSessionCookies(res: Response | undefined, accessToken: string): string | null {
    let payload: any = null;
    try {
      payload = this.jwt.decode(accessToken);
    } catch {
      payload = null;
    }
    const binding = csrfBinding(payload);
    const csrfToken = binding ? csrfTokenFor(this.csrfKey, binding) : null;
    if (res && typeof res.cookie === 'function') {
      const maxAge = tokenMaxAgeMs(payload);
      this.clearHostOnlyLeftovers(res);
      res.cookie(SESSION_COOKIE_NAME, accessToken, sessionCookieOptions(this.settings, maxAge));
      if (csrfToken) {
        res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions(this.settings, maxAge));
      }
    }
    return csrfToken;
  }

  /** Re-issues only the CSRF cookie (GET /auth/csrf). */
  setCsrfCookie(res: Response | undefined, csrfToken: string, payload: { exp?: number }): void {
    if (res && typeof res.cookie === 'function') {
      res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions(this.settings, tokenMaxAgeMs(payload)));
    }
  }

  clearSessionCookies(res: Response | undefined): void {
    if (!res || typeof res.clearCookie !== 'function') return;
    const { maxAge: _s, ...sessionOpts } = sessionCookieOptions(this.settings);
    const { maxAge: _c, ...csrfOpts } = csrfCookieOptions(this.settings);
    res.clearCookie(SESSION_COOKIE_NAME, sessionOpts);
    res.clearCookie(CSRF_COOKIE_NAME, csrfOpts);
    this.clearHostOnlyLeftovers(res);
  }

  /**
   * With SESSION_COOKIE_DOMAIN configured, drops host-only cookies issued before it
   * was set. Otherwise the browser would send both `erppreflight_session` cookies and
   * the older host-only one (listed first) would keep authenticating the previous
   * session after a new sign-in.
   */
  private clearHostOnlyLeftovers(res: Response): void {
    if (!this.settings.domain || typeof res.clearCookie !== 'function') return;
    const { maxAge: _s, domain: _d1, ...hostSession } = sessionCookieOptions(this.settings);
    const { maxAge: _c, domain: _d2, ...hostCsrf } = csrfCookieOptions(this.settings);
    res.clearCookie(SESSION_COOKIE_NAME, hostSession);
    res.clearCookie(CSRF_COOKIE_NAME, hostCsrf);
  }

  /**
   * Sets the cookies and shapes the response body: browser requests never receive
   * the access token (cookie only); non-browser clients receive it for Bearer use.
   */
  present<T extends IssuedSession>(req: any, res: Response | undefined, session: T): PresentedSession<T> {
    const csrfToken = this.setSessionCookies(res, session.accessToken) ?? '';
    const { accessToken, ...rest } = session;
    return isBrowserRequest(req)
      ? ({ ...rest, csrfToken } as PresentedSession<T>)
      : ({ ...rest, accessToken, csrfToken } as PresentedSession<T>);
  }
}
