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
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@ApiTags('Developer API Keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: 'Create an organization-scoped API key' })
  async create(@Req() req: any, @Body() dto: CreateApiKeyDto) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId;
    return await this.apiKeysService.create(orgId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all API keys for the current organization' })
  async findAll(@Req() req: any) {
    const orgId = req.user.organizationId;
    return await this.apiKeysService.findAll(orgId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return await this.apiKeysService.revoke(orgId, id);
  }
}
