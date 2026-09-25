import { Module } from '@nestjs/common';
import { TraceabilityService } from './traceability.service';
import { TraceabilityController } from './traceability.controller';
import { DatabaseModule } from '../database/database.module';
import { CloudAlmConnectorService } from './connectors/cloud-alm.connector';
import { JiraConnectorService } from './connectors/jira.connector';

@Module({
  imports: [DatabaseModule],
  controllers: [TraceabilityController],
  providers: [
    TraceabilityService,
    CloudAlmConnectorService,
    JiraConnectorService,
  ],
  exports: [
    TraceabilityService,
    CloudAlmConnectorService,
    JiraConnectorService,
  ],
})
export class TraceabilityModule {}
