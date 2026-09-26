import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ReportsHubService } from './reports-hub.service';

/** Reports hub listing (Part 01 §1.9). Generation stays on POST projects/:p/analyses/:a/export. */
@Controller('reports')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class ReportsHubController {
  constructor(private readonly hub: ReportsHubService) {}

  @Get()
  async list(@CurrentTenant() tenantId: string, @Query() query: Record<string, unknown>) {
    return this.hub.list(tenantId, query);
  }
}
