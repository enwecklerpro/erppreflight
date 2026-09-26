import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthRateLimit, AuthRateLimitGuard, RateLimitRule } from '../auth/guards/auth-rate-limit.guard';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { KnowledgeSyncService } from './knowledge-sync.service';
import {
  ClassifyRequestSchema,
  CreateTenantObjectSchema,
  CreateTenantRelationshipSchema,
  CuratedObjectSchema,
  LookupQuerySchema,
  NeighborhoodQuerySchema,
  ReviewTransitionSchema,
} from './knowledge-graph.types';
import { zodParse } from './zod-parse';

const SapTypeParam = z.string().regex(/^[A-Za-z0-9_]{2,20}$/, 'invalid object type');
const ObjectKeyParam = z.string().regex(/^[A-Za-z0-9_/$]{1,200}$/, 'invalid object key');

/** Authenticated knowledge graph API (global knowledge + the caller's customer knowledge). */
@ApiTags('Knowledge Graph')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenancyGuard)
@Controller('knowledge-graph')
export class KnowledgeGraphController {
  constructor(private readonly knowledge: KnowledgeGraphService) {}

  @Get('lookup')
  @ApiOperation({ summary: 'Look up SAP/customer objects (exact, prefix, alias, fuzzy trigram, full text)' })
  lookup(@Query() query: Record<string, unknown>) {
    return this.knowledge.lookup(zodParse(LookupQuerySchema, query), { publicOnly: false });
  }

  @Get('objects/resolve')
  @ApiOperation({ summary: 'Resolve an object id from its repository type and key' })
  async resolve(@Query('type') type: string, @Query('key') key: string) {
    const sapType = zodParse(SapTypeParam, type);
    const objectKey = zodParse(ObjectKeyParam, key);
    return { id: await this.knowledge.resolveByKey(sapType, objectKey, false) };
  }

  @Get('objects/:id')
  @ApiOperation({ summary: 'Object detail: release states per product/edition/release, successors, relationships, provenance' })
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.knowledge.getObjectDetail(id, { publicOnly: false });
  }

  @Get('objects/:id/neighborhood')
  @ApiOperation({ summary: 'Depth-limited graph neighborhood (max depth 3) for the dependency canvas' })
  neighborhood(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: Record<string, unknown>) {
    const q = zodParse(NeighborhoodQuerySchema, query);
    return this.knowledge.getNeighborhood(id, q.depth, q.limit);
  }

  @Post('classify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Classify object names against the latest snapshot for a product/edition/release' })
  classify(@Body() body: unknown) {
    return this.knowledge.classifyObjects(zodParse(ClassifyRequestSchema, body));
  }

  @Get('snapshots')
  @ApiOperation({ summary: 'Immutable knowledge snapshots with source checksums/versions' })
  snapshots() {
    return this.knowledge.listSnapshots();
  }

  @Get('evidence-sources')
  @ApiOperation({ summary: 'Evidence sources and their trust levels' })
  evidenceSources() {
    return this.knowledge.listEvidenceSources();
  }

  @Post('tenant-objects')
  @UseGuards(RolesGuard)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT', 'MIGRATION_CONSULTANT')
  @ApiOperation({ summary: 'Register a customer object (tenant scope, never public)' })
  createTenantObject(@CurrentTenant() orgId: string, @Body() body: unknown) {
    return this.knowledge.createTenantObject(orgId, zodParse(CreateTenantObjectSchema, body));
  }

  @Post('tenant-relationships')
  @UseGuards(RolesGuard)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT', 'MIGRATION_CONSULTANT')
  @ApiOperation({ summary: 'Add a customer dependency edge (tenant scope)' })
  createTenantRelationship(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: unknown) {
    return this.knowledge.createTenantRelationship(orgId, req.user.id, zodParse(CreateTenantRelationshipSchema, body));
  }
}

/** Public "Clean Core Object Lookup" free tool (Part 01 §1.11): global reviewed knowledge only. */
export const PUBLIC_LOOKUP_RATE_LIMIT: RateLimitRule = {
  name: 'public-knowledge-lookup',
  windowMs: 60 * 1000,
  maxPerIp: 30,
  maxPerIpAndEmail: 0,
};

@ApiTags('Knowledge Graph (public)')
@UseGuards(AuthRateLimitGuard)
@AuthRateLimit(PUBLIC_LOOKUP_RATE_LIMIT)
@Controller('knowledge-graph/public')
export class KnowledgeGraphPublicController {
  constructor(private readonly knowledge: KnowledgeGraphService) {}

  @Get('lookup')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Public Clean Core object lookup (global, reviewed knowledge only; rate limited)' })
  async lookup(@Query() query: Record<string, unknown>) {
    const q = zodParse(LookupQuerySchema, query);
    return this.knowledge.lookup({ ...q, limit: Math.min(q.limit, 20) }, { publicOnly: true });
  }

  @Get('objects/:type/:key')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Public object page data with SEO indexability assessment (Part 02 §2.9)' })
  async object(@Param('type') type: string, @Param('key') key: string) {
    const id = await this.knowledge.resolveByKey(zodParse(SapTypeParam, type), zodParse(ObjectKeyParam, key), true);
    const detail = await this.knowledge.getObjectDetail(id, { publicOnly: true });
    // Public payload: no internal review metadata beyond the status.
    return {
      ...detail,
      object: { ...detail.object, reviewedBy: undefined, attributes: undefined },
      history: detail.history.slice(0, 20),
    };
  }
}

/** Knowledge maintenance (super admin only): sync trigger, sync log, ROSA import, curation workflow. */
@ApiTags('Knowledge Graph (admin)')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('knowledge-graph/admin')
export class KnowledgeGraphAdminController {
  constructor(
    private readonly knowledge: KnowledgeGraphService,
    private readonly sync: KnowledgeSyncService
  ) {}

  @Post('sync')
  @HttpCode(202)
  @ApiOperation({ summary: 'Enqueue a Cloudification Repository sync (BullMQ knowledge-sync queue)' })
  triggerSync(@Req() req: any) {
    return this.sync.enqueueSync(`admin:${req.user.email ?? req.user.id}`);
  }

  @Get('sync-runs')
  @ApiOperation({ summary: 'Knowledge sync run log (including no-op and failed runs)' })
  runs() {
    return this.knowledge.listSyncRuns();
  }

  @Post('rosa-import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Import a ROSA export (JSON body, see docs/KNOWLEDGE_GRAPH.md) as THIRD_PARTY evidence' })
  rosaImport(@Req() req: any, @Body() body: unknown) {
    const content = Buffer.from(JSON.stringify(body ?? {}), 'utf-8');
    return this.sync.importRosaExport(content, 'api-upload', `admin:${req.user.email ?? req.user.id}`);
  }

  @Post('curated-objects')
  @ApiOperation({ summary: 'Create a curated global object as DRAFT (review workflow Part 04 §4.12)' })
  curate(@Req() req: any, @Body() body: unknown) {
    return this.knowledge.createCuratedObject(`admin:${req.user.email ?? req.user.id}`, zodParse(CuratedObjectSchema, body));
  }

  @Post('objects/:id/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move a global object through Draft -> Review -> Approved -> Published' })
  review(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const { to } = zodParse(ReviewTransitionSchema, body);
    return this.knowledge.transitionReview(id, to, `admin:${req.user.email ?? req.user.id}`);
  }
}
