import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  S3StorageService,
  buildCleanKey,
  buildQuarantineKey,
} from '../storage/s3-storage.service';
import { MimeMagicValidator } from './mime-magic.validator';
import { ArchiveSafetyGuard } from './archive-safety.guard';
import { ClamAvScanner } from './clamav.scanner';
import { SecretRedactorService } from '../redaction/secret-redactor.service';
import { RequestPresignedUploadDto } from '@erppreflight/schemas';
import { v4 as uuidv4 } from 'uuid';

/**
 * Text formats (as returned by MimeMagicValidator.detectedFormat) whose content
 * must pass secret redaction before being promoted to the clean bucket.
 */
export const REDACTABLE_TEXT_FORMATS: ReadonlySet<string> = new Set([
  'XML',
  'XSD',
  'WSDL',
  'EDMX',
  'XDP',
  'JSON',
  'CSV',
  'ABAP',
  'TXT',
  'PROG',
  'INCL',
]);

function parseMetadata(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value as Record<string, any>;
}

/**
 * File list item: keeps the historical snake_case keys and adds the camelCase
 * contract consumed by the web client.
 */
export function toFileListItem(row: any) {
  const metadata = parseMetadata(row.metadata);
  const ext = String(row.file_name ?? '').split('.').pop()?.toUpperCase() || null;
  const detectedFormat: string | null = metadata.detectedFormat ?? ext;
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  const sizeBytes = row.file_size === null || row.file_size === undefined ? null : Number(row.file_size);
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    originalName: metadata.originalName ?? row.file_name,
    detectedFormat,
    mimeType: row.mime_type,
    sizeBytes,
    quarantineStatus: row.quarantine_status,
    redactionStatus: row.redaction_status,
    checksumSha256: row.checksum_sha256,
    createdAt,
    // Backward-compatible snake_case keys
    file_name: row.file_name,
    file_size: sizeBytes,
    mime_type: row.mime_type,
    quarantine_status: row.quarantine_status,
    redaction_status: row.redaction_status,
    checksum_sha256: row.checksum_sha256,
    created_at: createdAt,
  };
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: S3StorageService,
    private readonly mimeValidator: MimeMagicValidator,
    private readonly archiveGuard: ArchiveSafetyGuard,
    private readonly clamAv: ClamAvScanner,
    private readonly redactor: SecretRedactorService
  ) {}

  /**
   * Generates a pre-signed PUT URL to upload an untrusted artifact directly to the quarantine bucket.
   */
  public async requestPresignedUpload(
    tenantId: string,
    projectId: string,
    userId: string | null,
    dto: RequestPresignedUploadDto
  ) {
    // 1. Verify project belongs to tenant
    const projectRes = await this.db.query(
      'SELECT id FROM projects WHERE id = $1 AND organization_id = $2',
      [projectId, tenantId]
    );
    if (!projectRes.rows?.length) {
      throw new NotFoundException(`Project ${projectId} not found in tenant context.`);
    }

    const fileId = uuidv4();
    // Tenant-scoped quarantine key (same layout the storage service signs).
    const storagePath = buildQuarantineKey(tenantId, projectId, fileId, dto.fileName);

    // 2. Insert record in uploaded_files with PENDING_SCAN status
    await this.db.query(
      `INSERT INTO uploaded_files (
        id, organization_id, project_id, file_name, file_size, mime_type, storage_path,
        checksum_sha256, quarantine_status, redaction_status, metadata, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        fileId,
        tenantId,
        projectId,
        dto.fileName,
        dto.fileSize,
        dto.mimeType,
        storagePath,
        '0'.repeat(64), // Placeholder until verified
        'PENDING_SCAN',
        'PENDING',
        JSON.stringify({ originalName: dto.fileName }),
        userId,
      ]
    );

    // 3. Generate presigned PUT URL
    const presigned = await this.storage.createUploadPresignedUrl({
      organizationId: tenantId,
      projectId,
      fileId,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      ttlSeconds: 900, // 15 min TTL
    });

    return {
      fileId,
      uploadUrl: presigned.uploadUrl,
      storagePath: presigned.storagePath,
      expiresInSeconds: presigned.expiresInSeconds,
    };
  }

  /**
   * Confirms upload completion and triggers the verification & redaction pipeline.
   */
  public async confirmUpload(
    tenantId: string,
    projectId: string,
    fileId: string,
    testBuffer?: Buffer
  ) {
    const fileRes = await this.db.query(
      'SELECT * FROM uploaded_files WHERE id = $1 AND organization_id = $2 AND project_id = $3',
      [fileId, tenantId, projectId]
    );
    if (!fileRes.rows?.length) {
      throw new NotFoundException(`File ${fileId} not found in project ${projectId}.`);
    }

    const file = fileRes.rows[0];

    // Transition status to SCANNING
    await this.db.query(
      "UPDATE uploaded_files SET quarantine_status = 'SCANNING' WHERE id = $1 AND organization_id = $2 AND project_id = $3",
      [fileId, tenantId, projectId]
    );

    // Run processing
    return await this.processFile(file, testBuffer);
  }

  /**
   * Executes the 5-stage ingestion verification pipeline:
   * 1. Magic bytes MIME sniffing & blacklist check
   * 2. Archive safety (Zip Slip & Zip Bomb limits)
   * 3. Antivirus scan (ClamAV)
   * 4. Secret & credential redaction
   * 5. Clean bucket promotion
   */
  public async processFile(fileRecord: any, explicitBuffer?: Buffer) {
    const fileId = fileRecord.id;
    const tenantId = fileRecord.organization_id;
    const projectId = fileRecord.project_id;
    const fileName = fileRecord.file_name;
    const quarantinePath = fileRecord.storage_path;

    let buffer = explicitBuffer;

    if (!buffer) {
      try {
        const stream = await this.storage.getQuarantineStream(quarantinePath);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        buffer = Buffer.concat(chunks);
      } catch (err: any) {
        this.logger.warn(`Could not fetch S3 quarantine stream for ${fileId}: ${err.message}`);
        buffer = undefined;
      }
    }

    try {
      if (!buffer) {
        // Never promote an artifact we could not read: fail closed.
        throw new UnprocessableEntityException({
          code: 'ARTIFACT_NOT_UPLOADED',
          message: `Artifact '${fileName}' could not be read from quarantine storage; upload it before confirming.`,
        });
      }
      // Stage 1: MIME & Binary Magic-Bytes
      const mimeResult = this.mimeValidator.validate(fileName, buffer);

      // Stage 2: Archive Safety Guard
      if (mimeResult.detectedFormat === 'ZIP') {
        await this.archiveGuard.inspectZipBuffer(buffer);
      }

      // Stage 3: ClamAV Antivirus Scanning
      const scanResult = await this.clamAv.scanBuffer(buffer);
      if (scanResult.isInfected) {
        this.logger.warn(`QUARANTINE ALERT: File ${fileId} infected with ${scanResult.virusName}`);
        await this.db.query(
          `UPDATE uploaded_files
           SET quarantine_status = 'QUARANTINED',
               metadata = metadata || $1
           WHERE id = $2`,
          [
            JSON.stringify({
              virusName: scanResult.virusName,
              quarantinedAt: new Date().toISOString(),
            }),
            fileId,
          ],
          { bypassRls: true }
        );
        return {
          fileId,
          status: 'QUARANTINED',
          virusName: scanResult.virusName,
        };
      }

      // Stage 4: Secret & Credential Redaction
      let cleanBuffer = buffer;
      let redactionCount = 0;
      const isTextFormat = REDACTABLE_TEXT_FORMATS.has(mimeResult.detectedFormat);

      if (isTextFormat) {
        const text = buffer.toString('utf-8');
        const redactionResult = this.redactor.redact(text, tenantId);
        redactionCount = redactionResult.redactionsCount;
        cleanBuffer = Buffer.from(redactionResult.sanitizedText, 'utf-8');
      }

      // Stage 5: Clean Bucket Promotion
      // Only the REDACTED buffer is written to the clean bucket. The unredacted
      // quarantine original is deleted, never copied over the clean key.
      const cleanKey = buildCleanKey(tenantId, projectId, fileId, fileName);
      await this.storage.putCleanObject(cleanKey, cleanBuffer, mimeResult.detectedMime);
      try {
        await this.storage.deleteQuarantineObject(quarantinePath);
      } catch (err: any) {
        this.logger.warn(
          `Could not delete quarantine object ${quarantinePath} for ${fileId}: ${err.message}`
        );
      }

      // Stage 6: Update DB Record
      await this.db.query(
        `UPDATE uploaded_files
         SET quarantine_status = 'CLEAN',
             redaction_status = $1,
             storage_path = $2,
             checksum_sha256 = $3,
             metadata = metadata || $5::jsonb
         WHERE id = $4`,
        [
          redactionCount > 0 ? 'REDACTED' : 'PASSED',
          cleanKey,
          mimeResult.sha256,
          fileId,
          JSON.stringify({
            detectedFormat: mimeResult.detectedFormat,
            detectedMime: mimeResult.detectedMime,
            redactionsCount: redactionCount,
          }),
        ],
        { bypassRls: true }
      );

      return {
        fileId,
        status: 'CLEAN',
        detectedFormat: mimeResult.detectedFormat,
        checksumSha256: mimeResult.sha256,
        redactionsCount: redactionCount,
        cleanStoragePath: cleanKey,
      };
    } catch (err: any) {
      this.logger.error(`File processing failed for ${fileId}: ${err.message}`);
      await this.db.query(
        `UPDATE uploaded_files
         SET quarantine_status = 'REJECTED',
             metadata = metadata || $1
         WHERE id = $2`,
        [
          JSON.stringify({
            error: err.message,
            errorCode: err.response?.code || 'VALIDATION_FAILED',
            rejectedAt: new Date().toISOString(),
          }),
          fileId,
        ],
        { bypassRls: true }
      );
      throw err;
    }
  }

  /**
   * Generates a pre-signed GET download URL strictly for verified CLEAN files.
   * Quarantined or pending files are rejected with HTTP 403 Forbidden.
   */
  public async getPresignedDownloadUrl(
    tenantId: string,
    projectId: string,
    fileId: string
  ) {
    const res = await this.db.query(
      'SELECT * FROM uploaded_files WHERE id = $1 AND organization_id = $2 AND project_id = $3',
      [fileId, tenantId, projectId]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`File ${fileId} not found in project ${projectId}.`);
    }

    const file = res.rows[0];

    // Enforce physical quarantine boundary: Only CLEAN files may be downloaded
    if (file.quarantine_status !== 'CLEAN') {
      throw new ForbiddenException({
        code: 'ARTIFACT_QUARANTINED',
        message: `Artifact '${file.file_name}' cannot be downloaded: quarantine status is '${file.quarantine_status}'.`,
      });
    }

    const presigned = await this.storage.createDownloadPresignedUrl({
      bucketType: 'clean',
      storagePath: file.storage_path,
      downloadFileName: file.file_name,
      ttlSeconds: 900, // 15 minutes (maximum permitted pre-signed URL lifespan)
    });

    return {
      downloadUrl: presigned.downloadUrl,
      expiresInSeconds: presigned.expiresInSeconds,
      fileName: file.file_name,
      checksumSha256: file.checksum_sha256,
    };
  }

  public async listFiles(tenantId: string, projectId: string) {
    const res = await this.db.query(
      `SELECT id, project_id, file_name, file_size, mime_type, quarantine_status, redaction_status,
              checksum_sha256, metadata, created_at
         FROM uploaded_files
        WHERE organization_id = $1 AND project_id = $2
        ORDER BY created_at DESC`,
      [tenantId, projectId]
    );
    return (res.rows || []).map((row: any) => toFileListItem(row));
  }

  public async getFile(tenantId: string, projectId: string, fileId: string) {
    const res = await this.db.query(
      'SELECT * FROM uploaded_files WHERE id = $1 AND organization_id = $2 AND project_id = $3',
      [fileId, tenantId, projectId]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`File ${fileId} not found.`);
    }
    return res.rows[0];
  }
}
