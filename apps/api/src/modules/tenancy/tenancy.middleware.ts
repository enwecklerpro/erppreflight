import {
  Injectable,
  NestMiddleware,
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
import * as crypto from 'node:crypto';

interface VerifiedTenant {
  tenantId: string;
  userId?: string;
  tenantRole?: string;
  systemRole?: string;
}

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

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService
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

    const anyReq = req as any;
    anyReq.tenantId = verified.tenantId;
    anyReq.tenantRole = verified.tenantRole;

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

    const userId: string | undefined = payload?.sub;
    const requestedTenantId: string | undefined = headerTenantId || payload?.organizationId;
    if (!userId || !requestedTenantId || !isValidUuid(requestedTenantId) || !isValidUuid(userId)) {
      return null;
    }

    const res = await this.db.query(
      `SELECT u.status, u.system_role, m.role AS member_role
       FROM users u
       LEFT JOIN organization_members m
         ON m.user_id = u.id AND m.organization_id = $1
       WHERE u.id = $2`,
      [requestedTenantId, userId],
      { bypassRls: true }
    );

    const row = res.rows[0];
    if (!row || row.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    if (!row.member_role && row.system_role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Access denied: You are not an active member of this tenant');
    }

    return {
      tenantId: requestedTenantId,
      userId,
      tenantRole: row.member_role || undefined,
      systemRole: row.system_role,
    };
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
