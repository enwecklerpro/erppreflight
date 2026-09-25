import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenancyContext } from '@erppreflight/tenancy';
import { validate as isValidUuid } from 'uuid';
import { DatabaseService } from '../database/database.service';
import * as crypto from 'node:crypto';

@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  constructor(private readonly db: DatabaseService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const headerTenantId = req.headers['x-tenant-id'] as string;
    const userTenantId = (req as any).user?.organizationId;
    const routeTenantId = req.params?.tenantId || req.params?.workspaceId;

    let tenantId = headerTenantId || userTenantId || routeTenantId;

    const apiKey = req.headers['x-api-key'] as string;
    if (!tenantId && apiKey) {
      try {
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const result = await this.db.query(
          `SELECT organization_id, created_by, scopes FROM api_keys WHERE key_hash = $1 AND status = 'ACTIVE'`,
          [keyHash],
          { bypassRls: true }
        );
        if (result.rows && result.rows.length > 0) {
          tenantId = result.rows[0].organization_id;
          (req as any).user = {
            id: result.rows[0].created_by,
            organizationId: result.rows[0].organization_id,
            role: 'API_CLIENT',
            scopes: result.rows[0].scopes,
          };
        }
      } catch {
        // Continue and let guards handle invalid state
      }
    }

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
