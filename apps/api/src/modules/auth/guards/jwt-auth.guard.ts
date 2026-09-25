import { Injectable, ExecutionContext, UnauthorizedException, Optional } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { TenancyContext } from '@erppreflight/tenancy';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(@Optional() private readonly apiKeysService?: ApiKeysService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string;

    if (apiKey && this.apiKeysService) {
      const validKey = await this.apiKeysService.validateKey(apiKey);
      if (!validKey) {
        throw new UnauthorizedException('Invalid or expired API Key');
      }

      request.user = {
        id: validKey.created_by,
        organizationId: validKey.organization_id,
        role: 'API_CLIENT',
        scopes: typeof validKey.scopes === 'string' ? JSON.parse(validKey.scopes) : validKey.scopes,
      };

      const existingStore = TenancyContext.get();
      if (!existingStore?.tenantId) {
        TenancyContext.run(
          {
            tenantId: validKey.organization_id,
            userId: validKey.created_by,
            roles: ['API_CLIENT'],
          },
          () => {}
        );
      }

      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
  }
}
