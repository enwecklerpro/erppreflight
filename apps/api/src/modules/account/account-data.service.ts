import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import { renderAccountDeleted } from '../mail/mail.templates';
import { TwoFactorService, SecondFactor } from '../auth/two-factor.service';
import { SecurityAuditService, RequestMeta } from '../auth/security-audit.service';
import { withGlobalTransaction } from '../auth/global-transaction';
import {
  OrganizationDeletionResult,
  OrganizationLifecycleService,
} from '../organizations/organization-lifecycle.service';

export const ACCOUNT_EXPORT_ACTIVITY_LIMIT = 10_000;

export interface DeletionImpact {
  /** Organizations where the caller is the only owner: deleted together with the account. */
  soleOwnerOrganizations: Array<{ id: string; name: string; memberCount: number }>;
  /** Organizations the caller will simply leave. */
  memberships: Array<{ id: string; name: string; role: string }>;
}

/**
 * User-level GDPR rights (spec 10 §10.19).
 *
 * Export scope (Art. 15/20): profile, security settings (no secrets), memberships,
 * invitations sent/received, projects created and the audit events the user
 * performed. Organization data (projects, findings, members) is exported by owners
 * and security admins with GET /organizations/current/export.
 *
 * Deletion (Art. 17): soft-delete + anonymisation. The users row is kept (audit
 * ledgers reference it by id) but e-mail, name, password hash and 2FA material are
 * erased, memberships and credentials are removed and every session is revoked.
 * Organizations where the user is the sole owner are permanently deleted after an
 * explicit confirmation that lists them.
 */
@Injectable()
export class AccountDataService {
  private readonly logger = new Logger(AccountDataService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mail: MailService,
    private readonly twoFactor: TwoFactorService,
    private readonly securityAudit: SecurityAuditService,
    private readonly organizations: OrganizationLifecycleService
  ) {}

