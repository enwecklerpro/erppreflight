import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { PlanLimitOverridesSchema, PlanTierEnum } from '@erppreflight/schemas';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { UpdateUserRoleDtoSchema } from './dto/admin.dto';

const SetPlanSchema = z.object({ planTier: PlanTierEnum }).strict();

function actorOf(req: any) {
  return { id: req.user?.id ?? null, email: req.user?.email ?? null };
}

@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  async getOverview() {
    return this.adminService.getOverview();
  }

  @Get('business')
  async getBusiness() {
    return this.adminService.getBusinessMetrics();
  }

  @Get('usage')
  async getUsage() {
    return this.adminService.getPlatformUsage();
  }

  @Get('incidents')
  async getIncidents() {
    return this.adminService.getIncidents();
  }

  @Get('tenants')
  async getTenants() {
    return this.adminService.getTenants();
  }

  @Get('tenants/search')
  async searchTenants(@Query('q') q?: string) {
    return this.adminService.searchTenants(String(q ?? ''));
  }

  @Get('tenants/:organizationId')
  async getTenant(@Param('organizationId', new ParseUUIDPipe()) organizationId: string) {
    return this.adminService.getTenantDetail(organizationId);
  }

  @Patch('tenants/:organizationId/limits')
  async setLimits(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() body: unknown,
    @Req() req: any
  ) {
    const parsed = PlanLimitOverridesSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(`Invalid limit overrides: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    return this.adminService.setTenantLimitOverrides(organizationId, parsed.data, actorOf(req));
  }

  @Patch('tenants/:organizationId/plan')
  async setPlan(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() body: unknown,
    @Req() req: any
  ) {
    const parsed = SetPlanSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(`Invalid plan payload: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    return this.adminService.setTenantPlan(organizationId, parsed.data.planTier, actorOf(req));
  }

  @Get('users')
  async getUsers() {
    return this.adminService.getUsers();
  }

  @Patch('users/:userId/role')
  async updateUserRole(
    @Param('userId') userId: string,
    @Body() body: any,
    @Req() req: any
  ) {
    const parse = UpdateUserRoleDtoSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException(`Invalid role payload: ${parse.error.message}`);
    }
    return this.adminService.updateUserRole(userId, parse.data.systemRole, actorOf(req));
  }

  @Get('engines')
  async getEngineTrustCenter() {
    return this.adminService.getEngineTrustCenter();
  }

  @Get('queues')
  async getQueueStats() {
    return this.adminService.getQueueStats();
  }
}
