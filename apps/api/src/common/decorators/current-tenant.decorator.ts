import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenancyContext } from '@erppreflight/tenancy';

export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    return TenancyContext.getTenantId();
  }
);
