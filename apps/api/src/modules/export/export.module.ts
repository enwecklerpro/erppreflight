import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { BillingModule } from '../billing/billing.module';
import { ReportsHubController } from './reports-hub.controller';
import { ReportsHubService } from './reports-hub.service';

@Module({
  imports: [DatabaseModule, StorageModule, BillingModule],
  controllers: [ExportController, ReportsHubController],
  providers: [ExportService, ReportsHubService],
  exports: [ExportService],
})
export class ExportModule {}
