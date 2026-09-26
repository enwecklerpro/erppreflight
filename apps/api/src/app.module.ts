import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './modules/database/database.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { TenancyMiddleware } from './modules/tenancy/tenancy.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { HealthModule } from './modules/health/health.module';
import { StorageModule } from './modules/storage/storage.module';
import { RedactionModule } from './modules/redaction/redaction.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { AuditModule } from './modules/audit/audit.module';
import { ExportModule } from './modules/export/export.module';
import { EnginesModule } from './modules/engines/engines.module';
import { FindingsModule } from './modules/findings/findings.module';
import { AnalysesModule } from './modules/analyses/analyses.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AdminModule } from './modules/admin/admin.module';
import { ChangeSetsModule } from './modules/changesets/changesets.module';
import { TraceabilityModule } from './modules/traceability/traceability.module';
import { DemoModule } from './modules/demo/demo.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { McpModule } from './modules/mcp/mcp.module';
import { AgentGateModule } from './modules/agent-gate/agent-gate.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { LandscapesModule } from './modules/landscapes/landscapes.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { ChangelogModule } from './modules/changelog/changelog.module';
import { LabModule } from './modules/lab/lab.module';
import { ObjectsModule } from './modules/objects/objects.module';
import { SapImportModule } from './modules/sap-import/sap-import.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';
import { BillingModule } from './modules/billing/billing.module';
import { resolveRedisConnectionOptions } from './modules/jobs/redis-connection.factory';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { ConnectorsModule } from './modules/connectors/connectors.module';
import { SsoModule } from './modules/sso/sso.module';
import { PartnersModule } from './modules/partners/partners.module';
import { UsageModule } from './modules/usage/usage.module';
import { RetentionModule } from './modules/retention/retention.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { SupportModule } from './modules/support/support.module';
import { AccountModule } from './modules/account/account.module';
import { KnowledgeGraphModule } from './modules/knowledge-graph/knowledge-graph.module';
import { ReleaseIntelligenceModule } from './modules/release-intelligence/release-intelligence.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        connection: resolveRedisConnectionOptions(config),
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
    TenancyModule,
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    JobsModule,
    HealthModule,
    StorageModule,
    RedactionModule,
    IngestionModule,
    AuditModule,
    ExportModule,
    EnginesModule,
    FindingsModule,
    AnalysesModule,
    DashboardModule,
    OrganizationsModule,
    AdminModule,
    ChangeSetsModule,
    TraceabilityModule,
    DemoModule,
    KnowledgeModule,
    McpModule,
    AgentGateModule,
    ApiKeysModule,
    WebhooksModule,
    LandscapesModule,
    TemplatesModule,
    FeedbackModule,
    ChangelogModule,
    LabModule,
    ObjectsModule,
    SapImportModule,
    OutboxModule,
    AiGatewayModule,
    BillingModule,
    TelemetryModule,
    ConnectorsModule,
    SsoModule,
    PartnersModule,
    UsageModule,
    RetentionModule,
    FeatureFlagsModule,
    SupportModule,
    AccountModule,
    KnowledgeGraphModule,
    ReleaseIntelligenceModule,
    NotificationsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenancyMiddleware)
      .exclude(
        'health/(.*)',
        'health',
        'auth/login',
        'auth/register',
        'auth/logout',
        'admin/(.*)',
        'admin',
        'knowledge/(.*)',
        'knowledge',
        'public/(.*)',
        'public',
        'changelog/(.*)',
        'changelog',
        'billing/webhook',
        'metrics'
      )
      .forRoutes('*');
  }
}
