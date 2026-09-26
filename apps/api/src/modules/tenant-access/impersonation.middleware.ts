import { ForbiddenException, Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ImpersonationService } from './impersonation.service';
import { presentedImpersonationToken } from './impersonation-token';
import { decideImpersonationRequest, isImpersonationControlPath } from './impersonation.policy';
import { apiPath } from './tenant-access.policy';
import { clientIpOf } from './client-ip';

/**
 * Runs before TenancyMiddleware on every route (apps/api/src/app.module.ts).
 *
 * When a request presents an impersonation credential (HttpOnly cookie or a Bearer
 * token of type `impersonation`):
 *  1. the session is verified against impersonation_sessions (active, unexpired,
 *     operator still SUPER_ADMIN, target still an active member). An ended or expired
 *     session answers 401 IMPERSONATION_EXPIRED / IMPERSONATION_ENDED and never falls
 *     back to another credential — except on the session-control routes
 *     (GET /impersonation/current, POST /impersonation/end, POST /auth/logout), which
 *     clear the cookie and report the end so the web app can return the operator;
 *  2. the request is checked against impersonation.policy.ts (read-only by default,
 *     secrets never) → 403 IMPERSONATION_READ_ONLY / IMPERSONATION_SECRET_ACCESS_DENIED;
 *  3. the request (allowed or denied) is written to the tenant's hash-chained audit
 *     ledger and the platform ledger with the impersonator's id (fail-closed, 503);
 *  4. `req.impersonation` / `req.impersonationToken` are set; JwtStrategy and
 *     TenancyMiddleware then authenticate the request as the impersonated member.
 * POST /auth/logout while impersonating ends the impersonation and lets the regular
 * logout continue with the operator's own credentials.
 */
@Injectable()
export class ImpersonationMiddleware implements NestMiddleware {
  constructor(private readonly impersonation: ImpersonationService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const anyReq = req as any;
    const path = apiPath(req.originalUrl || req.url);
    if (path === '/health' || path.startsWith('/health/')) return next();

    const presented = presentedImpersonationToken(req);
    if (!presented) return next();

    const method = String(req.method || 'GET').toUpperCase();
    const meta = { clientIp: clientIpOf(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 500) || null };
    const control = isImpersonationControlPath(path, method);
    const outcome = await this.impersonation.authenticate(presented, meta);

    if (outcome.kind === 'invalid') {
      if (presented.source === 'cookie') this.impersonation.clearCookie(res);
      if (control) {
        anyReq.impersonationEnded = {
          code: outcome.code,
          sessionId: outcome.sessionId,
          returnOrganizationId: outcome.returnOrganizationId,
        };
        return next();
      }
      throw new UnauthorizedException({ code: outcome.code, message: outcome.message });
    }

    const ctx = outcome.ctx;
    if (method === 'POST' && path === '/auth/logout') {
      await this.impersonation.end(ctx.id, 'LOGOUT', { id: ctx.impersonatorId, email: ctx.impersonatorEmail }, meta);
      this.impersonation.clearCookie(res);
      return next();
    }

    const decision = decideImpersonationRequest(method, path, ctx.readOnly);
    await this.impersonation.recordRequest(ctx, { method, path }, decision, meta);
    if (!decision.allowed) {
      throw new ForbiddenException({ code: decision.code, message: decision.message });
    }
    anyReq.impersonation = ctx;
    anyReq.impersonationToken = presented.token;
    anyReq.impersonationSource = presented.source;
    return next();
  }
}
