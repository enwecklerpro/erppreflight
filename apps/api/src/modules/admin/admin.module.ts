import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { DatabaseModule } from '../database/database.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    DatabaseModule,
    BillingModule,
    BullModule.registerQueue({ name: 'analysis-queue' }, { name: 'maintenance-queue' }),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
