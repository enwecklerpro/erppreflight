import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { FindingsModule } from '../findings/findings.module';
import { KnowledgeGraphModule } from '../knowledge-graph/knowledge-graph.module';
import { RegressionLabController } from './regression/regression-lab.controller';
import { REGRESSION_LAB_QUEUE, RegressionLabService } from './regression/regression-lab.service';
import { RegressionLabProcessor } from './regression/regression-lab.processor';

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    FindingsModule,
    KnowledgeGraphModule,
    BullModule.registerQueue({ name: REGRESSION_LAB_QUEUE }),
  ],
  controllers: [LabController, RegressionLabController],
  providers: [LabService, RegressionLabService, RegressionLabProcessor],
  exports: [LabService, RegressionLabService],
})
export class LabModule {}
