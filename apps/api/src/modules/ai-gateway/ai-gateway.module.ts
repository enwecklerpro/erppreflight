import { BillingModule } from '../billing/billing.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { AiGatewayService } from './ai-gateway.service';
import { AiGatewayController } from './ai-gateway.controller';
import { AiAdminController } from './ai-admin.controller';
import { AiGovernanceService } from './ai-governance.service';

@Module({
  imports: [ConfigModule, DatabaseModule, BillingModule],
  controllers: [AiGatewayController, AiAdminController],
  providers: [AiGatewayService, AiGovernanceService],
  exports: [AiGatewayService, AiGovernanceService],
})
export class AiGatewayModule {}
