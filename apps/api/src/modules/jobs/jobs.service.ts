import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { S3StorageService } from '../storage/s3-storage.service';
import {
  EngineType,
  EngineTypeEnum,
  TargetRelease,
  TargetReleaseEnum,
  FindingSchema,
} from '@erppreflight/schemas';
import { v4 as uuidv4 } from 'uuid';
import {
  AnalysisExecutor,
  AnalysisJobFile,
  applyDataPolicy,
  resolveArtifactType,
} from './analysis-executor';
import { mapEvidenceRow } from '../findings/evidence.mapper';
import { AnalysisProgressTracker } from './analysis-progress';
import { ArtifactProfilerService } from './orchestration/artifact-profiler.service';
import { planFullPreflight, type PreflightPlan } from './orchestration/preflight-planner';
import type { EngineAssignmentInput } from './analysis-executor';
import { buildAnalysisInputs, currentKnowledgeSnapshotId, recordAnalysisError } from './analysis-inputs';
import type { AnalysisInputs } from '@erppreflight/schemas';

/** Source analysis of a rerun, as loaded (tenant-scoped) by AnalysisLifecycleService. */
export interface RerunSource {
  id: string;
  projectId: string;
  kind: 'STANDARD' | 'FULL_PREFLIGHT';
  engineTypes: EngineType[];
  targetRelease: TargetRelease;
  fileIds: string[];
  requestedConfiguration: Record<string, unknown>;
  assignmentMode: AnalysisInputs['assignmentMode'];
  assignments?: EngineAssignmentInput[];
  stages?: EngineType[][];
  orchestration?: Record<string, unknown>;
  problemStatement?: string | null;
  routingId?: string | null;
}

/**
 * Public request contract for POST /analyses and POST /jobs/analyze.
 * Clients reference previously uploaded, CLEAN artifacts by id; the server
 * resolves storage locations itself. Client-supplied S3 keys or inline content
 * are rejected (strict schema).
 */
export const TriggerAnalysisSchema = z
  .object({
    projectId: z.string().uuid(),
    engineTypes: z.array(EngineTypeEnum).min(1).max(64),
    targetRelease: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
        TargetReleaseEnum
      )
      .optional(),
    fileIds: z.array(z.string().uuid()).min(1).max(100),
    configuration: z.record(z.unknown()).optional(),
    /**
     * CROSS (default, original behaviour): every engine on every file.
     * AUTO: the preflight planner assigns files to engines by declared input
     * contract + content signals and pairs multi-file inputs (XDP + data XML,
     * API baseline + candidate); engines without a match fall back to CROSS.
     */
    assignmentMode: z.enum(['CROSS', 'AUTO']).optional(),
    /** Natural-language problem the run answers (Analyze page). */
    problemStatement: z.string().trim().min(1).max(4000).optional(),
    /** Problem Router decision this run follows (advisory link, tenant-checked). */
    routingId: z.string().uuid().optional(),
  })
  .strict();

