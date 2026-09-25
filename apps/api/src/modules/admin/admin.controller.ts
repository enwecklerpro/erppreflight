import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { UpdateUserRoleDtoSchema } from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  async getOverview() {
    return this.adminService.getOverview();
  }

  @Get('tenants')
  async getTenants() {
    return this.adminService.getTenants();
  }

  @Get('users')
  async getUsers() {
    return this.adminService.getUsers();
  }

  @Patch('users/:userId/role')
  async updateUserRole(
    @Param('userId') userId: string,
    @Body() body: any
  ) {
    const parse = UpdateUserRoleDtoSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException(`Invalid role payload: ${parse.error.message}`);
    }
    return this.adminService.updateUserRole(userId, parse.data.systemRole);
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
