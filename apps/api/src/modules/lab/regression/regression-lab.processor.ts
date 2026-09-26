import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { REGRESSION_LAB_QUEUE, RegressionLabService, ScheduledRegressionJobData } from './regression-lab.service';
import { TenantAccessService } from '../../tenant-access/tenant-access.service';
import { gateJobForSuspendedTenant } from '../../tenant-access/suspended-jobs';

/** Executes repeatable regression-suite schedules (Part 05 §5.5 "scheduled re-run"). */
@Processor(REGRESSION_LAB_QUEUE)
@Injectable()
export class RegressionLabProcessor extends WorkerHost {
  private readonly logger = new Logger(RegressionLabProcessor.name);

  constructor(
    private readonly lab: RegressionLabService,
    @Optional() private readonly tenantAccess?: TenantAccessService
  ) {
    super();
  }

  async process(job: Job<ScheduledRegressionJobData>, token?: string): Promise<void> {
    if (job.name !== 'scheduled-regression-run') return;
    // Suspended tenants (spec 10.7): scheduled regression runs are skipped.
    const gate = await gateJobForSuspendedTenant(job, token, job.data?.organizationId, this.tenantAccess, this.logger, {
      repeatable: true,
    });
    if (gate === 'skip') return;
    const result = await this.lab.runScheduled(job.data);
    if (result) {
      this.logger.log(
        `Regression schedule ${job.data.scheduleId}: ${result.total} tests, ${result.passed} passed, ${result.failed} failed, ${result.errored} errored`
      );
    }
  }
}
