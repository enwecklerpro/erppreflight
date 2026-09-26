import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { LabService } from './lab.service';
import { GenerateScenarioDto, RunScenarioDto } from './dto/lab.dto';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller(['lab', 'projects/:id/lab'])
@UseGuards(JwtAuthGuard, TenancyGuard)
export class LabController {
  constructor(private readonly labService: LabService) {}

  @Post('generate')
  async generateScenario(
    @Body() dto: GenerateScenarioDto,
    @Param('id') projectId?: string,
    @CurrentUser('organizationId') userOrgId?: string,
    @CurrentTenant() tenantId?: string,
  ) {
    const effectiveTenantId = tenantId || userOrgId;
    const effectiveProjectId = projectId || dto.projectId;
    return this.labService.generateScenario(
      dto,
      effectiveTenantId,
      effectiveProjectId,
    );
  }

  @Post('run')
  async runScenario(
    @Body() dto: RunScenarioDto,
    @Param('id') projectId?: string,
    @CurrentUser('organizationId') userOrgId?: string,
    @CurrentTenant() tenantId?: string,
  ) {
    const effectiveTenantId = tenantId || userOrgId;
    const effectiveProjectId = projectId || dto.projectId;
    return this.labService.runScenario(
      dto,
      effectiveTenantId,
      effectiveProjectId,
    );
  }

  @Get('scenarios')
  async getScenarios(
    @Param('id') projectId?: string,
    @CurrentUser('organizationId') userOrgId?: string,
    @CurrentTenant() tenantId?: string,
  ) {
    const effectiveTenantId = tenantId || userOrgId;
    return this.labService.getScenarios(effectiveTenantId, projectId);
  }
}
