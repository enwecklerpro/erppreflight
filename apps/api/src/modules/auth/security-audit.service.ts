import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Records account-security events (password reset/change, 2FA changes, session
 * revocation, invitations, membership changes, deletion) in the tamper-evident
 * audit ledger of every organization the user belongs to, so each tenant's
 * security admins see security events of their members. Payloads never contain
 * secrets or tokens.
 */
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService
  ) {}

  async recordForUser(
    userId: string,
    action: string,
    payload: Record<string, unknown> = {},
    meta: RequestMeta = {},
    organizationIds?: string[]
  ): Promise<void> {
    try {
      let orgIds = organizationIds;
      if (!orgIds) {
        const res = await this.db.query(
          'SELECT organization_id FROM organization_members WHERE user_id = $1',
          [userId],
          { bypassRls: true }
        );
        orgIds = res.rows.map((r: any) => r.organization_id);
      }
      for (const organizationId of orgIds) {
        await this.audit.recordEvent({
          organizationId,
          action,
          resourceType: 'USER',
          resourceId: userId,
          payload,
          actorType: 'HUMAN',
          actorId: userId,
          clientIp: meta.ip || null,
          userAgent: meta.userAgent ? meta.userAgent.slice(0, 512) : null,
        });
      }
    } catch (err: any) {
      // The security action itself already succeeded; never fail it on audit I/O.
      this.logger.error(`Failed to record audit event ${action} for user ${userId}: ${err.message}`);
    }
  }

  async recordForOrganization(
    organizationId: string,
    actorId: string | null,
    action: string,
    resourceType: string,
    resourceId: string | null,
    payload: Record<string, unknown> = {},
    meta: RequestMeta = {}
  ): Promise<void> {
    try {
      await this.audit.recordEvent({
        organizationId,
        action,
        resourceType,
        resourceId,
        payload,
        actorType: 'HUMAN',
        actorId,
        clientIp: meta.ip || null,
        userAgent: meta.userAgent ? meta.userAgent.slice(0, 512) : null,
      });
    } catch (err: any) {
      this.logger.error(`Failed to record audit event ${action} for org ${organizationId}: ${err.message}`);
    }
  }
}
