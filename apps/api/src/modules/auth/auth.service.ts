import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

const ARGON2ID_ALGORITHM = 2; // Algorithm.Argon2id (RFC 9106 recommended)

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService
  ) {}

  private async hashPassword(password: string): Promise<string> {
    return hash(password, {
      algorithm: ARGON2ID_ALGORITHM,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  private async verifyPassword(plain: string, hashed: string): Promise<boolean> {
    if (!hashed) return false;
    if (hashed.startsWith('$argon2')) {
      return verify(hashed, plain);
    }
    // Backward-compatibility fallback: legacy SHA-256 hash check
    const sha = createHash('sha256').update(plain).digest('hex');
    return sha === hashed;
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

  async login(dto: LoginDto) {
    const userRes = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.password_hash, u.system_role, m.organization_id, m.role
       FROM users u
       LEFT JOIN organization_members m ON m.user_id = u.id
       WHERE u.email = $1`,
      [dto.email.toLowerCase()],
      { bypassRls: true }
    );

    if (userRes.rows.length === 0) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const row = userRes.rows[0];
    const isMatch = await this.verifyPassword(dto.password, row.password_hash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Seamlessly rehash legacy passwords to Argon2id on successful login
    if (row.password_hash && !row.password_hash.startsWith('$argon2')) {
      const newHash = await this.hashPassword(dto.password);
      await this.db.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [newHash, row.id],
        { bypassRls: true }
      );
    }

    const organizationId = row.organization_id || uuidv4();
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
