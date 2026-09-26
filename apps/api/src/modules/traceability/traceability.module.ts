import { BillingModule } from '../billing/billing.module';
import { Module } from '@nestjs/common';
import { TraceabilityService } from './traceability.service';
import { TraceabilityController } from './traceability.controller';
import { DatabaseModule } from '../database/database.module';
import { ConnectorsModule } from '../connectors/connectors.module';

@Module({
  imports: [DatabaseModule, ConnectorsModule, BillingModule],
  controllers: [TraceabilityController],
  providers: [TraceabilityService],
  exports: [TraceabilityService],
})
export class TraceabilityModule {}
