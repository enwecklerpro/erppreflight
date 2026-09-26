import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import type { ActorType } from '@erppreflight/schemas';
import { AUDITED_KEY, AuditContext, AuditSpec } from './audited.decorator';
import { AuditService } from './audit.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function clientIp(request: any): string | null {
  const ip: string | undefined = request?.ip || request?.socket?.remoteAddress;
  if (!ip) return null;
  // INET column: strip IPv4-mapped IPv6 prefix, reject anything unparsable.
  const cleaned = ip.replace(/^::ffff:/, '');
  return /^[0-9a-f:.]+$/i.test(cleaned) ? cleaned : null;
}

/**
 * Records @Audited routes into the tenant's hash-chained audit ledger
 * (spec 10.15, 13.10 #14).
 *
 * Failure policy (documented decision):
 *  - `security: true` events are fail-closed. The audit row is written before
 *    the response is released; if the write fails the client receives 503 and
 *    no success payload (e.g. no session token after login). The underlying
 *    mutation may already be committed — the 503 tells the caller the action
 *    is unconfirmed and operators see an ERROR log.
 *  - other events are fail-open: the response proceeds, the failure is logged
 *    at ERROR level so it surfaces in log alerting.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const spec = this.reflector.get<AuditSpec | undefined>(AUDITED_KEY, context.getHandler());
    if (!spec) return next.handle();

    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      mergeMap(async (result) => {
        await this.recordSuccess(spec, request, result);
        return result;
      }),
      catchError((err) =>
        from(this.recordFailure(spec, request, err)).pipe(mergeMap(() => throwError(() => err)))
      )
    );
  }

  private buildContext(request: any, result: any): AuditContext {
    return {
      request,
      params: request.params ?? {},
      body: request.body ?? {},
      result,
    };
  }

  private actorType(request: any): ActorType {
    if (request.user?.role === 'API_CLIENT') return 'API_KEY';
    if (request.user) return 'HUMAN';
    return 'SYSTEM';
  }

  private async recordSuccess(spec: AuditSpec, request: any, result: any): Promise<void> {
    const ctx = this.buildContext(request, result);
    const fromResult = spec.tenantFromResult?.(result) ?? null;
    const organizationId: string | undefined =
      request.tenantId || request.user?.organizationId || fromResult?.organizationId;
    const actorId: string | null = request.user?.id ?? fromResult?.actorId ?? null;

    if (!isUuid(organizationId)) {
      this.logger.warn(`Audit '${String(spec.action)}' skipped: no tenant context`);
      return;
    }

    const action = typeof spec.action === 'function' ? spec.action(ctx) : spec.action;
    const rawTarget = spec.targetId?.(ctx) ?? null;
    const payload: Record<string, unknown> = {
      ...(spec.payload?.(ctx) ?? {}),
      outcome: 'SUCCESS',
      ...(rawTarget && !isUuid(rawTarget) ? { targetRef: String(rawTarget).slice(0, 200) } : {}),
    };

    try {
      await this.audit.recordEvent({
        organizationId,
        action,
        resourceType: spec.targetType,
        resourceId: isUuid(rawTarget) ? rawTarget : null,
        payload,
        actorType: request.user ? this.actorType(request) : fromResult?.actorId ? 'HUMAN' : 'SYSTEM',
        actorId: isUuid(actorId) ? actorId : null,
        clientIp: clientIp(request),
        userAgent: String(request.headers?.['user-agent'] ?? '').slice(0, 500) || null,
      });
    } catch (err: any) {
      this.logger.error(`Audit write failed for '${action}' (org=${organizationId}): ${err?.message ?? err}`);
      if (spec.security) {
        throw new ServiceUnavailableException(
          'Audit trail is unavailable; this security-relevant action could not be confirmed. Please retry.'
        );
      }
    }
  }

  private async recordFailure(spec: AuditSpec, request: any, err: unknown): Promise<void> {
    if (!spec.failureAction) return;
    const status = err instanceof HttpException ? err.getStatus() : 500;
    try {
      let organizationId: string | null = request.tenantId || request.user?.organizationId || null;
      let actorId: string | null = request.user?.id ?? null;
      let email: string | null = null;

      if (!organizationId && spec.failureTenant === 'loginEmail') {
        email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase().slice(0, 254) : null;
        if (email) {
          const account = await this.audit.resolveAccountForEmail(email);
          organizationId = account?.organizationId ?? null;
          actorId = account?.userId ?? null;
        }
      }
      if (!isUuid(organizationId)) {
        // Unknown account: nothing tenant-scoped to attach to. Structured log only.
        this.logger.warn(`${spec.failureAction}: no tenant ledger (status ${status})`);
        return;
      }
      await this.audit.recordEvent({
        organizationId,
        action: spec.failureAction,
        resourceType: spec.targetType,
        resourceId: null,
        payload: {
          outcome: 'FAILURE',
          httpStatus: status,
          ...(email ? { email } : {}),
          reason: err instanceof HttpException ? String(err.message).slice(0, 200) : 'internal_error',
        },
        actorType: request.user ? this.actorType(request) : 'HUMAN',
        actorId: isUuid(actorId) ? actorId : null,
        clientIp: clientIp(request),
        userAgent: String(request.headers?.['user-agent'] ?? '').slice(0, 500) || null,
      });
    } catch (auditErr: any) {
      // The original error is rethrown by the caller; never mask it.
      this.logger.error(`Audit write failed for '${spec.failureAction}': ${auditErr?.message ?? auditErr}`);
    }
  }
}
