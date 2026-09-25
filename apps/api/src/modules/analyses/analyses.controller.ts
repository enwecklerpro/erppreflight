import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnalysesService } from './analyses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('analyses')
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementGuard)
export class AnalysesController {
  constructor(private readonly analysesService: AnalysesService) {}

  @Post()
  @RequireEntitlement('RUN_ANALYSIS')
  async trigger(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() body: unknown
  ) {
    return this.analysesService.triggerAnalysis(tenantId, userId, body);
  }

  @Get()
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('projectId') projectId?: string
  ) {
    return this.analysesService.findAll(tenantId, projectId);
  }

  @Get(':id')
  async findById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string
  ) {
    return this.analysesService.findById(tenantId, id);
  }

  @Get(':id/findings')
  async getFindingsForAnalysis(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string
  ) {
    return this.analysesService.getFindingsForAnalysis(tenantId, id);
  }
}
