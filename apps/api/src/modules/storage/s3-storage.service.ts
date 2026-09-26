import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

/** Maximum lifespan of any pre-signed URL (AGENTS.md 4.4: 15 minutes). */
export const MAX_PRESIGNED_TTL_SECONDS = 900;

export function safeObjectName(fileName: string): string {
  const base = String(fileName ?? '').split(/[\\/]/).pop() || 'artifact';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
  return cleaned || 'artifact';
}

/** Tenant-scoped quarantine key: tenants/{org}/projects/{project}/quarantine/{fileId}/{name} */
export function buildQuarantineKey(
  organizationId: string,
  projectId: string,
  fileId: string,
  fileName: string
): string {
  return `tenants/${organizationId}/projects/${projectId}/quarantine/${fileId}/${safeObjectName(fileName)}`;
}

/** Tenant-scoped clean key: tenants/{org}/projects/{project}/{fileId}/{name} */
export function buildCleanKey(
  organizationId: string,
  projectId: string,
  fileId: string,
  fileName: string
): string {
  return `tenants/${organizationId}/projects/${projectId}/${fileId}/${safeObjectName(fileName)}`;
}

/** Tenant-scoped API baseline key: tenants/{org}/projects/{project}/api-baselines/{baselineId}/{name} */
export function buildApiBaselineKey(
  organizationId: string,
  projectId: string,
  baselineId: string,
  fileName: string
): string {
  return `tenants/${organizationId}/projects/${projectId}/api-baselines/${baselineId}/${safeObjectName(fileName)}`;
}

@Injectable()
export class S3StorageService implements OnModuleInit {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3: S3Client;
  public readonly quarantineBucket: string;
  public readonly cleanBucket: string;
  public readonly reportsBucket: string;
  private bucketsInitialized = false;

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

  async onModuleInit(): Promise<void> {
    await this.ensureBucketsExist();
  }

  public async ensureBucketsExist(): Promise<void> {
    if (this.bucketsInitialized) return;
    const buckets = [this.quarantineBucket, this.cleanBucket, this.reportsBucket];
    let allReady = true;
    for (const bucket of buckets) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        try {
          await this.s3.send(new CreateBucketCommand({ Bucket: bucket }));
          this.logger.log(`Created missing S3 bucket: ${bucket}`);
        } catch (createErr: any) {
          if (
            createErr?.name !== 'BucketAlreadyOwnedByYou' &&
            createErr?.name !== 'BucketAlreadyExists'
          ) {
            allReady = false;
            this.logger.warn(`Could not create bucket ${bucket}: ${createErr?.message}`);
          }
        }
      }
    }
    // Only cache success: if any bucket is missing we retry on the next use.
    this.bucketsInitialized = allReady;
  }

  /** Clamps a requested pre-signed URL lifespan to the 15-minute platform maximum. */
  public static clampTtl(ttlSeconds?: number): number {
    const requested = Number(ttlSeconds);
    if (!Number.isFinite(requested) || requested <= 0) return MAX_PRESIGNED_TTL_SECONDS;
    return Math.min(Math.floor(requested), MAX_PRESIGNED_TTL_SECONDS);
  }

  /** Quarantine bucket key: tenants/{org}/projects/{project}/quarantine/{fileId}/{name} */
  public buildQuarantineKey(
    organizationId: string,
    projectId: string,
    fileId: string,
    fileName: string
  ): string {
    return buildQuarantineKey(organizationId, projectId, fileId, fileName);
  }

  /** Clean bucket key: tenants/{org}/projects/{project}/{fileId}/{name} */
  public buildCleanKey(
    organizationId: string,
    projectId: string,
    fileId: string,
    fileName: string
  ): string {
    return buildCleanKey(organizationId, projectId, fileId, fileName);
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
    await this.ensureBucketsExist();
    const ttl = S3StorageService.clampTtl(params.ttlSeconds);
    const storagePath = this.buildQuarantineKey(
      params.organizationId,
      params.projectId,
      params.fileId,
      params.fileName
    );

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
   * Default and maximum TTL: 15 minutes (900 seconds).
   */
  public async createDownloadPresignedUrl(params: {
    bucketType: 'clean' | 'reports';
    storagePath: string;
    downloadFileName?: string;
    ttlSeconds?: number;
  }): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
    const ttl = S3StorageService.clampTtl(params.ttlSeconds);
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
   * Returns a readable stream for a generated report object.
   */
  public async getReportStream(storagePath: string): Promise<NodeJS.ReadableStream> {
    const res = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.reportsBucket,
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
   * Size of a clean bucket object in bytes (HEAD, no download).
   */
  public async headCleanObject(storagePath: string): Promise<{ sizeBytes: number }> {
    const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.cleanBucket, Key: storagePath }));
    return { sizeBytes: Number(res.ContentLength ?? 0) };
  }

  /**
   * Deletes an object from the clean bucket.
   */
  public async deleteCleanObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.cleanBucket, Key: key }));
  }

  /**
   * Uploads an object directly to the clean bucket.
   */
  public async putCleanObject(
    key: string,
    data: Buffer | string,
    contentType: string = 'application/octet-stream'
  ): Promise<void> {
    await this.ensureBucketsExist();
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
    await this.ensureBucketsExist();
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
   * Permanently deletes every object stored for an organization
   * (`tenants/{organizationId}/` in the quarantine, clean and reports buckets).
   * Used by organization deletion (GDPR erasure). Returns the number of objects deleted.
   */
  public async deleteTenantObjects(organizationId: string): Promise<number> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
      throw new Error('deleteTenantObjects: organizationId must be a UUID');
    }
    const prefix = `tenants/${organizationId}/`;
    let deleted = 0;
    for (const bucket of [this.quarantineBucket, this.cleanBucket, this.reportsBucket]) {
      let continuationToken: string | undefined;
      do {
        const page = await this.s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken, MaxKeys: 1000 })
        );
        const keys = (page.Contents || []).map((o) => o.Key).filter((k): k is string => !!k && k.startsWith(prefix));
        if (keys.length > 0) {
          const result = await this.s3.send(
            new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } })
          );
          if (result.Errors && result.Errors.length > 0) {
            throw new Error(`Failed to delete ${result.Errors.length} object(s) from ${bucket}`);
          }
          deleted += keys.length;
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
    }
    return deleted;
  }

  /**
   * Directly get S3 client for lower-level operations if needed.
   */
  public getClient(): S3Client {
    return this.s3;
  }
}
