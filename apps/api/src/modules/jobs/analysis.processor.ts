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
import { TelemetryService } from '../telemetry/telemetry.service';
import {
  AnalysisExecutor,
  AnalysisRunResult,
  AnalysisJobFile,
  EngineAssignmentInput,
  applyDataPolicy,
  resolveArtifactType,
} from './analysis-executor';
import { AuditService } from '../audit/audit.service';
import { UsageService } from '../usage/usage.service';
import { RetentionService } from '../retention/retention.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { gateJobForSuspendedTenant } from '../tenant-access/suspended-jobs';

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
  /** Orchestrated runs (Full Project Preflight / AUTO assignment): see AnalysisRunInput. */
  assignments?: EngineAssignmentInput[];
  stages?: EngineType[][];
  kind?: 'STANDARD' | 'FULL_PREFLIGHT';
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
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly usage?: UsageService,
    @Optional() private readonly retention?: RetentionService,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly releasedObjects?: ReleasedObjectsProvider,
    @Optional() private readonly telemetry?: TelemetryService,
    @Optional() private readonly tenantAccess?: TenantAccessService
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
      this.releasedObjects,
      (engine, outcome, ms) => this.telemetry?.recordEngineRun(engine, outcome, ms)
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
    await this.recordOutcomeMetrics(data, result);
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

  /** Business metrics (C §57): analyses by final status and emitted findings by severity. Never throws. */
  private async recordOutcomeMetrics(data: AnalysisJobData, result: AnalysisRunResult | null): Promise<void> {
    if (!this.telemetry) return;
    try {
      this.telemetry.incrementAnalyses((result?.finalStatus ?? 'FAILED') as 'COMPLETED' | 'FAILED' | 'PARTIAL');
      if (!result || result.totalFindings === 0) return;
      const res = await this.db.query(
        `SELECT severity, COUNT(*)::int AS n FROM findings
          WHERE analysis_id = $1 AND organization_id = $2 GROUP BY severity`,
        [data.analysisId, data.organizationId],
        { tenantId: data.organizationId }
      );
      for (const r of res.rows ?? []) {
        this.telemetry.incrementFindings(String(r.severity), Number(r.n));
      }
    } catch (err: any) {
      this.logger.warn(`Could not record analysis metrics for ${data.analysisId}: ${err?.message ?? err}`);
    }
  }

  async process(job: Job<AnalysisJobData | ScheduledPreflightJobData>, token?: string): Promise<void> {
    // Suspended tenants (spec 10.7): analyses are parked until reactivation, schedule firings skipped.
    const gate = await gateJobForSuspendedTenant(job, token, job.data?.organizationId, this.tenantAccess, this.logger, {
      repeatable: job.name === 'scheduled-preflight',
    });
    if (gate === 'skip') return;
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

    let result: AnalysisRunResult;
    try {
      result = await this.executor.run({
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
        assignments: data.assignments,
        stages: data.stages,
        kind: data.kind,
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
      await this.audit?.recordSafe({
        organizationId,
        action: 'analysis.failed',
        resourceType: 'ANALYSIS',
        resourceId: analysisId,
        payload: {
          projectId,
          engineTypes,
          error: String(err?.message ?? err).slice(0, 300),
        },
      });
      await this.emitOutcome(data, null, String(err?.message ?? err));
      // Rethrow so BullMQ records the failure and applies its retry policy.
      throw err;
    }
    await this.recordRunOutcome(data, result);
  }

  /**
   * Audit + usage hooks (spec 10.5, 10.15, 13.10 #14): one audit event and one
   * ENGINE_EXECUTION usage row per engine, then the run outcome. Best-effort in
   * the worker: bookkeeping failures are logged and never fail a finished run.
   */
  private async recordRunOutcome(data: AnalysisJobData, result: AnalysisRunResult): Promise<void> {
    const { analysisId, organizationId, projectId } = data;
    const artifactCount = data.files?.length ?? 0;
    for (const [engine, outcome] of Object.entries(result.engineOutcomes)) {
      await this.audit?.recordSafe({
        organizationId,
        action: `analysis.engine.${outcome.toLowerCase()}`,
        resourceType: 'ANALYSIS',
        resourceId: analysisId,
        payload: { engine, outcome, projectId, artifacts: artifactCount },
      });
      await this.usage?.recordSafe(organizationId, 'ENGINE_EXECUTION', Math.max(1, artifactCount), {
        resourceType: 'ANALYSIS',
        resourceId: analysisId,
        actorId: data.userId,
        metadata: { engine, outcome },
      });
    }
    await this.audit?.recordSafe({
      organizationId,
      action: `analysis.${result.finalStatus === 'COMPLETED' ? 'completed' : result.finalStatus === 'PARTIAL' ? 'partial' : 'failed'}`,
      resourceType: 'ANALYSIS',
      resourceId: analysisId,
      payload: {
        projectId,
        finalStatus: result.finalStatus,
        totalFindings: result.totalFindings,
        engineOutcomes: result.engineOutcomes,
      },
    });
    if (this.retention && data.files?.length) {
      try {
        await this.retention.purgeAfterAnalysis(
          organizationId,
          data.files.map((f) => f.fileId),
          analysisId
        );
      } catch (err: any) {
        this.logger.error(`Post-analysis retention purge failed for ${analysisId}: ${err?.message ?? err}`);
      }
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
    await this.usage?.recordSafe(organizationId, 'ANALYSIS_RUN', 1, {
      resourceType: 'ANALYSIS',
      resourceId: analysisId,
      actorId: userId,
      metadata: { source: 'scheduled', scheduleId: job.data.scheduleId },
    });
    await this.audit?.recordSafe({
      organizationId,
      action: 'analysis.queued',
      resourceType: 'ANALYSIS',
      resourceId: analysisId,
      payload: { projectId, engineTypes, source: 'scheduled', scheduleId: job.data.scheduleId },
    });

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
