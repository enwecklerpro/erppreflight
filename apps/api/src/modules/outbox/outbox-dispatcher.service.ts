import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private pollIntervalMs = 5000;

  constructor(private readonly outboxService: OutboxService) {}

  onModuleInit() {
    this.startWorker();
    this.logger.log('Transactional Outbox background dispatcher initialized');
  }

  onModuleDestroy() {
    this.stopWorker();
    this.logger.log('Transactional Outbox background dispatcher stopped');
  }

  startWorker(intervalMs = 5000) {
    this.pollIntervalMs = intervalMs;
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(async () => {
      await this.drainQueueSafe();
    }, this.pollIntervalMs);
  }

  stopWorker() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Triggers an immediate dispatch pass outside the regular polling interval.
   * Useful for unit/integration tests and high-priority event triggers.
   */
  async triggerDispatch(limit = 50): Promise<{ dispatched: number; failed: number }> {
    return await this.drainQueue(limit);
  }

  private async drainQueueSafe() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      const result = await this.outboxService.dispatchPendingEvents(50);
      if (result.dispatched > 0 || result.failed > 0) {
        this.logger.debug(
          `Outbox dispatch pass: ${result.dispatched} dispatched, ${result.failed} failed`
        );
      }
    } catch (err: any) {
      this.logger.error(`Error in outbox background dispatcher: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async drainQueue(limit: number): Promise<{ dispatched: number; failed: number }> {
    try {
      return await this.outboxService.dispatchPendingEvents(limit);
    } catch (err: any) {
      this.logger.error(`Error in outbox dispatch: ${err.message}`);
      return { dispatched: 0, failed: 0 };
    }
  }
}
