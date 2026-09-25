import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntitlementsService } from '../entitlements.service';
import { EntitlementFeature } from '../billing.interface';

export const REQUIRE_ENTITLEMENT_KEY = 'require_entitlement';
export const RequireEntitlement = (feature: EntitlementFeature) =>
  SetMetadata(REQUIRE_ENTITLEMENT_KEY, feature);

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlementsService: EntitlementsService
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
    const tenantId = request.tenantId || request.headers['x-tenant-id'] || request.user?.tenantId;

    if (!tenantId) {
      return true; // Let tenant / auth guard handle missing tenant
    }

    await this.entitlementsService.checkEntitlement(tenantId, requiredFeature);
    return true;
  }
}
