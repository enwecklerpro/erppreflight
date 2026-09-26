import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  StreamableFile,
} from '@nestjs/common';
import { ExportService } from './export.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerifiedEmailGuard } from '../auth/guards/verified-email.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TriggerExportDto } from '@erppreflight/schemas';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { Audited } from '../audit/audited.decorator';
import { Metered } from '../usage/metered.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller()
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post('projects/:projectId/analyses/:analysisId/export')
  @RequireEntitlement('EXPORT_REPORT')
  @Audited({
    action: 'report.generated',
    targetType: 'REPORT',
    targetId: ({ result }) => result?.reportId,
    payload: ({ params, result, body }) => ({
      projectId: params.projectId,
      analysisId: params.analysisId,
      format: result?.format ?? null,
      reportType: body?.reportType ?? 'TECHNICAL',
      fileName: result?.fileName ?? null,
      checksumSha256: result?.checksumSha256 ?? null,
    }),
  })
  @Metered({
    metric: 'REPORT_EXPORT',
    resourceType: 'REPORT',
    resourceId: ({ result }) => result?.reportId,
    metadata: ({ result }) => ({ format: result?.format ?? null }),
  })
  @UseGuards(VerifiedEmailGuard)
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

  /** Tenant report branding (Professional plan and higher). */
  @Get('reports/branding')
  async getBranding(@CurrentTenant() tenantId: string) {
    return this.exportService.getBranding(tenantId);
  }

  @Put('reports/branding')
  @UseGuards(RolesGuard)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @Audited({
    action: 'report.branding_updated',
    targetType: 'ORGANIZATION',
    targetId: ({ request }) => request.tenantId,
    payload: ({ result }) => ({ fields: Object.keys(result ?? {}) }),
  })
  async updateBranding(@CurrentTenant() tenantId: string, @Body() body: unknown) {
    return this.exportService.updateBranding(tenantId, body);
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
  @Audited({
    action: 'report.download_url_issued',
    targetType: 'REPORT',
    targetId: ({ params }) => params.reportId,
  })
  async getDownload(
    @CurrentTenant() tenantId: string,
    @Param('reportId') reportId: string
  ) {
    return this.exportService.getReportDownload(tenantId, reportId);
  }

  @Get('reports/:reportId/file')
  @Audited({
    action: 'report.downloaded',
    targetType: 'REPORT',
    targetId: ({ params }) => params.reportId,
  })
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
  @RequireEntitlement('AIR_GAPPED_EXPORT')
  @Audited({
    action: 'report.downloaded',
    targetType: 'ANALYSIS',
    targetId: ({ params }) => params.analysisId,
    payload: () => ({ format: 'REPRODUCIBILITY_BUNDLE' }),
  })
  @UseGuards(VerifiedEmailGuard)
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
  @RequireEntitlement('AIR_GAPPED_EXPORT')
  @Audited({
    action: 'report.downloaded',
    targetType: 'ANALYSIS',
    targetId: ({ params }) => params.analysisId,
    payload: ({ params }) => ({ format: 'HTML_OFFLINE_DIRECT', projectId: params.projectId }),
  })
  @UseGuards(VerifiedEmailGuard)
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
