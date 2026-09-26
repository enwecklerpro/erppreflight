import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CredentialVault } from './credential-vault';
import { ConnectorsService } from './connectors.service';
import { WorkItemsService } from './work-items.service';
import { AgentDevicesService } from './agent-devices.service';
import { IntegrationAuditService } from './integration-audit.service';
import { AgentAdminController, ConnectorsController } from './connectors.controller';
import { AgentApiController } from './agent-api.controller';

@Module({
  imports: [DatabaseModule, AuditModule, IngestionModule, ApiKeysModule],
  controllers: [ConnectorsController, AgentAdminController, AgentApiController],
  providers: [CredentialVault, IntegrationAuditService, ConnectorsService, WorkItemsService, AgentDevicesService],
  exports: [CredentialVault, IntegrationAuditService, ConnectorsService, WorkItemsService, AgentDevicesService],
})
export class ConnectorsModule {}
