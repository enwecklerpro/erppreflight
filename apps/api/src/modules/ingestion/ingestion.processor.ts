import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { DatabaseService } from '../database/database.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { gateJobForSuspendedTenant } from '../tenant-access/suspended-jobs';

export interface IngestionJobData {
  fileId: string;
  organizationId: string;
  projectId: string;
  fileName: string;
  storagePath: string;
}

@Processor('ingestion-queue')
@Injectable()
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly db: DatabaseService,
    @Optional() private readonly tenantAccess?: TenantAccessService
  ) {
    super();
  }

  async process(job: Job<IngestionJobData>, token?: string): Promise<void> {
    const { fileId, organizationId, projectId } = job.data;
    // Suspended tenants (spec 10.7): ingestion is parked until reactivation.
    await gateJobForSuspendedTenant(job, token, organizationId, this.tenantAccess, this.logger);
    this.logger.log(`Processing ingestion job for file ${fileId}`);

    const res = await this.db.query(
      'SELECT * FROM uploaded_files WHERE id = $1 AND organization_id = $2 AND project_id = $3',
      [fileId, organizationId, projectId],
      { bypassRls: true }
    );

    if (!res.rows?.length) {
      throw new Error(`File ${fileId} not found for processing`);
    }

    await this.ingestionService.processFile(res.rows[0]);
  }
}
