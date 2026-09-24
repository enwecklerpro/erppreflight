import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenancyGuard } from './tenancy.guard';
import { DatabaseService } from '../database/database.service';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenancyContext } from '@erppreflight/tenancy';

describe('TenancyGuard', () => {
  let guard: TenancyGuard;
  let mockDb: Partial<DatabaseService>;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    guard = new TenancyGuard(mockDb as DatabaseService);
  });

  it('should throw ForbiddenException if no tenant context is in store', async () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'user-1' },
        }),
      }),
    } as unknown as ExecutionContext;

    // Run without TenancyContext
    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      ForbiddenException
    );
  });

  it('should allow Super Admin bypass', async () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'super-user', systemRole: 'SUPER_ADMIN' },
        }),
      }),
    } as unknown as ExecutionContext;

    const result = await TenancyContext.run(
      { tenantId: 'tenant-123' },
      () => guard.canActivate(mockContext)
    );

    expect(result).toBe(true);
  });

  it('should allow member of organization', async () => {
    mockDb.query = vi.fn().mockResolvedValue({
      rows: [{ role: 'LEAD_ARCHITECT' }],
    });

    const req: any = {
      user: { id: 'user-1', systemRole: 'USER' },
    };

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;

    const result = await TenancyContext.run(
      { tenantId: 'tenant-123' },
      () => guard.canActivate(mockContext)
    );

    expect(result).toBe(true);
    expect(req.tenantRole).toBe('LEAD_ARCHITECT');
  });
});
