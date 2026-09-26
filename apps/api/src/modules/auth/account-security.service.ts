import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import { renderPasswordChanged, renderPasswordReset } from '../mail/mail.templates';
import { ActionTokenStore } from './action-token.store';
import { AuthService, SessionResult, assertPasswordPolicy } from './auth.service';
import { SecurityAuditService, RequestMeta } from './security-audit.service';
import { withGlobalTransaction } from './global-transaction';

export const PASSWORD_RESET_TTL_MINUTES = 60;
/** Reset e-mails per account per hour (beyond this the request is silently ignored). */
export const PASSWORD_RESET_MAX_PER_HOUR = 5;

export const FORGOT_PASSWORD_RESPONSE = {
  accepted: true,
  message: 'If an account exists for this address, a password reset link has been sent.',
} as const;

function utcNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Password reset / change and session revocation.
 *
 * Session revocation model: every access token carries `tv` = users.token_version at
 * issuance. Bumping token_version (password change/reset, 2FA change, logout-all,
 * account deletion) invalidates every outstanding token at once; JwtStrategy and
 * TenancyMiddleware compare it on every request. Single-session logout records the
 * token's jti in revoked_sessions until the token's natural expiry.
 */
@Injectable()
export class AccountSecurityService {
  private readonly logger = new Logger(AccountSecurityService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly tokens: ActionTokenStore,
    private readonly mail: MailService,
    private readonly securityAudit: SecurityAuditService
  ) {}

