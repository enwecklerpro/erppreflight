import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { SourceSyncAdminService } from './source-sync-admin.service';

export const PLATFORM_GOVERNANCE_QUEUE = 'platform-governance';
export const SOURCE_FRESHNESS_SCHEDULER_ID = 'knowledge-source-freshness';
/** Hourly at minute 41 by default (SOURCE_FRESHNESS_CRON overrides; 'off' disables). */
export const DEFAULT_SOURCE_FRESHNESS_CRON = '41 * * * *';

/**
 * Scheduled stale-source check (spec 10.12 "Alert if a critical knowledge source becomes
 * stale"). A BullMQ job scheduler (upsert) keeps a single schedule across API replicas;
 * the check itself is idempotent (one open alert per source).
 */
@Processor(PLATFORM_GOVERNANCE_QUEUE, { concurrency: 1 })
@Injectable()
export class SourceFreshnessProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SourceFreshnessProcessor.name);

  constructor(
    private readonly sources: SourceSyncAdminService,
    private readonly config: ConfigService,
    @InjectQueue(PLATFORM_GOVERNANCE_QUEUE) private readonly queue: Queue
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    const cron = (this.config.get<string>('SOURCE_FRESHNESS_CRON') || DEFAULT_SOURCE_FRESHNESS_CRON).trim();
    try {
      if (['off', 'false', 'disabled'].includes(cron.toLowerCase())) {
        await this.queue.removeJobScheduler(SOURCE_FRESHNESS_SCHEDULER_ID);
        this.logger.warn('Knowledge source freshness check disabled (SOURCE_FRESHNESS_CRON=off)');
        return;
      }
      await this.queue.upsertJobScheduler(
        SOURCE_FRESHNESS_SCHEDULER_ID,
        { pattern: cron, tz: 'UTC' },
        { name: 'source-freshness', opts: { removeOnComplete: 50, removeOnFail: 100 } }
      );
      this.logger.log(`Knowledge source freshness check scheduled with cron '${cron}' (UTC)`);
    } catch (err: any) {
      this.logger.error(`Could not register the source freshness scheduler: ${err?.message ?? err}`);
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== 'source-freshness') {
      this.logger.warn(`Unknown platform governance job '${job.name}' ignored`);
      return null;
    }
    return this.sources.checkFreshness();
  }
}
