import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenancyContext } from '@erppreflight/tenancy';

/**
 * Returns the membership-verified tenant for the request.
 *
 * `request.tenantId` and the TenancyContext are only populated by
 * TenancyMiddleware / JwtAuthGuard after the caller's membership (or API key
 * ownership) has been verified; an unverified X-Tenant-Id header is never used.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const tenantId = request.tenantId || TenancyContext.get()?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('A verified tenant context is required for this operation');
    }
    return tenantId;
  }
);
