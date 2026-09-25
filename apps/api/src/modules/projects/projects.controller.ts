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
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto, SetBaselineDto } from './dto/project.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('projects')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
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
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto
  ) {
    return this.projectsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string
  ) {
    return this.projectsService.remove(tenantId, id);
  }

  @Post(':id/baseline')
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
