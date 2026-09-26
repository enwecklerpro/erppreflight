import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { AuthRateLimitGuard } from '../auth/guards/auth-rate-limit.guard';
import {
  KnowledgeGraphAdminController,
  KnowledgeGraphController,
  KnowledgeGraphPublicController,
} from './knowledge-graph.controller';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { KNOWLEDGE_SYNC_QUEUE, KnowledgeSyncProcessor, KnowledgeSyncService } from './knowledge-sync.service';
import { ReleasedObjectsProvider } from './released-objects.provider';

@Module({
  imports: [DatabaseModule, BullModule.registerQueue({ name: KNOWLEDGE_SYNC_QUEUE })],
  controllers: [KnowledgeGraphController, KnowledgeGraphPublicController, KnowledgeGraphAdminController],
  providers: [
    KnowledgeGraphService,
    KnowledgeSyncService,
    KnowledgeSyncProcessor,
    ReleasedObjectsProvider,
    AuthRateLimitGuard,
  ],
  exports: [KnowledgeGraphService, ReleasedObjectsProvider, KnowledgeSyncService],
})
export class KnowledgeGraphModule {}
