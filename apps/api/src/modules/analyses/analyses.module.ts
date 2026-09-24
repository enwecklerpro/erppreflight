import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { AnalysesService } from './analyses.service';
import { AnalysesController } from './analyses.controller';

@Module({
  imports: [DatabaseModule, JobsModule],
  controllers: [AnalysesController],
  providers: [AnalysesService],
  exports: [AnalysesService],
})
export class AnalysesModule {}
