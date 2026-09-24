import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditService } from './audit.service';
import { AuditTrailService } from './audit-trail.service';
import { AuditController } from './audit.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [AuditController],
  providers: [AuditService, AuditTrailService],
  exports: [AuditService, AuditTrailService],
})
export class AuditModule {}
