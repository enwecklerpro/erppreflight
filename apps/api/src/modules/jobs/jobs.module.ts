import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { AnalysisProcessor } from './analysis.processor';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'analysis-queue' }),
    StorageModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, AnalysisProcessor],
  exports: [JobsService],
})
export class JobsModule {}
