import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './ingestion.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestPresignedUploadDto } from '@erppreflight/schemas';

@Controller(['projects/:projectId/files', 'projects/:projectId/artifacts'])
@UseGuards(JwtAuthGuard, TenancyGuard)
export class FilesController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadArtifact(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('projectId') projectId: string,
    @UploadedFile() file?: any,
    @Body() body?: any
  ) {
    if (file && file.buffer) {
      const presigned = await this.ingestionService.requestPresignedUpload(
        tenantId,
        projectId,
        userId,
        {
          fileName: file.originalname || 'artifact.xml',
          fileSize: file.size || file.buffer.length,
          mimeType: file.mimetype || 'application/octet-stream',
        }
      );
      return await this.ingestionService.confirmUpload(
        tenantId,
        projectId,
        presigned.fileId,
        file.buffer
      );
    }

    if (body?.fileId) {
      return await this.ingestionService.confirmUpload(
        tenantId,
        projectId,
        body.fileId,
        body.content ? Buffer.from(body.content, 'utf-8') : undefined
      );
    }

    if (body?.fileName && (body?.content || body?.rawContent)) {
      const raw = body.content || body.rawContent;
      const buffer = Buffer.from(raw, typeof raw === 'string' ? 'utf-8' : undefined);
      const presigned = await this.ingestionService.requestPresignedUpload(
        tenantId,
        projectId,
        userId,
        {
          fileName: body.fileName,
          fileSize: buffer.length,
          mimeType: body.mimeType || 'application/octet-stream',
        }
      );
      return await this.ingestionService.confirmUpload(
        tenantId,
        projectId,
        presigned.fileId,
        buffer
      );
    }

    if (body?.fileName && body?.fileSize) {
      return await this.ingestionService.requestPresignedUpload(
        tenantId,
        projectId,
        userId,
        {
          fileName: body.fileName,
          fileSize: Number(body.fileSize),
          mimeType: body.mimeType || 'application/octet-stream',
        }
      );
    }

    throw new BadRequestException('No file or artifact payload provided for upload');
  }

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
