import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, mergeMap } from 'rxjs';
import { METERED_KEY, MeterSpec } from './metered.decorator';
import { UsageService } from './usage.service';

/**
 * Records metered usage for routes annotated with @Metered once the handler
 * has succeeded. Metering is best-effort (UsageService.recordSafe): a metering
 * outage never fails a customer request; it is logged at ERROR level.
 */
@Injectable()
export class UsageInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly usage: UsageService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const specs = this.reflector.get<MeterSpec[] | undefined>(METERED_KEY, context.getHandler());
    if (!specs || specs.length === 0) return next.handle();

    const request = context.switchToHttp().getRequest();
    return next.handle().pipe(
      mergeMap(async (result) => {
        const organizationId: string | undefined = request.tenantId || request.user?.organizationId;
        if (!organizationId) return result;
        for (const spec of specs) {
          const ctx = { request, result };
          const quantity = spec.quantity ? spec.quantity(ctx) : 1;
          if (quantity === null || quantity === undefined || quantity <= 0) continue;
          await this.usage.recordSafe(organizationId, spec.metric, quantity, {
            resourceType: spec.resourceType ?? null,
            resourceId: spec.resourceId?.(ctx) ?? null,
            actorId: request.user?.id ?? null,
            metadata: spec.metadata?.(ctx) ?? {},
          });
        }
        return result;
      })
    );
  }
}
