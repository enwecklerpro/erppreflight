import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  AnalysisInputsSchema,
  EngineTypeEnum,
  TargetReleaseEnum,
  type AnalysisDetail,
  type AnalysisInputs,
  type CancelAnalysisRequest,
  type CancelAnalysisResponse,
  type EngineType,
  type RerunAnalysisResponse,
} from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { JobsService, type RerunSource } from '../jobs/jobs.service';
import { AnalysisJobControlService } from '../jobs/analysis-job-control.service';
import { AnalysisProgressTracker, parseProgressState } from '../jobs/analysis-progress';
import { RunCancellation } from '../jobs/run-cancellation';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { RegressionLabService } from '../lab/regression/regression-lab.service';
import { LabService } from '../lab/lab.service';
import { GeneratedTestsService } from '../lab/generated-tests.service';
import {
  ACTIVE,
  FINISHED,
  canControlAnalyses,
  decideCancel,
  decideFinalization,
  decideRerun,
} from './analysis-lifecycle.state';

export interface LifecycleCaller {
  id: string;
  role: string | null;
  systemRole: string | null;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Analysis run lifecycle (section C §15/§16, KNOWN_LIMITATIONS P6/P8): cancel, rerun and the
 * analysis detail view. Every read and write is tenant-scoped (organization_id predicate +
 * RLS through the tenant transaction); foreign or unknown ids are 404.
 */
@Injectable()
export class AnalysisLifecycleService {
  private readonly logger = new Logger(AnalysisLifecycleService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly jobControl: AnalysisJobControlService,
    @Optional() private readonly regressionLab?: RegressionLabService,
    @Optional() private readonly scenarioLab?: LabService,
    @Optional() private readonly generatedTests?: GeneratedTestsService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly telemetry?: TelemetryService
  ) {}

  private async loadRow(tenantId: string, analysisId: string) {
    if (!UUID_RE.test(analysisId)) throw new NotFoundException(`Analysis run '${analysisId}' not found.`);
    const res = await this.db.query(
      `SELECT a.*, p.name AS project_name,
              (SELECT COUNT(*)::int FROM findings f WHERE f.analysis_id = a.id AND f.organization_id = a.organization_id) AS findings_count
         FROM analyses a
         JOIN projects p ON p.id = a.project_id AND p.organization_id = a.organization_id
        WHERE a.organization_id = $1 AND a.id = $2`,
      [tenantId, analysisId],
      { tenantId }
    );
    const row = res.rows?.[0];
    if (!row) throw new NotFoundException(`Analysis run '${analysisId}' not found.`);
    return row;
  }

  // ------------------------------------------------------------------ cancel

  async cancel(tenantId: string, caller: LifecycleCaller, analysisId: string, dto: CancelAnalysisRequest): Promise<CancelAnalysisResponse> {
    if (!UUID_RE.test(analysisId)) throw new NotFoundException(`Analysis run '${analysisId}' not found.`);
    const { row, decision } = await this.db.withTenantTransaction(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, status, kind, cancel_requested_at, published_at, cancelled_at, progress, started_at, created_at
           FROM analyses WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [analysisId, tenantId]
      );
      const current = res.rows[0];
      if (!current) throw new NotFoundException(`Analysis run '${analysisId}' not found.`);
      const d = decideCancel({
        status: current.status,
        cancelRequestedAt: current.cancel_requested_at,
        publishedAt: current.published_at,
      });
      if (d.kind === 'REQUEST') {
        const upd = await client.query(
          `UPDATE analyses SET cancel_requested_at = NOW(), cancel_requested_by = $3, cancel_reason = $4
            WHERE id = $1 AND organization_id = $2
            RETURNING cancel_requested_at`,
          [analysisId, tenantId, caller.id ?? null, dto.reason ?? null]
        );
        current.cancel_requested_at = upd.rows[0]?.cancel_requested_at ?? new Date();
      }
      return { row: current, decision: d };
    });

