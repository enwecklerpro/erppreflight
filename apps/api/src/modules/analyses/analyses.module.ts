import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { LabModule } from '../lab/lab.module';
import { AnalysesService } from './analyses.service';
import { AnalysesController } from './analyses.controller';
import { FullPreflightController } from './full-preflight.controller';
import { AnalysisLifecycleController } from './analysis-lifecycle.controller';
import { AnalysisLifecycleService } from './analysis-lifecycle.service';

@Module({
  imports: [BillingModule, DatabaseModule, JobsModule, LabModule],
  controllers: [AnalysesController, FullPreflightController, AnalysisLifecycleController],
  providers: [AnalysesService, AnalysisLifecycleService],
  exports: [AnalysesService, AnalysisLifecycleService],
})
export class AnalysesModule {}
