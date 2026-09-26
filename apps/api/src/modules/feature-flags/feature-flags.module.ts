import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BillingModule } from '../billing/billing.module';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsAdminController, FeatureFlagsController } from './feature-flags.controller';

@Module({
  imports: [DatabaseModule, BillingModule],
  controllers: [FeatureFlagsController, FeatureFlagsAdminController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
