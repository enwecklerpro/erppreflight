import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenancyContext } from '@erppreflight/tenancy';

export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    if (request.tenantId) {
      return request.tenantId;
    }
    return TenancyContext.getTenantId();
  }
);
