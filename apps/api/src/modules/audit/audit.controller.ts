import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

/** Query contract of GET /audit/log (org-admin audit log UI). */
export const AuditLogQuerySchema = z
  .object({
    action: z
      .string()
      .trim()
      .max(100)
      .regex(/^[a-z0-9_.-]*$/i, 'action filter may only contain letters, digits, dot, dash, underscore')
      .optional(),
    targetType: z
      .string()
      .trim()
      .max(100)
      .regex(/^[A-Z0-9_]*$/i)
      .optional(),
    actorId: z.string().uuid().optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

/**
 * The audit ledger is visible to tenant governance roles only; ordinary members
 * cannot enumerate who did what (spec 10.15).
 */
@Controller('audit')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
@Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'AUDITOR')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('verify')
  async verifyLedger(@CurrentTenant() tenantId: string) {
    return this.auditService.verifyTenantLedger(tenantId);
  }

  @Get('events')
  async getEvents(@CurrentTenant() tenantId: string, @Query('limit') limit?: string) {
    const parsed = z.coerce.number().int().min(1).max(500).safeParse(limit ?? 100);
    return this.auditService.getEvents(tenantId, parsed.success ? parsed.data : 100);
  }

  @Get('log')
  async getLog(@CurrentTenant() tenantId: string, @Query() query: Record<string, unknown>) {
    const parsed = AuditLogQuerySchema.safeParse(
      Object.fromEntries(Object.entries(query ?? {}).filter(([, v]) => v !== '' && v !== undefined))
    );
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid audit log query: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      );
    }
    return this.auditService.listEvents(tenantId, parsed.data);
  }
}
