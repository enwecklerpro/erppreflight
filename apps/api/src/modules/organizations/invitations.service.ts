import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import { renderInvitation } from '../mail/mail.templates';
import { AuthService, SessionResult, assertPasswordPolicy } from '../auth/auth.service';
import { SecurityAuditService, RequestMeta } from '../auth/security-audit.service';
import { generateOpaqueToken, hashOpaqueToken, isWellFormedOpaqueToken } from '../auth/crypto/opaque-token';
import { withGlobalTransaction } from '../auth/global-transaction';
import { OrganizationRole } from './dto/membership.dto';

export const INVITATION_TTL_DAYS = 7;
export const MAX_OPEN_INVITATIONS = 100;

export interface Actor {
  id: string;
  role?: string;
  systemRole?: string;
}

const isOwner = (actor: Actor) => actor.role === 'ORGANIZATION_OWNER' || actor.systemRole === 'SUPER_ADMIN';

function invitationStatus(row: any): 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' {
  if (row.accepted_at) return 'ACCEPTED';
  if (row.revoked_at) return 'REVOKED';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'EXPIRED';
  return 'PENDING';
}

/**
 * Organization invitations (spec 10 §10.7). Tokens are single-use, expire after
 * INVITATION_TTL_DAYS and are stored as SHA-256 digests. Accepting requires proof of
 * the invited mailbox: the token itself (delivered by e-mail) plus, for existing
 * accounts, a signed-in session whose e-mail matches the invitation.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
    private readonly securityAudit: SecurityAuditService
  ) {}

  async list(organizationId: string) {
    const res = await this.db.query(
      `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at,
              u.email AS invited_by_email, u.full_name AS invited_by_name
       FROM organization_invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.organization_id = $1
       ORDER BY i.created_at DESC
       LIMIT 200`,
      [organizationId],
      { tenantId: organizationId }
    );
    return res.rows.map((row: any) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: invitationStatus(row),
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      invitedBy: row.invited_by_email ? { email: row.invited_by_email, fullName: row.invited_by_name } : null,
    }));
  }

  async create(
    organizationId: string,
    actor: Actor,
    rawEmail: string,
    role: OrganizationRole,
    meta: RequestMeta = {}
  ) {
    const email = rawEmail.trim().toLowerCase();
    if (role === 'ORGANIZATION_OWNER' && !isOwner(actor)) {
      throw new ForbiddenException('Only organization owners can invite new owners');
    }

    const member = await this.db.query(
      `SELECT 1 FROM organization_members m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND lower(u.email) = $2`,
      [organizationId, email],
      { tenantId: organizationId }
    );
    if (member.rows.length > 0) {
      throw new ConflictException('This person is already a member of the organization');
    }

    const org = await this.db.query('SELECT name FROM organizations WHERE id = $1', [organizationId], {
      bypassRls: true,
    });
    const inviter = await this.db.query('SELECT email, full_name FROM users WHERE id = $1', [actor.id], {
      bypassRls: true,
    });
    const organizationName = org.rows[0]?.name;
    if (!organizationName) {
      throw new NotFoundException('Organization not found');
    }

    const { token, hash } = generateOpaqueToken();
    const invitationId = uuidv4();
    const inserted = await this.db.withTenantTransaction(organizationId, async (client) => {
      const open = await client.query(
        `SELECT COUNT(*)::int AS n FROM organization_invitations
         WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
        [organizationId]
      );
      if (Number(open.rows[0]?.n ?? 0) >= MAX_OPEN_INVITATIONS) {
        throw new HttpException(
          `An organization can have at most ${MAX_OPEN_INVITATIONS} open invitations`,
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      // Re-inviting the same address replaces the previous open invitation (new token).
      await client.query(
        `UPDATE organization_invitations SET revoked_at = NOW()
         WHERE organization_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [organizationId, email]
      );
      const res = await client.query(
        `INSERT INTO organization_invitations (id, organization_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7::int * INTERVAL '1 day'))
         RETURNING id, email, role, expires_at, created_at`,
        [invitationId, organizationId, email, role, hash, actor.id, INVITATION_TTL_DAYS]
      );
      return res.rows[0];
    });

    try {
      await this.mail.send(
        email,
        renderInvitation({
          organizationName,
          inviterName: inviter.rows[0]?.full_name || inviter.rows[0]?.email || 'A colleague',
          role,
          url: this.mail.link('/accept-invite', { token }),
          expiresDays: INVITATION_TTL_DAYS,
        })
      );
    } catch (err: any) {
      this.logger.error(`Invitation e-mail delivery failed (${invitationId}): ${err.message}`);
      await this.db.query(
        'UPDATE organization_invitations SET revoked_at = NOW() WHERE id = $1',
        [invitationId],
        { tenantId: organizationId }
      );
      throw new ServiceUnavailableException('The invitation e-mail could not be sent. Please try again later.');
    }

    await this.securityAudit.recordForOrganization(
      organizationId,
      actor.id,
      'ORGANIZATION_INVITATION_CREATED',
      'ORGANIZATION_INVITATION',
      invitationId,
      { email, role },
      meta
    );
    return {
      id: inserted.id,
      email: inserted.email,
      role: inserted.role,
      status: 'PENDING' as const,
      expiresAt: inserted.expires_at,
      createdAt: inserted.created_at,
    };
  }

  /** Re-sends an unaccepted invitation with a fresh token and expiry (old token revoked). */
  async resend(organizationId: string, actor: Actor, invitationId: string, meta: RequestMeta = {}) {
    const res = await this.db.query(
      `SELECT email, role FROM organization_invitations
       WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL`,
      [invitationId, organizationId],
      { tenantId: organizationId }
    );
    const invitation = res.rows[0];
    if (!invitation) {
      throw new NotFoundException('Invitation not found or already accepted');
    }
    return this.create(organizationId, actor, invitation.email, invitation.role, meta);
  }

  async revoke(organizationId: string, actor: Actor, invitationId: string, meta: RequestMeta = {}) {
    const res = await this.db.query(
      `UPDATE organization_invitations SET revoked_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id, email`,
      [invitationId, organizationId],
      { tenantId: organizationId }
    );
    if (res.rows.length === 0) {
      throw new NotFoundException('Open invitation not found');
    }
    await this.securityAudit.recordForOrganization(
      organizationId,
      actor.id,
      'ORGANIZATION_INVITATION_REVOKED',
      'ORGANIZATION_INVITATION',
      invitationId,
      { email: res.rows[0].email },
      meta
    );
    return { revoked: true };
  }

  /** Looks up an open invitation by token across tenants (the token is the credential). */
  private async findOpen(token: string, client?: { query: (t: string, p: unknown[]) => Promise<any> }) {
    if (!isWellFormedOpaqueToken(token)) return null;
    const sql = `SELECT i.id, i.organization_id, i.email, i.role, i.expires_at, i.invited_by,
                        o.name AS organization_name, o.status AS organization_status,
                        u.full_name AS inviter_name, u.email AS inviter_email
                 FROM organization_invitations i
                 JOIN organizations o ON o.id = i.organization_id
                 LEFT JOIN users u ON u.id = i.invited_by
                 WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                   AND i.expires_at > NOW() AND o.status = 'ACTIVE'
                 ${client ? 'FOR UPDATE OF i' : ''}`;
    const params = [hashOpaqueToken(token)];
    const res = client ? await client.query(sql, params) : await this.db.query(sql, params, { bypassRls: true });
    return res.rows[0] || null;
  }

  async preview(token: string) {
    const inv = await this.findOpen(token);
    if (!inv) {
      throw new NotFoundException('This invitation is invalid, expired, revoked or has already been accepted.');
    }
    const existing = await this.db.query(
      `SELECT 1 FROM users WHERE lower(email) = lower($1) AND status = 'ACTIVE'`,
      [inv.email],
      { bypassRls: true }
    );
    return {
      organizationName: inv.organization_name,
      email: inv.email,
      role: inv.role,
      invitedBy: inv.inviter_name || inv.inviter_email || null,
      expiresAt: inv.expires_at,
      accountExists: existing.rows.length > 0,
    };
  }

  /** Signed-in user joins the organization (e-mail must match the invitation). */
  async acceptAsExistingUser(token: string, userId: string, meta: RequestMeta = {}): Promise<SessionResult> {
    const organizationId = await withGlobalTransaction(this.db, async (client) => {
      const inv = await this.findOpen(token, client);
      if (!inv) {
        throw new NotFoundException('This invitation is invalid, expired, revoked or has already been accepted.');
      }
      const user = await client.query(`SELECT id, email, status FROM users WHERE id = $1`, [userId]);
      const row = user.rows[0];
      if (!row || row.status !== 'ACTIVE') {
        throw new ForbiddenException('Account is not active');
      }
      if (String(row.email).toLowerCase() !== String(inv.email).toLowerCase()) {
        throw new ForbiddenException(
          `This invitation was sent to ${inv.email}. Sign in with that address to accept it.`
        );
      }
      const joined = await client.query(
        `INSERT INTO organization_members (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, user_id) DO NOTHING
         RETURNING id`,
        [uuidv4(), inv.organization_id, userId, inv.role]
      );
      if (joined.rows.length === 0) {
        throw new ConflictException('You are already a member of this organization');
      }
      await client.query(
        'UPDATE organization_invitations SET accepted_at = NOW(), accepted_by = $2 WHERE id = $1',
        [inv.id, userId]
      );
      // The token was delivered to this mailbox: it proves ownership of the address.
      await client.query(
        'UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1',
        [userId]
      );
      return inv.organization_id as string;
    });
    await this.securityAudit.recordForOrganization(
      organizationId,
      userId,
      'ORGANIZATION_INVITATION_ACCEPTED',
      'ORGANIZATION_MEMBER',
      userId,
      {},
      meta
    );
    return this.auth.createSession(userId, { preferredOrganizationId: organizationId, meta, authMethod: 'INVITATION' });
  }

  /** Creates a (verified) account for the invited address and joins the organization. */
  async acceptWithNewAccount(
    token: string,
    password: string,
    fullName: string | undefined,
    meta: RequestMeta = {}
  ): Promise<SessionResult> {
    const preview = await this.findOpen(token);
    if (!preview) {
      throw new NotFoundException('This invitation is invalid, expired, revoked or has already been accepted.');
    }
    assertPasswordPolicy(password, { email: preview.email });
    const passwordHash = await this.auth.hashPassword(password);
    const userId = uuidv4();

    const organizationId = await withGlobalTransaction(this.db, async (client) => {
      const inv = await this.findOpen(token, client);
      if (!inv) {
        throw new NotFoundException('This invitation is invalid, expired, revoked or has already been accepted.');
      }
      const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [inv.email]);
      if (existing.rows.length > 0) {
        throw new ConflictException('An account already exists for this address. Sign in to accept the invitation.');
      }
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, system_role, status, email_verified_at, password_changed_at)
         VALUES ($1, $2, $3, $4, 'USER', 'ACTIVE', NOW(), NOW())`,
        [userId, String(inv.email).toLowerCase(), passwordHash, (fullName || '').trim()]
      );
      await client.query(
        `INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)`,
        [uuidv4(), inv.organization_id, userId, inv.role]
      );
      await client.query(
        'UPDATE organization_invitations SET accepted_at = NOW(), accepted_by = $2 WHERE id = $1',
        [inv.id, userId]
      );
      return inv.organization_id as string;
    });
    await this.securityAudit.recordForOrganization(
      organizationId,
      userId,
      'ORGANIZATION_INVITATION_ACCEPTED',
      'ORGANIZATION_MEMBER',
      userId,
      { newAccount: true },
      meta
    );
    return this.auth.createSession(userId, { preferredOrganizationId: organizationId, meta, authMethod: 'INVITATION' });
  }
}
