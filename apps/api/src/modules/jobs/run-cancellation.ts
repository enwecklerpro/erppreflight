import { Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const FINISHED_STATUSES = new Set(['COMPLETED', 'PARTIAL', 'FAILED']);

/** Thrown inside a run when a cancellation request was observed. */
export class AnalysisCancelledError extends Error {
  constructor(analysisId: string) {
    super(`Analysis ${analysisId} was cancelled`);
    this.name = 'AnalysisCancelledError';
  }
}

/** Snapshot of the persisted cancellation state of one analysis. */
export interface CancellationState {
  status: string | null;
  cancelRequestedAt: string | null;
}

/**
 * Cooperative cancellation of one analysis run (section C §15 "Support cancel").
 *
 * The source of truth is the database: POST /analyses/:id/cancel stamps
 * analyses.cancel_requested_at inside a tenant transaction. Every worker that executes
 * the run polls that column (cheap primary-key read, default every second) and checks it
 * between engine steps; when it is set, `signal` aborts so the in-flight HTTP call to the
 * analysis service is cancelled immediately. Works across API replicas and after a worker
 * restart. A process-local registry additionally aborts runs of the same process right
 * away (no poll delay) when the cancel request is handled by the replica running them.
 */
export class RunCancellation {
  private static readonly local = new Map<string, Set<RunCancellation>>();

  /** Aborts every run of `analysisId` executing in this process (best effort, no DB access). */
  static signalLocal(analysisId: string): number {
    const runs = RunCancellation.local.get(analysisId);
    if (!runs) return 0;
    for (const run of runs) run.abort('local-signal');
    return runs.size;
  }

  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | null = null;
  private registered = false;
  private polling = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly organizationId: string,
    private readonly analysisId: string,
    private readonly logger?: Logger,
    private readonly pollMs = 1000
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  /** Reads the persisted state once; aborts when a cancellation was requested. Never throws. */
  async check(): Promise<boolean> {
    if (this.cancelled) return true;
    const state = await this.readState();
    if (state && (state.cancelRequestedAt || state.status === 'CANCELLED')) {
      this.abort('db');
    } else if (state && FINISHED_STATUSES.has(state.status ?? '')) {
      // The run finished (possibly through another code path): nothing left to watch.
      this.stop();
    }
    return this.cancelled;
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new AnalysisCancelledError(this.analysisId);
  }

  /** Starts background polling + local registration. Idempotent. */
  start(): this {
    if (!this.registered) {
      const set = RunCancellation.local.get(this.analysisId) ?? new Set<RunCancellation>();
      set.add(this);
      RunCancellation.local.set(this.analysisId, set);
      this.registered = true;
    }
    if (!this.timer && this.pollMs > 0 && !this.cancelled) {
      this.timer = setInterval(() => void this.poll(), this.pollMs);
      this.timer.unref?.();
    }
    return this;
  }

  /** Stops polling and unregisters (the run passed its point of no return or finished). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.registered) {
      const set = RunCancellation.local.get(this.analysisId);
      set?.delete(this);
      if (set && set.size === 0) RunCancellation.local.delete(this.analysisId);
      this.registered = false;
    }
  }

  private abort(source: string): void {
    if (this.cancelled) return;
    this.logger?.log(`Analysis ${this.analysisId}: cancellation observed (${source}); stopping at the next engine step`);
    this.controller.abort(new AnalysisCancelledError(this.analysisId));
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.polling || this.cancelled) return;
    this.polling = true;
    try {
      await this.check();
    } finally {
      this.polling = false;
    }
  }

  private async readState(): Promise<CancellationState | null> {
    try {
      const res = await this.db.query(
        `SELECT status, cancel_requested_at FROM analyses WHERE id = $1 AND organization_id = $2`,
        [this.analysisId, this.organizationId],
        { tenantId: this.organizationId }
      );
      const row = res?.rows?.[0];
      if (!row) return null;
      return {
        status: row.status ?? null,
        cancelRequestedAt: row.cancel_requested_at ? String(row.cancel_requested_at) : null,
      };
    } catch (err: any) {
      this.logger?.warn(`Cancellation check for analysis ${this.analysisId} failed: ${err?.message ?? err}`);
      return null;
    }
  }
}

/** True when `err` is (or wraps) a cancellation abort. */
export function isCancellationError(err: unknown, cancellation?: RunCancellation): boolean {
  if (cancellation?.cancelled) return true;
  const e = err as { name?: string; cause?: { name?: string } } | null;
  return e?.name === 'AnalysisCancelledError' || e?.cause?.name === 'AnalysisCancelledError';
}
