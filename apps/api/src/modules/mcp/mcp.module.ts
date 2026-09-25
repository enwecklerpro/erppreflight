import { Module } from '@nestjs/common';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';
import { DatabaseModule } from '../database/database.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [DatabaseModule, KnowledgeModule],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
