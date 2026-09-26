import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import { renderMagicLink } from '../mail/mail.templates';
import { ActionTokenStore } from './action-token.store';
import { AuthService, LoginResult, MFA_CHALLENGE_TTL_SECONDS } from './auth.service';
import { SecurityAuditService, RequestMeta } from './security-audit.service';
import { withGlobalTransaction } from './global-transaction';

/** Spec 10.2 magic link: single-use, hashed at rest, short-lived. */
export const MAGIC_LINK_TTL_MINUTES = 15;
/** Sign-in links per account per hour; beyond this requests are silently ignored. */
export const MAGIC_LINK_MAX_PER_HOUR = 5;
export const MAGIC_LINK_INVALID_CODE = 'MAGIC_LINK_INVALID';

/** Identical for existing and unknown addresses (no account enumeration). */
export const MAGIC_LINK_REQUEST_RESPONSE = {
  accepted: true,
  message: 'If an account exists for this address, a sign-in link has been sent. It expires in 15 minutes.',
  expiresInMinutes: MAGIC_LINK_TTL_MINUTES,
} as const;

const INVALID_LINK_MESSAGE = 'This sign-in link is invalid, expired or has already been used. Request a new one.';

/**
 * Only same-site relative paths survive as post-login destinations (the web app
 * re-validates with safeNextPath). Anything else is dropped.
 */
export function sanitizeNextPath(next: unknown): string | undefined {
  if (typeof next !== 'string') return undefined;
  const value = next.trim();
  if (!value || value.length > 512) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  if (!/^\/[A-Za-z0-9\-._~/?=&%+,:@]*$/.test(value)) return undefined;
  return value;
}

interface MagicLinkUser {
  id: string;
  email: string;
  full_name: string | null;
}

/**
 * Passwordless sign-in by e-mail link (spec 10.2).
 *
 * - Request: always the same response; issuance, delivery and auditing run in the
 *   background so latency does not reveal whether the account exists. Per-IP and
 *   per-IP+e-mail limits (AuthRateLimitGuard) plus MAGIC_LINK_MAX_PER_HOUR per account.
 * - Token: 256-bit opaque token, only its SHA-256 digest is stored
 *   (user_action_tokens, purpose MAGIC_LINK), 15 min expiry, consumed atomically
 *   (single use); a new request supersedes older open links.
 * - Sign-in: consumption proves control of the mailbox. Accounts of SSO-enforced
 *   organizations get 403 SSO_REQUIRED exactly like password login; accounts with
 *   TOTP 2FA receive the regular MFA challenge and continue with POST /auth/login/2fa.
 *   An unverified address becomes verified (same proof as the verification link).
 */
@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly tokens: ActionTokenStore,
    private readonly mail: MailService,
    private readonly securityAudit: SecurityAuditService
  ) {}

  async request(
    email: string,
    meta: RequestMeta = {},
    next?: string
  ): Promise<typeof MAGIC_LINK_REQUEST_RESPONSE> {
    const normalized = String(email || '').trim().toLowerCase();
    const res = await this.db.query(
      `SELECT id, email, full_name FROM users WHERE email = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [normalized],
      { bypassRls: true }
    );
    const user = res.rows[0] as MagicLinkUser | undefined;
    if (user) {
      this.issue(user, meta, sanitizeNextPath(next)).catch((err: Error) =>
        this.logger.error(`Magic-link issuance failed for user ${user.id}: ${err.message}`)
      );
    }
    return MAGIC_LINK_REQUEST_RESPONSE;
  }

  /** Exposed for tests; normally invoked in the background by request(). */
  async issue(user: MagicLinkUser, meta: RequestMeta = {}, next?: string): Promise<boolean> {
    const recent = await this.tokens.countRecent(user.id, 'MAGIC_LINK', 60);
    if (recent >= MAGIC_LINK_MAX_PER_HOUR) {
      this.logger.warn(`Magic-link rate limit reached for user ${user.id}`);
      return false;
    }
    const { token } = await this.tokens.issue({
      userId: user.id,
      purpose: 'MAGIC_LINK',
      email: user.email,
      ttlMinutes: MAGIC_LINK_TTL_MINUTES,
      ip: meta.ip,
    });
    await this.mail.send(
      user.email,
      renderMagicLink({
        name: user.full_name,
        url: this.mail.link('/login/magic', next ? { token, next } : { token }),
        expiresMinutes: MAGIC_LINK_TTL_MINUTES,
      })
    );
    await this.securityAudit.recordForUser(user.id, 'USER_MAGIC_LINK_REQUESTED', {}, meta);
    return true;
  }

  /** Does not consume the link: lets the landing page show the account before signing in. */
  async preview(token: string): Promise<{ valid: boolean; email?: string; expiresAt?: string }> {
    const row = await this.tokens.peek(token, 'MAGIC_LINK');
    return row ? { valid: true, email: row.email, expiresAt: new Date(row.expires_at).toISOString() } : { valid: false };
  }

  /** Consumes the link and signs in (session or MFA challenge). */
  async signIn(token: string, meta: RequestMeta = {}): Promise<LoginResult> {
    const user = await withGlobalTransaction(this.db, async (client) => {
      const consumed = await this.tokens.consume(token, 'MAGIC_LINK', client);
      if (!consumed) return null;
      const res = await client.query(
        `SELECT id, email, status, token_version, totp_enabled_at, email_verified_at
           FROM users
          WHERE id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL
          FOR UPDATE`,
        [consumed.user_id, consumed.email]
      );
      const row = res.rows[0];
      if (!row || row.status !== 'ACTIVE') return null;
      // Every other open sign-in link of the account dies with this one.
      await this.tokens.revokeAll(row.id, 'MAGIC_LINK', client);
      return row as {
        id: string;
        email: string;
        token_version: number | null;
        totp_enabled_at: Date | null;
        email_verified_at: Date | null;
      };
    });
    if (!user) {
      throw new UnauthorizedException({ message: INVALID_LINK_MESSAGE, code: MAGIC_LINK_INVALID_CODE });
    }

    try {
      await this.auth.assertPasswordLoginAllowed(user.id, user.email);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        await this.securityAudit.recordForUser(user.id, 'USER_MAGIC_LINK_BLOCKED_SSO', { code: 'SSO_REQUIRED' }, meta);
      }
      throw err;
    }

    if (!user.email_verified_at) {
      // Following the link proves control of the mailbox (same proof as the verification link).
      const verified = await this.db.query(
        `UPDATE users SET email_verified_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND email_verified_at IS NULL
          RETURNING id`,
        [user.id],
        { bypassRls: true }
      );
      if (verified.rows.length > 0) {
        await this.tokens.revokeAll(user.id, 'EMAIL_VERIFICATION');
        await this.securityAudit.recordForUser(user.id, 'USER_EMAIL_VERIFIED', { via: 'MAGIC_LINK' }, meta);
      }
    }

    if (user.totp_enabled_at) {
      return {
        mfaRequired: true,
        challengeToken: this.auth.signMfaChallenge(user.id, Number(user.token_version ?? 0), 'MAGIC_LINK'),
        expiresIn: MFA_CHALLENGE_TTL_SECONDS,
      };
    }
    return this.auth.createSession(user.id, { meta, authMethod: 'MAGIC_LINK' });
  }
}
