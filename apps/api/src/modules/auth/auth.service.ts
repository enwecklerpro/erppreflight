import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { passwordPolicyViolations } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { v4 as uuidv4, validate as isUuid } from 'uuid';
import { hash, verify } from '@node-rs/argon2';
import { EmailVerificationService } from './email-verification.service';
import { SessionAuthMethod, SessionService } from './session.service';
import type { RequestMeta } from './security-audit.service';

const ARGON2ID_ALGORITHM = 2; // Algorithm.Argon2id (RFC 9106 recommended)
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID_ALGORITHM,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * True when a stored hash is not Argon2id with the current parameters (spec §8.1
 * rehash-on-login). Legacy non-Argon2 hashes never authenticate at all.
 */
export function passwordHashNeedsRehash(stored: string): boolean {
  const match = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(String(stored || ''));
  if (!match) return true;
  return (
    Number(match[1]) !== 19 ||
    Number(match[2]) !== ARGON2_OPTIONS.memoryCost ||
    Number(match[3]) !== ARGON2_OPTIONS.timeCost ||
    Number(match[4]) !== ARGON2_OPTIONS.parallelism
  );
}

/** Fallback session lifetime when the token expiry cannot be decoded. */
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_BOOTSTRAP_PASSWORD_LENGTH = 12;
const BOOTSTRAP_ORG_SLUG = 'erppreflight-global';
const BOOTSTRAP_ORG_NAME = 'ERP Preflight Global';
/** Lifetime of the short-lived token issued between password and TOTP steps. */
export const MFA_CHALLENGE_TTL_SECONDS = 300;
export const MFA_CHALLENGE_TYPE = 'mfa_challenge';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  organizationId: string;
  role: string;
  systemRole: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
}

export interface SessionResult {
  accessToken: string;
  user: SessionUser;
  /** The active organization requires 2FA and the user has not enrolled yet. */
  mfaEnrollmentRequired?: boolean;
}

export interface MfaChallengeResult {
  mfaRequired: true;
  challengeToken: string;
  expiresIn: number;
}

export type LoginResult = SessionResult | MfaChallengeResult;

export function isMfaChallenge(result: LoginResult): result is MfaChallengeResult {
  return (result as MfaChallengeResult).mfaRequired === true;
}

