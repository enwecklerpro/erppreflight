import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { BillingModule } from '../billing/billing.module';
import { MailModule } from '../mail/mail.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { TenantAccessService } from './tenant-access.service';
import { PlatformAuditService } from './platform-audit.service';
import { IpAllowlistService } from './ip-allowlist.service';
import { ImpersonationService } from './impersonation.service';
import { TenantAdminService } from './tenant-admin.service';
import { TenantAccessNotifier } from './tenant-access.notifier';
import { ImpersonationMiddleware } from './impersonation.middleware';
import { ImpersonationAdminController, TenantAdminController } from './tenant-admin.controller';
import { ImpersonationController, IpAllowlistController, TenantStatusController } from './tenant-access.controller';

/**
 * Tenant access administration (migration 021): suspension, trial extension, safe
 * impersonation, organization IP allowlists and the platform audit ledger.
 * Global so TenancyMiddleware, JwtStrategy and the queue workers can consult
 * TenantAccessService / ImpersonationService without module cycles.
 */
@Global()
@Module({
  imports: [ConfigModule, DatabaseModule, BillingModule, MailModule, ApiKeysModule],
  controllers: [
    TenantAdminController,
    ImpersonationAdminController,
    ImpersonationController,
    TenantStatusController,
    IpAllowlistController,
  ],
  providers: [
    TenantAccessService,
    PlatformAuditService,
    IpAllowlistService,
    ImpersonationService,
    TenantAdminService,
    TenantAccessNotifier,
    ImpersonationMiddleware,
  ],
  exports: [TenantAccessService, PlatformAuditService, ImpersonationService, ImpersonationMiddleware, TenantAccessNotifier],
})
export class TenantAccessModule {}
