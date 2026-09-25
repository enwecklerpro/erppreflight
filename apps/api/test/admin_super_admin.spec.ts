import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminService } from '../src/modules/admin/admin.service';
import { AdminController } from '../src/modules/admin/admin.controller';
import { SuperAdminGuard } from '../src/modules/admin/guards/super-admin.guard';
import { UnauthorizedException, ForbiddenException, ExecutionContext } from '@nestjs/common';

describe('Super Admin Module & Security Guard Suite', () => {
  let adminService: AdminService;
  let adminController: AdminController;
  let mockDb: any;
  let mockConfig: any;
  let mockQueue: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    mockConfig = {
      get: vi.fn().mockImplementation((key, def) => def),
    };
    mockQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, active: 1, completed: 50, failed: 0 }),
      isPaused: vi.fn().mockResolvedValue(false),
    };

    adminService = new AdminService(mockDb as any, mockConfig as any, mockQueue as any);
    adminController = new AdminController(adminService);
  });

  describe('SuperAdminGuard', () => {
    const guard = new SuperAdminGuard();

    const createMockContext = (user?: any): ExecutionContext => ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as any);

    it('rejects unauthenticated requests with UnauthorizedException', () => {
      const ctx = createMockContext(undefined);
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('rejects regular USER with ForbiddenException', () => {
      const ctx = createMockContext({ id: 'u1', systemRole: 'USER' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects tenant-level ADMIN without global SUPER_ADMIN role', () => {
      const ctx = createMockContext({ id: 'u2', systemRole: 'ADMIN' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('allows authenticated SUPER_ADMIN user', () => {
      const ctx = createMockContext({ id: 'u3', systemRole: 'SUPER_ADMIN' });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('AdminService.getOverview', () => {
    it('aggregates system-wide counts and reports healthy statuses', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ count: 12 }] }) // totalTenants
        .mockResolvedValueOnce({ rows: [{ count: 45 }] }) // totalUsers
        .mockResolvedValueOnce({ rows: [{ count: 18 }] }) // totalProjects
        .mockResolvedValueOnce({ rows: [{ count: 32 }] }) // totalAnalyses
        .mockResolvedValueOnce({ rows: [{ count: 100 }] }) // totalFindings
        .mockResolvedValueOnce({ rows: [{ count: 4 }] }) // blockersAndCritical
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // SELECT 1

      const overview = await adminService.getOverview();
      expect(overview.totalTenants).toBe(12);
      expect(overview.totalUsers).toBe(45);
      expect(overview.totalProjects).toBe(18);
      expect(overview.totalAnalyses).toBe(32);
      expect(overview.totalFindings).toBe(100);
      expect(overview.blockersAndCritical).toBe(4);
      expect(overview.systemHealth.database).toBe('HEALTHY');
      expect(overview.systemHealth.redisQueue).toBe('HEALTHY');
    });
  });

  describe('AdminService.getTenants', () => {
    it('returns tenant list with user and project counts', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'org-1',
            name: 'Acme Corp',
            slug: 'acme-corp',
            planTier: 'ENTERPRISE',
            status: 'ACTIVE',
            userCount: 5,
            projectCount: 3,
            analysisCount: 8,
          },
        ],
      });

      const tenants = await adminService.getTenants();
      expect(tenants).toHaveLength(1);
      expect(tenants[0].slug).toBe('acme-corp');
      expect(tenants[0].planTier).toBe('ENTERPRISE');
    });
  });

  describe('AdminService.getUsers', () => {
    it('returns users list with system roles and organization memberships', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'u-1',
            email: 'contact@erppreflight.com',
            fullName: 'ERP Preflight Super Admin',
            systemRole: 'SUPER_ADMIN',
            status: 'ACTIVE',
            organizations: [{ organizationId: 'org-1', organizationName: 'ERP Preflight Global', role: 'ORGANIZATION_OWNER' }],
          },
        ],
      });

      const users = await adminService.getUsers();
      expect(users).toHaveLength(1);
      expect(users[0].systemRole).toBe('SUPER_ADMIN');
      expect(users[0].email).toBe('contact@erppreflight.com');
    });
  });

  describe('AdminService.updateUserRole', () => {
    it('updates system role of user', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'u-target',
            email: 'auditor@example.com',
            fullName: 'Security Auditor',
            systemRole: 'ADMIN',
            status: 'ACTIVE',
          },
        ],
      });

      const updated = await adminService.updateUserRole('u-target', 'ADMIN');
      expect(updated.systemRole).toBe('ADMIN');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        ['ADMIN', 'u-target'],
        { bypassRls: true }
      );
    });
  });

  describe('AdminService.getQueueStats', () => {
    it('returns BullMQ queue counts', async () => {
      const stats = await adminService.getQueueStats();
      expect(stats.queueName).toBe('analysis-queue');
      expect(stats.status).toBe('ACTIVE');
      expect(stats.counts.waiting).toBe(2);
      expect(stats.counts.completed).toBe(50);
    });
  });
});
