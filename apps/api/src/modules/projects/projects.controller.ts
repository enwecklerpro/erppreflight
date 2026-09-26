import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto, SetBaselineDto } from './dto/project.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audited } from '../audit/audited.decorator';

@Controller('projects')
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @RequireEntitlement('PROJECT_CREATE')
  @Audited({
    action: 'project.created',
    targetType: 'PROJECT',
    targetId: ({ result }) => result?.id,
    payload: ({ result }) => ({ name: result?.name ?? null }),
  })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProjectDto
  ) {
    return this.projectsService.create(tenantId, userId, dto);
  }

  @Get()
  async findAll(@CurrentTenant() tenantId: string) {
    return this.projectsService.findAll(tenantId);
  }

  @Get(':id')
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string
  ) {
    return this.projectsService.findOne(tenantId, id);
  }

  @Put(':id')
  @Audited({
    action: 'project.updated',
    targetType: 'PROJECT',
    targetId: ({ params }) => params.id,
    payload: ({ body }) => ({ fields: Object.keys(body ?? {}).slice(0, 20) }),
  })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto
  ) {
    return this.projectsService.update(tenantId, id, dto);
  }

  /** Project mode context: source/target, release, deployment, countries, modules (Part 01 §1.5). */
  @Put(':id/context')
  @Audited({
    action: 'project.context_updated',
    targetType: 'PROJECT',
    targetId: ({ params }) => params.id,
    payload: ({ body }) => ({ fields: Object.keys(body ?? {}).slice(0, 20) }),
  })
  async updateContext(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    return this.projectsService.updateContext(tenantId, id, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @Audited({ action: 'project.deleted', targetType: 'PROJECT', targetId: ({ params }) => params.id, security: true })
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string
  ) {
    return this.projectsService.remove(tenantId, id);
  }

  @Post(':id/baseline')
  @Audited({
    action: 'project.baseline_set',
    targetType: 'PROJECT',
    targetId: ({ params }) => params.id,
    payload: ({ body }) => ({ analysisId: body?.analysisId ?? null }),
  })
  async setBaseline(
    @CurrentTenant() tenantId: string,
    @Param('id') projectId: string,
    @Body() dto: SetBaselineDto | { analysisId?: string } | string
  ) {
    const analysisId =
      typeof dto === 'string'
        ? dto
        : typeof dto === 'object' && dto !== null
        ? (dto as any).analysisId
        : '';
    return this.projectsService.setBaseline(tenantId, projectId, analysisId as string);
  }

  @Get(':id/drift')
  async getDrift(
    @CurrentTenant() tenantId: string,
    @Param('id') projectId: string,
    @Query('targetAnalysisId') targetAnalysisId?: string
  ) {
    return this.projectsService.getDrift(tenantId, projectId, targetAnalysisId);
  }

  @Get(':id/diagnostic-bundle')
  async getDiagnosticBundle(
    @CurrentTenant() tenantId: string,
    @Param('id') projectId: string
  ) {
    return this.projectsService.generateDiagnosticBundle(tenantId, projectId);
  }
}
