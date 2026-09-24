import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          email: 'test@example.com',
          full_name: 'Test User',
          system_role: 'USER',
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
