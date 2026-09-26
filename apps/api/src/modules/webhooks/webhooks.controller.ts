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
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/webhook.dto';
import { Audited } from '../audit/audited.decorator';

/** Webhook management: interactive owner / security-admin sessions only (no API keys). */
@ApiTags('Webhooks')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
@Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new webhook endpoint with auto-generated signing secret' })
  @Audited({
    action: 'webhook.created',
    targetType: 'WEBHOOK',
    targetId: ({ result }) => result?.id,
    security: true,
    payload: ({ body }) => {
      let host: string | null = null;
      try {
        host = new URL(String(body?.url)).host;
      } catch {
        host = null;
      }
      return { host, events: Array.isArray(body?.events) ? body.events.slice(0, 50) : [] };
    },
  })
  async create(@CurrentTenant() orgId: string, @Req() req: any, @Body() dto: CreateWebhookDto) {
    return await this.webhooksService.create(orgId, req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all webhooks for current organization' })
  async findAll(@CurrentTenant() orgId: string) {
    return await this.webhooksService.findAll(orgId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @Audited({ action: 'webhook.deleted', targetType: 'WEBHOOK', targetId: ({ params }) => params.id, security: true })
  async remove(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return await this.webhooksService.remove(orgId, id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Dispatch a test ping with HMAC-SHA256 signature to verify receiver' })
  async test(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return await this.webhooksService.sendTestPing(orgId, id);
  }
}
