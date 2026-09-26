import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import { renderTwoFactorChanged } from '../mail/mail.templates';
import { AuthService, SessionResult } from './auth.service';
import { SecurityAuditService, RequestMeta } from './security-audit.service';
import { SecretBox } from './crypto/secret-box';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from './crypto/totp';
import { generateRecoveryCodes, hashRecoveryCode } from './crypto/opaque-token';
import { withGlobalTransaction } from './global-transaction';
import { SessionService } from './session.service';

export const TOTP_ISSUER = 'ERP Preflight';
export const TOTP_SETUP_TTL_MINUTES = 15;
export const RECOVERY_CODE_COUNT = 10;
/** Failed second-factor attempts per user within the window before 429. */
export const MFA_MAX_FAILURES = 10;
export const MFA_FAILURE_WINDOW_MS = 15 * 60 * 1000;

export interface SecondFactor {
  code?: string;
  recoveryCode?: string;
}

function utcNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * TOTP two-factor authentication (RFC 6238) with hashed single-use recovery codes.
 * Seeds are encrypted at rest with AES-256-GCM under a key derived from
 * MASTER_ENCRYPTION_KEY (bound to the user id as associated data).
 */
@Injectable()
export class TwoFactorService {
  private readonly box: SecretBox;
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly securityAudit: SecurityAuditService,
    private readonly sessions: SessionService,
    config: ConfigService
  ) {
    this.box = new SecretBox(config.getOrThrow<string>('MASTER_ENCRYPTION_KEY'), 'totp-secret/v1');
  }

  private async loadUser(userId: string, client?: PoolClient) {
    const sql = `SELECT id, email, full_name, status, password_hash, token_version,
                        totp_secret_encrypted, totp_pending_secret_encrypted, totp_pending_created_at,
                        totp_enabled_at, totp_last_used_step
                 FROM users WHERE id = $1${client ? ' FOR UPDATE' : ''}`;
    const res = client ? await client.query(sql, [userId]) : await this.db.query(sql, [userId], { bypassRls: true });
    const user = res.rows[0];
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    return user;
  }

  private async requirePassword(user: { password_hash: string }, password: string): Promise<void> {
    if (!(await this.auth.verifyPassword(password, user.password_hash))) {
      throw new BadRequestException('Password is incorrect');
    }
  }

  private checkFailureBudget(userId: string): void {
    const bucket = this.failures.get(userId);
    if (bucket && bucket.resetAt > Date.now() && bucket.count >= MFA_MAX_FAILURES) {
      throw new HttpException('Too many invalid codes. Please wait 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailure(userId: string): void {
    const now = Date.now();
    const bucket = this.failures.get(userId);
    if (!bucket || bucket.resetAt <= now) {
      this.failures.set(userId, { count: 1, resetAt: now + MFA_FAILURE_WINDOW_MS });
    } else {
      bucket.count += 1;
    }
    if (this.failures.size > 50_000) {
      for (const [key, value] of this.failures) if (value.resetAt <= now) this.failures.delete(key);
    }
  }

  async status(userId: string) {
    const user = await this.loadUser(userId);
    const codes = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE used_at IS NULL)::int AS remaining FROM user_recovery_codes WHERE user_id = $1`,
      [userId],
      { bypassRls: true }
    );
    return {
      enabled: !!user.totp_enabled_at,
      enabledAt: user.totp_enabled_at ? new Date(user.totp_enabled_at).toISOString() : null,
      recoveryCodesRemaining: user.totp_enabled_at ? Number(codes.rows[0]?.remaining ?? 0) : 0,
    };
  }

  /** Step 1: generates a pending secret (requires the current password). */
  async beginSetup(userId: string, password: string) {
    const user = await this.loadUser(userId);
    await this.requirePassword(user, password);
    if (user.totp_enabled_at) {
      throw new ConflictException('Two-factor authentication is already enabled');
    }
    const secret = generateTotpSecret();
    await this.db.query(
      `UPDATE users SET totp_pending_secret_encrypted = $1, totp_pending_created_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [this.box.encrypt(secret, userId), userId],
      { bypassRls: true }
    );
    return {
      secret,
      otpauthUri: buildOtpauthUri({ issuer: TOTP_ISSUER, account: user.email, secret }),
      issuer: TOTP_ISSUER,
      account: user.email,
      expiresInMinutes: TOTP_SETUP_TTL_MINUTES,
    };
  }

  /** Step 2: confirms a code for the pending secret, enables 2FA, returns recovery codes once. */
  async enable(
    userId: string,
    code: string,
    activeOrganizationId: string | null,
    meta: RequestMeta = {}
  ): Promise<{ recoveryCodes: string[]; session: SessionResult }> {
    this.checkFailureBudget(userId);
    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    const email = await withGlobalTransaction(this.db, async (client) => {
      const user = await this.loadUser(userId, client);
      if (user.totp_enabled_at) {
        throw new ConflictException('Two-factor authentication is already enabled');
      }
      const created = user.totp_pending_created_at ? new Date(user.totp_pending_created_at).getTime() : 0;
      if (!user.totp_pending_secret_encrypted || Date.now() - created > TOTP_SETUP_TTL_MINUTES * 60_000) {
        throw new BadRequestException('No pending setup or the setup expired. Start again.');
      }
      const secret = this.box.decrypt(user.totp_pending_secret_encrypted, userId);
      const step = verifyTotp(secret, code);
      if (step === null) {
        this.recordFailure(userId);
        throw new BadRequestException('Invalid code. Check the time on your device and try again.');
      }
      await client.query(
        `UPDATE users
         SET totp_secret_encrypted = totp_pending_secret_encrypted,
             totp_pending_secret_encrypted = NULL,
             totp_pending_created_at = NULL,
             totp_enabled_at = NOW(),
             totp_last_used_step = $2,
             token_version = token_version + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [userId, step]
      );
      await this.replaceRecoveryCodes(client, userId, recoveryCodes);
      await this.sessions.revokeAll(userId, 'TWO_FACTOR_CHANGED', client);
      return user.email as string;
    });
    this.failures.delete(userId);
    this.mail.sendInBackground(email, renderTwoFactorChanged({ enabled: true, when: utcNow() }));
    await this.securityAudit.recordForUser(userId, 'USER_2FA_ENABLED', { sessionsRevoked: true }, meta);
    const session = await this.auth.createSession(userId, {
      preferredOrganizationId: activeOrganizationId,
      meta,
      authMethod: 'PASSWORD_2FA',
    });
    return { recoveryCodes, session };
  }

  async disable(
    userId: string,
    password: string,
    factor: SecondFactor,
    activeOrganizationId: string | null,
    meta: RequestMeta = {}
  ): Promise<SessionResult> {
    this.checkFailureBudget(userId);
    const email = await withGlobalTransaction(this.db, async (client) => {
      const user = await this.loadUser(userId, client);
      if (!user.totp_enabled_at) {
        throw new ConflictException('Two-factor authentication is not enabled');
      }
      await this.requirePassword(user, password);
      if (!(await this.verifySecondFactor(client, user, factor))) {
        this.recordFailure(userId);
        throw new BadRequestException('Invalid authentication code');
      }
      await client.query(
        `UPDATE users
         SET totp_secret_encrypted = NULL, totp_pending_secret_encrypted = NULL, totp_pending_created_at = NULL,
             totp_enabled_at = NULL, totp_last_used_step = NULL,
             token_version = token_version + 1, updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
      await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [userId]);
      await this.sessions.revokeAll(userId, 'TWO_FACTOR_CHANGED', client);
      return user.email as string;
    });
    this.failures.delete(userId);
    this.mail.sendInBackground(email, renderTwoFactorChanged({ enabled: false, when: utcNow() }));
    await this.securityAudit.recordForUser(userId, 'USER_2FA_DISABLED', { sessionsRevoked: true }, meta);
    return this.auth.createSession(userId, { preferredOrganizationId: activeOrganizationId, meta });
  }

  async regenerateRecoveryCodes(
    userId: string,
    password: string,
    factor: SecondFactor,
    meta: RequestMeta = {}
  ): Promise<{ recoveryCodes: string[] }> {
    this.checkFailureBudget(userId);
    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    await withGlobalTransaction(this.db, async (client) => {
      const user = await this.loadUser(userId, client);
      if (!user.totp_enabled_at) {
        throw new ConflictException('Two-factor authentication is not enabled');
      }
      await this.requirePassword(user, password);
      if (!(await this.verifySecondFactor(client, user, factor))) {
        this.recordFailure(userId);
        throw new BadRequestException('Invalid authentication code');
      }
      await this.replaceRecoveryCodes(client, userId, recoveryCodes);
    });
    await this.securityAudit.recordForUser(userId, 'USER_2FA_RECOVERY_CODES_REGENERATED', {}, meta);
    return { recoveryCodes };
  }

  /**
   * Step-up confirmation for destructive operations (account / organization deletion):
   * the current password and, when 2FA is enabled, a TOTP or recovery code.
   */
  async confirmIdentity(userId: string, password: string, factor: SecondFactor): Promise<void> {
    this.checkFailureBudget(userId);
    await withGlobalTransaction(this.db, async (client) => {
      const user = await this.loadUser(userId, client);
      await this.requirePassword(user, password);
      if (user.totp_enabled_at) {
        if (!factor.code && !factor.recoveryCode) {
          throw new BadRequestException('Enter a code from your authenticator app or a recovery code');
        }
        if (!(await this.verifySecondFactor(client, user, factor))) {
          this.recordFailure(userId);
          throw new BadRequestException('Invalid authentication code');
        }
      }
    });
  }

  /** Second login step: challenge token + TOTP or recovery code -> session. */
  async completeLogin(challengeToken: string, factor: SecondFactor, meta: RequestMeta = {}): Promise<SessionResult> {
    const { userId, tokenVersion, firstFactor } = this.auth.verifyMfaChallenge(challengeToken);
    this.checkFailureBudget(userId);
    let usedRecoveryCode = false;
    await withGlobalTransaction(this.db, async (client) => {
      const user = await this.loadUser(userId, client);
      if (!user.totp_enabled_at || Number(user.token_version ?? 0) !== tokenVersion) {
        throw new UnauthorizedException('The sign-in challenge is no longer valid. Please sign in again.');
      }
      usedRecoveryCode = !factor.code && !!factor.recoveryCode;
      if (!(await this.verifySecondFactor(client, user, factor))) {
        this.recordFailure(userId);
        throw new UnauthorizedException('Invalid authentication code');
      }
    });
    this.failures.delete(userId);
    if (usedRecoveryCode) {
      await this.securityAudit.recordForUser(userId, 'USER_2FA_RECOVERY_CODE_USED', {}, meta);
    }
    return this.auth.createSession(userId, {
      meta,
      authMethod: firstFactor === 'MAGIC_LINK' ? 'MAGIC_LINK_2FA' : 'PASSWORD_2FA',
    });
  }

  /**
   * Verifies a TOTP code (with replay protection: a time step is accepted at most once)
   * or consumes a recovery code. Must run inside the caller's transaction (row locked).
   */
  private async verifySecondFactor(client: PoolClient, user: any, factor: SecondFactor): Promise<boolean> {
    if (factor.code) {
      if (!user.totp_secret_encrypted) return false;
      const secret = this.box.decrypt(user.totp_secret_encrypted, user.id);
      const step = verifyTotp(secret, factor.code);
      if (step === null) return false;
      if (user.totp_last_used_step !== null && Number(user.totp_last_used_step) >= step) {
        return false; // replayed or older code
      }
      await client.query('UPDATE users SET totp_last_used_step = $2 WHERE id = $1', [user.id, step]);
      return true;
    }
    if (factor.recoveryCode) {
      const res = await client.query(
        `UPDATE user_recovery_codes SET used_at = NOW()
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
         RETURNING id`,
        [user.id, hashRecoveryCode(user.id, factor.recoveryCode)]
      );
      return res.rows.length === 1;
    }
    return false;
  }

  private async replaceRecoveryCodes(client: PoolClient, userId: string, codes: string[]): Promise<void> {
    await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [userId]);
    for (const code of codes) {
      await client.query('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [
        userId,
        hashRecoveryCode(userId, code),
      ]);
    }
  }
}
