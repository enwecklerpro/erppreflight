import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { TenancyContext } from '@erppreflight/tenancy';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const store = TenancyContext.get();

    if (!store?.tenantId) {
      throw new ForbiddenException(
        'Tenant context (X-Tenant-Id) is required for this operation'
      );
    }

    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Membership already verified by TenancyMiddleware for this exact tenant
    if (request.tenantId === store.tenantId && request.tenantRole) {
      return true;
    }

    // Super Admin bypass
    if (user.systemRole === 'SUPER_ADMIN') {
      return true;
    }

    // API Key Client bypass when organization matches
    if (user.role === 'API_CLIENT') {
      if (user.organizationId === store.tenantId) {
        request.tenantRole = 'API_CLIENT';
        return true;
      }
      throw new ForbiddenException('Access denied: API Key not authorized for this tenant');
    }

    // Check user organization membership
    const membership = await this.db.query(
      'SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
      [store.tenantId, user.id],
      { bypassRls: true }
    );

    if (membership.rows.length === 0) {
      throw new ForbiddenException(
        'Access denied: You are not an active member of this tenant'
      );
    }

    request.tenantRole = membership.rows[0].role;
    return true;
  }
}
