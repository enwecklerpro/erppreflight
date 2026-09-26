import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { AgentGateService } from './agent-gate.service';
import { AgentGateController } from './agent-gate.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [BillingModule, DatabaseModule],
  controllers: [AgentGateController],
  providers: [AgentGateService],
  exports: [AgentGateService],
})
export class AgentGateModule {}
