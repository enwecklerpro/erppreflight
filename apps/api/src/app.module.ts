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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: Number(config.get<number>('REDIS_PORT', 6379)),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
        },
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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenancyMiddleware)
      .exclude('health/(.*)', 'health', 'auth/login', 'auth/register', 'admin/(.*)', 'admin')
      .forRoutes('*');
  }
}