  async exportAccount(userId: string, meta: RequestMeta = {}) {
    const userRes = await this.db.query(
      `SELECT id, email, full_name, system_role, status, email_verified_at, password_changed_at,
              totp_enabled_at, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId],
      { bypassRls: true }
    );
    const user = userRes.rows[0];
    if (!user) throw new NotFoundException('Account not found');

    const [memberships, recovery, invitationsSent, invitationsReceived, projectsCreated, activity] = await Promise.all([
      this.db.query(
        `SELECT o.id AS organization_id, o.name AS organization_name, m.role, m.created_at AS joined_at
         FROM organization_members m JOIN organizations o ON o.id = m.organization_id
         WHERE m.user_id = $1 ORDER BY m.created_at`,
        [userId],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT COUNT(*) FILTER (WHERE used_at IS NULL)::int AS remaining FROM user_recovery_codes WHERE user_id = $1`,
        [userId],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT i.id, i.organization_id, i.email, i.role, i.created_at, i.expires_at, i.accepted_at, i.revoked_at
         FROM organization_invitations i WHERE i.invited_by = $1 ORDER BY i.created_at`,
        [userId],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT i.id, i.organization_id, o.name AS organization_name, i.role, i.created_at, i.accepted_at, i.revoked_at
         FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id
         WHERE lower(i.email) = lower($1) ORDER BY i.created_at`,
        [user.email],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT id, organization_id, name, description, target_release, created_at
         FROM projects WHERE created_by = $1 ORDER BY created_at`,
        [userId],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT organization_id, action, target_type, target_id, created_at, client_ip::text AS client_ip, user_agent
         FROM audit_events WHERE actor_id = $1 ORDER BY created_at DESC LIMIT ${ACCOUNT_EXPORT_ACTIVITY_LIMIT}`,
        [userId],
        { bypassRls: true }
      ),
    ]);

    await this.securityAudit.recordForUser(userId, 'USER_DATA_EXPORTED', {}, meta);

    return {
      format: 'erppreflight.account-export/v1',
      exportedAt: new Date().toISOString(),
      scope:
        'Personal data held about you. Organization data is exported by organization owners and security admins ' +
        '(Settings > Account > Organization data export).',
      profile: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        systemRole: user.system_role,
        status: user.status,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
      security: {
        emailVerifiedAt: user.email_verified_at,
        passwordChangedAt: user.password_changed_at,
        twoFactorEnabledAt: user.totp_enabled_at,
        recoveryCodesRemaining: user.totp_enabled_at ? Number(recovery.rows[0]?.remaining ?? 0) : 0,
      },
      memberships: memberships.rows,
      invitationsSent: invitationsSent.rows,
      invitationsReceived: invitationsReceived.rows,
      projectsCreated: projectsCreated.rows,
      activity: activity.rows,
      activityTruncated: activity.rows.length >= ACCOUNT_EXPORT_ACTIVITY_LIMIT,
    };
  }

  async deletionImpact(userId: string): Promise<DeletionImpact> {
    const res = await this.db.query(
      `SELECT o.id, o.name, m.role,
              (SELECT COUNT(*)::int FROM organization_members x
                WHERE x.organization_id = o.id AND x.role = 'ORGANIZATION_OWNER' AND x.user_id <> $1) AS other_owners,
              (SELECT COUNT(*)::int FROM organization_members x WHERE x.organization_id = o.id) AS member_count
       FROM organization_members m JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1
       ORDER BY o.name`,
      [userId],
      { bypassRls: true }
    );
    const impact: DeletionImpact = { soleOwnerOrganizations: [], memberships: [] };
    for (const row of res.rows) {
      if (row.role === 'ORGANIZATION_OWNER' && Number(row.other_owners) === 0) {
        impact.soleOwnerOrganizations.push({ id: row.id, name: row.name, memberCount: Number(row.member_count) });
      } else {
        impact.memberships.push({ id: row.id, name: row.name, role: row.role });
      }
    }
    return impact;
  }

  async deleteAccount(
    userId: string,
    input: { password: string; factor: SecondFactor; confirmOrganizationDeletion?: string[] },
    meta: RequestMeta = {}
  ): Promise<{ deleted: true; organizationsDeleted: OrganizationDeletionResult[] }> {
    await this.twoFactor.confirmIdentity(userId, input.password, input.factor);

    const impact = await this.deletionImpact(userId);
    const expected = impact.soleOwnerOrganizations.map((o) => o.id).sort();
    const confirmed = [...new Set(input.confirmOrganizationDeletion || [])].sort();
    if (expected.length !== confirmed.length || expected.some((id, i) => id !== confirmed[i])) {
      throw new ConflictException({
        message:
          'Deleting your account also deletes the organizations you are the only owner of. ' +
          'Confirm them explicitly (or transfer ownership first).',
        code: 'ORGANIZATION_DELETION_CONFIRMATION_REQUIRED',
        soleOwnerOrganizations: impact.soleOwnerOrganizations,
      });
    }

    const userRes = await this.db.query('SELECT email, full_name FROM users WHERE id = $1', [userId], {
      bypassRls: true,
    });
    const original = userRes.rows[0];
    if (!original) throw new NotFoundException('Account not found');

    // Recorded while the user is still a member of the organizations it leaves.
    await this.securityAudit.recordForUser(
      userId,
      'USER_ACCOUNT_DELETED',
      { organizationsDeleted: expected.length },
      meta,
      impact.memberships.map((m) => m.id)
    );

    const organizationsDeleted: OrganizationDeletionResult[] = [];
    for (const org of impact.soleOwnerOrganizations) {
      organizationsDeleted.push(await this.organizations.deleteOrganization(org.id, userId));
    }

    await withGlobalTransaction(this.db, async (client) => {
      await client.query('DELETE FROM organization_members WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_action_tokens WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
      await client.query(
        `UPDATE api_keys SET status = 'REVOKED' WHERE created_by = $1 AND status = 'ACTIVE'`,
        [userId]
      );
      const updated = await client.query(
        `UPDATE users
         SET email = $2,
             full_name = NULL,
             password_hash = '!deleted',
             status = 'DELETED',
             deleted_at = NOW(),
             email_verified_at = NULL,
             totp_secret_encrypted = NULL,
             totp_pending_secret_encrypted = NULL,
             totp_pending_created_at = NULL,
             totp_enabled_at = NULL,
             totp_last_used_step = NULL,
             token_version = token_version + 1,
             updated_at = NOW()
         WHERE id = $1 AND status <> 'DELETED'
         RETURNING id`,
        [userId, `deleted+${userId}@deleted.invalid`]
      );
      if (updated.rows.length === 0) {
        throw new BadRequestException('Account is already deleted');
      }
    });

    this.logger.warn(`USER_ACCOUNT_DELETED user=${userId} organizationsDeleted=${organizationsDeleted.length}`);
    this.mail.sendInBackground(
      original.email,
      renderAccountDeleted({
        name: original.full_name,
        when: new Date().toISOString().replace('T', ' ').slice(0, 19),
        deletedOrganizations: organizationsDeleted.map((o) => o.organizationName),
      })
    );
    return { deleted: true, organizationsDeleted };
  }
}
