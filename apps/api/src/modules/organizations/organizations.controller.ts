import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('organizations')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('current')
  async getCurrent(@CurrentTenant() tenantId: string) {
    return this.organizationsService.getCurrentOrganization(tenantId);
  }

  @Get()
  async getUserOrganizations(@CurrentUser('id') userId: string) {
    return this.organizationsService.getUserOrganizations(userId);
  }

  @Get('members')
  async getMembers(@CurrentTenant() tenantId: string) {
    return this.organizationsService.getMembers(tenantId);
  }

  @Patch('current')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  async updateCurrent(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateOrganizationDto
  ) {
    return this.organizationsService.updateCurrentOrganization(tenantId, dto);
  }
}
