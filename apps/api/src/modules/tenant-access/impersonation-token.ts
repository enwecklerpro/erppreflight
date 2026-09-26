/**
 * Impersonation credential (spec 10.8 / C §24).
 *
 * A dedicated JWT, distinct from session tokens:
 *   { typ: 'impersonation', sub: <impersonated member>, organizationId, role,
 *     imp: <impersonation_sessions.id>, act: <impersonator user id>, exp = session expiry }
 * Because of `typ`, every code path that only knows session tokens rejects it
 * (fail closed); only ImpersonationMiddleware, TenancyMiddleware and JwtStrategy
 * accept it, and only after the impersonation_sessions row was verified active.
 *
 * Browsers receive it exclusively in the HttpOnly cookie `erppreflight_impersonation`
 * (never in a response body or script-readable storage). While that cookie is
 * present it takes precedence over the operator's own session, so every tab of that
 * browser acts as the impersonated member (read-only) until the session ends.
 * Non-browser clients (scripts, the live E2E suite) get the token in the response
 * body and present it as `Authorization: Bearer`.
 */

export const IMPERSONATION_TOKEN_TYPE = 'impersonation';
export const IMPERSONATION_COOKIE_NAME = 'erppreflight_impersonation';
export const IMPERSONATION_MAX_MINUTES = 30;
export const IMPERSONATION_DEFAULT_MINUTES = 15;

export interface ImpersonationTokenPayload {
  typ: typeof IMPERSONATION_TOKEN_TYPE;
  sub: string;
  email: string;
  organizationId: string;
  role: string;
  systemRole: 'USER';
  imp: string;
  act: string;
  iat?: number;
  exp?: number;
}

export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface ImpersonationCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: CookieSameSite;
  path: '/';
  maxAge?: number;
  domain?: string;
}

const COOKIE_DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Same attributes as the browser session cookie: SESSION_COOKIE_SAMESITE (default lax),
 * SESSION_COOKIE_SECURE (default: true in production; SameSite=None forces Secure) and
 * SESSION_COOKIE_DOMAIN (unset = host-only on the API host, recommended).
 */
export function impersonationCookieOptions(
  env: NodeJS.ProcessEnv = process.env,
  maxAgeMs?: number
): ImpersonationCookieOptions {
  const rawSameSite = String(env.SESSION_COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  const sameSite: CookieSameSite = rawSameSite === 'strict' || rawSameSite === 'none' ? rawSameSite : 'lax';
  const secureRaw = String(env.SESSION_COOKIE_SECURE ?? '').trim().toLowerCase();
  const secure = sameSite === 'none' ? true : secureRaw === 'true' ? true : secureRaw === 'false' ? false : env.NODE_ENV === 'production';
  const domain = String(env.SESSION_COOKIE_DOMAIN ?? '').trim().toLowerCase().replace(/^\./, '');
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: Math.max(1000, Math.floor(maxAgeMs)) } : {}),
    ...(domain && COOKIE_DOMAIN_RE.test(domain) ? { domain } : {}),
  };
}

export function readCookie(req: any, name: string): string | null {
  if (!req) return null;
  if (req.cookies && typeof req.cookies[name] === 'string' && req.cookies[name]) return req.cookies[name];
  const header = req.headers?.cookie;
  if (typeof header !== 'string' || !header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1 || part.slice(0, idx).trim() !== name) continue;
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

/** Unverified peek at a JWT payload (only used to route a Bearer token; verification follows). */
export function peekJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

export interface PresentedImpersonationToken {
  token: string;
  source: 'cookie' | 'bearer';
}

/**
 * The impersonation credential presented with a request, if any: the HttpOnly cookie
 * first (it deliberately overrides the operator's own session), else a Bearer token
 * whose payload is of type `impersonation`.
 */
export function presentedImpersonationToken(req: any): PresentedImpersonationToken | null {
  const cookie = readCookie(req, IMPERSONATION_COOKIE_NAME);
  if (cookie) return { token: cookie, source: 'cookie' };
  const auth = req?.headers?.authorization;
  const bearer = typeof auth === 'string' ? /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1] : undefined;
  if (bearer && peekJwtPayload(bearer)?.typ === IMPERSONATION_TOKEN_TYPE) {
    return { token: bearer, source: 'bearer' };
  }
  return null;
}

/**
 * passport-jwt extractor: the impersonation token verified by ImpersonationMiddleware
 * for this request (null otherwise, so the regular Bearer / cookie extractors apply).
 */
export const verifiedImpersonationTokenExtractor = (req: any): string | null =>
  typeof req?.impersonationToken === 'string' && req.impersonationToken ? req.impersonationToken : null;

/** Browser requests carry Origin or Sec-Fetch-Site (forbidden header names script cannot forge). */
export function isBrowserRequest(req: any): boolean {
  const h = req?.headers ?? {};
  return typeof h.origin === 'string' || typeof h['sec-fetch-site'] === 'string';
}