export type TriggerAnalysisDto = z.infer<typeof TriggerAnalysisSchema>;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly analysisUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Optional()
    @InjectQueue('analysis-queue')
    private readonly analysisQueue?: Queue,
    @Optional()
    private readonly storage?: S3StorageService,
    @Optional()
    private readonly profiler?: ArtifactProfilerService
  ) {
    this.analysisUrl =
      this.config.get<string>('ANALYSIS_SERVICE_URL') ||
      'http://localhost:8000';
  }

  /**
   * Runtime-validates the trigger payload, verifies the project belongs to the
   * tenant, and resolves every fileId to a CLEAN uploaded artifact of that
   * project + tenant.
   */
  private async resolveTrigger(organizationId: string, body: unknown) {
    const parsed = TriggerAnalysisSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_ANALYSIS_REQUEST',
        message: 'Invalid analysis request payload',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const dto = parsed.data;

    const projectRes = await this.db.query(
      `SELECT id, target_release FROM projects WHERE id = $1 AND organization_id = $2`,
      [dto.projectId, organizationId],
      { tenantId: organizationId }
    );
    if (!projectRes.rows?.length) {
      throw new NotFoundException(`Project '${dto.projectId}' not found`);
    }

    const files = await this.resolveFiles(organizationId, dto.projectId, dto.fileIds);

    const projectRelease = TargetReleaseEnum.safeParse(projectRes.rows[0].target_release);
    const targetRelease: TargetRelease =
      dto.targetRelease ?? (projectRelease.success ? projectRelease.data : 'S4H_2023');

    return { dto, files, targetRelease };
  }

  /**
   * Resolves file ids to CLEAN, analysable uploads of the project + tenant (404 for unknown
   * or foreign ids, 400 for non-CLEAN or non-analysable formats). Order follows `fileIds`.
   */
  async resolveFiles(organizationId: string, projectId: string, fileIds: string[]): Promise<AnalysisJobFile[]> {
    const dto = { projectId };
    const uniqueFileIds = Array.from(new Set(fileIds));
    const filesRes = await this.db.query(
      `SELECT id, file_name, storage_path, quarantine_status, metadata
         FROM uploaded_files
        WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND project_id = $3`,
      [uniqueFileIds, organizationId, dto.projectId],
      { tenantId: organizationId }
    );
    const rowsById = new Map<string, any>(
      (filesRes.rows ?? []).map((r: any) => [r.id, r])
    );

    const missing = uniqueFileIds.filter((id) => !rowsById.has(id));
    if (missing.length > 0) {
      throw new NotFoundException({
        code: 'ARTIFACT_NOT_FOUND',
        message: `Artifact(s) not found in project '${dto.projectId}': ${missing.join(', ')}`,
      });
    }

    const files: AnalysisJobFile[] = [];
    for (const id of uniqueFileIds) {
      const row = rowsById.get(id);
      if (row.quarantine_status !== 'CLEAN') {
        throw new BadRequestException({
          code: 'ARTIFACT_NOT_CLEAN',
          message: `Artifact '${id}' cannot be analysed: quarantine status is '${row.quarantine_status}'.`,
        });
      }
      const metadata =
        typeof row.metadata === 'string' ? safeJson(row.metadata) : row.metadata ?? {};
      const artifactType = resolveArtifactType(metadata?.detectedFormat, row.file_name);
      if (!artifactType) {
        throw new BadRequestException({
          code: 'ARTIFACT_FORMAT_NOT_ANALYSABLE',
          message: `Artifact '${row.file_name}' has a format that no preflight engine can analyse.`,
        });
      }
      files.push({
        fileId: row.id,
        fileName: row.file_name,
        storagePath: row.storage_path,
        artifactType,
      });
    }
    return files;
  }

  async triggerAnalysis(organizationId: string, userId: string, body: unknown) {
    const { dto, files, targetRelease } = await this.resolveTrigger(organizationId, body);

    let orchestration: { assignments?: EngineAssignmentInput[]; stages?: EngineType[][]; plan?: PreflightPlan } = {};
    if (dto.assignmentMode === 'AUTO') {
      orchestration = await this.autoAssign(organizationId, dto.projectId, dto.engineTypes, files);
    }
    if (dto.routingId) {
      const routing = await this.db.query(
        `SELECT id FROM problem_routings WHERE id = $1 AND organization_id = $2`,
        [dto.routingId, organizationId],
        { tenantId: organizationId }
      );
      if (!routing.rows?.length) {
        throw new NotFoundException(`Routing '${dto.routingId}' not found`);
      }
    }

    return this.enqueueAnalysis({
      organizationId,
      userId,
      projectId: dto.projectId,
      engineTypes: dto.engineTypes,
      targetRelease,
      files,
      requestedConfiguration: dto.configuration,
      kind: 'STANDARD',
      assignments: orchestration.assignments,
      stages: orchestration.stages,
      orchestration: orchestration.plan ? { plan: orchestration.plan } : undefined,
      problemStatement: dto.problemStatement,
      routingId: dto.routingId,
      assignmentMode: dto.assignmentMode ?? 'CROSS',
    });
  }

  /**
   * Re-run (section C §15/§16): a NEW analysis with the identical inputs of `source` —
   * same artifacts (re-resolved: still CLEAN and in the project), engine selection,
   * target release, requested configuration (the current data policy is applied on top),
   * planner assignments/stages — linked through rerun_of_analysis_id. The knowledge
   * snapshot in force now is recorded on the new run. The source run and its findings
   * are not touched (finding immutability).
   */
  async rerunAnalysis(organizationId: string, userId: string, source: RerunSource) {
    let files: AnalysisJobFile[];
    try {
      files = await this.resolveFiles(organizationId, source.projectId, source.fileIds);
    } catch (err: any) {
      const reason = String(err?.getResponse?.()?.message ?? err?.message ?? err).slice(0, 300);
      throw new ConflictException({
        code: 'RERUN_INPUTS_UNAVAILABLE',
        message: `The artifacts of this run are no longer available unchanged (${reason}). Upload them again and start a new analysis.`,
      });
    }
    if (files.length === 0) {
      throw new ConflictException({ code: 'RERUN_INPUTS_UNAVAILABLE', message: 'The run has no recorded artifacts to re-run.' });
    }
    return this.enqueueAnalysis({
      organizationId,
      userId,
      projectId: source.projectId,
      engineTypes: source.engineTypes,
      targetRelease: source.targetRelease,
      files,
      requestedConfiguration: source.requestedConfiguration,
      kind: source.kind,
      assignments: source.assignments,
      stages: source.stages,
      orchestration: source.orchestration,
      problemStatement: source.problemStatement ?? undefined,
      routingId: source.routingId ?? undefined,
      assignmentMode: source.assignmentMode,
      rerunOfAnalysisId: source.id,
      trigger: 'RERUN',
    });
  }

  /**
   * AUTO assignment for an explicit engine + file selection: planner assignments
   * where a contract + content signal matches, CROSS for selected engines the
   * planner could not feed (the engine then reports its own input diagnostics).
   */
  private async autoAssign(
    organizationId: string,
    projectId: string,
    engineTypes: EngineType[],
    files: AnalysisJobFile[]
  ): Promise<{ assignments?: EngineAssignmentInput[]; stages?: EngineType[][]; plan?: PreflightPlan }> {
    if (!this.profiler) return {};
    const profile = await this.profiler.profileProjectArtifacts(
      organizationId,
      projectId,
      files.map((f) => f.fileId)
    );
    const plan = planFullPreflight(profile.artifacts, {}, engineTypes);
    const assignments: EngineAssignmentInput[] = plan.assignments.map((a) => ({
      engine: a.engine,
      fileId: a.fileId,
      companions: a.companions,
    }));
    for (const engine of engineTypes) {
      if (assignments.some((a) => a.engine === engine)) continue;
      for (const f of files) assignments.push({ engine, fileId: f.fileId, companions: [] });
    }
    return { assignments, plan };
  }

  /**
   * Full Project Preflight (Part 01 §1.6, Part 05 §5.6): profiles every CLEAN
   * artifact of the project, plans engines from declared input contracts + content
   * signals + project context, and queues one orchestrated analysis whose engines
   * run in dependency stages (parallel inside a stage). The correlation pass runs
   * in the worker (stage MATCHING_EVIDENCE).
   */
  async startFullPreflight(
    organizationId: string,
    userId: string,
    projectId: string,
    options: { targetRelease?: TargetRelease; engines?: EngineType[] } = {}
  ) {
    const projectRes = await this.db.query(
      `SELECT id, target_release, source_erp, target_product, deployment_type, modules
         FROM projects WHERE id = $1 AND organization_id = $2`,
      [projectId, organizationId],
      { tenantId: organizationId }
    );
    const project = projectRes.rows?.[0];
    if (!project) {
      throw new NotFoundException(`Project '${projectId}' not found`);
    }
    if (!this.profiler) {
      throw new BadRequestException({ code: 'ORCHESTRATOR_UNAVAILABLE', message: 'Artifact profiler is not available.' });
    }
    const profile = await this.profiler.profileProjectArtifacts(organizationId, projectId);
    const modules = Array.isArray(project.modules)
      ? project.modules
      : typeof project.modules === 'string'
      ? safeJson(project.modules)
      : [];
    const plan = planFullPreflight(
      profile.artifacts,
      {
        sourceErp: project.source_erp,
        targetProduct: project.target_product,
        deploymentType: project.deployment_type,
        modules: Array.isArray(modules) ? modules : [],
      },
      options.engines
    );
    plan.unassigned.push(...profile.skipped);

    if (plan.assignments.length === 0) {
      throw new BadRequestException({
        code: 'NO_ANALYSABLE_ARTIFACTS',
        message:
          profile.files.length === 0 && profile.skipped.length === 0
            ? 'The project has no CLEAN artifacts. Upload SAP exports and wait for the quarantine scan first.'
            : 'None of the project artifacts matches an engine input contract with a specific content signal.',
        unassigned: plan.unassigned,
        missingInputs: plan.missingInputs,
      });
    }

    const referenced = new Set<string>();
    for (const a of plan.assignments) {
      referenced.add(a.fileId);
      for (const c of a.companions) referenced.add(c.fileId);
    }
    const files = profile.files.filter((f) => referenced.has(f.fileId));
    const projectRelease = TargetReleaseEnum.safeParse(project.target_release);
    const targetRelease: TargetRelease =
      options.targetRelease ?? (projectRelease.success ? projectRelease.data : 'S4H_2023');

    const queued = await this.enqueueAnalysis({
      organizationId,
      userId,
      projectId,
      engineTypes: plan.engines,
      targetRelease,
      files,
      requestedConfiguration: undefined,
      kind: 'FULL_PREFLIGHT',
      assignments: plan.assignments.map((a) => ({ engine: a.engine, fileId: a.fileId, companions: a.companions })),
      stages: plan.stages,
      orchestration: { plan },
      assignmentMode: 'PLANNED',
    });
    return { ...queued, kind: 'FULL_PREFLIGHT' as const, plan };
  }

  /** Creates the QUEUED analysis row, records UPLOAD_VALIDATED and dispatches the job. */
  private async enqueueAnalysis(args: {
    organizationId: string;
    userId: string;
    projectId: string;
    engineTypes: EngineType[];
    targetRelease: TargetRelease;
    files: AnalysisJobFile[];
    requestedConfiguration?: Record<string, unknown>;
    kind: 'STANDARD' | 'FULL_PREFLIGHT';
    assignments?: EngineAssignmentInput[];
    stages?: EngineType[][];
    orchestration?: Record<string, unknown>;
    problemStatement?: string;
    routingId?: string;
    assignmentMode?: AnalysisInputs['assignmentMode'];
    rerunOfAnalysisId?: string;
    trigger?: AnalysisInputs['trigger'];
  }) {
    const { organizationId, userId, projectId, engineTypes, targetRelease, files } = args;
    const analysisId = uuidv4();
    const effectiveConfig = await applyDataPolicy(this.db, organizationId, args.requestedConfiguration);
    const inputs = await buildAnalysisInputs(this.db, organizationId, {
      files,
      requestedConfiguration: args.requestedConfiguration ?? {},
      effectiveConfiguration: effectiveConfig,
      assignmentMode: args.assignmentMode ?? 'CROSS',
      assignments: args.assignments,
      stages: args.stages,
      trigger: args.trigger ?? 'API',
    });
    const knowledgeSnapshotId = await currentKnowledgeSnapshotId(this.db, organizationId);

    // 1. Create analysis record with status QUEUED (inputs + knowledge snapshot recorded for reruns)
    await this.db.query(
      `INSERT INTO analyses (id, organization_id, project_id, status, engine_types, target_release, triggered_by,
                             inputs, knowledge_snapshot_id, rerun_of_analysis_id)
       VALUES ($1, $2, $3, 'QUEUED', $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        analysisId,
        organizationId,
        projectId,
        JSON.stringify(engineTypes),
        targetRelease,
        userId,
        JSON.stringify(inputs),
        knowledgeSnapshotId,
        args.rerunOfAnalysisId ?? null,
      ],
      { tenantId: organizationId }
    );
    if (args.kind !== 'STANDARD' || args.orchestration || args.problemStatement || args.routingId) {
      await this.db.query(
        `UPDATE analyses
            SET kind = $1, orchestration = $2::jsonb, problem_statement = $3, routing_id = $4
          WHERE id = $5 AND organization_id = $6`,
        [
          args.kind,
          JSON.stringify(args.orchestration ?? {}),
          args.problemStatement ?? null,
          args.routingId ?? null,
          analysisId,
          organizationId,
        ],
        { tenantId: organizationId }
      );
    }

    // Stage 1 of the progress stepper: every artifact was resolved as a CLEAN,
    // tenant-owned upload of this project (Part 03 §3.8 "Upload validated").
    const progress = new AnalysisProgressTracker(this.db, organizationId, analysisId, this.logger);
    await progress.complete('UPLOAD_VALIDATED', {
      files: files.length,
      engines: engineTypes.length,
      kind: args.kind,
    });

    // 2. Dispatch job to BullMQ analysis queue
    const jobPayload: Record<string, unknown> = {
      analysisId,
      organizationId,
      projectId,
      userId,
      engineTypes,
      targetRelease,
      files,
      configuration: effectiveConfig,
    };
    if (args.assignments) jobPayload.assignments = args.assignments;
    if (args.stages) jobPayload.stages = args.stages;
    if (args.kind !== 'STANDARD') jobPayload.kind = args.kind;

    if (this.analysisQueue) {
      await this.analysisQueue.add('analyze', jobPayload, {
        // Job id = analysis id: POST /analyses/:id/cancel finds and removes a queued job by it.
        jobId: analysisId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      this.logger.log(`Enqueued analysis job ${analysisId} to analysis-queue`);
    } else {
      this.logger.warn(
        `analysisQueue not injected; falling back to direct asynchronous run for analysis ${analysisId}`
      );
      this.runEngines(
        analysisId,
        organizationId,
        projectId,
        engineTypes,
        targetRelease,
        files,
        effectiveConfig,
        { assignments: args.assignments, stages: args.stages, kind: args.kind }
      ).catch((err) => {
        this.logger.error(`Error executing analysis job ${analysisId}: ${err.message}`);
      });
    }

    // 3. Immediately return HTTP 202 / queued analysis record
    return {
      analysisId,
      status: 'QUEUED',
      engineTypes,
      targetRelease,
      knowledgeSnapshotId,
      rerunOfAnalysisId: args.rerunOfAnalysisId ?? null,
    };
  }

  /**
   * In-process fallback when no BullMQ queue is available. Shares the exact
   * pipeline of AnalysisProcessor (status semantics, multi-artifact fan-out,
   * fetch failure => FAILED).
   */
  private async runEngines(
    analysisId: string,
    organizationId: string,
    projectId: string,
    engineTypes: EngineType[],
    targetRelease: TargetRelease,
    files: AnalysisJobFile[],
    configuration?: Record<string, unknown>,
    orchestration: { assignments?: EngineAssignmentInput[]; stages?: EngineType[][]; kind?: 'STANDARD' | 'FULL_PREFLIGHT' } = {}
  ) {
    const executor = new AnalysisExecutor(this.db, this.storage, this.analysisUrl, this.logger);
    try {
      return await executor.run({
        analysisId,
        organizationId,
        projectId,
        engineTypes,
        targetRelease,
        files,
        configuration,
        ...orchestration,
      });
    } catch (err: any) {
      await this.db
        .query(
          `UPDATE analyses SET status = 'FAILED', completed_at = NOW() WHERE id = $1 AND organization_id = $2 AND status <> 'CANCELLED'`,
          [analysisId, organizationId],
          { tenantId: organizationId }
        )
        .catch(() => {});
      await recordAnalysisError(this.db, organizationId, analysisId, err);
      throw err;
    }
  }

  async getAnalysis(organizationId: string, analysisId: string) {
    const res = await this.db.query(
      `SELECT a.*, COUNT(f.id)::int as total_findings
       FROM analyses a
       LEFT JOIN findings f ON f.analysis_id = a.id
       WHERE a.organization_id = $1 AND a.id = $2
       GROUP BY a.id`,
      [organizationId, analysisId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Analysis job '${analysisId}' not found`);
    }

    const findingsRes = await this.db.query(
      `SELECT * FROM findings WHERE organization_id = $1 AND analysis_id = $2 ORDER BY created_at ASC`,
      [organizationId, analysisId]
    );

    const findingIds = findingsRes.rows.map((r: any) => r.id);
    const evidenceMap = new Map<string, any[]>();

    if (findingIds.length > 0) {
      const evidenceRes = await this.db.query(
        `SELECT id, finding_id, artifact_path, line_number, column_number, snippet, sha256,
                provenance, source_title, source_url, trust_score, created_at
           FROM evidence WHERE organization_id = $1 AND finding_id = ANY($2::uuid[])
          ORDER BY created_at ASC, id ASC`,
        [organizationId, findingIds]
      );
      for (const evRow of evidenceRes.rows) {
        const ev = mapEvidenceRow(evRow);
        const list = evidenceMap.get(evRow.finding_id) || [];
        list.push(ev);
        evidenceMap.set(evRow.finding_id, list);
      }
    }

    const normalizedFindings = findingsRes.rows.map((row: any) => {
      const evidence = evidenceMap.get(row.id) || [];
      return FindingSchema.parse({
        ...row,
        evidence,
      });
    });

    return {
      ...res.rows[0],
      findings: normalizedFindings,
    };
  }

  /**
   * Part 17.16 & Section 31: Schedule automated recurring preflight analysis via BullMQ repeatable jobs.
   */
  async schedulePreflight(
    organizationId: string,
    userId: string,
    dto: {
      projectId: string;
      cronExpression: string;
      engineTypes: EngineType[];
      targetRelease?: TargetRelease;
    }
  ) {
    const id = uuidv4();
    const cron = dto.cronExpression.trim();
    const parts = cron.split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron pattern '${cron}'. Expected standard 5-part cron syntax (e.g. '0 2 * * *')`);
    }

    const targetRelease = (dto.targetRelease || 'S4H_2023') as TargetRelease;
    const repeatJobKey = `sched:${organizationId}:${dto.projectId}:${id}`;

    if (this.analysisQueue) {
      await this.analysisQueue.add(
        'scheduled-preflight',
        {
          scheduleId: id,
          organizationId,
          projectId: dto.projectId,
          userId,
          engineTypes: dto.engineTypes,
          targetRelease,
        },
        {
          repeat: {
            pattern: cron,
            jobId: repeatJobKey,
          },
          jobId: repeatJobKey,
        }
      );
    }

    const res = await this.db.query(
      `INSERT INTO scheduled_preflights (
        id, organization_id, project_id, cron_expression, engine_types, target_release,
        status, repeat_job_key, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $8)
      RETURNING *`,
      [
        id,
        organizationId,
        dto.projectId,
        cron,
        JSON.stringify(dto.engineTypes),
        targetRelease,
        repeatJobKey,
        userId,
      ],
      { tenantId: organizationId }
    );

    return res.rows[0];
  }

  async listScheduledPreflights(organizationId: string, projectId?: string) {
    if (projectId) {
      const res = await this.db.query(
        `SELECT * FROM scheduled_preflights WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
        [organizationId, projectId],
        { tenantId: organizationId }
      );
      return res.rows;
    }

    const res = await this.db.query(
      `SELECT * FROM scheduled_preflights WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId],
      { tenantId: organizationId }
    );
    return res.rows;
  }

  async cancelScheduledPreflight(organizationId: string, scheduleId: string) {
    const existing = await this.db.query(
      `SELECT * FROM scheduled_preflights WHERE organization_id = $1 AND id = $2`,
      [organizationId, scheduleId],
      { tenantId: organizationId }
    );
    if (!existing.rows?.length) {
      throw new NotFoundException(`Scheduled preflight '${scheduleId}' not found`);
    }

    const row = existing.rows[0];
    if (this.analysisQueue && row.cron_expression && row.repeat_job_key) {
      try {
        await this.analysisQueue.removeRepeatable(
          'scheduled-preflight',
          { pattern: row.cron_expression, jobId: row.repeat_job_key }
        );
      } catch (err: any) {
        this.logger.warn(`Failed to remove BullMQ repeatable job ${row.repeat_job_key}: ${err.message}`);
      }
    }

    const res = await this.db.query(
      `UPDATE scheduled_preflights SET status = 'CANCELLED', updated_at = NOW()
       WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [organizationId, scheduleId],
      { tenantId: organizationId }
    );

    return res.rows[0];
  }
}

function safeJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
