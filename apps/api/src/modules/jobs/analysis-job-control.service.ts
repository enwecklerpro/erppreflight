import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * What happened to the BullMQ job of an analysis when a cancellation tried to remove it.
 *  - REMOVED: the job was still waiting/delayed (incl. a pending retry) and is gone now.
 *  - ACTIVE: a worker holds the job lock; cancellation must be cooperative.
 *  - FINISHED: BullMQ already completed/failed the job (no worker will touch it again).
 *  - NOT_FOUND: no job with this id (legacy numeric job id, scheduled run executed inside a
 *    repeatable job, or removed by retention of finished jobs).
 *  - NO_QUEUE: no queue configured (in-process fallback execution).
 */
export type JobRemovalOutcome = 'REMOVED' | 'ACTIVE' | 'FINISHED' | 'NOT_FOUND' | 'NO_QUEUE';

/** BullMQ control for analysis jobs (job id = analysis id, see JobsService.enqueueAnalysis). */
@Injectable()
export class AnalysisJobControlService {
  private readonly logger = new Logger(AnalysisJobControlService.name);

  constructor(
    @Optional()
    @InjectQueue('analysis-queue')
    private readonly queue?: Queue
  ) {}

  async removeQueuedJob(analysisId: string): Promise<JobRemovalOutcome> {
    if (!this.queue) return 'NO_QUEUE';
    try {
      const job = await this.queue.getJob(analysisId);
      if (!job) return 'NOT_FOUND';
      const state = await job.getState();
      if (state === 'active') return 'ACTIVE';
      if (state === 'completed' || state === 'failed') return 'FINISHED';
      try {
        await job.remove();
        this.logger.log(`Removed queued analysis job ${analysisId} (state ${state})`);
        return 'REMOVED';
      } catch (err: any) {
        // A worker picked the job up between getState() and remove(): the lock prevents removal.
        const now = await job.getState().catch(() => 'unknown');
        this.logger.warn(`Could not remove analysis job ${analysisId} (${err?.message ?? err}); state now ${now}`);
        if (now === 'completed' || now === 'failed') return 'FINISHED';
        return 'ACTIVE';
      }
    } catch (err: any) {
      // Redis unavailable: fall back to cooperative cancellation (the worker checks the DB flag).
      this.logger.warn(`BullMQ lookup for analysis ${analysisId} failed: ${err?.message ?? err}`);
      return 'ACTIVE';
    }
  }
}
