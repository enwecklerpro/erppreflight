import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import { renderEmailVerification } from '../mail/mail.templates';
import { ActionTokenStore } from './action-token.store';
import { SecurityAuditService, RequestMeta } from './security-audit.service';

export const EMAIL_VERIFICATION_TTL_HOURS = 24;
/** Maximum verification e-mails per user per hour (persistent, multi-instance safe). */
export const EMAIL_VERIFICATION_MAX_PER_HOUR = 5;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: ActionTokenStore,
    private readonly mail: MailService,
    private readonly securityAudit: SecurityAuditService
  ) {}

  /** Issues a token and sends the e-mail; errors propagate. */
  async issue(params: { userId: string; email: string; fullName?: string | null; ip?: string | null }): Promise<void> {
    const { token } = await this.tokens.issue({
      userId: params.userId,
      purpose: 'EMAIL_VERIFICATION',
      email: params.email,
      ttlMinutes: EMAIL_VERIFICATION_TTL_HOURS * 60,
      ip: params.ip,
    });
    await this.mail.send(
      params.email,
      renderEmailVerification({
        name: params.fullName,
        url: this.mail.link('/verify-email', { token }),
        expiresHours: EMAIL_VERIFICATION_TTL_HOURS,
      })
    );
  }

  /** Sign-up variant: never throws (the account exists; the user can resend). */
  async issueSafely(params: { userId: string; email: string; fullName?: string | null; ip?: string | null }): Promise<void> {
    try {
      await this.issue(params);
    } catch (err: any) {
      this.logger.error(`Could not send verification e-mail for user ${params.userId}: ${err.message}`);
    }
  }

  async resend(userId: string, meta: RequestMeta = {}): Promise<{ sent: true; expiresInHours: number }> {
    const res = await this.db.query(
      `SELECT email, full_name, email_verified_at, status FROM users WHERE id = $1`,
      [userId],
      { bypassRls: true }
    );
    const user = res.rows[0];
    if (!user || user.status !== 'ACTIVE') {
      throw new BadRequestException('Account is not active');
    }
    if (user.email_verified_at) {
      throw new ConflictException('E-mail address is already verified');
    }
    const recent = await this.tokens.countRecent(userId, 'EMAIL_VERIFICATION', 60);
    if (recent >= EMAIL_VERIFICATION_MAX_PER_HOUR) {
      throw new HttpException(
        'Too many verification e-mails requested. Please try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    try {
      await this.issue({ userId, email: user.email, fullName: user.full_name, ip: meta.ip });
    } catch (err: any) {
      this.logger.error(`Verification e-mail delivery failed for user ${userId}: ${err.message}`);
      throw new ServiceUnavailableException('The verification e-mail could not be sent. Please try again later.');
    }
    return { sent: true, expiresInHours: EMAIL_VERIFICATION_TTL_HOURS };
  }

  /**
   * Consumes a verification token. The token is bound to the address it was sent to:
   * if the account e-mail changed since, the token no longer verifies anything.
   */
  async verify(token: string, meta: RequestMeta = {}): Promise<{ verified: true; email: string }> {
    const row = await this.tokens.consume(token, 'EMAIL_VERIFICATION');
    if (!row) {
      throw new BadRequestException('This verification link is invalid, expired or has already been used.');
    }
    const updated = await this.db.query(
      `UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND lower(email) = lower($2) AND status = 'ACTIVE'
       RETURNING email`,
      [row.user_id, row.email],
      { bypassRls: true }
    );
    if (updated.rows.length === 0) {
      throw new BadRequestException('This verification link is no longer valid for this account.');
    }
    await this.securityAudit.recordForUser(row.user_id, 'USER_EMAIL_VERIFIED', {}, meta);
    return { verified: true, email: updated.rows[0].email };
  }
}
