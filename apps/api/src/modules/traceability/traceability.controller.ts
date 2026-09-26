import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CreateRemediationTaskSchema, ImportRequirementsSchema, LinkFindingSchema, TraceabilityService } from './traceability.service';
import { ZodBody } from '../../common/openapi/zod-openapi';

const WRITE_ROLES = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT', 'MIGRATION_CONSULTANT'] as const;

@ApiTags('Delivery Traceability & ALM Integration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard, EntitlementGuard)
@Controller('projects/:projectId/traceability')
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  @Get()
  @ApiOperation({ summary: 'Traceability matrix built from imported requirements, findings, work items and tests' })
  getMatrix(@CurrentTenant() orgId: string, @Param('projectId', new ParseUUIDPipe()) projectId: string) {
    return this.traceabilityService.getMatrix(orgId, projectId);
  }

  @Post('requirements/import')
  @RequireEntitlement('CLOUD_ALM_SYNC')
  @ZodBody(ImportRequirementsSchema)
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Import requirements from the mapped SAP Cloud ALM project' })
  importRequirements(@CurrentTenant() orgId: string, @Req() req: any, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() body: unknown) {
    return this.traceabilityService.importRequirements(orgId, req.user.id, projectId, body);
  }

  @Post('nodes/:nodeId/finding')
  @RequireEntitlement('CLOUD_ALM_SYNC')
  @ZodBody(LinkFindingSchema)
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Link (or unlink with null) a finding to a requirement node' })
  linkFinding(
    @CurrentTenant() orgId: string,
    @Req() req: any,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('nodeId', new ParseUUIDPipe()) nodeId: string,
    @Body() body: unknown
  ) {
    return this.traceabilityService.linkFinding(orgId, req.user.id, projectId, nodeId, body);
  }

  @Post('tasks')
  @RequireEntitlement('CLOUD_ALM_SYNC')
  @ZodBody(CreateRemediationTaskSchema)
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Create a remediation task for a finding through a configured work item connector' })
  createTask(@CurrentTenant() orgId: string, @Req() req: any, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() body: unknown) {
    return this.traceabilityService.createRemediationTask(orgId, projectId, body, req.user.id);
  }
}
