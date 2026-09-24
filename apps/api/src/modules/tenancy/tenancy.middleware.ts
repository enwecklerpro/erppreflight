import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenancyContext } from '@erppreflight/tenancy';
import { validate as isValidUuid } from 'uuid';

@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const headerTenantId = req.headers['x-tenant-id'] as string;
    const userTenantId = (req as any).user?.organizationId;
    const routeTenantId = req.params?.tenantId || req.params?.workspaceId;

    const tenantId = headerTenantId || userTenantId || routeTenantId;

    if (tenantId) {
      if (!isValidUuid(tenantId)) {
        throw new BadRequestException('Invalid Tenant ID format. Must be a valid UUID');
      }
      TenancyContext.run(
        {
          tenantId,
          userId: (req as any).user?.id,
          roles: (req as any).user?.role ? [(req as any).user.role] : [],
        },
        () => next()
      );
    } else {
      next();
    }
  }
}
