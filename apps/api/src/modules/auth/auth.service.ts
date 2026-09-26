import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { v4 as uuidv4 } from 'uuid';
import { hash, verify } from '@node-rs/argon2';

const ARGON2ID_ALGORITHM = 2; // Algorithm.Argon2id (RFC 9106 recommended)
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID_ALGORITHM,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
const MIN_BOOTSTRAP_PASSWORD_LENGTH = 12;
const BOOTSTRAP_ORG_SLUG = 'erppreflight-global';
const BOOTSTRAP_ORG_NAME = 'ERP Preflight Global';

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash?: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService
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
        `INSERT INTO users (id, email, password_hash, full_name, system_role, status)
         VALUES ($1, $2, $3, $4, 'SUPER_ADMIN', 'ACTIVE')
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

  private async hashPassword(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /**
   * Verifies a password against an Argon2id hash. The supplied password is used
   * byte-for-byte (no trimming) and non-Argon2 (legacy unsalted) hashes are rejected.
   */
  private async verifyPassword(plain: string, hashed: string): Promise<boolean> {
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
  private async burnPasswordCheck(plain: string): Promise<void> {
    if (!this.dummyHash) {
      this.dummyHash = await this.hashPassword(uuidv4());
    }
    await this.verifyPassword(plain, this.dummyHash);
  }

  async register(dto: RegisterDto) {
    // 1. Check if user already exists
    const existing = await this.db.query(
      'SELECT id FROM users WHERE email = $1',
      [dto.email.toLowerCase()],
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

    // 3. Insert user
    await this.db.query(
      `INSERT INTO users (id, email, password_hash, full_name, system_role, status)
       VALUES ($1, $2, $3, $4, 'USER', 'ACTIVE')`,
      [userId, dto.email.toLowerCase(), passwordHash, dto.fullName || ''],
      { bypassRls: true }
    );

    // 4. Insert membership
    await this.db.query(
      `INSERT INTO organization_members (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, 'ORGANIZATION_OWNER')`,
      [uuidv4(), orgId, userId],
      { bypassRls: true }
    );

    // 5. Sign token
    const token = this.jwt.sign({
      sub: userId,
      email: dto.email.toLowerCase(),
      organizationId: orgId,
      role: 'ORGANIZATION_OWNER',
      systemRole: 'USER',
    });

    return {
      accessToken: token,
      user: {
        id: userId,
        email: dto.email.toLowerCase(),
        fullName: dto.fullName || '',
        organizationId: orgId,
        role: 'ORGANIZATION_OWNER',
      },
    };
  }

  /**
   * Issues the same session JWT as password login for a principal that was
   * authenticated by another mechanism (enterprise SSO, see modules/sso). The
   * user must be ACTIVE and a member of the organization; nothing else about
   * the session differs from a password login.
   */
  async issueSessionForMembership(userId: string, organizationId: string) {
    const res = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.system_role, u.status, m.role
         FROM users u
         JOIN organization_members m ON m.user_id = u.id AND m.organization_id = $2
         JOIN organizations o ON o.id = m.organization_id AND o.status = 'ACTIVE'
        WHERE u.id = $1`,
      [userId, organizationId],
      { bypassRls: true }
    );
    const row = res.rows[0];
    if (!row) {
      throw new UnauthorizedException('User is not a member of this organization');
    }
    if (row.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    const role = row.role || 'VIEWER';
    const token = this.jwt.sign({
      sub: row.id,
      email: row.email,
      organizationId,
      role,
      systemRole: row.system_role,
    });
    return {
      accessToken: token,
      user: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        organizationId,
        role,
        systemRole: row.system_role,
      },
    };
  }

  async login(dto: LoginDto) {
    // Deterministic membership selection: the oldest membership in an ACTIVE organization.
    const userRes = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.password_hash, u.system_role, u.status,
              m.organization_id, m.role
       FROM users u
       LEFT JOIN LATERAL (
         SELECT om.organization_id, om.role
         FROM organization_members om
         JOIN organizations o ON o.id = om.organization_id
         WHERE om.user_id = u.id AND o.status = 'ACTIVE'
         ORDER BY om.created_at ASC, om.organization_id ASC
         LIMIT 1
       ) m ON TRUE
       WHERE u.email = $1`,
      [dto.email.toLowerCase()],
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

    const organizationId = row.organization_id;
    if (!organizationId) {
      throw new UnauthorizedException('User has no active organization assignment');
    }
    const role = row.role || 'VIEWER';

    const token = this.jwt.sign({
      sub: row.id,
      email: row.email,
      organizationId,
      role,
      systemRole: row.system_role,
    });

    return {
      accessToken: token,
      user: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        organizationId,
        role,
        systemRole: row.system_role,
      },
    };
  }
}
