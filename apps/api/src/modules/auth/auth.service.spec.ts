import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database/database.service';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';
import { SessionService } from './session.service';

describe('AuthService', () => {
  let service: AuthService;
  let mockDb: Partial<DatabaseService>;
  let mockJwt: Partial<JwtService>;
  let mockVerification: { issueSafely: ReturnType<typeof vi.fn> };
  let mockSessions: { create: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    mockJwt = {
      sign: vi.fn().mockReturnValue('mock-jwt-token'),
    };
    mockVerification = { issueSafely: vi.fn().mockResolvedValue(undefined) };
    mockSessions = { create: vi.fn().mockResolvedValue(undefined) };
    (mockJwt as any).decode = vi.fn().mockReturnValue({ exp: 2_000_000_000 });
    service = new AuthService(
      mockDb as DatabaseService,
      mockJwt as JwtService,
      mockVerification as unknown as EmailVerificationService,
      mockSessions as unknown as SessionService
    );
  });

  it('should register a new user and organization', async () => {
    mockDb.query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // check existing user
      .mockResolvedValueOnce({ rows: [] }) // insert organization
      .mockResolvedValueOnce({ rows: [] }) // insert user
      .mockResolvedValueOnce({ rows: [] }); // insert membership

    const result = await service.register({
      email: 'test@example.com',
      password: 'Correct-Horse-42',
      fullName: 'Test User',
      organizationName: 'Acme Corp',
    });

    expect(result.accessToken).toBe('mock-jwt-token');
    expect(result.user.email).toBe('test@example.com');
    expect(result.user.role).toBe('ORGANIZATION_OWNER');
    expect(result.user.emailVerified).toBe(false);
    // A verification e-mail is issued for every new account
    expect(mockVerification.issueSafely).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com' })
    );
    // The access token carries token_version 0 and a unique jti
    const payload = (mockJwt.sign as any).mock.calls[0][0];
    expect(payload.tv).toBe(0);
    expect(typeof payload.jti).toBe('string');
    // ...and the jti is registered as a server-side session expiring with the token
    expect(mockSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: payload.jti, authMethod: 'SIGNUP', expiresAt: new Date(2_000_000_000 * 1000) })
    );
  });

  it('should reject sign-up with a password that violates the policy', async () => {
    mockDb.query = vi.fn();
    await expect(
      service.register({ email: 'test@example.com', password: 'password123', organizationName: 'Acme' })
    ).rejects.toThrow(BadRequestException);
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('should return a 2FA challenge instead of a session when TOTP is enabled', async () => {
    const passwordHash = await (service as any).hashPassword('password123');
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: 'user-1', password_hash: passwordHash, status: 'ACTIVE', token_version: 3, totp_enabled_at: new Date() }],
    });
    const result: any = await service.login({ email: 'test@example.com', password: 'password123' });
    expect(result.mfaRequired).toBe(true);
    expect(result.challengeToken).toBe('mock-jwt-token');
    expect(result.accessToken).toBeUndefined();
    const [payload, options] = (mockJwt.sign as any).mock.calls[0];
    expect(payload).toMatchObject({ sub: 'user-1', typ: 'mfa_challenge', tv: 3 });
    expect(options).toEqual({ expiresIn: 300 });
    expect(mockDb.query).toHaveBeenCalledTimes(1);
  });

  it('should throw ConflictException if user email already exists', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: 'existing-id' }],
    });

    await expect(
      service.register({
        email: 'test@example.com',
        password: 'Correct-Horse-42',
        organizationName: 'Acme Corp',
      })
    ).rejects.toThrow(ConflictException);
  });

  it('should login an existing user with valid password', async () => {
    const passwordHash = await (service as any).hashPassword('password123');
    // 1st query: credentials lookup, 2nd query: session (membership) lookup
    mockDb.query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'user-1',
          email: 'test@example.com',
          password_hash: passwordHash,
          full_name: 'Test User',
          system_role: 'USER',
          status: 'ACTIVE',
          token_version: 0,
          organization_id: 'org-1',
          role: 'LEAD_ARCHITECT',
        },
      ],
    });

    const result: any = await service.login({
      email: 'test@example.com',
      password: 'password123',
    });

    expect(result.accessToken).toBe('mock-jwt-token');
    expect(result.user.email).toBe('test@example.com');
    expect(result.user.role).toBe('LEAD_ARCHITECT');
  });

  it('should reject legacy unsalted SHA-256 password hashes (no legacy fallback)', async () => {
    const { createHash } = await import('node:crypto');
    const legacySha = createHash('sha256').update('password123').digest('hex');
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 'user-legacy',
          email: 'legacy@example.com',
          password_hash: legacySha,
          full_name: 'Legacy User',
          system_role: 'USER',
          status: 'ACTIVE',
          organization_id: 'org-1',
          role: 'LEAD_ARCHITECT',
        },
      ],
    });

    await expect(
      service.login({ email: 'legacy@example.com', password: 'password123' })
    ).rejects.toThrow(UnauthorizedException);
    // No password rewrite happened
    expect(mockDb.query).toHaveBeenCalledTimes(1);
  });

  it('should not accept a whitespace-trimmed variant of the password', async () => {
    const passwordHash = await (service as any).hashPassword('password123');
    mockDb.query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'user-1',
          email: 'test@example.com',
          password_hash: passwordHash,
          system_role: 'USER',
          status: 'ACTIVE',
          organization_id: 'org-1',
          role: 'VIEWER',
        },
      ],
    });

    await expect(
      service.login({ email: 'test@example.com', password: ' password123 ' })
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should reject login for SUSPENDED users even with the correct password', async () => {
    const passwordHash = await (service as any).hashPassword('password123');
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 'user-s',
          email: 'suspended@example.com',
          password_hash: passwordHash,
          system_role: 'USER',
          status: 'SUSPENDED',
          organization_id: 'org-1',
          role: 'VIEWER',
        },
      ],
    });

    await expect(
      service.login({ email: 'suspended@example.com', password: 'password123' })
    ).rejects.toThrow(UnauthorizedException);
    expect(mockJwt.sign).not.toHaveBeenCalled();
  });

  it('should select the membership deterministically (preferred, else oldest active organization) in SQL', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [] });
    await expect(service.createSession('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      UnauthorizedException
    );
    const sql: string = (mockDb.query as any).mock.calls[0][0];
    expect(sql).toMatch(/ORDER BY \(om\.organization_id = \$2::uuid\) DESC NULLS LAST, om\.created_at ASC/);
    expect(sql).toMatch(/LIMIT 1/);
    expect(sql).toMatch(/o\.status = 'ACTIVE'/);
    // A malformed preferred organization id is ignored (never interpolated)
    await expect(service.createSession('11111111-1111-4111-8111-111111111111', { preferredOrganizationId: "x' OR 1=1" })).rejects.toThrow();
    expect((mockDb.query as any).mock.calls[1][1][1]).toBeNull();
  });

  describe('bootstrapSuperAdmins', () => {
    const envBackup = { ...process.env };
    afterEach(() => {
      process.env = { ...envBackup };
    });

    it('does nothing when ADMIN_BOOTSTRAP_PASSWORD or ADMIN_BOOTSTRAP_EMAIL is missing', async () => {
      delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
      process.env.ADMIN_BOOTSTRAP_EMAIL = 'root@example.com';
      mockDb.query = vi.fn();
      await service.bootstrapSuperAdmins();
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('never modifies an existing account (no password/role/status reset)', async () => {
      process.env.ADMIN_BOOTSTRAP_EMAIL = 'Root@Example.com';
      process.env.ADMIN_BOOTSTRAP_PASSWORD = 'a-very-long-bootstrap-pass';
      mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
      await service.bootstrapSuperAdmins();
      expect(mockDb.query).toHaveBeenCalledTimes(1);
      expect((mockDb.query as any).mock.calls[0][1]).toEqual(['root@example.com']);
      const allSql = (mockDb.query as any).mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(allSql).not.toMatch(/UPDATE users/i);
    });

    it('creates exactly one SUPER_ADMIN when the account does not exist', async () => {
      process.env.ADMIN_BOOTSTRAP_EMAIL = 'root@example.com';
      process.env.ADMIN_BOOTSTRAP_PASSWORD = 'a-very-long-bootstrap-pass';
      mockDb.query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // user lookup
        .mockResolvedValueOnce({ rows: [] }) // org insert
        .mockResolvedValueOnce({ rows: [{ id: 'org-global' }] }) // org select
        .mockResolvedValueOnce({ rows: [{ id: 'new-user' }] }) // user insert
        .mockResolvedValueOnce({ rows: [] }); // membership insert
      await service.bootstrapSuperAdmins();
      const calls = (mockDb.query as any).mock.calls;
      const userInserts = calls.filter((c: any[]) => /INSERT INTO users/.test(c[0]));
      expect(userInserts).toHaveLength(1);
      expect(userInserts[0][0]).toMatch(/'SUPER_ADMIN'/);
      expect(userInserts[0][1][1]).toBe('root@example.com');
      expect(userInserts[0][1][2]).toMatch(/^\$argon2id\$/);
      const allSql = calls.map((c: any[]) => c[0]).join('\n');
      expect(allSql).not.toMatch(/demo|acme/i);
      expect(allSql).not.toMatch(/UPDATE users/i);
    });

    it('refuses short bootstrap passwords', async () => {
      process.env.ADMIN_BOOTSTRAP_EMAIL = 'root@example.com';
      process.env.ADMIN_BOOTSTRAP_PASSWORD = 'short';
      mockDb.query = vi.fn();
      await service.bootstrapSuperAdmins();
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });

  it('should generate distinct salt and hash for the same password', async () => {
    const hash1 = await (service as any).hashPassword('password123');
    const hash2 = await (service as any).hashPassword('password123');
    expect(hash1).not.toBe(hash2);
    expect(hash1).toMatch(/^\$argon2id\$/);
    expect(hash2).toMatch(/^\$argon2id\$/);
  });

  it('should throw UnauthorizedException on invalid credentials', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await expect(
      service.login({
        email: 'test@example.com',
        password: 'wrongpassword',
      })
    ).rejects.toThrow(UnauthorizedException);
  });
});
