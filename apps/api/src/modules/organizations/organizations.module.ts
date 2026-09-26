import { BillingModule } from '../billing/billing.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';
import { OrganizationLifecycleService } from './organization-lifecycle.service';
import { BILLING_ACCOUNT_HOOK, NoSubscriptionStorageBillingHook } from './billing-account.hook';

@Module({
  imports: [DatabaseModule, AuthModule, StorageModule, BillingModule],
  controllers: [OrganizationsController, InvitationsController],
  providers: [
    OrganizationsService,
    InvitationsService,
    MembersService,
    OrganizationLifecycleService,
    { provide: BILLING_ACCOUNT_HOOK, useClass: NoSubscriptionStorageBillingHook },
  ],
  exports: [OrganizationsService, MembersService, OrganizationLifecycleService],
})
export class OrganizationsModule {}
