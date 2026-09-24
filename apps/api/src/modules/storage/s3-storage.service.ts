import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

@Injectable()
export class S3StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3: S3Client;
  public readonly quarantineBucket: string;
  public readonly cleanBucket: string;
  public readonly reportsBucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('S3_ENDPOINT', 'http://localhost:9000');
    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY', 'minioadmin');
    const secretAccessKey = this.config.get<string>('S3_SECRET_KEY', 'minioadmin');

    this.quarantineBucket = this.config.get<string>(
      'S3_BUCKET_QUARANTINE',
      'erppreflight-quarantine'
    );
    this.cleanBucket = this.config.get<string>(
      'S3_BUCKET_CLEAN',
      'erppreflight-clean'
    );
    this.reportsBucket = this.config.get<string>(
      'S3_BUCKET_REPORTS',
      'erppreflight-reports'
    );

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // MinIO requirement
    });
  }

  /**
   * Generates a short-lived pre-signed PUT upload URL for the quarantine bucket.
   * Default TTL: 15 minutes (900 seconds).
   */
  public async createUploadPresignedUrl(params: {
    organizationId: string;
    projectId: string;
    fileId: string;
    fileName: string;
    mimeType: string;
    ttlSeconds?: number;
  }): Promise<{ uploadUrl: string; storagePath: string; expiresInSeconds: number }> {
    const ttl = params.ttlSeconds || 900;
    const safeFileName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `quarantine/${params.organizationId}/${params.projectId}/${params.fileId}/${safeFileName}`;

    const command = new PutObjectCommand({
      Bucket: this.quarantineBucket,
      Key: storagePath,
      ContentType: params.mimeType,
      Metadata: {
        'organization-id': params.organizationId,
        'project-id': params.projectId,
        'file-id': params.fileId,
      },
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: ttl });
    return { uploadUrl, storagePath, expiresInSeconds: ttl };
  }

  /**
   * Generates a short-lived pre-signed GET download URL for the clean bucket or reports bucket.
   * Default TTL: 30 minutes (1800 seconds).
   */
  public async createDownloadPresignedUrl(params: {
    bucketType: 'clean' | 'reports';
    storagePath: string;
    downloadFileName?: string;
    ttlSeconds?: number;
  }): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
    const ttl = params.ttlSeconds || 1800;
    const bucket = params.bucketType === 'clean' ? this.cleanBucket : this.reportsBucket;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: params.storagePath,
      ResponseContentDisposition: params.downloadFileName
        ? `attachment; filename="${encodeURIComponent(params.downloadFileName)}"`
        : undefined,
    });

    const downloadUrl = await getSignedUrl(this.s3, command, { expiresIn: ttl });
    return { downloadUrl, expiresInSeconds: ttl };
  }

  /**
   * Promotes a verified, clean artifact from Quarantine to Clean bucket.
   */
  public async promoteQuarantineToClean(
    quarantineKey: string,
    cleanKey: string
  ): Promise<void> {
    try {
      await this.s3.send(
        new CopyObjectCommand({
          CopySource: `${this.quarantineBucket}/${quarantineKey}`,
          Bucket: this.cleanBucket,
          Key: cleanKey,
        })
      );
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.quarantineBucket,
          Key: quarantineKey,
        })
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed S3 copy/delete during quarantine promotion (may be in mock/test mode): ${err.message}`
      );
    }
  }

  /**
   * Returns a readable stream for a quarantine bucket object.
   */
  public async getQuarantineStream(storagePath: string): Promise<NodeJS.ReadableStream> {
    const res = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.quarantineBucket,
        Key: storagePath,
      })
    );
    return res.Body as NodeJS.ReadableStream;
  }

  /**
   * Returns a readable stream for a clean bucket object.
   */
  public async getCleanStream(storagePath: string): Promise<NodeJS.ReadableStream> {
    const res = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.cleanBucket,
        Key: storagePath,
      })
    );
    return res.Body as NodeJS.ReadableStream;
  }

  /**
   * Uploads an object directly to the clean bucket.
   */
  public async putCleanObject(
    key: string,
    data: Buffer | string,
    contentType: string = 'application/octet-stream'
  ): Promise<void> {
    const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.cleanBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }

  /**
   * Uploads an object directly to the reports bucket.
   */
  public async putReportObject(
    key: string,
    data: Buffer | string,
    contentType: string = 'application/octet-stream'
  ): Promise<void> {
    const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.reportsBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }

  /**
   * Deletes an object from the quarantine bucket.
   */
  public async deleteQuarantineObject(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.quarantineBucket,
        Key: key,
      })
    );
  }

  /**
   * Directly get S3 client for lower-level operations if needed.
   */
  public getClient(): S3Client {
    return this.s3;
  }
}
