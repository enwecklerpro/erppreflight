import { Logger } from '@nestjs/common';
import { ANALYSIS_STAGES, type AnalysisStage, type StageSnapshot } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';

/**
 * Persisted analysis stage progress (Part 03 §3.8, section C §15/§16).
 *
 * Every transition is appended to analysis_progress_events (the SSE stream source)
 * and mirrored into analyses.progress / analyses.current_stage (the poll fallback).
 * Progress bookkeeping is best-effort: a failed write is logged and never fails or
 * alters the analysis itself.
 */
export type ProgressEventStatus = 'STARTED' | 'PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';

export interface ProgressState {
  stages: Record<AnalysisStage, StageSnapshot>;
  currentStage: AnalysisStage | null;
  percent: number;
  updatedAt: string | null;
}

/** Relative weight of each stage in the overall percentage. */
const STAGE_WEIGHTS: Record<AnalysisStage, number> = {
  UPLOAD_VALIDATED: 5,
  PARSING: 10,
  RUNNING_RULES: 55,
  MATCHING_EVIDENCE: 12,
  GENERATING_TESTS: 10,
  FINALIZING: 8,
};

export function initialProgressState(): ProgressState {
  const stages = {} as Record<AnalysisStage, StageSnapshot>;
  for (const s of ANALYSIS_STAGES) stages[s] = { state: 'PENDING' };
  return { stages, currentStage: null, percent: 0, updatedAt: null };
}

/** Overall percentage: finished stages count fully, the running stage by its own fraction. */
export function computePercent(state: ProgressState): number {
  let total = 0;
  for (const s of ANALYSIS_STAGES) {
    const snap = state.stages[s];
    if (!snap) continue;
    if (snap.state === 'COMPLETED' || snap.state === 'SKIPPED' || snap.state === 'FAILED') {
      total += STAGE_WEIGHTS[s];
    } else if (snap.state === 'RUNNING' || snap.state === 'CANCELLED') {
      const done = Number((snap.detail as any)?.done);
      const of = Number((snap.detail as any)?.total);
      if (Number.isFinite(done) && Number.isFinite(of) && of > 0) {
        total += (STAGE_WEIGHTS[s] * Math.min(done, of)) / of;
      }
    }
  }
  return Math.max(0, Math.min(100, Math.round(total)));
}

/** Normalises a stored analyses.progress JSON value into a full ProgressState. */
export function parseProgressState(raw: unknown): ProgressState {
  const base = initialProgressState();
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!value || typeof value !== 'object') return base;
  const stored = (value as any).stages ?? {};
  for (const s of ANALYSIS_STAGES) {
    const snap = stored[s];
    if (snap && typeof snap === 'object' && typeof snap.state === 'string') {
      base.stages[s] = {
        state: snap.state,
        startedAt: snap.startedAt ?? null,
        finishedAt: snap.finishedAt ?? null,
        ...(snap.detail && typeof snap.detail === 'object' ? { detail: snap.detail } : {}),
      };
    }
  }
  const cur = (value as any).currentStage;
  base.currentStage = ANALYSIS_STAGES.includes(cur) ? cur : null;
  base.updatedAt = typeof (value as any).updatedAt === 'string' ? (value as any).updatedAt : null;
  base.percent = computePercent(base);
  return base;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Applies one transition to a state (pure; used by the tracker and its tests). */
export function applyTransition(
  state: ProgressState,
  stage: AnalysisStage,
  status: ProgressEventStatus,
  detail: Record<string, unknown> | undefined,
  at: string
): ProgressState {
  const next: ProgressState = {
    ...state,
    stages: { ...state.stages },
  };
  const prev = next.stages[stage] ?? { state: 'PENDING' };
  const mergedDetail = detail ? { ...(prev.detail ?? {}), ...detail } : prev.detail;
  switch (status) {
    case 'STARTED':
      next.stages[stage] = { state: 'RUNNING', startedAt: at, finishedAt: null, ...(mergedDetail ? { detail: mergedDetail } : {}) };
      next.currentStage = stage;
      break;
    case 'PROGRESS':
      next.stages[stage] = { ...prev, state: prev.state === 'PENDING' ? 'RUNNING' : prev.state, startedAt: prev.startedAt ?? at, ...(mergedDetail ? { detail: mergedDetail } : {}) };
      next.currentStage = stage;
      break;
    case 'COMPLETED':
      next.stages[stage] = { ...prev, state: 'COMPLETED', startedAt: prev.startedAt ?? at, finishedAt: at, ...(mergedDetail ? { detail: mergedDetail } : {}) };
      next.currentStage = stage;
      break;
    case 'SKIPPED':
      next.stages[stage] = { ...prev, state: 'SKIPPED', startedAt: prev.startedAt ?? at, finishedAt: at, ...(mergedDetail ? { detail: mergedDetail } : {}) };
      break;
    case 'FAILED':
      next.stages[stage] = { ...prev, state: 'FAILED', startedAt: prev.startedAt ?? at, finishedAt: at, ...(mergedDetail ? { detail: mergedDetail } : {}) };
      next.currentStage = stage;
      break;
    case 'CANCELLED':
      next.stages[stage] = { ...prev, state: 'CANCELLED', startedAt: prev.startedAt ?? at, finishedAt: at, ...(mergedDetail ? { detail: mergedDetail } : {}) };
      next.currentStage = stage;
      break;
  }
  next.updatedAt = at;
  next.percent = computePercent(next);
  return next;
}

