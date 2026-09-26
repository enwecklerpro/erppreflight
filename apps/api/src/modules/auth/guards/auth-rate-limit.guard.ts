import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitBudget, RateLimiterService } from '../../rate-limit/rate-limiter.service';

export interface RateLimitRule {
  /** Bucket namespace, e.g. 'login'. */
  name: string;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests per client IP within the window. */
  maxPerIp: number;
  /** Max requests per client IP + submitted email within the window (0 = disabled). */
  maxPerIpAndEmail: number;
}

export const AUTH_RATE_LIMIT_KEY = 'auth_rate_limit';
export const AuthRateLimit = (rule: RateLimitRule) => SetMetadata(AUTH_RATE_LIMIT_KEY, rule);

export const LOGIN_RATE_LIMIT: RateLimitRule = {
  name: 'login',
  windowMs: 15 * 60 * 1000,
  maxPerIp: 100,
  maxPerIpAndEmail: 10,
};

export const REGISTER_RATE_LIMIT: RateLimitRule = {
  name: 'register',
  windowMs: 60 * 60 * 1000,
  maxPerIp: 10,
  maxPerIpAndEmail: 3,
};

export const VERIFY_EMAIL_RATE_LIMIT: RateLimitRule = {
  name: 'verify-email',
  windowMs: 15 * 60 * 1000,
  maxPerIp: 60,
  maxPerIpAndEmail: 0,
};

export const RESEND_VERIFICATION_RATE_LIMIT: RateLimitRule = {
  name: 'resend-verification',
  windowMs: 60 * 60 * 1000,
  maxPerIp: 20,
  maxPerIpAndEmail: 0,
};

export const FORGOT_PASSWORD_RATE_LIMIT: RateLimitRule = {
  name: 'forgot-password',
  windowMs: 60 * 60 * 1000,
  maxPerIp: 20,
  maxPerIpAndEmail: 5,
};

export const RESET_PASSWORD_RATE_LIMIT: RateLimitRule = {
  name: 'reset-password',
  windowMs: 15 * 60 * 1000,
  maxPerIp: 30,
  maxPerIpAndEmail: 0,
};

export const MFA_LOGIN_RATE_LIMIT: RateLimitRule = {
  name: 'mfa-login',
  windowMs: 15 * 60 * 1000,
  maxPerIp: 30,
  maxPerIpAndEmail: 0,
};

export const INVITATION_RATE_LIMIT: RateLimitRule = {
  name: 'invitation',
  windowMs: 15 * 60 * 1000,
  maxPerIp: 60,
  maxPerIpAndEmail: 0,
};

/**
 * Multiplier applied to all limits. Defaults to 1 in production and 20 elsewhere
 * (local E2E suites log in repeatedly from one IP). Override with AUTH_RATE_LIMIT_SCALE.
 */
export function rateLimitScale(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.AUTH_RATE_LIMIT_SCALE);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return env.NODE_ENV === 'production' ? 1 : 20;
}

/**
 * Fixed-window limiter for unauthenticated / brute-forceable endpoints, backed by the
 * shared Redis RateLimiterService so the budget holds across ALL API instances.
 * Keys are client IP and client IP + normalized e-mail (both hashed in Redis). Requires
 * Express `trust proxy` behind a reverse proxy so `req.ip` is the real client address.
 * Redis unavailable: see RateLimitFailureMode (bounded in-memory fallback by default,
 * HTTP 503 in 'closed' mode).
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(AUTH_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const rawEmail = req.body?.email ?? req.query?.email;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase().slice(0, 320) : '';

    const scale = rateLimitScale();
    const budgets: RateLimitBudget[] = [{ scope: 'ip', id: ip, limit: Math.ceil(rule.maxPerIp * scale) }];
    if (email && rule.maxPerIpAndEmail > 0) {
      budgets.push({ scope: 'ipmail', id: `${ip}|${email}`, limit: Math.ceil(rule.maxPerIpAndEmail * scale) });
    }

    const decision = await this.limiter.consume(rule.name, budgets, rule.windowMs);
    if (decision.allowed) {
      return true;
    }
    const retryAfter = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    if (res && typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', String(retryAfter));
    }
    if (decision.backend === 'unavailable') {
      throw new ServiceUnavailableException('Sign-in protection is temporarily unavailable. Please try again shortly.');
    }
    throw new HttpException('Too many attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
