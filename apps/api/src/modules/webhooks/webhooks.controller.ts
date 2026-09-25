import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/webhook.dto';

@ApiTags('Webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new webhook endpoint with auto-generated signing secret' })
  async create(@Req() req: any, @Body() dto: CreateWebhookDto) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId;
    return await this.webhooksService.create(orgId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all webhooks for current organization' })
  async findAll(@Req() req: any) {
    const orgId = req.user.organizationId;
    return await this.webhooksService.findAll(orgId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  async remove(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return await this.webhooksService.remove(orgId, id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Dispatch a test ping with HMAC-SHA256 signature to verify receiver' })
  async test(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return await this.webhooksService.sendTestPing(orgId, id);
  }
}