export class AnalysisProgressTracker {
  private state: ProgressState;
  private lastProgressWrite = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly organizationId: string,
    private readonly analysisId: string,
    private readonly logger?: Logger,
    initial?: ProgressState,
    private readonly clock: () => Date = () => new Date()
  ) {
    this.state = initial ?? initialProgressState();
  }

  /** Loads the persisted state (e.g. UPLOAD_VALIDATED written at trigger time). */
  static async resume(
    db: DatabaseService,
    organizationId: string,
    analysisId: string,
    logger?: Logger
  ): Promise<AnalysisProgressTracker> {
    let initial = initialProgressState();
    try {
      const res = await db.query(
        `SELECT progress FROM analyses WHERE id = $1 AND organization_id = $2`,
        [analysisId, organizationId],
        { tenantId: organizationId }
      );
      if (res?.rows?.[0]) initial = parseProgressState(res.rows[0].progress);
    } catch (err: any) {
      logger?.warn(`Could not load progress for analysis ${analysisId}: ${err?.message ?? err}`);
    }
    return new AnalysisProgressTracker(db, organizationId, analysisId, logger, initial);
  }

  snapshot(): ProgressState {
    return this.state;
  }

  start(stage: AnalysisStage, detail?: Record<string, unknown>) {
    return this.record(stage, 'STARTED', detail);
  }

  /** Throttled (≥ 750 ms apart) intermediate progress; always kept in memory. */
  async progress(stage: AnalysisStage, detail: Record<string, unknown>, force = false) {
    const now = this.clock().getTime();
    if (!force && now - this.lastProgressWrite < 750) {
      this.state = applyTransition(this.state, stage, 'PROGRESS', detail, this.clock().toISOString());
      return;
    }
    this.lastProgressWrite = now;
    await this.record(stage, 'PROGRESS', detail);
  }

  complete(stage: AnalysisStage, detail?: Record<string, unknown>) {
    return this.record(stage, 'COMPLETED', detail);
  }

  /** `code` lets the web app show a translated reason (progress.reasons.<code>); `reason` stays the English fallback. */
  skip(stage: AnalysisStage, reason: string, code?: string) {
    return this.record(stage, 'SKIPPED', code ? { reason, code } : { reason });
  }

  /** Marks the current (or given) stage FAILED. */
  fail(reason: string, stage?: AnalysisStage) {
    const target =
      stage ??
      ANALYSIS_STAGES.find((s) => this.state.stages[s]?.state === 'RUNNING') ??
      this.state.currentStage ??
      'PARSING';
    return this.record(target, 'FAILED', { reason: reason.slice(0, 300) });
  }

  /**
   * Marks the run as cancelled on the stage that was executing (or, for a run that never
   * started, the first stage still pending). Later stages stay PENDING.
   */
  cancel(reason: string, extra: Record<string, unknown> = {}) {
    const target =
      ANALYSIS_STAGES.find((s) => this.state.stages[s]?.state === 'RUNNING') ??
      ANALYSIS_STAGES.find((s) => this.state.stages[s]?.state === 'PENDING') ??
      'FINALIZING';
    return this.record(target, 'CANCELLED', { reason: reason.slice(0, 300), cancelled: true, code: 'CANCELLED', ...extra });
  }

  private async record(stage: AnalysisStage, status: ProgressEventStatus, detail?: Record<string, unknown>) {
    const at = this.clock().toISOString();
    this.state = applyTransition(this.state, stage, status, detail, at);
    try {
      await this.db.withTenantTransaction(this.organizationId, async (client) => {
        await client.query(
          `INSERT INTO analysis_progress_events (organization_id, analysis_id, stage, status, detail)
           VALUES ($1, $2, $3, $4, $5)`,
          [this.organizationId, this.analysisId, stage, status, JSON.stringify(detail ?? {})]
        );
        await client.query(
          `UPDATE analyses SET progress = $1, current_stage = $2 WHERE id = $3 AND organization_id = $4`,
          [JSON.stringify(this.state), this.state.currentStage, this.analysisId, this.organizationId]
        );
      });
    } catch (err: any) {
      this.logger?.warn(`Progress update ${stage}/${status} for analysis ${this.analysisId} not persisted: ${err?.message ?? err}`);
    }
  }
}
