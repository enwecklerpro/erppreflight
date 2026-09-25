import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FindingsService, FindFindingsRequest } from './findings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('findings')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class FindingsController {
  constructor(private readonly findingsService: FindingsService) {}

  @Get()
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('projectId') projectId?: string,
    @Query('engine') engine?: string,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ) {
    const query: FindFindingsRequest = {
      projectId,
      engine,
      severity,
      category,
      search,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25,
    };
    return this.findingsService.findAll(tenantId, query);
  }

  @Get('stats')
  async getStats(
    @CurrentTenant() tenantId: string,
    @Query('projectId') projectId?: string
  ) {
    return this.findingsService.getStats(tenantId, projectId);
  }

  @Get(':id')
  async findById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string
  ) {
    return this.findingsService.findById(tenantId, id);
  }

  @Post(':id/work-item')
  async createWorkItem(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { system?: string; title?: string; process?: string }
  ) {
    return this.findingsService.createWorkItem(tenantId, id, userId, body || {});
  }

  @Patch(':id/review')
  async reviewFinding(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body()
    body: {
      status: 'OPEN' | 'VERIFIED' | 'ACCEPTED_RISK' | 'SUPPRESSED_FALSE_POSITIVE';
      justification: string;
      suppressScope?: 'FINDING_ONLY' | 'OBJECT_RULE' | 'TENANT_OVERRIDE';
    }
  ) {
    return this.findingsService.reviewFinding(tenantId, id, userId, body);
  }
}

