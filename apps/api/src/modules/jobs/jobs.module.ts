import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { AnalysisProcessor } from './analysis.processor';
import { StorageModule } from '../storage/storage.module';
import { RetentionModule } from '../retention/retention.module';
import { KnowledgeGraphModule } from '../knowledge-graph/knowledge-graph.module';
import { EngineCatalogService } from './orchestration/engine-catalog.service';
import { ArtifactProfilerService } from './orchestration/artifact-profiler.service';
import { AnalysisJobControlService } from './analysis-job-control.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'analysis-queue' }),
    StorageModule,
    RetentionModule,
    KnowledgeGraphModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, AnalysisProcessor, EngineCatalogService, ArtifactProfilerService, AnalysisJobControlService],
  exports: [JobsService, EngineCatalogService, ArtifactProfilerService, AnalysisJobControlService],
})
export class JobsModule {}
