import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EngineType, TargetRelease, ArtifactType } from '@erppreflight/schemas';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { OutboxService } from '../outbox/outbox.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import {
  AnalysisExecutor,
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
    @Optional() private readonly telemetry?: TelemetryService
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
      (engine, outcome, ms) => this.telemetry?.recordEngineRun(engine, outcome, ms)
    );
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
      await this.emitCompletionEvents(data, result.finalStatus, result.totalFindings, result.engineOutcomes);
    } catch (err: any) {
      this.logger.error(`Analysis job ${analysisId} failed: ${err?.message ?? err}`);
      this.telemetry?.incrementAnalyses('FAILED');
      await this.recordEvent(organizationId, 'analysis.failed', analysisId, {
        analysisId,
        projectId,
        engineTypes,
        error: 'Analysis could not be executed',
      });
      await this.db
        .query(
          `UPDATE analyses SET status = 'FAILED', completed_at = NOW() WHERE id = $1 AND organization_id = $2`,
          [analysisId, organizationId],
          { tenantId: organizationId }
        )
        .catch(() => {});
      // Rethrow so BullMQ records the failure and applies its retry policy.
      throw err;
    }
  }

  private async recordEvent(organizationId: string, eventType: string, aggregateId: string, payload: Record<string, unknown>) {
    if (!this.outbox) return;
    try {
      await this.outbox.recordEvent(organizationId, eventType, 'ANALYSIS', aggregateId, payload);
    } catch (err: any) {
      this.logger.warn(`Could not record ${eventType} outbox event: ${err?.message}`);
    }
  }

  /**
   * Domain events for webhooks / automation (C §48): analysis.completed or
   * analysis.failed, plus finding.critical when BLOCKER/CRITICAL findings exist.
   */
  private async emitCompletionEvents(
    data: AnalysisJobData,
    finalStatus: string,
    totalFindings: number,
    engineOutcomes: Record<string, string>
  ) {
    const { analysisId, organizationId, projectId } = data;
    this.telemetry?.incrementAnalyses(finalStatus as any);
    const eventType = finalStatus === 'FAILED' ? 'analysis.failed' : 'analysis.completed';
    await this.recordEvent(organizationId, eventType, analysisId, {
      analysisId,
      projectId,
      status: finalStatus,
      totalFindings,
      engineOutcomes,
    });
    if (finalStatus === 'FAILED') return;
    try {
      const res = await this.db.query(
        `SELECT severity, COUNT(*)::int AS n FROM findings
          WHERE organization_id = $1 AND analysis_id = $2 GROUP BY severity`,
        [organizationId, analysisId],
        { tenantId: organizationId }
      );
      const bySeverity: Record<string, number> = {};
      for (const r of res.rows ?? []) {
        bySeverity[r.severity] = Number(r.n);
        this.telemetry?.incrementFindings(String(r.severity));
      }
      const critical = (bySeverity.BLOCKER ?? 0) + (bySeverity.CRITICAL ?? 0);
      if (critical > 0) {
        await this.recordEvent(organizationId, 'finding.critical', analysisId, {
          analysisId,
          projectId,
          criticalFindings: critical,
          bySeverity,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Could not evaluate critical findings for ${analysisId}: ${err?.message}`);
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
