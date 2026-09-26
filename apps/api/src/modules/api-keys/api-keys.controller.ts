import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';
import { DenyApiKeyAuth } from './api-key-scopes';
import { Audited } from '../audit/audited.decorator';

/**
 * API-key management requires an interactive session of an organization
 * owner / security admin; API keys cannot mint or revoke API keys.
 */
@ApiTags('Developer API Keys')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
@Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: 'Create an organization-scoped API key' })
  @Audited({
    action: 'api_key.created',
    targetType: 'API_KEY',
    targetId: ({ result }) => result?.id,
    security: true,
    payload: ({ result }) => ({ name: result?.name ?? null, prefix: result?.prefix ?? null, scopes: result?.scopes ?? [] }),
  })
  async create(@CurrentTenant() orgId: string, @Req() req: any, @Body() dto: CreateApiKeyDto) {
    return await this.apiKeysService.create(orgId, req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all API keys for the current organization' })
  async findAll(@CurrentTenant() orgId: string) {
    return await this.apiKeysService.findAll(orgId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  @Audited({ action: 'api_key.revoked', targetType: 'API_KEY', targetId: ({ params }) => params.id, security: true })
  async revoke(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return await this.apiKeysService.revoke(orgId, id);
  }
}
