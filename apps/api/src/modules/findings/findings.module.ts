import { Module } from '@nestjs/common';
import { FindingsController } from './findings.controller';
import { FindingsService } from './findings.service';
import { FindingLifecycleService } from './lifecycle/finding-lifecycle.service';
import { LegacyReviewImportService } from './lifecycle/legacy-review-import.service';
import { DatabaseModule } from '../database/database.module';
import { TraceabilityModule } from '../traceability/traceability.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [DatabaseModule, TraceabilityModule, OutboxModule],
  controllers: [FindingsController],
  providers: [FindingsService, FindingLifecycleService, LegacyReviewImportService],
  exports: [FindingsService, FindingLifecycleService],
})
export class FindingsModule {}
