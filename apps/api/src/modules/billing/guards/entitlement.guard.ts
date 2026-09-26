import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  HttpException,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntitlementsService } from '../entitlements.service';
import { EntitlementFeature } from '../billing.interface';
import { AuditService } from '../../audit/audit.service';

export const REQUIRE_ENTITLEMENT_KEY = 'require_entitlement';
export const RequireEntitlement = (feature: EntitlementFeature) =>
  SetMetadata(REQUIRE_ENTITLEMENT_KEY, feature);

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlementsService: EntitlementsService,
    @Optional() private readonly audit?: AuditService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<EntitlementFeature>(
      REQUIRE_ENTITLEMENT_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredFeature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    // Only the membership-verified tenant (TenancyMiddleware / API key) is trusted;
    // the raw X-Tenant-Id header is never used here.
    const tenantId = request.tenantId || request.user?.organizationId;

    if (!tenantId) {
      return true; // Let tenant / auth guard handle missing tenant
    }

    try {
      await this.entitlementsService.checkEntitlement(tenantId, requiredFeature);
    } catch (err) {
      if (err instanceof HttpException) {
        // Plan-limit denials are billing-relevant events (spec 10.15); best-effort record.
        await this.audit?.recordSafe({
          organizationId: tenantId,
          action: 'billing.entitlement.denied',
          resourceType: 'ENTITLEMENT',
          payload: {
            feature: requiredFeature,
            httpStatus: err.getStatus(),
            route: `${request.method} ${request.route?.path ?? request.url}`,
          },
          actorType: request.user?.role === 'API_CLIENT' ? 'API_KEY' : 'HUMAN',
          actorId: request.user?.id ?? null,
        });
      }
      throw err;
    }
    return true;
  }
}
