import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EngineType, TargetRelease, ArtifactType } from '@erppreflight/schemas';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { OutboxService } from '../outbox/outbox.service';
import { ReleasedObjectsProvider } from '../knowledge-graph/released-objects.provider';
import {
  AnalysisExecutor,
  AnalysisRunResult,
  AnalysisJobFile,
  applyDataPolicy,
  resolveArtifactType,
} from './analysis-executor';

export interface AnalysisJobData {
  analysisId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  engineTypes: EngineType[];
  targetRelease: TargetRelease;
  /** Server-resolved CLEAN artifacts (tenant + project verified at trigger time). */
  files?: AnalysisJobFile[];
  configuration?: Record<string, unknown>;
  /** @deprecated legacy payloads enqueued before fileIds became mandatory */
  artifactS3Key?: string | null;
  /** @deprecated */
  artifactType?: ArtifactType;
  /** @deprecated */
  rawContent?: string | null;
}

export interface ScheduledPreflightJobData {
  scheduleId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  engineTypes: EngineType[];
  targetRelease: TargetRelease;
}

@Processor('analysis-queue')
@Injectable()
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);
  private readonly analysisUrl: string;
  private readonly executor: AnalysisExecutor;

  constructor(
    private readonly db: DatabaseService,
    private readonly storageService: S3StorageService,
    private readonly config: ConfigService,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly releasedObjects?: ReleasedObjectsProvider
  ) {
    super();
    this.analysisUrl =
      this.config.get<string>('ANALYSIS_SERVICE_URL') ||
      'http://localhost:8000';
    this.executor = new AnalysisExecutor(
      this.db,
      this.storageService,
      this.analysisUrl,
      this.logger,
      this.releasedObjects
    );
  }

  /**
   * Domain events for the notification engine / webhooks (Part 05 §5.10):
   * analysis.completed | analysis.failed, plus finding.critical when the run
   * persisted BLOCKER/CRITICAL findings. Best effort: never fails the job.
   */
  private async emitOutcome(
    data: AnalysisJobData,
    result: AnalysisRunResult | null,
    error?: string
  ): Promise<void> {
    if (!this.outbox) return;
    const { analysisId, organizationId, projectId, userId, engineTypes, targetRelease } = data;
    try {
      const failed = !result || result.finalStatus === 'FAILED';
      await this.outbox.recordEvent(
        organizationId,
        failed ? 'analysis.failed' : 'analysis.completed',
        'ANALYSIS',
        analysisId,
        {
          analysisId,
          projectId,
          triggeredBy: userId ?? null,
          engineTypes,
          targetRelease,
          status: result?.finalStatus ?? 'FAILED',
          totalFindings: result?.totalFindings ?? 0,
          engineOutcomes: result?.engineOutcomes ?? {},
          ...(error ? { reason: error.slice(0, 500) } : {}),
        }
      );
      if (!result || result.totalFindings === 0) return;
      const sev = await this.db.query(
        `SELECT severity, engine, COUNT(*)::int AS n FROM findings
          WHERE analysis_id = $1 AND organization_id = $2 AND severity IN ('BLOCKER', 'CRITICAL')
          GROUP BY severity, engine`,
        [analysisId, organizationId],
        { tenantId: organizationId }
      );
      if (!sev.rows.length) return;
      const count = (s: string) => sev.rows.filter((r: any) => r.severity === s).reduce((a: number, r: any) => a + r.n, 0);
      await this.outbox.recordEvent(organizationId, 'finding.critical', 'ANALYSIS', analysisId, {
        analysisId,
        projectId,
        triggeredBy: userId ?? null,
        blockerCount: count('BLOCKER'),
        criticalCount: count('CRITICAL'),
        engines: [...new Set(sev.rows.map((r: any) => r.engine))].sort(),
      });
    } catch (err: any) {
      this.logger.warn(`Could not record analysis outcome event for ${analysisId}: ${err?.message ?? err}`);
    }
  }

  async process(job: Job<AnalysisJobData | ScheduledPreflightJobData>): Promise<void> {
    if (job.name === 'scheduled-preflight') {
      await this.processScheduled(job as Job<ScheduledPreflightJobData>);
      return;
    }
    await this.processAnalysis(job.data as AnalysisJobData);
  }

  private async processAnalysis(data: AnalysisJobData): Promise<void> {
    const { analysisId, organizationId, projectId, engineTypes, targetRelease } = data;

    this.logger.log(
      `Processing analysis job ${analysisId} for organization ${organizationId}: ${engineTypes.length} engines x ${data.files?.length ?? 0} artifacts`
    );

    try {
      const result = await this.executor.run({
        analysisId,
        organizationId,
        projectId,
        engineTypes,
        targetRelease,
        files: data.files ?? [],
        configuration: data.configuration,
        legacyRawContent: data.rawContent ?? null,
        legacyArtifactS3Key: data.artifactS3Key ?? null,
        legacyArtifactType: data.artifactType,
      });
      await this.emitOutcome(data, result);
    } catch (err: any) {
      this.logger.error(`Analysis job ${analysisId} failed: ${err?.message ?? err}`);
      await this.db
        .query(
          `UPDATE analyses SET status = 'FAILED', completed_at = NOW() WHERE id = $1 AND organization_id = $2`,
          [analysisId, organizationId],
          { tenantId: organizationId }
        )
        .catch(() => {});
      await this.emitOutcome(data, null, String(err?.message ?? err));
      // Rethrow so BullMQ records the failure and applies its retry policy.
      throw err;
    }
  }

  /**
   * Repeatable scheduled preflight: creates a fresh analysis record over every
   * CLEAN artifact currently in the project, then runs it like a normal job.
   */
  private async processScheduled(job: Job<ScheduledPreflightJobData>): Promise<void> {
    const { organizationId, projectId, userId, engineTypes, targetRelease } = job.data;

    const filesRes = await this.db.query(
      `SELECT id, file_name, storage_path, metadata
         FROM uploaded_files
        WHERE organization_id = $1 AND project_id = $2 AND quarantine_status = 'CLEAN'
        ORDER BY created_at ASC`,
      [organizationId, projectId],
      { tenantId: organizationId }
    );

    const files: AnalysisJobFile[] = [];
    for (const row of filesRes.rows ?? []) {
      const artifactType = resolveArtifactType(row.metadata?.detectedFormat, row.file_name);
      if (!artifactType) continue;
      files.push({
        fileId: row.id,
        fileName: row.file_name,
        storagePath: row.storage_path,
        artifactType,
      });
    }

    if (files.length === 0) {
      this.logger.warn(
        `Scheduled preflight ${job.data.scheduleId}: project ${projectId} has no CLEAN analysable artifacts; skipping run`
      );
      return;
    }

    const analysisId = uuidv4();
    await this.db.query(
      `INSERT INTO analyses (id, organization_id, project_id, status, engine_types, target_release, triggered_by)
       VALUES ($1, $2, $3, 'QUEUED', $4, $5, $6)`,
      [analysisId, organizationId, projectId, JSON.stringify(engineTypes), targetRelease, userId],
      { tenantId: organizationId }
    );

    await this.processAnalysis({
      analysisId,
      organizationId,
      projectId,
      userId,
      engineTypes,
      targetRelease,
      files,
      configuration: await applyDataPolicy(this.db, organizationId, {}),
    });
  }
}
