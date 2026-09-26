import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { SecurityAuditService, RequestMeta } from '../auth/security-audit.service';
import { OrganizationRole } from './dto/membership.dto';
import type { Actor } from './invitations.service';

const OWNER = 'ORGANIZATION_OWNER';

const actorIsOwner = (actor: Actor) => actor.role === OWNER || actor.systemRole === 'SUPER_ADMIN';

/**
 * Membership management with owner protection:
 * - only owners may grant, change or revoke the OWNER role;
 * - the last owner can never be demoted or removed (transfer ownership first);
 * - membership rows are locked (FOR UPDATE) so concurrent changes cannot remove
 *   the last owner in a race.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly securityAudit: SecurityAuditService
  ) {}

  async list(organizationId: string) {
    const res = await this.db.query(
      `SELECT m.id, m.role, m.created_at, u.id AS user_id, u.email, u.full_name,
              (u.email_verified_at IS NOT NULL) AS email_verified,
              (u.totp_enabled_at IS NOT NULL) AS mfa_enabled
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1
       ORDER BY m.created_at ASC`,
      [organizationId],
      { tenantId: organizationId }
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      email: r.email,
      fullName: r.full_name,
      role: r.role,
      emailVerified: r.email_verified,
      mfaEnabled: r.mfa_enabled,
      joinedAt: r.created_at,
    }));
  }

  private async lockMembers(client: PoolClient, organizationId: string) {
    const res = await client.query(
      `SELECT id, user_id, role FROM organization_members WHERE organization_id = $1 ORDER BY id FOR UPDATE`,
      [organizationId]
    );
    return res.rows as Array<{ id: string; user_id: string; role: string }>;
  }

  async updateRole(
    organizationId: string,
    actor: Actor,
    memberId: string,
    role: OrganizationRole,
    meta: RequestMeta = {}
  ) {
    const result = await this.db.withTenantTransaction(organizationId, async (client) => {
      const members = await this.lockMembers(client, organizationId);
      const target = members.find((m) => m.id === memberId);
      if (!target) {
        throw new NotFoundException('Member not found');
      }
      if ((target.role === OWNER || role === OWNER) && !actorIsOwner(actor)) {
        throw new ForbiddenException('Only organization owners can grant or revoke the owner role');
      }
      if (target.role === role) {
        return { id: target.id, userId: target.user_id, role, previousRole: target.role, changed: false };
      }
      const owners = members.filter((m) => m.role === OWNER).length;
      if (target.role === OWNER && owners <= 1) {
        throw new ConflictException('The last owner cannot be demoted. Make another member an owner first.');
      }
      await client.query(
        'UPDATE organization_members SET role = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3',
        [role, memberId, organizationId]
      );
      return { id: target.id, userId: target.user_id, role, previousRole: target.role, changed: true };
    });
    if (result.changed) {
      await this.securityAudit.recordForOrganization(
        organizationId,
        actor.id,
        'ORGANIZATION_MEMBER_ROLE_CHANGED',
        'ORGANIZATION_MEMBER',
        result.userId,
        { from: result.previousRole, to: role },
        meta
      );
    }
    return { id: result.id, userId: result.userId, role: result.role };
  }

  async remove(organizationId: string, actor: Actor, memberId: string, meta: RequestMeta = {}) {
    const removed = await this.db.withTenantTransaction(organizationId, async (client) => {
      const members = await this.lockMembers(client, organizationId);
      const target = members.find((m) => m.id === memberId);
      if (!target) {
        throw new NotFoundException('Member not found');
      }
      if (target.role === OWNER && !actorIsOwner(actor)) {
        throw new ForbiddenException('Only organization owners can remove an owner');
      }
      if (target.role === OWNER && members.filter((m) => m.role === OWNER).length <= 1) {
        throw new ConflictException('The last owner cannot be removed. Transfer ownership or delete the organization.');
      }
      await client.query('DELETE FROM organization_members WHERE id = $1 AND organization_id = $2', [
        memberId,
        organizationId,
      ]);
      return target;
    });
    await this.securityAudit.recordForOrganization(
      organizationId,
      actor.id,
      removed.user_id === actor.id ? 'ORGANIZATION_MEMBER_LEFT' : 'ORGANIZATION_MEMBER_REMOVED',
      'ORGANIZATION_MEMBER',
      removed.user_id,
      { role: removed.role },
      meta
    );
    return { removed: true };
  }

  /**
   * Transfers ownership: the target member becomes ORGANIZATION_OWNER and the calling
   * owner becomes SECURITY_ADMIN, atomically.
   */
  async transferOwnership(organizationId: string, actor: Actor, memberId: string, meta: RequestMeta = {}) {
    const result = await this.db.withTenantTransaction(organizationId, async (client) => {
      const members = await this.lockMembers(client, organizationId);
      const self = members.find((m) => m.user_id === actor.id);
      const target = members.find((m) => m.id === memberId);
      if (!self || self.role !== OWNER) {
        throw new ForbiddenException('Only an organization owner can transfer ownership');
      }
      if (!target) {
        throw new NotFoundException('Member not found');
      }
      if (target.id === self.id) {
        throw new ConflictException('You already own this organization');
      }
      await client.query(
        `UPDATE organization_members SET role = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
        [OWNER, target.id, organizationId]
      );
      await client.query(
        `UPDATE organization_members SET role = 'SECURITY_ADMIN', updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [self.id, organizationId]
      );
      return { newOwnerUserId: target.user_id, previousOwnerUserId: self.user_id };
    });
    await this.securityAudit.recordForOrganization(
      organizationId,
      actor.id,
      'ORGANIZATION_OWNERSHIP_TRANSFERRED',
      'ORGANIZATION_MEMBER',
      result.newOwnerUserId,
      { previousOwner: result.previousOwnerUserId, previousOwnerNewRole: 'SECURITY_ADMIN' },
      meta
    );
    return { transferred: true, newOwnerUserId: result.newOwnerUserId };
  }

  /** The caller leaves the organization (not allowed for the last owner). */
  async leave(organizationId: string, userId: string, meta: RequestMeta = {}) {
    const res = await this.db.query(
      'SELECT id, role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
      [organizationId, userId],
      { tenantId: organizationId }
    );
    const membership = res.rows[0];
    if (!membership) {
      throw new NotFoundException('You are not a member of this organization');
    }
    return this.remove(organizationId, { id: userId, role: membership.role }, membership.id, meta);
  }
}
