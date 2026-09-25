import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    if (user.systemRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super Admin privilege required');
    }
    return true;
  }
}
