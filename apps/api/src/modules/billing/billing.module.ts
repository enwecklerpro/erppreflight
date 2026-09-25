import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { OutboxModule } from '../outbox/outbox.module';
import { EntitlementsService } from './entitlements.service';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { EntitlementGuard } from './guards/entitlement.guard';

@Module({
  imports: [ConfigModule, DatabaseModule, OutboxModule],
  controllers: [BillingController],
  providers: [EntitlementsService, BillingService, EntitlementGuard],
  exports: [EntitlementsService, BillingService, EntitlementGuard],
})
export class BillingModule {}
