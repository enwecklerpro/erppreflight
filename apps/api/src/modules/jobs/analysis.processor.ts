import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EngineType,
  TargetRelease,
  ArtifactType,
  toWireJobRequest,
  AnalysisJobResponseSchema,
} from '@erppreflight/schemas';
import { createFindingFingerprint } from '@erppreflight/evidence';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { S3StorageService } from '../storage/s3-storage.service';

export interface AnalysisJobData {
  analysisId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  engineTypes: EngineType[];
  targetRelease: TargetRelease;
  artifactS3Key?: string | null;
  artifactType?: ArtifactType;
  rawContent?: string | null;
  configuration?: Record<string, unknown>;
}

@Processor('analysis-queue')
@Injectable()
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);
  private readonly analysisUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly storageService: S3StorageService,
    private readonly config: ConfigService
  ) {
    super();
    this.analysisUrl =
      this.config.get<string>('ANALYSIS_SERVICE_URL') ||
      'http://localhost:8000';
  }

  private async streamToString(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  private inferArtifactType(
    artifactS3Key?: string | null,
    rawContent?: string | null
  ): ArtifactType {
    if (artifactS3Key) {
      const ext = artifactS3Key.split('.').pop()?.toUpperCase();
      if (ext === 'XML') return 'XML';
      if (ext === 'JSON') return 'JSON';
      if (ext === 'CSV') return 'CSV';
      if (ext === 'ZIP') return 'ZIP';
      if (ext === 'ABAP') return 'ABAP';
      if (ext === 'XDP') return 'XDP';
      if (ext === 'WSDL') return 'WSDL';
      if (ext === 'EDMX') return 'EDMX';
      if (ext === 'TXT') return 'TXT';
      if (ext === 'XLSX') return 'XLSX';
    }
    if (rawContent?.trim().startsWith('<')) return 'XML';
    if (rawContent?.trim().startsWith('{') || rawContent?.trim().startsWith('[')) return 'JSON';
    return 'JSON';
  }

  async process(job: Job<AnalysisJobData>): Promise<void> {
    const {
      analysisId,
      organizationId,
      projectId,
      engineTypes,
      targetRelease,
      configuration,
    } = job.data;

    this.logger.log(
      `Processing analysis job ${analysisId} for organization ${organizationId} across ${engineTypes.length} engines`
    );

    try {
      // 1. Transition status to RUNNING
      await this.db.query(
        `UPDATE analyses SET status = 'RUNNING' WHERE id = $1 AND organization_id = $2`,
        [analysisId, organizationId],
        { tenantId: organizationId }
      );

      // 2. Retrieve clean artifact from S3 if artifactS3Key is present and rawContent is null
      let rawContent = job.data.rawContent ?? null;
      if (job.data.artifactS3Key && !rawContent) {
        try {
          this.logger.log(
            `Fetching clean artifact from S3: ${job.data.artifactS3Key}`
          );
          const stream = await this.storageService.getCleanStream(
            job.data.artifactS3Key
          );
          rawContent = await this.streamToString(stream);
        } catch (err: any) {
          this.logger.error(
            `Failed to fetch clean artifact from S3 (${job.data.artifactS3Key}): ${err.message}`
          );
        }
      }

      const artifactType =
        job.data.artifactType ||
        this.inferArtifactType(job.data.artifactS3Key, rawContent);

      const failedEngines: EngineType[] = [];
      let totalFindings = 0;

      // 3. Dispatch each engine to Python analysis microservice
      for (const engine of engineTypes) {
        try {
          const wirePayload = toWireJobRequest({
            jobId: analysisId,
            tenantId: organizationId,
            projectId: projectId,
            engineType: engine,
            targetRelease: targetRelease as TargetRelease,
            artifactS3Key: job.data.artifactS3Key ?? null,
            artifactType,
            configuration: configuration ?? {},
            rawContent: rawContent ?? null,
          });

          const res = await fetch(`${this.analysisUrl}/api/v1/analyze`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'X-Tenant-Id': organizationId,
            },
            body: JSON.stringify(wirePayload),
          });

          if (!res.ok) {
            const errText = await res.text();
            this.logger.error(
              `Engine '${engine}' analysis failed [HTTP ${res.status}]: ${errText}`
            );
            failedEngines.push(engine);
            continue;
          }

          const rawData = await res.json();
          const validatedResponse = AnalysisJobResponseSchema.parse(rawData);

          // 4. Persist findings & cryptographic evidence into PostgreSQL with tenant context
          if (
            Array.isArray(validatedResponse.findings) &&
            validatedResponse.findings.length > 0
          ) {
            await this.db.withTenantTransaction(organizationId, async (client) => {
              for (const f of validatedResponse.findings) {
                const findingId = f.id || uuidv4();
                const firstObjName = f.affectedObjects[0]?.name || 'GLOBAL';
                const firstArtifact =
                  f.evidence[0]?.artifactPath || 'UNKNOWN_SOURCE';
                const fingerprint =
                  f.fingerprint ||
                  createFindingFingerprint(f.ruleId, firstObjName, firstArtifact);

                await client.query(
                  `INSERT INTO findings (
                    id, organization_id, project_id, analysis_id, engine, rule_id,
                    severity, category, title, description, confidence_class,
                    confidence_score, remediation, affected_objects, technical_details, fingerprint
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                  [
                    findingId,
                    organizationId,
                    projectId,
                    analysisId,
                    engine,
                    f.ruleId,
                    f.severity,
                    f.category,
                    f.title,
                    f.description,
                    f.confidence,
                    f.confidenceScore,
                    f.remediation,
                    JSON.stringify(f.affectedObjects || []),
                    JSON.stringify(f.technicalDetails || {}),
                    fingerprint,
                  ]
                );

                if (Array.isArray(f.evidence) && f.evidence.length > 0) {
                  for (const ev of f.evidence) {
                    await client.query(
                      `INSERT INTO evidence (
                        id, organization_id, finding_id, artifact_path, line_number,
                        column_number, snippet, sha256, provenance, source_title,
                        source_url, trust_score
                      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                      [
                        ev.id || uuidv4(),
                        organizationId,
                        findingId,
                        ev.artifactPath,
                        ev.lineNumber ?? null,
                        ev.columnNumber ?? null,
                        ev.snippet ?? null,
                        ev.sha256,
                        ev.provenance || 'VERIFIED',
                        ev.sourceTitle ?? null,
                        ev.sourceUrl ?? null,
                        ev.trustScore ?? 1.0,
                      ]
                    );
                  }
                }

                totalFindings++;
              }
            });
          }
        } catch (err: any) {
          this.logger.warn(
            `Engine '${engine}' execution skipped/failed: ${err.message}`
          );
          failedEngines.push(engine);
        }
      }

      // 5. Transition status to COMPLETED, PARTIAL, or FAILED
      const finalStatus =
        failedEngines.length === 0
          ? 'COMPLETED'
          : failedEngines.length === engineTypes.length
          ? 'FAILED'
          : 'PARTIAL';

      await this.db.query(
        `UPDATE analyses SET status = $1, completed_at = NOW() WHERE id = $2 AND organization_id = $3`,
        [finalStatus, analysisId, organizationId],
        { tenantId: organizationId }
      );

      this.logger.log(
        `Analysis job ${analysisId} completed with status ${finalStatus}, persisted ${totalFindings} findings`
      );
    } catch (err: any) {
      this.logger.error(`Analysis job ${analysisId} failed: ${err.message}`);
      await this.db
        .query(
          `UPDATE analyses SET status = 'FAILED', completed_at = NOW() WHERE id = $1 AND organization_id = $2`,
          [analysisId, organizationId],
          { tenantId: organizationId }
        )
        .catch(() => {});
      throw err;
    }
  }
}
