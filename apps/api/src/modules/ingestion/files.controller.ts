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
import { Audited, AuditContext } from '../audit/audited.decorator';
import { Metered, MeteredContext } from '../usage/metered.decorator';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';

/** Upload result → audit action (quarantine outcomes are security events). */
function uploadAction({ result }: AuditContext): string {
  if (result?.status === 'QUARANTINED') return 'artifact.quarantined';
  if (result?.status === 'CLEAN') return 'artifact.uploaded';
  if (result?.uploadUrl) return 'artifact.upload_requested';
  return 'artifact.upload_processed';
}

function uploadPayload({ result, request }: AuditContext): Record<string, unknown> {
  return {
    projectId: request.params?.projectId ?? null,
    status: result?.status ?? (result?.uploadUrl ? 'PENDING_UPLOAD' : null),
    fileName: request.file?.originalname ?? request.body?.fileName ?? null,
    detectedFormat: result?.detectedFormat ?? null,
    checksumSha256: result?.checksumSha256 ?? null,
    redactionsCount: result?.redactionsCount ?? null,
    virusName: result?.virusName ?? null,
  };
}

function uploadedBytes({ request, result }: MeteredContext): number {
  if (result?.status !== 'CLEAN' && result?.status !== 'QUARANTINED') return 0;
  if (request.file?.size) return Number(request.file.size);
  const raw = request.body?.content ?? request.body?.rawContent;
  return typeof raw === 'string' ? Buffer.byteLength(raw, 'utf-8') : 0;
}

const processedUpload = ({ result }: MeteredContext) =>
  result?.status === 'CLEAN' || result?.status === 'QUARANTINED' ? 1 : 0;

const UPLOAD_AUDIT = {
  action: uploadAction,
  targetType: 'ARTIFACT',
  targetId: ({ result }: AuditContext) => result?.fileId,
  payload: uploadPayload,
};

const UPLOAD_METERS = [
  {
    metric: 'ARTIFACT_UPLOAD' as const,
    quantity: processedUpload,
    resourceType: 'ARTIFACT',
    resourceId: ({ result }: MeteredContext) => result?.fileId,
    metadata: ({ result }: MeteredContext) => ({ status: result?.status ?? null }),
  },
  {
    metric: 'ARTIFACT_BYTES' as const,
    quantity: uploadedBytes,
    resourceType: 'ARTIFACT',
    resourceId: ({ result }: MeteredContext) => result?.fileId,
  },
];

// Multipart uploads are buffered in memory before quarantine; cap them (default 100 MB,
// matching the web client) so a single request cannot exhaust API memory. Multer answers 413.
const MAX_UPLOAD_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_SIZE_MB) || 100) * 1024 * 1024;

@Controller(['projects/:projectId/files', 'projects/:projectId/artifacts'])
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementGuard)
export class FilesController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  @RequireEntitlement('UPLOAD_ARTIFACT')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @Audited(UPLOAD_AUDIT)
  @Metered(...UPLOAD_METERS)
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
  @RequireEntitlement('UPLOAD_ARTIFACT')
  @Audited(UPLOAD_AUDIT)
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
  @Audited(UPLOAD_AUDIT)
  @Metered(...UPLOAD_METERS)
  async confirmUpload(
    @CurrentTenant() tenantId: string,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string
  ) {
    return this.ingestionService.confirmUpload(tenantId, projectId, fileId);
  }

  @Get(':fileId/presign-download')
  @Audited({
    action: 'artifact.download_url_issued',
    targetType: 'ARTIFACT',
    targetId: ({ params }) => params.fileId,
    payload: ({ params }) => ({ projectId: params.projectId }),
  })
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
