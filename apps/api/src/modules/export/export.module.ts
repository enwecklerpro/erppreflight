import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [DatabaseModule, StorageModule, BillingModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
