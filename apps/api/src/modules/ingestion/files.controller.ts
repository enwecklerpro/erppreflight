import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestPresignedUploadDto } from '@erppreflight/schemas';

@Controller('projects/:projectId/files')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class FilesController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('presign-upload')
  async presignUpload(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: RequestPresignedUploadDto
  ) {
    return this.ingestionService.requestPresignedUpload(
      tenantId,
      projectId,
      userId,
      dto
    );
  }

  @Post(':fileId/confirm')
  async confirmUpload(
    @CurrentTenant() tenantId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string
  ) {
    return this.ingestionService.confirmUpload(tenantId, projectId, fileId);
  }

  @Get(':fileId/presign-download')
  async presignDownload(
    @CurrentTenant() tenantId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string
  ) {
    return this.ingestionService.getPresignedDownloadUrl(
      tenantId,
      projectId,
      fileId
    );
  }

  @Get()
  async listFiles(
    @CurrentTenant() tenantId: string,
    @Param('projectId') projectId: string
  ) {
    return this.ingestionService.listFiles(tenantId, projectId);
  }

  @Get(':fileId')
  async getFile(
    @CurrentTenant() tenantId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string
  ) {
    return this.ingestionService.getFile(tenantId, projectId, fileId);
  }
}
