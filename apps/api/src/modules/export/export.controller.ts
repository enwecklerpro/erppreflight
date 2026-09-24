import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ExportService } from './export.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TriggerExportDto } from '@erppreflight/schemas';

@Controller()
@UseGuards(JwtAuthGuard, TenancyGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post('projects/:projectId/analyses/:analysisId/export')
  async triggerExport(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('projectId') projectId: string,
    @Param('analysisId') analysisId: string,
    @Body() dto: TriggerExportDto
  ) {
    return this.exportService.generateExport(
      tenantId,
      projectId,
      analysisId,
      dto,
      userId
    );
  }

  @Get('projects/:projectId/analyses/:analysisId/reports')
  async getReports(
    @CurrentTenant() tenantId: string,
    @Param('projectId') projectId: string,
    @Param('analysisId') analysisId: string
  ) {
    return this.exportService.getReportsForAnalysis(
      tenantId,
      projectId,
      analysisId
    );
  }

  @Get('reports/:reportId/download')
  async getDownload(
    @CurrentTenant() tenantId: string,
    @Param('reportId') reportId: string
  ) {
    return this.exportService.getReportDownload(tenantId, reportId);
  }
}
