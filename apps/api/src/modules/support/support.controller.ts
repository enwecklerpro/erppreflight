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
import { AdminTicketReplySchema, SupportThreadService, TicketReplySchema, resolveTicketLocale } from './support-thread.service';
import { SupportMailService } from './support-mail.service';

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
  constructor(
    private readonly support: SupportService,
    private readonly thread: SupportThreadService
  ) {}

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
    const dto = parseOr400(CreateTicketSchema, body, 'ticket');
    const ticket = await this.support.createTicket(tenantId, req.user?.id ?? null, {
      ...dto,
      locale: resolveTicketLocale(dto.locale, req),
    });
    // E-mails to the requester and the support inbox (asynchronous, never fail the request).
    await this.thread.notifyCreated(ticket.id).catch(() => undefined);
    return ticket;
  }

  @Get('tickets/:ticketId/messages')
  async listMessages(@CurrentTenant() tenantId: string, @Param('ticketId', new ParseUUIDPipe()) ticketId: string) {
    return this.thread.listMessages(tenantId, ticketId);
  }

  /** Customer reply on a ticket of the caller's organization; e-mails the requester and the support inbox. */
  @Post('tickets/:ticketId/messages')
  @Audited({
    action: 'support.ticket.replied',
    targetType: 'SUPPORT_TICKET',
    targetId: ({ params }) => params.ticketId,
    payload: ({ result }) => ({ messageId: result?.message?.id ?? null, authorRole: 'CUSTOMER' }),
  })
  async reply(
    @CurrentTenant() tenantId: string,
    @Param('ticketId', new ParseUUIDPipe()) ticketId: string,
    @Req() req: any,
    @Body() body: unknown
  ) {
    const dto = parseOr400(TicketReplySchema, body, 'reply');
    return this.thread.customerReply(tenantId, ticketId, { id: req.user?.id ?? null, email: req.user?.email ?? null }, dto.body);
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
  constructor(
    private readonly support: SupportService,
    private readonly thread: SupportThreadService,
    private readonly mails: SupportMailService
  ) {}

  @Get('tickets')
  async listAll(@Query('status') status?: string) {
    return this.support.listAllTickets(status || undefined);
  }

  /** Where ticket e-mails for operators go (SUPPORT_INBOX_EMAIL / SUPPORT_INBOX_LOCALE). */
  @Get('config')
  config() {
    const inboxEmail = this.mails.inboxAddress();
    return { inboxConfigured: !!inboxEmail, inboxEmail, inboxLocale: this.mails.inboxLocale() };
  }

  /** Ticket with its conversation (operator view). */
  @Get('tickets/:ticketId')
  async getTicket(@Param('ticketId', new ParseUUIDPipe()) ticketId: string) {
    return this.thread.adminTicket(ticketId);
  }

  /** Status change; e-mails the requester and the support inbox. Recorded in the tenant ledger. */
  @Patch('tickets/:ticketId')
  @Audited({
    action: 'support.ticket.status_changed',
    targetType: 'SUPPORT_TICKET',
    targetId: ({ params }) => params.ticketId,
    tenantId: ({ result }) => result?.organizationId,
    payload: ({ result, request }) => ({
      status: result?.status ?? null,
      previousStatus: result?.previousStatus ?? null,
      changed: result?.changed ?? false,
      byEmail: request.user?.email ?? null,
    }),
  })
  async updateStatus(@Param('ticketId', new ParseUUIDPipe()) ticketId: string, @Body() body: unknown, @Req() req: any) {
    const { status } = parseOr400(z.object({ status: TicketStatusEnum }).strict(), body, 'ticket status');
    const change = await this.thread.changeStatus(ticketId, status, { id: req.user?.id ?? null, email: req.user?.email ?? null });
    const ticket = await this.support.getTicket(ticketId);
    return { ...ticket, ...change };
  }

  /** Operator reply (optionally with a status change); e-mails the requester and the support inbox. */
  @Post('tickets/:ticketId/messages')
  @Audited({
    action: 'support.ticket.replied',
    targetType: 'SUPPORT_TICKET',
    targetId: ({ params }) => params.ticketId,
    tenantId: ({ result }) => result?.organizationId,
    payload: ({ result, request }) => ({
      messageId: result?.message?.id ?? null,
      authorRole: 'SUPPORT',
      statusChange: result?.statusChange ?? null,
      byEmail: request.user?.email ?? null,
    }),
  })
  async reply(@Param('ticketId', new ParseUUIDPipe()) ticketId: string, @Body() body: unknown, @Req() req: any) {
    const dto = parseOr400(AdminTicketReplySchema, body, 'reply');
    return this.thread.supportReply(ticketId, { id: req.user?.id ?? null, email: req.user?.email ?? null }, dto.body, dto.status);
  }
}
