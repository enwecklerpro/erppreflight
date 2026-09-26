import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { RetentionSettingsSchema } from '@erppreflight/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { Audited } from '../audit/audited.decorator';
import { RetentionService } from './retention.service';

@Controller('retention')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get('settings')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'AUDITOR')
  async getSettings(@CurrentTenant() tenantId: string) {
    return this.retention.getSettings(tenantId);
  }

  @Put('settings')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @Audited({
    action: 'retention.policy.updated',
    targetType: 'ORGANIZATION',
    targetId: ({ request }) => request.tenantId,
    security: true,
    payload: ({ result }) => ({
      artifactRetentionDays: result?.artifactRetentionDays ?? null,
      reportRetentionDays: result?.reportRetentionDays ?? null,
    }),
  })
  async updateSettings(@CurrentTenant() tenantId: string, @Body() body: unknown) {
    const parsed = RetentionSettingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid retention settings: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      );
    }
    return this.retention.updateSettings(tenantId, parsed.data);
  }

  /** Applies the tenant's own retention policy immediately (owner-triggered). */
  @Post('purge')
  @HttpCode(HttpStatus.OK)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @Audited({
    action: 'retention.purge.requested',
    targetType: 'ORGANIZATION',
    targetId: ({ request }) => request.tenantId,
    security: true,
    payload: ({ result }) => ({
      artifactsPurged: result?.artifactsPurged ?? 0,
      reportsPurged: result?.reportsPurged ?? 0,
    }),
  })
  async purgeNow(@CurrentTenant() tenantId: string) {
    return this.retention.purgeTenant(tenantId);
  }
}
