import { DelayedError, Job } from 'bullmq';

/** How often a deferred job of a suspended tenant re-checks the tenant status. */
export const SUSPENDED_JOB_RECHECK_MS = 5 * 60 * 1000;

export interface TenantSuspensionLookup {
  isSuspended(organizationId: string): Promise<boolean>;
}

export interface JobLogger {
  warn(message: string): void;
}

/**
 * Queue rule for suspended tenants (spec 10.7): their queued work is NOT processed.
 *  - one-off jobs (analyses, artifact ingestion) are parked: moved back to the delayed
 *    set and re-checked every SUSPENDED_JOB_RECHECK_MS, so they run automatically once
 *    the tenant is reactivated (no attempt is consumed);
 *  - repeatable schedule firings are skipped (the next firing re-evaluates).
 * Returns 'run' when the job may proceed, 'skip' for a skipped schedule firing; for a
 * parked job it throws BullMQ's DelayedError (the worker must rethrow it).
 */
export async function gateJobForSuspendedTenant(
  job: Pick<Job, 'id' | 'name' | 'moveToDelayed'>,
  token: string | undefined,
  organizationId: string | null | undefined,
  tenants: TenantSuspensionLookup | undefined,
  logger: JobLogger,
  options: { repeatable?: boolean } = {}
): Promise<'run' | 'skip'> {
  if (!tenants || typeof organizationId !== 'string' || !organizationId) return 'run';
  if (!(await tenants.isSuspended(organizationId))) return 'run';
  if (options.repeatable) {
    logger.warn(`Skipping ${job.name} (${job.id}): organization ${organizationId} is suspended`);
    return 'skip';
  }
  if (!token) {
    // Without the worker lock token the job cannot be parked; fail it so it is retried later.
    throw new Error(`TENANT_SUSPENDED: organization ${organizationId} is suspended; job ${job.id} not processed`);
  }
  logger.warn(`Deferring ${job.name} (${job.id}) by ${SUSPENDED_JOB_RECHECK_MS / 1000}s: organization ${organizationId} is suspended`);
  await job.moveToDelayed(Date.now() + SUSPENDED_JOB_RECHECK_MS, token);
  throw new DelayedError();
}
