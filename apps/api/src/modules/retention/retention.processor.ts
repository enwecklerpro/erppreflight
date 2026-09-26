import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { RetentionService } from './retention.service';

export const MAINTENANCE_QUEUE = 'maintenance-queue';
export const GOVERNANCE_SWEEP_SCHEDULER_ID = 'governance-sweep';
/** Hourly at minute 17 by default (RETENTION_SWEEP_CRON overrides; 'off' disables). */
export const DEFAULT_SWEEP_CRON = '17 * * * *';

/**
 * BullMQ repeatable governance sweep: retention purges (10.16) and trial
 * expiry (13.8). A job scheduler (upsert) guarantees a single schedule even
 * with several API replicas.
 */
@Processor(MAINTENANCE_QUEUE)
@Injectable()
export class RetentionProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(
    private readonly retention: RetentionService,
    private readonly config: ConfigService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    const cron = (this.config.get<string>('RETENTION_SWEEP_CRON') || DEFAULT_SWEEP_CRON).trim();
    try {
      if (cron.toLowerCase() === 'off') {
        await this.queue.removeJobScheduler(GOVERNANCE_SWEEP_SCHEDULER_ID);
        this.logger.warn('Governance sweep scheduler disabled (RETENTION_SWEEP_CRON=off)');
        return;
      }
      await this.queue.upsertJobScheduler(
        GOVERNANCE_SWEEP_SCHEDULER_ID,
        { pattern: cron },
        { name: 'governance-sweep', opts: { removeOnComplete: 50, removeOnFail: 100 } }
      );
      this.logger.log(`Governance sweep scheduled with cron '${cron}'`);
    } catch (err: any) {
      // Redis outage at boot must not crash the API; readiness reports Redis separately.
      this.logger.error(`Could not register governance sweep scheduler: ${err?.message ?? err}`);
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== 'governance-sweep') {
      this.logger.warn(`Unknown maintenance job '${job.name}' ignored`);
      return null;
    }
    return this.retention.sweep();
  }
}
