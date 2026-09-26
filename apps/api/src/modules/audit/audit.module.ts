import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { AuditService } from './audit.service';
import { AuditTrailService } from './audit-trail.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Global: any module can inject AuditService, and every route decorated with
 * @Audited is recorded by the app-wide AuditInterceptor.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuditController],
  providers: [AuditService, AuditTrailService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService, AuditTrailService],
})
export class AuditModule {}