/** Throws 400 with every password policy violation. */
export function assertPasswordPolicy(password: string, context: { email?: string | null } = {}): void {
  const violations = passwordPolicyViolations(password, context);
  if (violations.length > 0) {
    throw new BadRequestException(violations);
  }
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash?: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly verification: EmailVerificationService,
    private readonly sessions: SessionService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bootstrapSuperAdmins();
  }

  /**
   * Creates exactly one SUPER_ADMIN account from ADMIN_BOOTSTRAP_EMAIL /
   * ADMIN_BOOTSTRAP_PASSWORD, and only if no user with that email exists.
   * Existing accounts are never modified (no password / role / status resets),
   * and no demo accounts are created.
   */
  public async bootstrapSuperAdmins(): Promise<void> {
    const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    const rawEmail = process.env.ADMIN_BOOTSTRAP_EMAIL || process.env.SUPER_ADMIN_EMAIL;
    if (!bootstrapPassword || !rawEmail) {
      this.logger.log(
        'ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD not set, skipping super admin bootstrap'
      );
      return;
    }

    const email = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.logger.error('ADMIN_BOOTSTRAP_EMAIL is not a valid email address, skipping bootstrap');
      return;
    }
    if (bootstrapPassword.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
      this.logger.error(
        `ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters, skipping bootstrap`
      );
      return;
    }

    try {
      const existing = await this.db.query(
        'SELECT id FROM users WHERE email = $1',
        [email],
        { bypassRls: true }
      );
      if (existing.rows.length > 0) {
        this.logger.log('Bootstrap super admin already exists; leaving account unchanged');
        return;
      }

      // Ensure the platform organization exists
      await this.db.query(
        `INSERT INTO organizations (id, name, slug, plan_tier, status)
         VALUES ($1, $2, $3, 'ENTERPRISE', 'ACTIVE')
         ON CONFLICT (slug) DO NOTHING`,
        [uuidv4(), BOOTSTRAP_ORG_NAME, BOOTSTRAP_ORG_SLUG],
        { bypassRls: true }
      );
      const orgRes = await this.db.query(
        'SELECT id FROM organizations WHERE slug = $1',
        [BOOTSTRAP_ORG_SLUG],
        { bypassRls: true }
      );
      const orgId: string | undefined = orgRes.rows[0]?.id;
      if (!orgId) {
        throw new Error('platform organization could not be created');
      }

      const userId = uuidv4();
      const passwordHash = await this.hashPassword(bootstrapPassword);
      const inserted = await this.db.query(
        // Operator-provisioned from environment: the address is trusted as verified.
        `INSERT INTO users (id, email, password_hash, full_name, system_role, status, email_verified_at)
         VALUES ($1, $2, $3, $4, 'SUPER_ADMIN', 'ACTIVE', NOW())
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [userId, email, passwordHash, 'ERP Preflight Super Admin'],
        { bypassRls: true }
      );
      if (inserted.rows.length === 0) {
        // Created concurrently by another instance: never touch it.
        return;
      }

      await this.db.query(
        `INSERT INTO organization_members (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'ORGANIZATION_OWNER')
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [uuidv4(), orgId, userId],
        { bypassRls: true }
      );

      this.logger.log(`Bootstrap super admin created: ${email}`);
    } catch (err: any) {
      this.logger.warn(`Could not bootstrap super admin account: ${err.message}`);
    }
  }

  async hashPassword(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /**
   * Verifies a password against an Argon2id hash. The supplied password is used
   * byte-for-byte (no trimming) and non-Argon2 (legacy unsalted) hashes are rejected.
   */
  async verifyPassword(plain: string, hashed: string): Promise<boolean> {
    if (!hashed || typeof plain !== 'string' || !hashed.startsWith('$argon2')) {
      return false;
    }
    try {
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  }

  /** Equalizes response timing for unknown accounts (mitigates user enumeration). */
  async burnPasswordCheck(plain: string): Promise<void> {
    if (!this.dummyHash) {
      this.dummyHash = await this.hashPassword(uuidv4());
    }
    await this.verifyPassword(plain, this.dummyHash);
  }

  async register(dto: RegisterDto, meta: RequestMeta = {}): Promise<SessionResult> {
    const email = dto.email.trim().toLowerCase();
    assertPasswordPolicy(dto.password, { email });

    // 1. Check if user already exists
    const existing = await this.db.query(
      'SELECT id FROM users WHERE email = $1',
      [email],
      { bypassRls: true }
    );
    if (existing.rows.length > 0) {
      throw new ConflictException('User with this email already exists');
    }

    const orgId = uuidv4();
    const userId = uuidv4();
    const orgSlug = dto.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);

    const passwordHash = await this.hashPassword(dto.password);

    // 2. Insert organization
    await this.db.query(
      `INSERT INTO organizations (id, name, slug, plan_tier, status)
       VALUES ($1, $2, $3, 'FREE', 'ACTIVE')`,
      [orgId, dto.organizationName, `${orgSlug}-${Date.now().toString().slice(-4)}`],
      { bypassRls: true }
    );

    // 3. Insert user (unverified until the e-mail link is followed)
    await this.db.query(
      `INSERT INTO users (id, email, password_hash, full_name, system_role, status, password_changed_at)
       VALUES ($1, $2, $3, $4, 'USER', 'ACTIVE', NOW())`,
      [userId, email, passwordHash, dto.fullName || ''],
      { bypassRls: true }
    );

    // 4. Insert membership
    await this.db.query(
      `INSERT INTO organization_members (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, 'ORGANIZATION_OWNER')`,
      [uuidv4(), orgId, userId],
      { bypassRls: true }
    );

    // 5. Verification e-mail. Delivery failures never fail sign-up: the user can
    //    request a new link from the banner (POST /auth/verify-email/resend).
    await this.verification.issueSafely({ userId, email, fullName: dto.fullName || null, ip: meta.ip });

    // 6. Sign token (bound to a new server-side session)
    const accessToken = await this.issueSessionToken(
      {
        userId,
        email,
        organizationId: orgId,
        role: 'ORGANIZATION_OWNER',
        systemRole: 'USER',
        tokenVersion: 0,
      },
      'SIGNUP',
      meta
    );

    return {
      accessToken,
      user: {
        id: userId,
        email,
        fullName: dto.fullName || '',
        organizationId: orgId,
        role: 'ORGANIZATION_OWNER',
        systemRole: 'USER',
        emailVerified: false,
        mfaEnabled: false,
      },
    };
  }

  /**
   * Password step. Returns a session, or — when TOTP 2FA is enabled — a short-lived
   * challenge token that must be completed with POST /auth/login/2fa.
   */
  async login(dto: LoginDto, meta: RequestMeta = {}): Promise<LoginResult> {
    const userRes = await this.db.query(
      `SELECT u.id, u.password_hash, u.status, u.token_version, u.totp_enabled_at
       FROM users u
       WHERE u.email = $1`,
      [dto.email.trim().toLowerCase()],
      { bypassRls: true }
    );

    if (userRes.rows.length === 0) {
      await this.burnPasswordCheck(dto.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    const row = userRes.rows[0];
    const isMatch = await this.verifyPassword(dto.password, row.password_hash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (row.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    await this.assertPasswordLoginAllowed(row.id, dto.email);

    if (passwordHashNeedsRehash(row.password_hash)) {
      // Parameters changed since the hash was created: upgrade transparently.
      const upgraded = await this.hashPassword(dto.password);
      await this.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [upgraded, row.id], {
        bypassRls: true,
      });
    }

    if (row.totp_enabled_at) {
      return {
        mfaRequired: true,
        challengeToken: this.signMfaChallenge(row.id, Number(row.token_version ?? 0)),
        expiresIn: MFA_CHALLENGE_TTL_SECONDS,
      };
    }

    return this.createSession(row.id, { meta, authMethod: 'PASSWORD' });
  }

  /**
   * Organizations that enforce SSO (ACTIVE IdP with enforce_sso on a VERIFIED e-mail
   * domain) must not be reachable through password login for their members. Platform
   * SUPER_ADMINs stay exempt as the documented break-glass path. Also applied to
   * magic-link sign-in (MagicLinkService): SSO enforcement covers every local method.
   */
  async assertPasswordLoginAllowed(userId: string, email: string): Promise<void> {
    const domain = String(email || '').trim().toLowerCase().split('@')[1];
    if (!domain) return;
    const res = await this.db.query(
      `SELECT o.name
         FROM sso_domains d
         JOIN sso_identity_providers p
           ON p.organization_id = d.organization_id AND p.status = 'ACTIVE' AND p.enforce_sso = TRUE
         JOIN organizations o ON o.id = d.organization_id AND o.status = 'ACTIVE'
         JOIN organization_members m ON m.organization_id = d.organization_id AND m.user_id = $2
         JOIN users u ON u.id = $2
        WHERE d.domain = $1 AND d.status = 'VERIFIED' AND COALESCE(u.system_role, '') <> 'SUPER_ADMIN'
        LIMIT 1`,
      [domain, userId],
      { bypassRls: true }
    );
    if (res.rows.length > 0) {
      throw new ForbiddenException({
        message: `${res.rows[0].name} requires single sign-on. Continue with your identity provider.`,
        code: 'SSO_REQUIRED',
        loginUrl: `/api/v1/sso/login?email=${encodeURIComponent(email.trim().toLowerCase())}`,
      });
    }
  }

  /**
   * Issues an access token for an ACTIVE user in `preferredOrganizationId` (when the
   * user is a member of that ACTIVE organization) or in their oldest ACTIVE membership.
   */
  async createSession(
    userId: string,
    options: {
      preferredOrganizationId?: string | null;
      meta?: RequestMeta;
      authMethod?: SessionAuthMethod;
    } = {}
  ): Promise<SessionResult> {
    const preferred =
      options.preferredOrganizationId && isUuid(options.preferredOrganizationId)
        ? options.preferredOrganizationId
        : null;
    const res = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.system_role, u.status, u.token_version,
              u.email_verified_at, u.totp_enabled_at,
              m.organization_id, m.role, m.require_2fa
       FROM users u
       LEFT JOIN LATERAL (
         SELECT om.organization_id, om.role, o.require_2fa
         FROM organization_members om
         JOIN organizations o ON o.id = om.organization_id
         WHERE om.user_id = u.id AND o.status IN ('ACTIVE', 'SUSPENDED')
         -- A suspended organization still yields a session (the web app shows the suspended
         -- screen; tenant routes answer 403 TENANT_SUSPENDED), but an active one is preferred.
         ORDER BY (om.organization_id = $2::uuid) DESC NULLS LAST, (o.status = 'ACTIVE') DESC,
                  om.created_at ASC, om.organization_id ASC
         LIMIT 1
       ) m ON TRUE
       WHERE u.id = $1`,
      [userId, preferred],
      { bypassRls: true }
    );
    const row = res.rows[0];
    if (!row || row.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    const organizationId = row.organization_id;
    if (!organizationId) {
      throw new UnauthorizedException('User has no active organization assignment');
    }
    const role = row.role || 'VIEWER';
    const accessToken = await this.issueSessionToken(
      {
        userId: row.id,
        email: row.email,
        organizationId,
        role,
        systemRole: row.system_role,
        tokenVersion: Number(row.token_version ?? 0),
      },
      options.authMethod || 'PASSWORD',
      options.meta
    );
    const mfaEnabled = !!row.totp_enabled_at;
    return {
      accessToken,
      user: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        organizationId,
        role,
        systemRole: row.system_role,
        emailVerified: !!row.email_verified_at,
        mfaEnabled,
      },
      ...(row.require_2fa && !mfaEnabled && row.system_role !== 'SUPER_ADMIN'
        ? { mfaEnrollmentRequired: true }
        : {}),
    };
  }

  /**
   * Session for a principal authenticated by enterprise SSO (modules/sso). Uses the same
   * server-side session + token_version machinery as password login, so logout, "log out
   * everywhere" and account security actions revoke SSO sessions too. The user must be an
   * ACTIVE member of the ACTIVE organization the IdP is configured for.
   */
  async issueSessionForMembership(userId: string, organizationId: string, meta: RequestMeta = {}): Promise<SessionResult> {
    const session = await this.createSession(userId, { preferredOrganizationId: organizationId, meta, authMethod: 'SSO' });
    if (session.user.organizationId !== organizationId) {
      throw new UnauthorizedException('User is not a member of this organization');
    }
    return session;
  }

  /** Registers a server-side session and signs an access token bound to it (jti). */
  private async issueSessionToken(
    params: {
      userId: string;
      email: string;
      organizationId: string;
      role: string;
      systemRole: string;
      tokenVersion: number;
    },
    authMethod: SessionAuthMethod,
    meta: RequestMeta = {}
  ): Promise<string> {
    const sessionId = uuidv4();
    const token = this.jwt.sign({
      sub: params.userId,
      email: params.email,
      organizationId: params.organizationId,
      role: params.role,
      systemRole: params.systemRole,
      tv: params.tokenVersion,
      jti: sessionId,
    });
    let expiresAt = new Date(Date.now() + DEFAULT_SESSION_TTL_MS);
    try {
      const decoded: any = this.jwt.decode(token);
      if (decoded?.exp) expiresAt = new Date(decoded.exp * 1000);
    } catch {
      // keep default
    }
    await this.sessions.create({ id: sessionId, userId: params.userId, expiresAt, authMethod, meta });
    return token;
  }

  /**
   * Short-lived token between the first factor and the TOTP step. `firstFactor`
   * records how the first step was passed (password or magic link) so the final
   * session carries the right auth method.
   */
  signMfaChallenge(userId: string, tokenVersion: number, firstFactor: 'PASSWORD' | 'MAGIC_LINK' = 'PASSWORD'): string {
    return this.jwt.sign(
      {
        sub: userId,
        typ: MFA_CHALLENGE_TYPE,
        tv: tokenVersion,
        jti: uuidv4(),
        ...(firstFactor === 'MAGIC_LINK' ? { amr: 'MAGIC_LINK' } : {}),
      },
      { expiresIn: MFA_CHALLENGE_TTL_SECONDS }
    );
  }

  /** Verifies a 2FA challenge token (signature, expiry and type). */
  verifyMfaChallenge(token: string): {
    userId: string;
    tokenVersion: number;
    firstFactor: 'PASSWORD' | 'MAGIC_LINK';
  } {
    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('The sign-in challenge expired. Please sign in again.');
    }
    if (payload?.typ !== MFA_CHALLENGE_TYPE || typeof payload.sub !== 'string' || !isUuid(payload.sub)) {
      throw new UnauthorizedException('Invalid sign-in challenge');
    }
    return {
      userId: payload.sub,
      tokenVersion: Number(payload.tv ?? 0),
      firstFactor: payload.amr === 'MAGIC_LINK' ? 'MAGIC_LINK' : 'PASSWORD',
    };
  }
}
