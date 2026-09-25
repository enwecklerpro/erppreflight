import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  StreamableFile,
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

  @Get('reports/:reportId/file')
  async streamReportFile(
    @CurrentTenant() tenantId: string,
    @Param('reportId') reportId: string
  ): Promise<StreamableFile> {
    const { stream, fileName, mimeType } = await this.exportService.openReportStream(tenantId, reportId);
    const safeName = fileName.replace(/["\r\n]/g, '_');
    return new StreamableFile(stream as any, {
      type: mimeType,
      disposition: `attachment; filename="${safeName}"`,
    });
  }

  @Get('analyses/:analysisId/reproducibility-bundle')
  async getReproducibilityBundle(
    @CurrentTenant() tenantId: string,
    @Param('analysisId') analysisId: string
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.exportService.generateReproducibilityZip(
      tenantId,
      analysisId
    );
    return new StreamableFile(buffer, {
      type: 'application/zip',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Get('projects/:projectId/analyses/:analysisId/offline-html')
  async getOfflineHtmlReport(
    @CurrentTenant() tenantId: string,
    @Param('projectId') projectId: string,
    @Param('analysisId') analysisId: string
  ): Promise<StreamableFile> {
    const { html, fileName } = await this.exportService.generateDirectOfflineHtml(
      tenantId,
      projectId,
      analysisId
    );
    return new StreamableFile(Buffer.from(html, 'utf-8'), {
      type: 'text/html; charset=utf-8',
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
