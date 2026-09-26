import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { RedactionModule } from '../redaction/redaction.module';
import { MimeMagicValidator } from './mime-magic.validator';
import { ArchiveSafetyGuard } from './archive-safety.guard';
import { ClamAvScanner } from './clamav.scanner';
import { IngestionService } from './ingestion.service';
import { FilesController } from './files.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [ConfigModule, DatabaseModule, StorageModule, RedactionModule, BillingModule],
  controllers: [FilesController],
  providers: [
    MimeMagicValidator,
    ArchiveSafetyGuard,
    ClamAvScanner,
    IngestionService,
  ],
  exports: [
    MimeMagicValidator,
    ArchiveSafetyGuard,
    ClamAvScanner,
    IngestionService,
  ],
})
export class IngestionModule {}
