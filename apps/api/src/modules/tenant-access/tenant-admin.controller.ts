import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { Audited } from '../audit/audited.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import {
  BreakGlassReasonSchema,
  ExtendTrialSchema,
  SuspendTenantSchema,
  TenantAdminService,
  UnsuspendTenantSchema,
} from './tenant-admin.service';
import { PlatformAuditService } from './platform-audit.service';
import { ImpersonationService, StartImpersonationSchema, contextView } from './impersonation.service';
import { isBrowserRequest } from './impersonation-token';
import { operatorOf, parseBody } from './http';

const tenantParam = ({ params }: { params: Record<string, string> }) => params.organizationId;

/**
 * Super-admin tenant actions (spec 10.7). Every mutation carries a mandatory reason,
 * is recorded fail-closed in the TARGET tenant's hash-chained ledger (@Audited with an
 * explicit tenant) and in the platform ledger, and notifies the organization owners.
 */
@Controller('admin/tenants/:organizationId')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@DenyApiKeyAuth()
export class TenantAdminController {
  constructor(
    private readonly tenants: TenantAdminService,
    private readonly platformAudit: PlatformAuditService
  ) {}

  @Get('access')
  async access(@Param('organizationId', new ParseUUIDPipe()) organizationId: string) {
    return this.tenants.accessOverview(organizationId);
  }

  @Get('platform-audit')
  async platformLedger(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query('limit') limit?: string
  ) {
    return this.platformAudit.list({ organizationId, limit: Number(limit) || 100 });
  }

  @Post('suspend')
  @HttpCode(HttpStatus.OK)
  @Audited({
    action: 'admin.tenant.suspended',
    targetType: 'ORGANIZATION',
    targetId: tenantParam,
    tenantId: tenantParam,
    security: true,
    payload: ({ result, request }) => ({
      reason: result?.suspensionReason ?? null,
      ownersNotified: result?.ownersNotified ?? 0,
      byEmail: request.user?.email ?? null,
    }),
  })
  async suspend(@Param('organizationId', new ParseUUIDPipe()) organizationId: string, @Body() body: unknown, @Req() req: any) {
    return this.tenants.suspend(organizationId, parseBody(SuspendTenantSchema, body, 'suspension'), operatorOf(req));
  }

  @Post('unsuspend')
  @HttpCode(HttpStatus.OK)
  @Audited({
    action: 'admin.tenant.reactivated',
    targetType: 'ORGANIZATION',
    targetId: tenantParam,
    tenantId: tenantParam,
    security: true,
    payload: ({ body, result, request }) => ({
      reason: typeof body?.reason === 'string' ? body.reason.slice(0, 1000) : null,
      previousSuspendedAt: result?.previousSuspendedAt ?? null,
      ownersNotified: result?.ownersNotified ?? 0,
      byEmail: request.user?.email ?? null,
    }),
  })
  async unsuspend(@Param('organizationId', new ParseUUIDPipe()) organizationId: string, @Body() body: unknown, @Req() req: any) {
    return this.tenants.unsuspend(organizationId, parseBody(UnsuspendTenantSchema, body, 'reactivation'), operatorOf(req));
  }

  @Post('trial-extension')
  @HttpCode(HttpStatus.OK)
  @Audited({
    action: 'admin.tenant.trial_extended',
    targetType: 'ORGANIZATION',
    targetId: tenantParam,
    tenantId: tenantParam,
    security: true,
    payload: ({ body, result, request }) => ({
      days: result?.days ?? null,
      reason: typeof body?.reason === 'string' ? body.reason.slice(0, 1000) : null,
      previousEndsAt: result?.previousEndsAt ?? null,
      trialEndsAt: result?.trialEndsAt ?? null,
      trialExtendedDays: result?.trialExtendedDays ?? null,
      effectiveTier: result?.effectiveTier ?? null,
      byEmail: request.user?.email ?? null,
    }),
  })
  async extendTrial(@Param('organizationId', new ParseUUIDPipe()) organizationId: string, @Body() body: unknown, @Req() req: any) {
    return this.tenants.extendTrial(organizationId, parseBody(ExtendTrialSchema, body, 'trial extension'), operatorOf(req));
  }

  /** Break-glass: removes a tenant's IP allowlist when its administrators locked themselves out. */
  @Post('ip-allowlist/clear')
  @HttpCode(HttpStatus.OK)
  @Audited({
    action: 'admin.tenant.ip_allowlist_cleared',
    targetType: 'ORGANIZATION',
    targetId: tenantParam,
    tenantId: tenantParam,
    security: true,
    payload: ({ body, result, request }) => ({
      reason: typeof body?.reason === 'string' ? body.reason.slice(0, 1000) : null,
      removed: result?.removed ?? 0,
      byEmail: request.user?.email ?? null,
    }),
  })
  async clearAllowlist(@Param('organizationId', new ParseUUIDPipe()) organizationId: string, @Body() body: unknown, @Req() req: any) {
    const { reason } = parseBody(BreakGlassReasonSchema, body, 'break-glass request');
    return this.tenants.clearIpAllowlist(organizationId, reason, operatorOf(req));
  }
}

/** Super-admin impersonation management (spec 10.8, C §24). */
@Controller('admin/impersonations')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@DenyApiKeyAuth()
export class ImpersonationAdminController {
  constructor(
    private readonly impersonation: ImpersonationService,
    private readonly platformAudit: PlatformAuditService
  ) {}

  @Get()
  async list(@Query('organizationId') organizationId?: string, @Query('active') active?: string) {
    const org = organizationId && /^[0-9a-f-]{36}$/i.test(organizationId) ? organizationId : undefined;
    return this.impersonation.list({ organizationId: org, activeOnly: active === 'true', limit: 100 });
  }

  /**
   * Starts an impersonation. The token is set as the HttpOnly cookie
   * `erppreflight_impersonation` (browsers) and returned in the body only to non-browser
   * clients. Audited fail-closed inside ImpersonationService before the token exists.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(@Body() body: unknown, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const dto = parseBody(StartImpersonationSchema, body, 'impersonation request');
    const operator = operatorOf(req);
    const { view, token, ctx } = await this.impersonation.start(
      { id: req.user.id, email: req.user.email ?? null, organizationId: req.user.organizationId ?? null },
      dto,
      { clientIp: operator.clientIp, userAgent: operator.userAgent }
    );
    this.impersonation.setCookie(res, token, view.expiresAt);
    return {
      impersonation: view,
      session: contextView(ctx),
      returnTo: '/dashboard',
      ...(isBrowserRequest(req) ? {} : { accessToken: token }),
    };
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  async end(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    const operator = operatorOf(req);
    const ended = await this.impersonation.end(id, 'ENDED_BY_ADMIN', { id: operator.id, email: operator.email }, operator);
    if (!ended) throw ImpersonationService.notActive();
    return ended;
  }

  /** Request log of one session (platform ledger). */
  @Get(':id/requests')
  async requests(@Param('id', new ParseUUIDPipe()) id: string) {
    const session = await this.impersonation.requireSession(id);
    const events = await this.platformAudit.list({ impersonationId: id, limit: 500 });
    return { session, events };
  }
}
