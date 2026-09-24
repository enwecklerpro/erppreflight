import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@erppreflight/schemas';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user, tenantRole } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (user.systemRole === 'SUPER_ADMIN') {
      return true;
    }

    const currentRole = tenantRole || user.role;
    if (requiredRoles.includes(currentRole)) {
      return true;
    }

    throw new ForbiddenException(
      `Insufficient permissions: Requires one of [${requiredRoles.join(', ')}]`
    );
  }
}
