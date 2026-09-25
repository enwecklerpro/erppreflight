import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { AnalysesService } from './analyses.service';
import { AnalysesController } from './analyses.controller';

@Module({
  imports: [BillingModule, DatabaseModule, JobsModule],
  controllers: [AnalysesController],
  providers: [AnalysesService],
  exports: [AnalysesService],
})
export class AnalysesModule {}
