import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  ParseUUIDPipe,
  Query,
  HttpCode,
  BadRequestException,
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

  @Get('events')
  @ApiOperation({ summary: 'Webhook event catalog (event types and payload fields)' })
  events() {
    return this.webhooksService.eventCatalog();
  }

  @Post()
  @ApiOperation({ summary: 'Register a webhook endpoint; the signing secret is returned once' })
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

  @Patch(':id')
  @ApiOperation({ summary: 'Enable or disable a webhook endpoint' })
  async setStatus(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: any) {
    if (body?.status !== 'ACTIVE' && body?.status !== 'DISABLED') {
      throw new BadRequestException('status must be ACTIVE or DISABLED');
    }
    return await this.webhooksService.setStatus(orgId, id, body.status);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @Audited({ action: 'webhook.deleted', targetType: 'WEBHOOK', targetId: ({ params }) => params.id, security: true })
  async remove(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return await this.webhooksService.remove(orgId, id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Send a signed test ping (recorded in the delivery log)' })
  async test(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return await this.webhooksService.sendTestPing(orgId, id);
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the signing secret (new secret returned once)' })
  async rotate(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return await this.webhooksService.rotateSecret(orgId, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'Delivery log (status, attempts, HTTP status, next retry)' })
  async deliveries(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string, @Query('limit') limit?: string) {
    return await this.webhooksService.listDeliveries(orgId, id, limit ? Number(limit) : 50);
  }

  @Get(':id/deliveries/:deliveryId/payload')
  async payload(
    @CurrentTenant() orgId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('deliveryId', new ParseUUIDPipe()) deliveryId: string
  ) {
    return await this.webhooksService.getDeliveryPayload(orgId, id, deliveryId);
  }

  @Post(':id/deliveries/:deliveryId/replay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Replay a delivery (same event id, new signed delivery)' })
  async replay(
    @CurrentTenant() orgId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('deliveryId', new ParseUUIDPipe()) deliveryId: string
  ) {
    return await this.webhooksService.replay(orgId, id, deliveryId);
  }
}
