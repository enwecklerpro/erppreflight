import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database/database.service';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let mockDb: Partial<DatabaseService>;
  let mockJwt: Partial<JwtService>;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    mockJwt = {
      sign: vi.fn().mockReturnValue('mock-jwt-token'),
    };
    service = new AuthService(
      mockDb as DatabaseService,
      mockJwt as JwtService
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
      password: 'password123',
      fullName: 'Test User',
      organizationName: 'Acme Corp',
    });

    expect(result.accessToken).toBe('mock-jwt-token');
    expect(result.user.email).toBe('test@example.com');
    expect(result.user.role).toBe('ORGANIZATION_OWNER');
  });

  it('should throw ConflictException if user email already exists', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: 'existing-id' }],
    });

    await expect(
      service.register({
        email: 'test@example.com',
        password: 'password123',
        organizationName: 'Acme Corp',
      })
    ).rejects.toThrow(ConflictException);
  });

  it('should login an existing user with valid password', async () => {
    const passwordHash = await (service as any).hashPassword('password123');
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          email: 'test@example.com',
          password_hash: passwordHash,
          full_name: 'Test User',
          system_role: 'USER',
          status: 'ACTIVE',
          organization_id: 'org-1',
          role: 'LEAD_ARCHITECT',
        },
      ],
    });

    const result = await service.login({
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

  it('should select the membership deterministically (oldest, active organization) in SQL', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [] });
    await expect(
      service.login({ email: 'x@example.com', password: 'whatever-pass' })
    ).rejects.toThrow(UnauthorizedException);
    const sql: string = (mockDb.query as any).mock.calls[0][0];
    expect(sql).toMatch(/ORDER BY om\.created_at ASC/);
    expect(sql).toMatch(/LIMIT 1/);
    expect(sql).toMatch(/o\.status = 'ACTIVE'/);
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
