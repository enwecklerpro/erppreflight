import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { apiPath, decideTenantAccess } from './tenant-access.policy';
import { clientIpOf } from './client-ip';

export interface TenantAccessSnapshot {
  organizationId: string;
  organizationName: string;
  status: string;
  suspendedAt: string | null;
  suspensionReason: string | null;
  allowlistCount: number;
  ipAllowed: boolean;
  clientIp: string | null;
}

/**
 * Per-request tenant access state (suspension + IP allowlist) in one indexed query,
 * evaluated by TenancyMiddleware for every tenant-scoped request (JWT, API key,
 * partner delegation, impersonation). No caching: suspending a tenant or saving an
 * allowlist takes effect on the next request on every API instance.
 */
@Injectable()
export class TenantAccessService {
  constructor(private readonly db: DatabaseService) {}

  async snapshot(organizationId: string, clientIp: string | null): Promise<TenantAccessSnapshot | null> {
    const res = await this.db.query(
      `SELECT o.id, o.name, o.status, o.suspended_at, o.suspension_reason,
              (SELECT count(*)::int FROM organization_ip_allowlist a WHERE a.organization_id = o.id) AS allowlist_count,
              CASE WHEN $2::inet IS NULL THEN FALSE
                   ELSE EXISTS (SELECT 1 FROM organization_ip_allowlist a
                                 WHERE a.organization_id = o.id AND a.cidr >>= $2::inet) END AS ip_allowed
         FROM organizations o WHERE o.id = $1`,
      [organizationId, clientIp],
      { bypassRls: true }
    );
    const row = res.rows?.[0];
    if (!row) return null;
    return {
      organizationId: row.id,
      organizationName: row.name,
      status: row.status,
      suspendedAt: row.suspended_at ? new Date(row.suspended_at).toISOString() : null,
      suspensionReason: row.suspension_reason ?? null,
      allowlistCount: Number(row.allowlist_count ?? 0),
      ipAllowed: Boolean(row.ip_allowed),
      clientIp,
    };
  }

  /**
   * Throws 403 TENANT_SUSPENDED / IP_NOT_ALLOWED when the verified tenant may not be
   * used by this request (see tenant-access.policy.ts for the exemptions).
   */
  async enforce(
    req: any,
    organizationId: string,
    principal: { systemRole?: string | null; impersonating?: boolean }
  ): Promise<void> {
    const clientIp = clientIpOf(req);
    const state = await this.snapshot(organizationId, clientIp);
    if (!state) return; // membership resolution already failed closed for unknown organizations
    const denial = decideTenantAccess(
      { status: state.status, allowlistCount: state.allowlistCount, ipAllowed: state.ipAllowed },
      {
        path: apiPath(req?.originalUrl || req?.url),
        method: String(req?.method || 'GET'),
        systemRole: principal.systemRole,
        impersonating: principal.impersonating,
        clientIp,
      }
    );
    if (denial) {
      throw new ForbiddenException({ code: denial.code, message: denial.message });
    }
  }

  /** Used by queue workers: jobs of suspended tenants are deferred, not processed. */
  async isSuspended(organizationId: string): Promise<boolean> {
    const res = await this.db.query(`SELECT status FROM organizations WHERE id = $1`, [organizationId], {
      bypassRls: true,
    });
    return res.rows?.[0]?.status === 'SUSPENDED';
  }
}
