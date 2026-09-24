import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
} from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { UpdateWorkspaceDto } from './dto/workspace.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('workspaces')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get('current')
  async getCurrent(@CurrentTenant() tenantId: string) {
    return this.workspacesService.getWorkspace(tenantId);
  }

  @Put('current')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  async updateCurrent(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateWorkspaceDto
  ) {
    return this.workspacesService.updateWorkspace(tenantId, dto);
  }

  @Get('members')
  async getMembers(@CurrentTenant() tenantId: string) {
    return this.workspacesService.getMembers(tenantId);
  }
}
