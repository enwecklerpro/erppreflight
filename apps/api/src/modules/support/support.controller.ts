import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { Audited } from '../audit/audited.decorator';
import { CreateGrantSchema, CreateTicketSchema, SupportService, TicketStatusEnum } from './support.service';

function parseOr400<S extends z.ZodTypeAny>(schema: S, body: unknown, what: string): z.output<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException(
      `Invalid ${what}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ')}`
    );
  }
  return parsed.data;
}

@Controller('support')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  async listTickets(@CurrentTenant() tenantId: string) {
    return this.support.listTickets(tenantId);
  }

  /** Any member may open a ticket, including "report incorrect finding". */
  @Post('tickets')
  @Audited({
    action: 'support.ticket.created',
    targetType: 'SUPPORT_TICKET',
    targetId: ({ result }) => result?.id,
    payload: ({ result }) => ({
      category: result?.category ?? null,
      findingId: result?.findingId ?? null,
      analysisId: result?.analysisId ?? null,
      correlationId: result?.correlationId ?? null,
    }),
  })
  async createTicket(@CurrentTenant() tenantId: string, @Req() req: any, @Body() body: unknown) {
    return this.support.createTicket(tenantId, req.user?.id ?? null, parseOr400(CreateTicketSchema, body, 'ticket'));
  }

  @Get('access-grants')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  async listGrants(@CurrentTenant() tenantId: string) {
    return this.support.listGrants(tenantId);
  }

  /** Time-boxed support access (≤ 7 days), granted by the tenant, revocable, audited. */
  @Post('access-grants')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @Audited({
    action: 'support.access.granted',
    targetType: 'SUPPORT_ACCESS_GRANT',
    targetId: ({ result }) => result?.id,
    security: true,
    payload: ({ result }) => ({ expiresAt: result?.expiresAt ?? null, reason: result?.reason ?? null, ticketId: result?.ticketId ?? null }),
  })
  async createGrant(@CurrentTenant() tenantId: string, @Req() req: any, @Body() body: unknown) {
    return this.support.createGrant(tenantId, req.user?.id ?? null, parseOr400(CreateGrantSchema, body, 'support access grant'));
  }

  @Post('access-grants/:grantId/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @Audited({
    action: 'support.access.revoked',
    targetType: 'SUPPORT_ACCESS_GRANT',
    targetId: ({ params }) => params.grantId,
    security: true,
  })
  async revokeGrant(@CurrentTenant() tenantId: string, @Param('grantId', new ParseUUIDPipe()) grantId: string) {
    return this.support.revokeGrant(tenantId, grantId);
  }
}

/** Operator ticket queue (Super Admin). */
@Controller('admin/support')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  async listAll(@Query('status') status?: string) {
    return this.support.listAllTickets(status || undefined);
  }

  @Patch('tickets/:ticketId')
  async updateStatus(@Param('ticketId', new ParseUUIDPipe()) ticketId: string, @Body() body: unknown) {
    const { status } = parseOr400(z.object({ status: TicketStatusEnum }).strict(), body, 'ticket status');
    return this.support.updateTicketStatus(ticketId, status);
  }
}
