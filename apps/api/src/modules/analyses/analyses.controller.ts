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
import { VerifiedEmailGuard } from '../auth/guards/verified-email.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audited } from '../audit/audited.decorator';
import { Metered } from '../usage/metered.decorator';

@Controller('analyses')
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementGuard)
export class AnalysesController {
  constructor(private readonly analysesService: AnalysesService) {}

  @Post()
  @UseGuards(VerifiedEmailGuard)
  @RequireEntitlement('RUN_ANALYSIS')
  @Audited({
    action: 'analysis.queued',
    targetType: 'ANALYSIS',
    targetId: ({ result }) => result?.analysisId,
    payload: ({ body, result }) => ({
      projectId: typeof body?.projectId === 'string' ? body.projectId : null,
      engineTypes: result?.engineTypes ?? [],
      targetRelease: result?.targetRelease ?? null,
      fileCount: Array.isArray(body?.fileIds) ? body.fileIds.length : 0,
    }),
  })
  @Metered({
    metric: 'ANALYSIS_RUN',
    resourceType: 'ANALYSIS',
    resourceId: ({ result }) => result?.analysisId,
    metadata: ({ result }) => ({ engineTypes: result?.engineTypes ?? [], source: 'api' }),
  })
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
