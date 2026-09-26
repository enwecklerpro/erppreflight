import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { zodParse } from '../knowledge-graph/zod-parse';
import { KgObjectListQuerySchema, KnowledgeGraphAdminViewService } from './knowledge-graph-admin-view.service';

/** Knowledge Admin graph view (spec 10.9): object records, sources, release validity, verification, conflicts. */
@ApiTags('Admin Knowledge Graph')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/knowledge-graph')
export class KnowledgeGraphAdminViewController {
  constructor(private readonly view: KnowledgeGraphAdminViewService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Global knowledge graph summary: objects by review status, evidence sources, conflicts' })
  summary() {
    return this.view.summary();
  }

  @Get('objects')
  @ApiOperation({ summary: 'Global object records with sources, release validity, last verification and conflicts' })
  objects(@Query() query: unknown) {
    return this.view.objects(zodParse(KgObjectListQuerySchema, query));
  }

  @Get('conflicts')
  @ApiOperation({ summary: 'Current facts on which evidence sources disagree' })
  conflicts() {
    return this.view.conflicts();
  }
}
