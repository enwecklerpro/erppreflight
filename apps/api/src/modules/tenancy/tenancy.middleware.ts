import {
  Injectable,
  NestMiddleware,
  Optional,
  Logger,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';
import { TenancyContext } from '@erppreflight/tenancy';
import { validate as isValidUuid } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { cookieExtractor } from '../auth/strategies/jwt.strategy';
import { AuditService } from '../audit/audit.service';
import { DelegatedAccess, resolveDelegatedRole } from '../partners/partners.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { IMPERSONATION_TOKEN_TYPE } from '../tenant-access/impersonation-token';
import type { ImpersonationContext } from '../tenant-access/impersonation.service';
import * as crypto from 'node:crypto';

interface VerifiedTenant {
  tenantId: string;
  userId?: string;
  tenantRole?: string;
  systemRole?: string;
  delegated?: DelegatedAccess;
  /** The organization requires 2FA and this user has not enrolled yet. */
  mfaEnrollmentRequired?: boolean;
  /** Request authenticated by a verified impersonation session (ImpersonationMiddleware). */
  impersonating?: boolean;
}

/**
 * Routes a member of a "require 2FA" organization may still call before enrolling:
 * authentication / account self-service and the organization list used by the switcher.
 */
const MFA_ENROLLMENT_ALLOWED_ANY_METHOD = [/^\/auth(\/|$)/, /^\/account(\/|$)/, /^\/invitations(\/|$)/];
const MFA_ENROLLMENT_ALLOWED_READ = [/^\/organizations\/?$/, /^\/organizations\/current\/?$/];

export function isMfaEnrollmentAllowedPath(originalUrl: string, method = 'GET'): boolean {
  const path = String(originalUrl || '').split('?')[0].replace(/^\/api\/v1(?=\/|$)/, '') || '/';
  if (MFA_ENROLLMENT_ALLOWED_ANY_METHOD.some((re) => re.test(path))) return true;
  return String(method).toUpperCase() === 'GET' && MFA_ENROLLMENT_ALLOWED_READ.some((re) => re.test(path));
}

/** Audit / last-used bookkeeping for delegated (partner) access at most once per grant+user per window. */
const DELEGATION_AUDIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Resolves the active tenant for a request and establishes the
 * AsyncLocalStorage TenancyContext ONLY after verifying the caller may act in it:
 *
 * - API key: tenant = the key's organization; a different X-Tenant-Id is rejected (403).
 * - JWT (Bearer or session cookie): tenant = X-Tenant-Id or, if absent, the token's
 *   organizationId. The user must be ACTIVE and a member of that organization
 *   (SUPER_ADMIN may act in any tenant). Otherwise 403.
 * - Unauthenticated / invalid credentials: no tenant context is established; the
 *   route's guards decide (public routes keep working, protected routes return 401).
 *
 * Downstream, `@CurrentTenant()`, RLS-scoped queries and `req.user.organizationId`
 * therefore always refer to a membership-verified tenant.
 */
@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  private readonly jwt = new JwtService({});
  private readonly logger = new Logger(TenancyMiddleware.name);
  private readonly delegationSeen = new Map<string, number>();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly tenantAccess?: TenantAccessService
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const rawHeader = req.headers['x-tenant-id'];
    const headerTenantId =
      typeof rawHeader === 'string' && rawHeader.trim() !== '' ? rawHeader.trim() : undefined;

    if (headerTenantId && !isValidUuid(headerTenantId)) {
      throw new BadRequestException('Invalid Tenant ID format. Must be a valid UUID');
    }

    const verified = await this.resolveVerifiedTenant(req, headerTenantId);
    if (!verified) {
      return next();
    }

    if (verified.mfaEnrollmentRequired && !isMfaEnrollmentAllowedPath(req.originalUrl || req.url, req.method)) {
      throw new ForbiddenException({
        message:
          'This organization requires two-factor authentication. Enable it under Settings > Security to continue.',
        code: 'MFA_ENROLLMENT_REQUIRED',
      });
    }

    // Suspension (403 TENANT_SUSPENDED) and organization IP allowlist (403 IP_NOT_ALLOWED),
    // modules/tenant-access/tenant-access.policy.ts.
    if (this.tenantAccess) {
      await this.tenantAccess.enforce(req, verified.tenantId, {
        systemRole: verified.systemRole,
        impersonating: verified.impersonating,
      });
    }

    const anyReq = req as any;
    anyReq.tenantId = verified.tenantId;
    anyReq.tenantRole = verified.tenantRole;
    if (verified.delegated) {
      anyReq.delegatedAccess = verified.delegated;
    }

    TenancyContext.run(
      {
        tenantId: verified.tenantId,
        userId: verified.userId,
        roles: verified.tenantRole ? [verified.tenantRole] : [],
      },
      () => next()
    );
  }

  private async resolveVerifiedTenant(
    req: Request,
    headerTenantId: string | undefined
  ): Promise<VerifiedTenant | null> {
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      return this.resolveApiKeyTenant(apiKey, headerTenantId);
    }

    const token = this.extractToken(req);
    if (!token) {
      return null;
    }

    let payload: any;
    try {
      payload = this.jwt.verify(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      // Invalid/expired token: JwtAuthGuard returns 401 on protected routes.
      return null;
    }

    // Impersonation token: only valid together with the session verified by ImpersonationMiddleware.
    if (payload?.typ === IMPERSONATION_TOKEN_TYPE) {
      return this.resolveImpersonatedTenant(req, payload, headerTenantId);
    }

    // Only access tokens establish a tenant (2FA challenge tokens carry a typ claim).
    if (payload?.typ) {
      return null;
    }

    const userId: string | undefined = payload?.sub;
    const requestedTenantId: string | undefined = headerTenantId || payload?.organizationId;
    if (!userId || !requestedTenantId || !isValidUuid(requestedTenantId) || !isValidUuid(userId)) {
      return null;
    }

    const res = await this.db.query(
      `SELECT u.status, u.system_role, u.token_version, u.totp_enabled_at,
              m.role AS member_role, o.require_2fa
       FROM users u
       LEFT JOIN organization_members m
         ON m.user_id = u.id AND m.organization_id = $1
       LEFT JOIN organizations o ON o.id = $1
       WHERE u.id = $2`,
      [requestedTenantId, userId],
      { bypassRls: true }
    );

    const row = res.rows[0];
    if (!row || row.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    // Revoked session (password change/reset, 2FA change, logout-all): no tenant context;
    // JwtAuthGuard rejects the token with 401 on protected routes.
    if (Number(row.token_version ?? 0) !== Number(payload?.tv ?? 0)) {
      return null;
    }

    if (!row.member_role && row.system_role !== 'SUPER_ADMIN') {
      // Partner mode (C §61): customer-granted, unexpired delegated access for members
      // of the partner organization. Same verified path, no bypass; RLS still applies.
      const delegated = await resolveDelegatedRole(this.db, requestedTenantId, userId);
      if (!delegated) {
        throw new ForbiddenException('Access denied: You are not an active member of this tenant');
      }
      await this.recordDelegatedUse(requestedTenantId, userId, delegated);
      return {
        tenantId: requestedTenantId,
        userId,
        tenantRole: delegated.tenantRole,
        systemRole: row.system_role,
        delegated,
      };
    }

    return {
      tenantId: requestedTenantId,
      userId,
      tenantRole: row.member_role || undefined,
      systemRole: row.system_role,
      mfaEnrollmentRequired:
        !!row.require_2fa && !row.totp_enabled_at && row.system_role !== 'SUPER_ADMIN',
    };
  }

  /**
   * The tenant of an impersonation session is fixed: an X-Tenant-Id naming another
   * organization is rejected (403 IMPERSONATION_TENANT_MISMATCH).
   */
  private resolveImpersonatedTenant(req: Request, payload: any, headerTenantId: string | undefined): VerifiedTenant {
    const ctx: ImpersonationContext | undefined = (req as any).impersonation;
    if (!ctx || ctx.id !== payload?.imp || ctx.targetUserId !== payload?.sub) {
      throw new UnauthorizedException({ code: 'IMPERSONATION_ENDED', message: 'The impersonation session is not active.' });
    }
    // Browsers: the HttpOnly impersonation cookie defines the tenant; the web app's stored
    // X-Tenant-Id (the operator's own organization) is ignored. Bearer clients that name
    // another organization are refused.
    const fromCookie = (req as any).impersonationSource === 'cookie';
    if (headerTenantId && headerTenantId !== ctx.organizationId && !fromCookie) {
      throw new ForbiddenException({
        code: 'IMPERSONATION_TENANT_MISMATCH',
        message: 'An impersonation session is bound to one organization.',
      });
    }
    return {
      tenantId: ctx.organizationId,
      userId: ctx.targetUserId,
      tenantRole: ctx.memberRole,
      systemRole: 'USER',
      impersonating: true,
    };
  }

  private async recordDelegatedUse(tenantId: string, userId: string, delegated: DelegatedAccess): Promise<void> {
    const key = `${delegated.grantId}:${userId}`;
    const now = Date.now();
    const last = this.delegationSeen.get(key);
    if (last && now - last < DELEGATION_AUDIT_WINDOW_MS) return;
    this.delegationSeen.set(key, now);
    if (this.delegationSeen.size > 10_000) this.delegationSeen.clear();
    try {
      await this.db.query(
        `UPDATE partner_access_grants SET last_used_at = NOW() WHERE organization_id = $1 AND id = $2`,
        [tenantId, delegated.grantId],
        { tenantId }
      );
      await this.audit?.recordEvent({
        organizationId: tenantId,
        action: 'partner.delegated_access_used',
        resourceType: 'ORGANIZATION',
        resourceId: delegated.partnerOrganizationId,
        actorType: 'HUMAN',
        actorId: userId,
        payload: { grantId: delegated.grantId, accessRole: delegated.accessRole, tenantRole: delegated.tenantRole },
      });
    } catch (err: any) {
      this.logger.warn(`Could not record delegated access use: ${err?.message}`);
    }
  }

  private async resolveApiKeyTenant(
    apiKey: string,
    headerTenantId: string | undefined
  ): Promise<VerifiedTenant | null> {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await this.db.query(
      `SELECT organization_id, created_by
       FROM api_keys
       WHERE key_hash = $1 AND status = 'ACTIVE'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [keyHash],
      { bypassRls: true }
    );
    const key = result.rows[0];
    if (!key) {
      // Unknown/expired key: JwtAuthGuard rejects with 401.
      return null;
    }
    if (headerTenantId && headerTenantId !== key.organization_id) {
      throw new ForbiddenException('Access denied: API Key not authorized for this tenant');
    }
    return {
      tenantId: key.organization_id,
      userId: key.created_by || undefined,
      tenantRole: 'API_CLIENT',
    };
  }

  private extractToken(req: Request): string | null {
    // A verified impersonation credential takes precedence (ImpersonationMiddleware).
    const impersonationToken = (req as any).impersonationToken;
    if (typeof impersonationToken === 'string' && impersonationToken) {
      return impersonationToken;
    }
    const auth = req.headers.authorization;
    if (typeof auth === 'string') {
      const match = auth.match(/^Bearer\s+(.+)$/i);
      if (match) {
        return match[1].trim();
      }
    }
    return cookieExtractor(req);
  }
}
