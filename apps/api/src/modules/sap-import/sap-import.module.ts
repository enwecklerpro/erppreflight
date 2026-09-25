import { Module } from '@nestjs/common';
import { SapImportService } from './sap-import.service';
import { SapImportController } from './sap-import.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [SapImportController],
  providers: [SapImportService],
  exports: [SapImportService],
})
export class SapImportModule {}
