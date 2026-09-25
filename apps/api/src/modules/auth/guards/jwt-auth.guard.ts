import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import {
  apiKeyScopesAllow,
  normalizeScopes,
  DENY_API_KEY_AUTH,
} from '../../api-keys/api-key-scopes';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    @Optional() private readonly apiKeysService?: ApiKeysService,
    @Optional() private readonly reflector?: Reflector
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers?.['x-api-key'] as string | undefined;

    if (apiKey) {
      if (!this.apiKeysService) {
        throw new UnauthorizedException('API key authentication is not available on this route');
      }

      const denyApiKey = this.reflector?.getAllAndOverride<boolean>(DENY_API_KEY_AUTH, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (denyApiKey) {
        throw new ForbiddenException('API keys cannot be used for this operation; sign in interactively');
      }

      const validKey = await this.apiKeysService.validateKey(apiKey);
      if (!validKey) {
        throw new UnauthorizedException('Invalid or expired API Key');
      }

      // The tenant middleware rejects mismatching X-Tenant-Id headers; re-check defensively.
      if (request.tenantId && request.tenantId !== validKey.organization_id) {
        throw new ForbiddenException('Access denied: API Key not authorized for this tenant');
      }

      const scopes = normalizeScopes(validKey.scopes);
      if (!apiKeyScopesAllow(request.method, scopes)) {
        throw new ForbiddenException('API key scopes do not permit this operation');
      }

      request.user = {
        id: validKey.created_by,
        userId: validKey.created_by,
        organizationId: validKey.organization_id,
        role: 'API_CLIENT',
        systemRole: 'USER',
        scopes,
      };

      request.tenantId = validKey.organization_id;
      request.tenantRole = 'API_CLIENT';
      request.userId = validKey.created_by;
      request.roles = ['API_CLIENT'];

      return true;
    }

    const ok = (await super.canActivate(context)) as boolean;

    // Align the authenticated principal with the membership-verified tenant
    // resolved by TenancyMiddleware, so `req.user.organizationId` always names
    // the active (verified) tenant rather than the token's home organization.
    if (ok && request.user && request.tenantId) {
      request.user.organizationId = request.tenantId;
      if (request.tenantRole) {
        request.user.role = request.tenantRole;
      }
    }

    return ok;
  }
}
