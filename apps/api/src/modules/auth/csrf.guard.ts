import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CSRF_HEADER_NAME,
  SessionCookieService,
  csrfTokensEqual,
  hasApiKeyCredentials,
  hasBearerCredentials,
} from './session-cookie';

/**
 * CSRF protection for cookie-authenticated browser requests (OWASP CSRF Prevention
 * Cheat Sheet: signed double-submit cookie + Origin/Referer verification).
 *
 * Applied globally (APP_GUARD) to every unsafe request (POST/PUT/PATCH/DELETE):
 *   1. Requests authenticated by `Authorization: Bearer` or `X-Api-Key` are exempt:
 *      a cross-site page cannot attach those headers (CORS preflight), and the
 *      session cookie is ignored when a bearer token is present.
 *   2. The request source (Origin, else Referer) must be a trusted web origin
 *      (CORS_ORIGIN + APP_PUBLIC_URL) or the API's own host. `Origin: null` is foreign.
 *      Requests without either header (non-browser clients) pass this step.
 *   3. When a valid session cookie is present, `X-CSRF-Token` must equal the HMAC of
 *      that session's id (see session-cookie.ts); forged or missing -> 403.
 * Routes that authenticate by other means (Stripe signature, SCIM bearer, agent
 * request signatures) are marked with @SkipCsrf().
 * Rejections are 403 with `code: CSRF_REJECTED`.
 */

export const SKIP_CSRF_KEY = 'erppreflight:skip-csrf';
/** Exempts a route (or controller) that never relies on the session cookie. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const CSRF_REJECTED_CODE = 'CSRF_REJECTED';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const DEV_DEFAULT_ORIGINS = ['http://localhost:3000', 'https://erppreflight.com'];
const PROD_DEFAULT_ORIGINS = ['https://erppreflight.com', 'https://www.erppreflight.com'];

/** CORS allowlist (credentials are only honoured for these origins). */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.CORS_ORIGIN) {
    return env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  }
  return env.NODE_ENV === 'production' ? [...PROD_DEFAULT_ORIGINS] : [...DEV_DEFAULT_ORIGINS];
}

export function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Origins allowed to send cookie-authenticated unsafe requests: CORS allowlist + APP_PUBLIC_URL. */
export function resolveTrustedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const set = new Set<string>();
  for (const origin of resolveCorsOrigins(env)) {
    const normalized = normalizeOrigin(origin);
    if (normalized) set.add(normalized);
  }
  const app = normalizeOrigin(env.APP_PUBLIC_URL);
  if (app) set.add(app);
  return [...set];
}

/**
 * The browser-reported source of the request: the Origin header, else the origin of
 * the Referer. `undefined` when neither is present (non-browser client).
 */
export function requestSourceOrigin(origin: unknown, referer: unknown): string | undefined {
  if (typeof origin === 'string' && origin.trim() !== '') {
    return origin.trim() === 'null' ? 'null' : normalizeOrigin(origin) ?? 'null';
  }
  if (typeof referer === 'string' && referer.trim() !== '') {
    return normalizeOrigin(referer) ?? 'null';
  }
  return undefined;
}

export function isTrustedOrigin(source: string, trustedOrigins: readonly string[], requestHost?: string | null): boolean {
  if (!source || source === 'null') return false;
  if (trustedOrigins.includes(source)) return true;
  // Same-origin calls to the API itself (Swagger UI / API reference on the API host).
  if (requestHost) {
    try {
      return new URL(source).host.toLowerCase() === String(requestHost).trim().toLowerCase();
    } catch {
      return false;
    }
  }
  return false;
}

export type CsrfRejectReason = 'ORIGIN_NOT_ALLOWED' | 'TOKEN_MISSING' | 'TOKEN_INVALID';
export type CsrfDecision =
  | { ok: true; reason: 'SAFE_METHOD' | 'SKIPPED' | 'TOKEN_AUTH' | 'NO_COOKIE_SESSION' | 'TOKEN_VALID' }
  | { ok: false; reason: CsrfRejectReason };

export interface CsrfInput {
  method: string;
  skip?: boolean;
  /** Request carries Bearer or API-key credentials (the cookie is not used). */
  tokenAuthenticated: boolean;
  origin?: unknown;
  referer?: unknown;
  host?: string | null;
  trustedOrigins: readonly string[];
  /** Expected CSRF token when the request carries a valid session cookie; null otherwise. */
  expectedToken: string | null;
  presentedToken?: unknown;
}

/** Pure decision function (unit-tested); CsrfGuard supplies the request facts. */
export function evaluateCsrf(input: CsrfInput): CsrfDecision {
  if (SAFE_METHODS.has(String(input.method || 'GET').toUpperCase())) return { ok: true, reason: 'SAFE_METHOD' };
  if (input.skip) return { ok: true, reason: 'SKIPPED' };
  if (input.tokenAuthenticated) return { ok: true, reason: 'TOKEN_AUTH' };
  const source = requestSourceOrigin(input.origin, input.referer);
  if (source !== undefined && !isTrustedOrigin(source, input.trustedOrigins, input.host)) {
    return { ok: false, reason: 'ORIGIN_NOT_ALLOWED' };
  }
  if (!input.expectedToken) return { ok: true, reason: 'NO_COOKIE_SESSION' };
  const presented = Array.isArray(input.presentedToken) ? input.presentedToken[0] : input.presentedToken;
  if (typeof presented !== 'string' || presented.trim() === '') return { ok: false, reason: 'TOKEN_MISSING' };
  if (!csrfTokensEqual(presented.trim(), input.expectedToken)) return { ok: false, reason: 'TOKEN_INVALID' };
  return { ok: true, reason: 'TOKEN_VALID' };
}

const REJECT_MESSAGES: Record<CsrfRejectReason, string> = {
  ORIGIN_NOT_ALLOWED: 'Request rejected: it did not originate from a trusted ERP Preflight origin.',
  TOKEN_MISSING: 'Request rejected: the CSRF token is missing. Reload the page and try again.',
  TOKEN_INVALID: 'Request rejected: the CSRF token does not match your session. Reload the page and try again.',
};

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);
  private readonly trustedOrigins = resolveTrustedOrigins();

  constructor(
    private readonly reflector: Reflector,
    private readonly cookies: SessionCookieService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    const method = String(req?.method || 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) return true;
    const skip =
      this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [context.getHandler(), context.getClass()]) === true;
    if (skip) return true;

    const tokenAuthenticated = hasBearerCredentials(req) || hasApiKeyCredentials(req);
    const session = tokenAuthenticated ? null : this.cookies.verifiedCookieSession(req);
    const decision = evaluateCsrf({
      method,
      tokenAuthenticated,
      origin: req.headers?.origin,
      referer: req.headers?.referer,
      host: req.headers?.host ?? null,
      trustedOrigins: this.trustedOrigins,
      expectedToken: session?.csrfToken ?? null,
      presentedToken: req.headers?.[CSRF_HEADER_NAME],
    });
    if (!decision.ok) {
      this.logger.warn(
        `CSRF rejected ${method} ${String(req.originalUrl || req.url || '').split('?')[0]}: ${decision.reason}` +
          (decision.reason === 'ORIGIN_NOT_ALLOWED'
            ? ` (origin=${String(req.headers?.origin ?? req.headers?.referer ?? '').slice(0, 200)})`
            : '')
      );
      throw new ForbiddenException({ message: REJECT_MESSAGES[decision.reason], code: CSRF_REJECTED_CODE });
    }
    return true;
  }
}
