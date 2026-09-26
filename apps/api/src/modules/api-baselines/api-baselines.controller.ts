import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audited } from '../audit/audited.decorator';
import { ApiBaselinesService } from './api-baselines.service';

/** Roles that may change a project's API baselines (auditors and viewers read only). */
const BASELINE_EDITORS = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT', 'MIGRATION_CONSULTANT'] as const;

/**
 * API Change Guard stored baselines (KNOWN_LIMITATIONS E4): register an uploaded OpenAPI / EDMX
 * specification as a baseline, list, activate and delete. Analyses of API_CHANGE_GUARD compare the new
 * specification against the selected (`apiBaselineId` on POST /analyses) or the active baseline.
 */
@Controller('projects/:projectId/api-baselines')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class ApiBaselinesController {
  constructor(private readonly baselines: ApiBaselinesService) {}

  @Get()
  async list(@CurrentTenant() tenantId: string, @Param('projectId', new ParseUUIDPipe()) projectId: string) {
    return this.baselines.list(tenantId, projectId);
  }

  @Get(':id')
  async get(
    @CurrentTenant() tenantId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.baselines.get(tenantId, projectId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(...BASELINE_EDITORS)
  @Audited({
    action: 'api_baseline.created',
    targetType: 'API_BASELINE',
    targetId: ({ result }) => result?.id,
    payload: ({ params, result }) => ({
      projectId: params.projectId ?? null,
      name: result?.name ?? null,
      version: result?.version ?? null,
      format: result?.format ?? null,
      sha256: result?.sha256 ?? null,
      sourceFileId: result?.sourceFileId ?? null,
      active: result?.isActive ?? null,
    }),
  })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() body: unknown
  ) {
    return this.baselines.create(tenantId, userId ?? null, projectId, body);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles(...BASELINE_EDITORS)
  @Audited({
    action: 'api_baseline.activated',
    targetType: 'API_BASELINE',
    targetId: ({ params }) => params.id,
    payload: ({ params, result }) => ({ projectId: params.projectId ?? null, name: result?.name ?? null, version: result?.version ?? null }),
  })
  async activate(
    @CurrentTenant() tenantId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.baselines.activate(tenantId, projectId, id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(...BASELINE_EDITORS)
  @Audited({
    action: 'api_baseline.deleted',
    targetType: 'API_BASELINE',
    targetId: ({ params }) => params.id,
    payload: ({ params, result }) => ({ projectId: params.projectId ?? null, wasActive: result?.wasActive ?? null }),
  })
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.baselines.remove(tenantId, projectId, id);
  }
}
