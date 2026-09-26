import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { AnalysisInputs, LabRunSummary } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { AnalysisProgressTracker } from '../jobs/analysis-progress';
import { RunCancellation } from '../jobs/run-cancellation';
import { buildAnalysisInputs, currentKnowledgeSnapshotId, type RecordedInputFile } from '../jobs/analysis-inputs';
import type { EngineCallRecord } from '../jobs/orchestration/correlation';

export type LabAnalysisKind = 'LAB_REGRESSION' | 'LAB_SCENARIO';

export interface LabAnalysisHandle {
  analysisId: string;
  organizationId: string;
  projectId: string;
  total: number;
  done: number;
  calls: EngineCallRecord[];
  progress: AnalysisProgressTracker;
  cancellation: RunCancellation;
}

export interface BeginLabAnalysisArgs {
  organizationId: string;
  projectId: string;
  userId: string | null;
  kind: LabAnalysisKind;
  engineTypes: string[];
  targetRelease: string;
  files: RecordedInputFile[];
  total: number;
  trigger: NonNullable<AnalysisInputs['trigger']>;
  testCaseIds?: string[];
  scenarioId?: string | null;
  rerunOfAnalysisId?: string | null;
}

/** Final status of a lab execution: executed tests (PASSED or FAILED verdict) are a completed run. */
export function labRunStatus(summary: Pick<LabRunSummary, 'total' | 'errored'>): 'COMPLETED' | 'PARTIAL' | 'FAILED' {
  if (summary.total === 0 || summary.errored === 0) return 'COMPLETED';
  return summary.errored >= summary.total ? 'FAILED' : 'PARTIAL';
}

/**
 * Records Test Lab executions (regression cases, synthetic scenarios) as analysis runs
 * (section C §18, KNOWN_LIMITATIONS P6): one analyses row per lab execution with
 * kind LAB_REGRESSION / LAB_SCENARIO, the exact inputs (test cases, fixture artifacts with
 * SHA-256), the knowledge snapshot in force, stage progress for the stepper, per-test engine
 * calls and the lab verdict summary. Lab runs never write findings rows, so they never become
 * "the latest analysis" of a project (dashboard, drift, work items and traceability only read
 * STANDARD / FULL_PREFLIGHT runs). They support the same cancel (between tests, in-flight
 * engine call aborted) and rerun endpoints as regular runs.
 */
