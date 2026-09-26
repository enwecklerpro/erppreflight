import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthRateLimitGuard } from '../auth/guards/auth-rate-limit.guard';
import { KnowledgeGraphModule } from '../knowledge-graph/knowledge-graph.module';
import { ReleaseIntelligenceModule } from '../release-intelligence/release-intelligence.module';
import { PublicToolsController } from './public-tools.controller';
import { PublicToolsService } from './public-tools.service';

/** Public free tools + programmatic SEO data (read-only, global knowledge only). */
@Module({
  imports: [DatabaseModule, KnowledgeGraphModule, ReleaseIntelligenceModule],
  controllers: [PublicToolsController],
  providers: [PublicToolsService, AuthRateLimitGuard],
})
export class PublicToolsModule {}
