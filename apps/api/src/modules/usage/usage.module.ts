import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { UsageService } from './usage.service';
import { UsageInterceptor } from './usage.interceptor';

/**
 * Global so feature modules (ingestion, export, jobs, ai-gateway) can meter
 * usage without importing this module explicitly.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [UsageService, { provide: APP_INTERCEPTOR, useClass: UsageInterceptor }],
  exports: [UsageService],
})
export class UsageModule {}
