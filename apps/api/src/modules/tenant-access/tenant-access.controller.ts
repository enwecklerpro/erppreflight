import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { Audited } from '../audit/audited.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { ImpersonationService, contextView } from './impersonation.service';
import { IpAllowlistReplaceSchema, IpAllowlistService } from './ip-allowlist.service';
import { TenantAccessService } from './tenant-access.service';
import { clientIpOf } from './client-ip';
import { parseBody } from './http';

/**
 * Impersonation session control for the web app's banner. Deliberately without
 * guards: it answers from the verified impersonation (ImpersonationMiddleware) and
 * never returns data to anonymous callers.
 */
@Controller('impersonation')
export class ImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @Get('current')
  current(@Req() req: any) {
    if (req.impersonation) {
      return { active: true, session: contextView(req.impersonation), serverTime: new Date().toISOString() };
    }
    if (req.impersonationEnded) {
      return {
        active: false,
        ended: { code: req.impersonationEnded.code, returnOrganizationId: req.impersonationEnded.returnOrganizationId ?? null },
        returnTo: '/admin',
        serverTime: new Date().toISOString(),
      };
    }
    return { active: false, serverTime: new Date().toISOString() };
  }

  /** Ends the caller's impersonation (idempotent) and clears the impersonation cookie. */
  @Post('end')
  @HttpCode(HttpStatus.OK)
  async end(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const meta = { clientIp: clientIpOf(req), userAgent: String(req.headers?.['user-agent'] ?? '').slice(0, 500) || null };
    this.impersonation.clearCookie(res);
    if (req.impersonation) {
      const ctx = req.impersonation;
      await this.impersonation.end(ctx.id, 'ENDED_BY_IMPERSONATOR', { id: ctx.impersonatorId, email: ctx.impersonatorEmail }, meta);
      return { ended: true, sessionId: ctx.id, returnOrganizationId: ctx.impersonatorOrganizationId, returnTo: '/admin' };
    }
    if (req.impersonationEnded) {
      return {
        ended: true,
        sessionId: req.impersonationEnded.sessionId ?? null,
        reason: req.impersonationEnded.code,
        returnOrganizationId: req.impersonationEnded.returnOrganizationId ?? null,
        returnTo: '/admin',
      };
    }
    return { ended: false, returnTo: '/admin' };
  }
}

/** Access status of the caller's organization (the web app's suspended / blocked screens). */
@Controller('tenant-access')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class TenantStatusController {
  constructor(private readonly access: TenantAccessService) {}

  @Get('status')
  async status(@CurrentTenant() tenantId: string, @Req() req: any) {
    const snap = await this.access.snapshot(tenantId, clientIpOf(req));
    return {
      organizationId: tenantId,
      organizationName: snap?.organizationName ?? null,
      status: snap?.status ?? 'ACTIVE',
      suspended: snap?.status === 'SUSPENDED',
      suspendedAt: snap?.suspendedAt ?? null,
      suspensionReason: snap?.status === 'SUSPENDED' ? snap.suspensionReason : null,
      ipAllowlist: {
        enforced: (snap?.allowlistCount ?? 0) > 0,
        clientIp: snap?.clientIp ?? null,
        clientIpAllowed: (snap?.allowlistCount ?? 0) === 0 || !!snap?.ipAllowed,
      },
      impersonating: !!req.impersonation,
    };
  }
}

/** Organization IP allowlist (spec 10.2, Enterprise). Owners and security admins. */
@Controller('organizations/current/ip-allowlist')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard, EntitlementGuard)
@DenyApiKeyAuth()
export class IpAllowlistController {
  constructor(private readonly allowlist: IpAllowlistService) {}

  @Get()
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  async get(@CurrentTenant() tenantId: string, @Req() req: any) {
    return this.allowlist.get(tenantId, clientIpOf(req));
  }

  @Put()
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @RequireEntitlement('IP_ALLOWLIST')
  @Audited({
    action: 'organization.ip_allowlist.updated',
    targetType: 'ORGANIZATION',
    targetId: ({ request }) => request.tenantId,
    security: true,
    payload: ({ result }) => ({
      entries: (result?.entries ?? []).map((e: { cidr: string }) => e.cidr),
      entryCount: result?.entries?.length ?? 0,
      previousCount: result?.previousCount ?? null,
      clientIp: result?.clientIp ?? null,
      lockoutConfirmed: result?.lockoutConfirmed ?? false,
    }),
    failureAction: 'organization.ip_allowlist.update_failed',
  })
  async replace(@CurrentTenant() tenantId: string, @Req() req: any, @Body() body: unknown) {
    const dto = parseBody(IpAllowlistReplaceSchema, body, 'IP allowlist');
    return this.allowlist.replace(tenantId, req.user?.id ?? null, dto, clientIpOf(req));
  }

  /** Removing the allowlist never requires the Enterprise entitlement (downgraded tenants can clean up). */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @Audited({
    action: 'organization.ip_allowlist.cleared',
    targetType: 'ORGANIZATION',
    targetId: ({ request }) => request.tenantId,
    security: true,
    payload: ({ result }) => ({ removed: result?.removed ?? 0 }),
  })
  async clear(@CurrentTenant() tenantId: string) {
    return this.allowlist.clear(tenantId);
  }
}