export class LabAnalysisRecorder {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: Logger
  ) {}

  async begin(args: BeginLabAnalysisArgs): Promise<LabAnalysisHandle> {
    const analysisId = uuidv4();
    const deterministic = { deterministicOnly: true, allowAiAssistance: false };
    const inputs = await buildAnalysisInputs(this.db, args.organizationId, {
      files: args.files,
      requestedConfiguration: deterministic,
      effectiveConfiguration: deterministic,
      assignmentMode: 'PLANNED',
      testCaseIds: args.testCaseIds,
      scenarioId: args.scenarioId,
      trigger: args.trigger,
    });
    const snapshotId = await currentKnowledgeSnapshotId(this.db, args.organizationId);
    await this.db.query(
      `INSERT INTO analyses (id, organization_id, project_id, status, engine_types, target_release, triggered_by, kind,
                             inputs, knowledge_snapshot_id, rerun_of_analysis_id, started_at)
       VALUES ($1, $2, $3, 'RUNNING', $4, $5, $6, $7, $8::jsonb, $9, $10, NOW())`,
      [
        analysisId,
        args.organizationId,
        args.projectId,
        JSON.stringify([...new Set(args.engineTypes)].sort()),
        args.targetRelease,
        args.userId,
        args.kind,
        JSON.stringify(inputs),
        snapshotId,
        args.rerunOfAnalysisId ?? null,
      ],
      { tenantId: args.organizationId }
    );
    const progress = new AnalysisProgressTracker(this.db, args.organizationId, analysisId, this.logger);
    await progress.complete('UPLOAD_VALIDATED', { files: args.files.length, tests: args.total, kind: args.kind });
    await progress.skip('PARSING', 'Fixture artifacts are fetched and hashed per test.');
    await progress.start('RUNNING_RULES', { done: 0, total: args.total });
    const cancellation = new RunCancellation(this.db, args.organizationId, analysisId, this.logger).start();
    return {
      analysisId,
      organizationId: args.organizationId,
      projectId: args.projectId,
      total: args.total,
      done: 0,
      calls: [],
      progress,
      cancellation,
    };
  }

  async step(handle: LabAnalysisHandle, call: EngineCallRecord): Promise<void> {
    handle.done++;
    handle.calls.push(call);
    await handle.progress.progress('RUNNING_RULES', { done: handle.done, total: handle.total, lastEngine: call.engine }, true);
  }

  /**
   * Writes the terminal state. Returns the status actually stored: a cancellation requested
   * while the last test executed wins (CANCELLED), mirroring the analysis publish gate.
   */
  async finish(handle: LabAnalysisHandle, lab: LabRunSummary, errorMessage?: string | null): Promise<string> {
    handle.cancellation.stop();
    const status = labRunStatus(lab);
    await handle.progress.complete('RUNNING_RULES', {
      done: handle.done,
      total: handle.total,
      passed: lab.passed,
      failed: lab.failed,
      errored: lab.errored,
    });
    await handle.progress.skip('MATCHING_EVIDENCE', 'Test Lab runs compare engine results with expected outcomes; no findings are persisted.');
    await handle.progress.skip('GENERATING_TESTS', 'Not applicable to Test Lab runs.');
    await handle.progress.start('FINALIZING');
    const res = await this.db.query(
      `UPDATE analyses
          SET status = $3, completed_at = NOW(), published_at = NOW(), error_message = $4,
              orchestration = COALESCE(orchestration, '{}'::jsonb) || $5::jsonb
        WHERE id = $1 AND organization_id = $2 AND status = 'RUNNING' AND cancel_requested_at IS NULL
        RETURNING status`,
      [
        handle.analysisId,
        handle.organizationId,
        status,
        errorMessage ? errorMessage.slice(0, 2000) : null,
        JSON.stringify({ lab, calls: handle.calls.slice(0, 500) }),
      ],
      { tenantId: handle.organizationId }
    );
    if (!res?.rows?.length) {
      const cancelled = await this.cancelled(handle, lab);
      if (cancelled) return 'CANCELLED';
    }
    await handle.progress.complete('FINALIZING', { status, tests: handle.total });
    return status;
  }

  /** Finalises CANCELLED (tests already executed keep their regression_test_runs rows). */
  async cancelled(handle: LabAnalysisHandle, lab: LabRunSummary): Promise<boolean> {
    handle.cancellation.stop();
    const res = await this.db.query(
      `UPDATE analyses
          SET status = 'CANCELLED', cancelled_at = COALESCE(cancelled_at, NOW()), completed_at = COALESCE(completed_at, NOW()),
              orchestration = COALESCE(orchestration, '{}'::jsonb) || $3::jsonb
        WHERE id = $1 AND organization_id = $2 AND status IN ('QUEUED', 'RUNNING')
        RETURNING id`,
      [handle.analysisId, handle.organizationId, JSON.stringify({ lab, calls: handle.calls.slice(0, 500), cancelled: { discardedFindings: 0 } })],
      { tenantId: handle.organizationId }
    );
    const status = await this.db.query(`SELECT status FROM analyses WHERE id = $1 AND organization_id = $2`, [handle.analysisId, handle.organizationId], {
      tenantId: handle.organizationId,
    });
    if (res?.rows?.length) {
      await handle.progress.cancel(`Cancelled on request after ${handle.done} of ${handle.total} test(s).`);
      return true;
    }
    return status?.rows?.[0]?.status === 'CANCELLED';
  }

  /** The lab execution itself failed (e.g. nothing could be run). */
  async fail(handle: LabAnalysisHandle, message: string): Promise<void> {
    handle.cancellation.stop();
    await handle.progress.fail(message, 'RUNNING_RULES');
    await this.db
      .query(
        `UPDATE analyses SET status = 'FAILED', completed_at = NOW(), error_message = $3,
                orchestration = COALESCE(orchestration, '{}'::jsonb) || $4::jsonb
          WHERE id = $1 AND organization_id = $2 AND status = 'RUNNING'`,
        [handle.analysisId, handle.organizationId, message.slice(0, 2000), JSON.stringify({ calls: handle.calls.slice(0, 500) })],
        { tenantId: handle.organizationId }
      )
      .catch((err: any) => this.logger.warn(`Could not mark lab analysis ${handle.analysisId} FAILED: ${err?.message ?? err}`));
  }
}