    switch (decision.kind) {
      case 'ALREADY_CANCELLED':
        return this.cancelResponse(analysisId, 'ALREADY_CANCELLED', row);
      case 'REJECT_FINISHED':
        throw new ConflictException({
          code: 'ANALYSIS_NOT_CANCELLABLE',
          message: `The analysis already finished with status ${decision.status}; only queued or running analyses can be cancelled.`,
        });
      case 'REJECT_PUBLISHING':
        throw new ConflictException({
          code: 'ANALYSIS_FINALIZING',
          message: 'The analysis is publishing its results and can no longer be cancelled.',
        });
      default:
        break;
    }

    // REQUEST or ALREADY_REQUESTED: stop it now when nobody executes it, otherwise the worker does.
    RunCancellation.signalLocal(analysisId);
    const isLab = String(row.kind ?? '').startsWith('LAB_');
    const job = isLab ? null : await this.jobControl.removeQueuedJob(analysisId);
    const progress = parseProgressState(row.progress);
    const action = decideFinalization({
      status: row.status,
      kind: String(row.kind ?? 'STANDARD'),
      job,
      lastActivityAt: progress.updatedAt ?? row.started_at ?? row.created_at,
      now: new Date(),
    });
    if (action === 'FINALIZE_NOW') {
      const finalized = await this.finalizeCancelled(tenantId, analysisId, caller.id, job);
      if (finalized) {
        const fresh = await this.loadRow(tenantId, analysisId);
        return this.cancelResponse(analysisId, 'CANCELLED', fresh);
      }
    }
    const fresh = await this.loadRow(tenantId, analysisId);
    if (fresh.status === 'CANCELLED') return this.cancelResponse(analysisId, 'CANCELLED', fresh);
    return this.cancelResponse(analysisId, decision.kind === 'ALREADY_REQUESTED' ? 'ALREADY_REQUESTED' : 'CANCELLATION_REQUESTED', fresh);
  }

  private cancelResponse(analysisId: string, outcome: CancelAnalysisResponse['outcome'], row: any): CancelAnalysisResponse {
    return {
      analysisId,
      outcome,
      status: row.status,
      cancelRequestedAt: iso(row.cancel_requested_at),
      cancelledAt: iso(row.cancelled_at),
    };
  }

  /** Final CANCELLED transition when no worker executes the run (guarded: never after publishing). */
  private async finalizeCancelled(tenantId: string, analysisId: string, actorId: string | null, job: string | null): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE analyses
          SET status = 'CANCELLED', cancelled_at = NOW(), completed_at = COALESCE(completed_at, NOW()),
              orchestration = COALESCE(orchestration, '{}'::jsonb) || '{"cancelled":{"discardedFindings":0}}'::jsonb
        WHERE id = $1 AND organization_id = $2 AND status IN ('QUEUED', 'RUNNING') AND published_at IS NULL
        RETURNING project_id, engine_types, triggered_by`,
      [analysisId, tenantId],
      { tenantId }
    );
    const row = res.rows?.[0];
    if (!row) return false;
    const tracker = await AnalysisProgressTracker.resume(this.db, tenantId, analysisId, this.logger);
    await tracker.cancel('Cancelled on request before any result was published.');
    await this.audit?.recordSafe({
      organizationId: tenantId,
      actorType: actorId ? 'HUMAN' : 'SYSTEM',
      actorId: actorId ?? null,
      action: 'analysis.cancelled',
      resourceType: 'ANALYSIS',
      resourceId: analysisId,
      payload: { projectId: row.project_id, finalizedBy: 'api', job: job ?? 'n/a', discardedFindings: 0 },
    });
    try {
      this.telemetry?.incrementAnalyses('CANCELLED');
    } catch {
      /* metrics never fail a request */
    }
    if (this.outbox) {
      try {
        await this.outbox.recordEvent(tenantId, 'analysis.cancelled', 'ANALYSIS', analysisId, {
          analysisId,
          projectId: row.project_id,
          triggeredBy: row.triggered_by ?? null,
          engineTypes: json<string[]>(row.engine_types, []),
          status: 'CANCELLED',
          discardedFindings: 0,
        });
      } catch (err: any) {
        this.logger.warn(`Could not record analysis.cancelled event for ${analysisId}: ${err?.message ?? err}`);
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ rerun

  async rerun(tenantId: string, caller: LifecycleCaller, analysisId: string): Promise<RerunAnalysisResponse> {
    const row = await this.loadRow(tenantId, analysisId);
    const decision = decideRerun(row.status);
    if (decision.kind === 'REJECT_ACTIVE') {
      throw new ConflictException({
        code: 'ANALYSIS_STILL_ACTIVE',
        message: `The analysis is still ${decision.status}. Wait for it to finish or cancel it before re-running.`,
      });
    }
    const kind = String(row.kind ?? 'STANDARD');
    const inputs = this.parseInputs(row);
    let created: { analysisId: string; status: string; engineTypes: string[]; targetRelease: string | null; knowledgeSnapshotId?: string | null };

    if (kind === 'LAB_REGRESSION') {
      if (!this.regressionLab) throw new ConflictException({ code: 'RERUN_INPUTS_UNAVAILABLE', message: 'The Test Lab is not available.' });
      created = await this.regressionLab.rerunLabAnalysis(tenantId, caller, {
        id: row.id,
        projectId: row.project_id,
        testCaseIds: inputs?.testCaseIds ?? [],
        trigger: inputs?.trigger ?? null,
      });
    } else if (kind === 'LAB_SCENARIO') {
      if (!this.scenarioLab) throw new ConflictException({ code: 'RERUN_INPUTS_UNAVAILABLE', message: 'The Test Lab is not available.' });
      created = await this.scenarioLab.rerunScenarioAnalysis(tenantId, caller.id, {
        id: row.id,
        projectId: row.project_id,
        scenarioId: inputs?.scenarioId ?? null,
        targetRelease: row.target_release ?? null,
      });
    } else {
      created = await this.jobs.rerunAnalysis(tenantId, caller.id, this.rerunSource(row, inputs));
    }

    const snap = await this.db.query(`SELECT knowledge_snapshot_id FROM analyses WHERE id = $1 AND organization_id = $2`, [created.analysisId, tenantId], {
      tenantId,
    });
    return {
      analysisId: created.analysisId,
      status: created.status as RerunAnalysisResponse['status'],
      kind: kind as RerunAnalysisResponse['kind'],
      engineTypes: created.engineTypes,
      targetRelease: created.targetRelease ?? null,
      rerunOfAnalysisId: row.id,
      knowledgeSnapshotId: snap.rows?.[0]?.knowledge_snapshot_id ?? created.knowledgeSnapshotId ?? null,
      previousKnowledgeSnapshotId: row.knowledge_snapshot_id ?? null,
    };
  }

  private parseInputs(row: any): AnalysisInputs | null {
    const raw = json<Record<string, unknown>>(row.inputs, {});
    if (!raw || Object.keys(raw).length === 0) return null;
    const parsed = AnalysisInputsSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Inputs of the source run. Runs created before migration 020 have no recorded inputs; their
   * artifacts are recovered from the orchestration record (engine calls / planner assignments).
   */
  private rerunSource(row: any, inputs: AnalysisInputs | null): RerunSource {
    const engineTypes = json<string[]>(row.engine_types, []).filter((e): e is EngineType => EngineTypeEnum.safeParse(e).success);
    const release = TargetReleaseEnum.safeParse(row.target_release);
    const orchestration = json<Record<string, any>>(row.orchestration, {});
    const kind = row.kind === 'FULL_PREFLIGHT' ? 'FULL_PREFLIGHT' : 'STANDARD';
    let fileIds: string[] = inputs?.files.map((f) => f.fileId) ?? [];
    if (!inputs) {
      const ids = new Set<string>();
      for (const c of Array.isArray(orchestration.calls) ? orchestration.calls : []) if (c?.fileId) ids.add(String(c.fileId));
      for (const a of orchestration.plan?.assignments ?? []) {
        if (a?.fileId) ids.add(String(a.fileId));
        for (const c of a?.companions ?? []) if (c?.fileId) ids.add(String(c.fileId));
      }
      fileIds = [...ids].filter((id) => UUID_RE.test(id));
    }
    const planAssignments = Array.isArray(orchestration.plan?.assignments) ? orchestration.plan.assignments : undefined;
    const assignments =
      inputs?.assignments ??
      (planAssignments?.map((a: any) => ({ engine: a.engine, fileId: a.fileId, companions: a.companions ?? [] })) as RerunSource['assignments']);
    const stages = (inputs?.stages ?? (Array.isArray(orchestration.plan?.stages) ? orchestration.plan.stages : undefined)) as RerunSource['stages'];
    return {
      id: row.id,
      projectId: row.project_id,
      kind,
      engineTypes,
      targetRelease: release.success ? release.data : 'S4H_2023',
      fileIds,
      requestedConfiguration: inputs?.requestedConfiguration ?? {},
      assignmentMode: inputs?.assignmentMode ?? (assignments?.length ? 'PLANNED' : 'CROSS'),
      assignments: assignments?.length ? assignments : undefined,
      stages: stages?.length ? stages : undefined,
      orchestration: orchestration.plan ? { plan: orchestration.plan } : undefined,
      problemStatement: row.problem_statement ?? null,
      routingId: row.routing_id ?? null,
    };
  }

  // ------------------------------------------------------------------ detail

  async detail(tenantId: string, caller: LifecycleCaller, analysisId: string): Promise<AnalysisDetail> {
    const row = await this.loadRow(tenantId, analysisId);
    const kind = String(row.kind ?? 'STANDARD');
    const orchestration = json<Record<string, any>>(row.orchestration, {});
    const inputs = this.parseInputs(row);
    const calls: any[] = Array.isArray(orchestration.calls) ? orchestration.calls : [];
    const progress = parseProgressState(row.progress);
    const terminal = !ACTIVE.has(row.status);

    const userIds = [row.triggered_by, row.cancel_requested_by].filter((v): v is string => typeof v === 'string');
    const users = new Map<string, { id: string; name: string | null; email: string | null }>();
    if (userIds.length) {
      const u = await this.db.query(
        `SELECT u.id, u.full_name, u.email FROM users u
           JOIN organization_members m ON m.user_id = u.id AND m.organization_id = $1
          WHERE u.id = ANY($2::uuid[])`,
        [tenantId, userIds],
        { tenantId }
      );
      for (const r of u.rows ?? []) users.set(r.id, { id: r.id, name: r.full_name ?? null, email: r.email ?? null });
    }

    // Recorded inputs (or the legacy reconstruction) + the current state of each artifact.
    const recordedFiles = inputs?.files ?? this.rerunSource(row, null).fileIds.map((id) => ({
      fileId: id,
      fileName: calls.find((c) => c?.fileId === id)?.fileName ?? '',
      artifactType: '',
      sha256: null,
      sizeBytes: null,
    }));
    const fileState = new Map<string, { status: string; sha256: string | null; name: string }>();
    if (recordedFiles.length) {
      const f = await this.db.query(
        `SELECT id, file_name, quarantine_status, checksum_sha256 FROM uploaded_files WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, recordedFiles.map((x) => x.fileId)],
        { tenantId }
      );
      for (const r of f.rows ?? []) fileState.set(r.id, { status: r.quarantine_status, sha256: r.checksum_sha256 ?? null, name: r.file_name });
    }

    let knowledgeSnapshot: AnalysisDetail['knowledgeSnapshot'] = null;
    if (row.knowledge_snapshot_id) {
      const k = await this.db.query(
        `SELECT s.id, s.seq, s.adapter_id, s.status, s.published_at, s.content_sha256,
                (SELECT l.id FROM knowledge_snapshots l WHERE l.status = 'PUBLISHED' ORDER BY l.seq DESC LIMIT 1) AS latest_id
           FROM knowledge_snapshots s WHERE s.id = $1`,
        [row.knowledge_snapshot_id],
        { tenantId }
      );
      const s = k.rows?.[0];
      if (s) {
        knowledgeSnapshot = {
          id: s.id,
          seq: s.seq === null || s.seq === undefined ? null : Number(s.seq),
          adapterId: s.adapter_id ?? null,
          status: s.status ?? null,
          publishedAt: iso(s.published_at),
          contentSha256: s.content_sha256 ? String(s.content_sha256).trim() : null,
          superseded: Boolean(s.latest_id && s.latest_id !== s.id),
        };
      }
    }

    const lineageRes = await this.db.query(
      `SELECT id, status, created_at, 'child' AS rel FROM analyses WHERE organization_id = $1 AND rerun_of_analysis_id = $2
       UNION ALL
       SELECT id, status, created_at, 'parent' AS rel FROM analyses WHERE organization_id = $1 AND id = $3
       ORDER BY created_at DESC LIMIT 50`,
      [tenantId, row.id, row.rerun_of_analysis_id ?? null],
      { tenantId }
    );
    const lineageRows: any[] = lineageRes.rows ?? [];
    const parent = lineageRows.find((r) => r.rel === 'parent');

    let labResults: AnalysisDetail['labResults'] = [];
    if (kind === 'LAB_REGRESSION') {
      const lr = await this.db.query(
        `SELECT r.id, r.test_case_id, r.status, r.finding_present, r.artifact_sha256, r.engine_version, r.execution_time_ms,
                r.error_message, r.baseline_comparison, c.title, c.engine, c.rule_id, c.expected_outcome
           FROM regression_test_runs r
           JOIN regression_test_cases c ON c.id = r.test_case_id AND c.organization_id = r.organization_id
          WHERE r.organization_id = $1 AND r.analysis_id = $2
          ORDER BY r.started_at ASC, r.id ASC`,
        [tenantId, row.id],
        { tenantId }
      );
      labResults = (lr.rows ?? []).map((r: any) => ({
        runId: r.id,
        testCaseId: r.test_case_id,
        title: r.title,
        engine: r.engine,
        ruleId: r.rule_id,
        expectedOutcome: r.expected_outcome,
        status: r.status,
        findingPresent: r.finding_present ?? null,
        artifactSha256: r.artifact_sha256 ? String(r.artifact_sha256).trim() : null,
        engineVersion: r.engine_version ?? null,
        executionTimeMs: r.execution_time_ms ?? null,
        errorMessage: r.error_message ?? null,
        baselineVerdict: json<Record<string, any> | null>(r.baseline_comparison, null)?.verdict ?? null,
      }));
    }

    const generated = this.generatedTests && !kind.startsWith('LAB_') ? await this.generatedTests.countForAnalysis(tenantId, row.id) : { total: 0, promoted: 0 };

    const createdAt = iso(row.created_at) ?? new Date(0).toISOString();
    const startedAt = iso(row.started_at);
    const completedAt = iso(row.completed_at);
    const durationMs = completedAt ? new Date(completedAt).getTime() - new Date(startedAt ?? createdAt).getTime() : null;
    const allowed = canControlAnalyses(caller.role, caller.systemRole);
    const cancelled = orchestration.cancelled && typeof orchestration.cancelled === 'object' ? orchestration.cancelled : null;

    return {
      analysis: {
        id: row.id,
        projectId: row.project_id,
        projectName: row.project_name ?? null,
        status: row.status,
        kind: kind as AnalysisDetail['analysis']['kind'],
        engineTypes: json<string[]>(row.engine_types, []),
        targetRelease: row.target_release ?? null,
        findingsCount: Number(row.findings_count ?? 0),
        isBaseline: Boolean(row.is_baseline),
        problemStatement: row.problem_statement ?? null,
        routingId: row.routing_id ?? null,
        triggeredBy: row.triggered_by ? users.get(row.triggered_by) ?? { id: row.triggered_by, name: null, email: null } : null,
        createdAt,
        startedAt,
        completedAt,
        durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null,
        currentStage: progress.currentStage ?? row.current_stage ?? null,
        progressPercent: terminal && row.status !== 'CANCELLED' ? 100 : progress.percent,
        errorMessage: row.error_message ?? null,
      },
      cancellation:
        row.cancel_requested_at || row.status === 'CANCELLED'
          ? {
              requestedAt: iso(row.cancel_requested_at),
              requestedBy: row.cancel_requested_by
                ? users.get(row.cancel_requested_by) ?? { id: row.cancel_requested_by, name: null, email: null }
                : null,
              reason: row.cancel_reason ?? null,
              cancelledAt: iso(row.cancelled_at),
              discardedFindings: cancelled && Number.isFinite(Number(cancelled.discardedFindings)) ? Number(cancelled.discardedFindings) : null,
            }
          : null,
      lineage: {
        rerunOf: parent ? { id: parent.id, status: parent.status, createdAt: iso(parent.created_at) ?? createdAt } : null,
        reruns: lineageRows
          .filter((r) => r.rel === 'child')
          .map((r) => ({ id: r.id, status: r.status, createdAt: iso(r.created_at) ?? createdAt })),
      },
      knowledgeSnapshot,
      inputs: {
        recorded: Boolean(inputs),
        assignmentMode: inputs?.assignmentMode ?? 'CROSS',
        files: recordedFiles.map((f) => {
          const now = fileState.get(f.fileId);
          return {
            fileId: f.fileId,
            fileName: f.fileName || now?.name || '',
            artifactType: f.artifactType,
            sha256: f.sha256 ?? null,
            sizeBytes: f.sizeBytes ?? null,
            currentStatus: now?.status ?? null,
            changed: Boolean(f.sha256 && now?.sha256 && f.sha256 !== now.sha256),
          };
        }),
        requestedConfiguration: inputs?.requestedConfiguration ?? {},
        effectiveConfiguration: inputs?.effectiveConfiguration ?? {},
        assignments: (inputs?.assignments ?? []).map((a) => ({ engine: a.engine, fileId: a.fileId, companions: a.companions ?? [] })),
        stages: inputs?.stages ?? [],
        testCaseIds: inputs?.testCaseIds ?? [],
      },
      telemetry: {
        engineCalls: calls.length,
        completedCalls: calls.filter((c) => c?.outcome === 'COMPLETED').length,
        partialCalls: calls.filter((c) => c?.outcome === 'PARTIAL').length,
        failedCalls: calls.filter((c) => c?.outcome === 'FAILED').length,
        rulesEvaluated: calls.reduce((n, c) => n + (Number(c?.rulesEvaluated) || 0), 0),
        totalEngineMs: calls.reduce((n, c) => n + (Number(c?.durationMs) || 0), 0),
        queueWaitMs: startedAt ? Math.max(0, new Date(startedAt).getTime() - new Date(createdAt).getTime()) : null,
      },
      calls: calls.slice(0, 500).map((c) => ({
        engine: String(c?.engine ?? ''),
        fileId: c?.fileId ?? null,
        fileName: c?.fileName ?? null,
        outcome: String(c?.outcome ?? 'FAILED'),
        findings: Number(c?.findings ?? 0),
        rulesEvaluated: Number(c?.rulesEvaluated ?? 0),
        durationMs: Number(c?.durationMs ?? 0),
        engineVersion: c?.engineVersion ?? null,
        error: c?.error ?? null,
      })),
      summary: orchestration.summary && typeof orchestration.summary === 'object' ? orchestration.summary : null,
      plan: orchestration.plan && typeof orchestration.plan === 'object' ? orchestration.plan : null,
      lab: orchestration.lab && typeof orchestration.lab === 'object' ? orchestration.lab : null,
      labResults,
      generatedTests: generated,
      permissions: {
        canCancel: allowed && ACTIVE.has(row.status) && !row.published_at,
        canRerun: allowed && terminal,
        canExport: !kind.startsWith('LAB_') && (row.status === 'COMPLETED' || row.status === 'PARTIAL'),
      },
    };
  }

  /** Statuses a finished run can have (exported for the controller's audit payloads). */
  static isFinished(status: string): boolean {
    return FINISHED.has(status) || status === 'CANCELLED';
  }
}
