import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { KnowledgeGraphModule } from '../knowledge-graph/knowledge-graph.module';
import { MailModule } from '../mail/mail.module';
import { AnalysisRulesClient } from './analysis-rules.client';
import { RuleGovernanceService } from './rule-governance.service';
import { RuleGovernanceController } from './rule-governance.controller';
import { SourceSyncAdminService } from './source-sync-admin.service';
import { SourceSyncAdminController } from './source-sync-admin.controller';
import { PLATFORM_GOVERNANCE_QUEUE, SourceFreshnessProcessor } from './source-freshness.processor';
import { KnowledgeGraphAdminViewService } from './knowledge-graph-admin-view.service';
import { KnowledgeGraphAdminViewController } from './knowledge-graph-admin-view.controller';

/**
 * Platform governance for SUPER_ADMIN (spec 10.9–10.12): Rule Admin with the self-test
 * publish gate, Source Sync Admin with stale alerts, and the Knowledge Admin graph view.
 * AI Admin lives next to the gateway it governs (AiGatewayModule).
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    KnowledgeGraphModule,
    MailModule,
    BullModule.registerQueue({ name: PLATFORM_GOVERNANCE_QUEUE }),
  ],
  controllers: [RuleGovernanceController, SourceSyncAdminController, KnowledgeGraphAdminViewController],
  providers: [
    AnalysisRulesClient,
    RuleGovernanceService,
    SourceSyncAdminService,
    SourceFreshnessProcessor,
    KnowledgeGraphAdminViewService,
  ],
  exports: [RuleGovernanceService, SourceSyncAdminService],
})
export class GovernanceModule {}
