import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { RetentionService } from './retention.service';
import { RetentionController } from './retention.controller';
import { MAINTENANCE_QUEUE, RetentionProcessor } from './retention.processor';

@Module({
  imports: [DatabaseModule, StorageModule, BillingModule, BullModule.registerQueue({ name: MAINTENANCE_QUEUE })],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionProcessor],
  exports: [RetentionService],
})
export class RetentionModule {}
