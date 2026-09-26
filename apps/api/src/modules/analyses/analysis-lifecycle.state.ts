import type { JobRemovalOutcome } from '../jobs/analysis-job-control.service';

/**
 * Pure state machine of the analysis run lifecycle (section C §15/§16). Kept free of I/O so
 * every transition is unit tested; AnalysisLifecycleService applies the decisions inside
 * tenant transactions.
 *
 *   QUEUED ──cancel──▶ CANCELLED                    (job removed from BullMQ, final at once)
 *   RUNNING ─cancel──▶ RUNNING + cancel_requested   (worker stops at the next engine step,
 *                        └──worker──▶ CANCELLED       aborts the in-flight engine call)
 *   RUNNING ─publish gate─▶ COMPLETED | PARTIAL | FAILED (cancel rejected from here on)
 *   COMPLETED | PARTIAL | FAILED | CANCELLED ──rerun──▶ new QUEUED run (rerun_of = source)
 */

export const ACTIVE = new Set(['QUEUED', 'RUNNING']);
export const FINISHED = new Set(['COMPLETED', 'PARTIAL', 'FAILED']);
export const LAB_KIND_PREFIX = 'LAB_';

/** Lab runs execute inside the HTTP request that started them; silence this long means the executing request is gone. */
export const LAB_RUN_STALE_MS = 5 * 60 * 1000;

export interface CancelInputState {
  status: string;
  cancelRequestedAt: string | Date | null;
  publishedAt: string | Date | null;
}

export type CancelDecision =
  | { kind: 'ALREADY_CANCELLED' }
  | { kind: 'ALREADY_REQUESTED' }
  | { kind: 'REJECT_FINISHED'; status: string }
  | { kind: 'REJECT_PUBLISHING' }
  | { kind: 'REQUEST' };

/** First step of POST /analyses/:id/cancel, evaluated on the row locked FOR UPDATE. */
export function decideCancel(state: CancelInputState): CancelDecision {
  if (state.status === 'CANCELLED') return { kind: 'ALREADY_CANCELLED' };
  if (FINISHED.has(state.status)) return { kind: 'REJECT_FINISHED', status: state.status };
  if (!ACTIVE.has(state.status)) return { kind: 'REJECT_FINISHED', status: state.status };
  // Results are being published (findings written): the run completes; a cancel cannot undo that.
  if (state.publishedAt) return { kind: 'REJECT_PUBLISHING' };
  if (state.cancelRequestedAt) return { kind: 'ALREADY_REQUESTED' };
  return { kind: 'REQUEST' };
}

export interface FinalizationInput {
  status: string;
  kind: string;
  /** Result of trying to remove the BullMQ job (ignored for Test Lab runs, which have no job). */
  job: JobRemovalOutcome | null;
  /** Last progress / start timestamp of the run (Test Lab staleness). */
  lastActivityAt: string | Date | null;
  now: Date;
}

/**
 * Second step, after the cancellation request is recorded: finalise CANCELLED right away
 * (nobody is executing the run) or leave it to the executing worker (cooperative).
 * Finalising while a worker still runs is safe: the worker observes the persisted
 * request, the publish gate rejects it, and the terminal write is guarded.
 */
export function decideFinalization(input: FinalizationInput): 'FINALIZE_NOW' | 'COOPERATIVE' {
  if (input.status === 'QUEUED') {
    // A queued run whose job a worker just locked is finalised by that worker's start check.
    return input.job === 'ACTIVE' ? 'COOPERATIVE' : 'FINALIZE_NOW';
  }
  if (input.kind.startsWith(LAB_KIND_PREFIX)) {
    const last = input.lastActivityAt ? new Date(input.lastActivityAt).getTime() : NaN;
    if (!Number.isFinite(last)) return 'FINALIZE_NOW';
    return input.now.getTime() - last > LAB_RUN_STALE_MS ? 'FINALIZE_NOW' : 'COOPERATIVE';
  }
  switch (input.job) {
    case 'ACTIVE':
    case 'NO_QUEUE': // in-process fallback: the executor polls the flag
      return 'COOPERATIVE';
    case 'REMOVED':
    case 'FINISHED':
    case 'NOT_FOUND':
    default:
      return 'FINALIZE_NOW';
  }
}

export type RerunDecision =
  | { kind: 'ALLOWED' }
  | { kind: 'REJECT_ACTIVE'; status: string };

/** A run can be re-run once it is terminal (including CANCELLED and FAILED). */
export function decideRerun(status: string): RerunDecision {
  if (ACTIVE.has(status)) return { kind: 'REJECT_ACTIVE', status };
  return { kind: 'ALLOWED' };
}

/** Whether the caller's organisation role may cancel / re-run analyses. */
export function canControlAnalyses(role: string | null | undefined, systemRole?: string | null): boolean {
  if (systemRole === 'SUPER_ADMIN') return true;
  return (
    role === 'ORGANIZATION_OWNER' ||
    role === 'SECURITY_ADMIN' ||
    role === 'LEAD_ARCHITECT' ||
    role === 'MIGRATION_CONSULTANT' ||
    role === 'API_CLIENT'
  );
}
