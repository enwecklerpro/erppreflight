import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ReleaseWatchEvaluator } from '../release-intelligence/release-watch.evaluator';
import { CloudificationRepositorySource } from './sources/cloudification-repository.source';
import { RosaFileImportSource } from './sources/rosa-file-import.source';
import { KnowledgeSyncPipeline, SyncResult, SyncTrigger } from './sync/knowledge-sync.pipeline';
import type { ReleasedObjectSource } from './knowledge-graph.types';

export const KNOWLEDGE_SYNC_QUEUE = 'knowledge-sync';
export const KNOWLEDGE_SYNC_SCHEDULER_ID = 'knowledge-sync-weekly';
/** Mondays 03:17 UTC — off the hour to avoid the top-of-hour thundering herd. */
export const DEFAULT_KNOWLEDGE_SYNC_CRON = '17 3 * * 1';

export interface KnowledgeSyncJobData {
  trigger: SyncTrigger;
  triggeredBy?: string | null;
}

/**
 * Orchestrates knowledge syncs: owns a schema-owner pg pool (global knowledge is
 * not writable through the RLS runtime role), runs the pipeline, then
 * re-evaluates release watches. Admin triggers and the weekly schedule go
 * through the BullMQ `knowledge-sync` queue; the CLI calls the same pipeline.
 */
@Injectable()
export class KnowledgeSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeSyncService.name);
  private ownerPool: Pool | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    @InjectQueue(KNOWLEDGE_SYNC_QUEUE) private readonly queue: Queue
  ) {}

  async onModuleInit(): Promise<void> {
    const cron = (this.config.get<string>('KNOWLEDGE_SYNC_CRON') ?? DEFAULT_KNOWLEDGE_SYNC_CRON).trim();
    if (['', 'off', 'false', 'disabled'].includes(cron.toLowerCase())) {
      this.logger.log('Scheduled knowledge sync disabled (KNOWLEDGE_SYNC_CRON=off)');
      await this.queue.removeJobScheduler(KNOWLEDGE_SYNC_SCHEDULER_ID).catch(() => undefined);
      return;
    }
    try {
      await this.queue.upsertJobScheduler(
        KNOWLEDGE_SYNC_SCHEDULER_ID,
        { pattern: cron, tz: 'UTC' },
        { name: 'scheduled-sync', data: { trigger: 'SCHEDULED', triggeredBy: 'scheduler' } }
      );
      this.logger.log(`Knowledge sync scheduled with cron '${cron}' (UTC)`);
    } catch (err: any) {
      // Redis unavailable at boot: the admin trigger/CLI still work once it is back.
      this.logger.warn(`Could not register the weekly knowledge sync: ${err?.message ?? err}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.ownerPool) await this.ownerPool.end().catch(() => undefined);
  }

  private getOwnerPool(): Pool {
    if (!this.ownerPool) {
      const url = this.config.get<string>('DATABASE_URL');
      if (!url) throw new ServiceUnavailableException('DATABASE_URL is not configured');
      this.ownerPool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000 });
    }
    return this.ownerPool;
  }

  cloudificationSource(): CloudificationRepositorySource {
    const files = (this.config.get<string>('KNOWLEDGE_CR_FILES') ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    return new CloudificationRepositorySource({
      files,
      baseUrl: this.config.get<string>('KNOWLEDGE_CR_BASE_URL') || undefined,
    });
  }

  async enqueueSync(triggeredBy: string): Promise<{ jobId: string | undefined; queued: true }> {
    const job = await this.queue.add(
      'admin-sync',
      { trigger: 'ADMIN', triggeredBy } satisfies KnowledgeSyncJobData,
      { removeOnComplete: 50, removeOnFail: 50, attempts: 1 }
    );
    return { jobId: job.id, queued: true };
  }

  async runSource(source: ReleasedObjectSource, trigger: SyncTrigger, triggeredBy?: string | null) {
    const pool = this.getOwnerPool();
    const result: SyncResult = await new KnowledgeSyncPipeline(pool, this.logger).run(source, { trigger, triggeredBy });
    let watches = null;
    if (result.status === 'PUBLISHED' && result.snapshotId && result.snapshotSeq) {
      watches = await new ReleaseWatchEvaluator(pool, this.logger, this.db.getRuntimeRole()).evaluateAfterSnapshot({
        id: result.snapshotId,
        seq: result.snapshotSeq,
      });
    }
    return { ...result, watches };
  }

  async importRosaExport(content: Buffer, label: string, triggeredBy: string) {
    return this.runSource(new RosaFileImportSource([{ label, content }]), 'FILE_IMPORT', triggeredBy);
  }
}

@Processor(KNOWLEDGE_SYNC_QUEUE, { concurrency: 1 })
@Injectable()
export class KnowledgeSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(KnowledgeSyncProcessor.name);

  constructor(private readonly sync: KnowledgeSyncService) {
    super();
  }

  async process(job: Job<KnowledgeSyncJobData>) {
    this.logger.log(`Knowledge sync job ${job.id} (${job.data.trigger}) started`);
    const result = await this.sync.runSource(this.sync.cloudificationSource(), job.data.trigger, job.data.triggeredBy);
    if (result.status === 'FAILED') {
      throw new Error(result.error ?? 'Knowledge sync failed');
    }
    return {
      status: result.status,
      snapshotId: result.snapshotId,
      snapshotSeq: result.snapshotSeq,
      diff: result.diff,
      watches: result.watches,
    };
  }
}
