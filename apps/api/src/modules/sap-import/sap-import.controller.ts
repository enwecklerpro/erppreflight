import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SapImportService } from './sap-import.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ImportAtcDto, ImportReadinessDto, ImportFioriUsageDto } from './dto/sap-import.dto';

@Controller('projects/:projectId/import')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class SapImportController {
  constructor(private readonly sapImportService: SapImportService) {}

  @Post('atc')
  @UseInterceptors(FileInterceptor('file'))
  async importAtc(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('projectId') projectId: string,
    @Body() body: any,
    @UploadedFile() file?: any
  ) {
    const rawContent = file?.buffer
      ? file.buffer.toString('utf-8')
      : body.rawContent || body.content;

    const dto: ImportAtcDto = {
      fileName: file?.originalname || body.fileName || 'atc_results.xml',
      format: body.format || (file?.originalname?.endsWith('.json') ? 'JSON' : 'XML'),
      rawContent,
    };

    return this.sapImportService.importAtc(tenantId, projectId, userId, dto);
  }

  @Post('readiness')
  @UseInterceptors(FileInterceptor('file'))
  async importReadiness(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('projectId') projectId: string,
    @Body() body: any,
    @UploadedFile() file?: any
  ) {
    const rawContent = file?.buffer
      ? file.buffer.toString('utf-8')
      : body.rawContent || body.content;

    const dto: ImportReadinessDto = {
      fileName: file?.originalname || body.fileName || 'readiness_check.json',
      sourceAnalysisId: body.sourceAnalysisId,
      targetRelease: body.targetRelease,
      rawContent,
    };

    return this.sapImportService.importReadinessCheck(tenantId, projectId, userId, dto);
  }

  @Post('fiori')
  @UseInterceptors(FileInterceptor('file'))
  async importFiori(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('projectId') projectId: string,
    @Body() body: any,
    @UploadedFile() file?: any
  ) {
    const rawContent = file?.buffer
      ? file.buffer.toString('utf-8')
      : body.rawContent || body.content;

    const dto: ImportFioriUsageDto = {
      fileName: file?.originalname || body.fileName || 'fiori_usage.csv',
      rawContent,
    };

    return this.sapImportService.importFioriUsage(tenantId, projectId, userId, dto);
  }
}