  /**
   * Always resolves with the same response (no account enumeration). The e-mail is
   * delivered in the background so response latency does not reveal account existence.
   */
  async forgotPassword(email: string, meta: RequestMeta = {}): Promise<typeof FORGOT_PASSWORD_RESPONSE> {
    const normalized = String(email || '').trim().toLowerCase();
    const res = await this.db.query(
      `SELECT id, email, full_name FROM users WHERE email = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [normalized],
      { bypassRls: true }
    );
    const user = res.rows[0];
    if (user) {
      // Token issuance, delivery and auditing run after the response is decided, so
      // both branches cost one indexed lookup before responding.
      this.issuePasswordReset(user, meta).catch((err: Error) =>
        this.logger.error(`Password reset issuance failed for user ${user.id}: ${err.message}`)
      );
    }
    return FORGOT_PASSWORD_RESPONSE;
  }

  /** Exposed for tests; normally invoked in the background by forgotPassword(). */
  async issuePasswordReset(
    user: { id: string; email: string; full_name: string | null },
    meta: RequestMeta = {}
  ): Promise<boolean> {
    const recent = await this.tokens.countRecent(user.id, 'PASSWORD_RESET', 60);
    if (recent >= PASSWORD_RESET_MAX_PER_HOUR) {
      this.logger.warn(`Password reset rate limit reached for user ${user.id}`);
      return false;
    }
    const { token } = await this.tokens.issue({
      userId: user.id,
      purpose: 'PASSWORD_RESET',
      email: user.email,
      ttlMinutes: PASSWORD_RESET_TTL_MINUTES,
      ip: meta.ip,
    });
    await this.mail.send(
      user.email,
      renderPasswordReset({
        name: user.full_name,
        url: this.mail.link('/reset-password', { token }),
        expiresMinutes: PASSWORD_RESET_TTL_MINUTES,
      })
    );
    await this.securityAudit.recordForUser(user.id, 'USER_PASSWORD_RESET_REQUESTED', {}, meta);
    return true;
  }

  async validateResetToken(token: string): Promise<{ valid: boolean; expiresAt?: string }> {
    const row = await this.tokens.peek(token, 'PASSWORD_RESET');
    return row ? { valid: true, expiresAt: new Date(row.expires_at).toISOString() } : { valid: false };
  }

  async resetPassword(token: string, newPassword: string, meta: RequestMeta = {}): Promise<{ reset: true }> {
    const open = await this.tokens.peek(token, 'PASSWORD_RESET');
    if (!open) {
      throw new BadRequestException('This reset link is invalid, expired or has already been used.');
    }
    assertPasswordPolicy(newPassword, { email: open.email });
    const passwordHash = await this.auth.hashPassword(newPassword);

    const user = await withGlobalTransaction(this.db, async (client) => {
      const consumed = await this.tokens.consume(token, 'PASSWORD_RESET', client);
      if (!consumed) {
        throw new BadRequestException('This reset link is invalid, expired or has already been used.');
      }
      const updated = await client.query(
        `UPDATE users
         SET password_hash = $1,
             password_changed_at = NOW(),
             token_version = token_version + 1,
             -- Following the link proves control of the mailbox.
             email_verified_at = COALESCE(email_verified_at, NOW()),
             updated_at = NOW()
         WHERE id = $2 AND lower(email) = lower($3) AND status = 'ACTIVE'
         RETURNING id, email, full_name`,
        [passwordHash, consumed.user_id, consumed.email]
      );
      if (updated.rows.length === 0) {
        throw new BadRequestException('This reset link is no longer valid for this account.');
      }
      await this.tokens.revokeAll(consumed.user_id, 'PASSWORD_RESET', client);
      return updated.rows[0];
    });

    this.mail.sendInBackground(
      user.email,
      renderPasswordChanged({ name: user.full_name, when: utcNow(), resetUrl: this.mail.link('/forgot-password') })
    );
    await this.securityAudit.recordForUser(user.id, 'USER_PASSWORD_RESET', { sessionsRevoked: true }, meta);
    return { reset: true };
  }

  /** Changes the password, revokes every other session and returns a fresh session. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    activeOrganizationId: string | null,
    meta: RequestMeta = {}
  ): Promise<SessionResult> {
    const res = await this.db.query(
      `SELECT email, full_name, password_hash, status FROM users WHERE id = $1`,
      [userId],
      { bypassRls: true }
    );
    const user = res.rows[0];
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    if (!(await this.auth.verifyPassword(currentPassword, user.password_hash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('The new password must differ from the current password');
    }
    assertPasswordPolicy(newPassword, { email: user.email });
    const passwordHash = await this.auth.hashPassword(newPassword);
    await this.db.query(
      `UPDATE users
       SET password_hash = $1, password_changed_at = NOW(), token_version = token_version + 1, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, userId],
      { bypassRls: true }
    );
    await this.tokens.revokeAll(userId, 'PASSWORD_RESET');
    this.mail.sendInBackground(
      user.email,
      renderPasswordChanged({ name: user.full_name, when: utcNow(), resetUrl: this.mail.link('/forgot-password') })
    );
    await this.securityAudit.recordForUser(userId, 'USER_PASSWORD_CHANGED', { sessionsRevoked: true }, meta);
    return this.auth.createSession(userId, { preferredOrganizationId: activeOrganizationId });
  }

  /** Increments token_version: every outstanding access token becomes invalid. */
  async bumpTokenVersion(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1`,
      [userId],
      { bypassRls: true }
    );
  }

  async logoutAll(userId: string, meta: RequestMeta = {}): Promise<{ success: true }> {
    await this.bumpTokenVersion(userId);
    await this.securityAudit.recordForUser(userId, 'USER_SESSIONS_REVOKED', { scope: 'ALL' }, meta);
    return { success: true };
  }

  /** Revokes a single access token (logout) until it would have expired anyway. */
  async revokeSession(jti: string, userId: string, expSeconds: number): Promise<void> {
    await this.db.query(
      `INSERT INTO revoked_sessions (jti, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3))
       ON CONFLICT (jti) DO NOTHING`,
      [jti, userId, expSeconds],
      { bypassRls: true }
    );
    // Opportunistic cleanup of entries whose tokens have expired.
    await this.db.query(`DELETE FROM revoked_sessions WHERE expires_at < NOW() - INTERVAL '1 day'`, [], {
      bypassRls: true,
    });
  }
}
