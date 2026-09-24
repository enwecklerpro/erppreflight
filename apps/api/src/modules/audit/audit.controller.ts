import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('audit')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('verify')
  async verifyLedger(@CurrentTenant() tenantId: string) {
    return this.auditService.verifyTenantLedger(tenantId);
  }

  @Get('events')
  async getEvents(
    @CurrentTenant() tenantId: string,
    @Query('limit') limit?: string
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    return this.auditService.getEvents(tenantId, limitNum);
  }
}
