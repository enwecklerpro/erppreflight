import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

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

const MAX_TRACKED_KEYS = 50_000;

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
 * In-memory fixed-window limiter for unauthenticated auth endpoints (per API
 * instance). Keys are client IP and client IP + normalized email. Requires
 * Express `trust proxy` to be configured when running behind a reverse proxy
 * so `req.ip` is the real client address.
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(AUTH_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const now = Date.now();
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 320) : '';

    this.sweep(now);

    const scale = rateLimitScale();
    const checks: Array<[string, number]> = [
      [`${rule.name}|ip|${ip}`, Math.ceil(rule.maxPerIp * scale)],
    ];
    if (email && rule.maxPerIpAndEmail > 0) {
      checks.push([
        `${rule.name}|ipmail|${ip}|${email}`,
        Math.ceil(rule.maxPerIpAndEmail * scale),
      ]);
    }

    for (const [key, limit] of checks) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.resetAt > now && bucket.count >= limit) {
        const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        if (res && typeof res.setHeader === 'function') {
          res.setHeader('Retry-After', String(retryAfter));
        }
        throw new HttpException(
          'Too many attempts. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
    }

    for (const [key] of checks) {
      const bucket = this.buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        this.buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      } else {
        bucket.count += 1;
      }
    }
    return true;
  }

  /** Test helper. */
  reset(): void {
    this.buckets.clear();
  }

  private sweep(now: number): void {
    if (this.buckets.size < MAX_TRACKED_KEYS) {
      return;
    }
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
    // Still full (sustained attack from many sources): drop the oldest entries.
    if (this.buckets.size >= MAX_TRACKED_KEYS) {
      const excess = this.buckets.size - Math.floor(MAX_TRACKED_KEYS * 0.9);
      let removed = 0;
      for (const key of this.buckets.keys()) {
        if (removed++ >= excess) break;
        this.buckets.delete(key);
      }
    }
  }
}
