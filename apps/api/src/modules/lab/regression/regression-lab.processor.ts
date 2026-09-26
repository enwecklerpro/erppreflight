import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { REGRESSION_LAB_QUEUE, RegressionLabService, ScheduledRegressionJobData } from './regression-lab.service';

/** Executes repeatable regression-suite schedules (Part 05 §5.5 "scheduled re-run"). */
@Processor(REGRESSION_LAB_QUEUE)
@Injectable()
export class RegressionLabProcessor extends WorkerHost {
  private readonly logger = new Logger(RegressionLabProcessor.name);

  constructor(private readonly lab: RegressionLabService) {
    super();
  }

  async process(job: Job<ScheduledRegressionJobData>): Promise<void> {
    if (job.name !== 'scheduled-regression-run') return;
    const result = await this.lab.runScheduled(job.data);
    if (result) {
      this.logger.log(
        `Regression schedule ${job.data.scheduleId}: ${result.total} tests, ${result.passed} passed, ${result.failed} failed, ${result.errored} errored`
      );
    }
  }
}
