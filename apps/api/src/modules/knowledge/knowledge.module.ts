import { Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeArticlesService } from './knowledge-articles.service';
import { PublicKnowledgeController } from './public-knowledge.controller';
import { AdminKnowledgeController } from './admin-knowledge.controller';

@Module({
  controllers: [KnowledgeController, PublicKnowledgeController, AdminKnowledgeController],
  providers: [KnowledgeService, KnowledgeArticlesService],
  exports: [KnowledgeService, KnowledgeArticlesService],
})
export class KnowledgeModule {}
