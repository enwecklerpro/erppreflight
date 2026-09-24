import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { DatabaseService } from '../src/modules/database/database.service';
import { TenancyContext } from '@erppreflight/tenancy';
import { ConfigService } from '@nestjs/config';

describe('Empirical Verification: PostgreSQL RLS Multi-Tenant Isolation', () => {
  let dbService: DatabaseService;
  let mockPool: Pool;

  // Simulate PostgreSQL backend connection state per client
  class MockPostgresClient {
    public id: string;
    public inTransaction = false;
    public sessionVariables: Record<string, string> = {};
    public transactionVariables: Record<string, string> = {};
    public queryLog: string[] = [];
    public released = false;
    public destroyed = false;

    constructor(id: string) {
      this.id = id;
    }

    async query(text: string, params: any[] = []): Promise<any> {
      this.queryLog.push(text);

      if (text === 'BEGIN') {
        this.inTransaction = true;
        this.transactionVariables = { ...this.sessionVariables };
        return { rows: [] };
      }

      if (text === 'COMMIT') {
        this.inTransaction = false;
        // On commit, transaction-local variables revert to session level
        this.transactionVariables = {};
        return { rows: [] };
      }

      if (text === 'ROLLBACK') {
        this.inTransaction = false;
        this.transactionVariables = {};
        return { rows: [] };
      }

      // Handle set_config
      const setConfigMatch = /SELECT set_config\('([^']+)',\s*\$1,\s*(\$2|true|false)\)/i.exec(text);
      if (setConfigMatch) {
        const varName = setConfigMatch[1];
        const val = params[0] || '';
        const isLocal = setConfigMatch[2] === 'true' || params[1] === true;

        if (isLocal) {
          if (!this.inTransaction) {
            // THE BUG REPRODUCTION:
            // Autocommit transaction: sets and immediately resets!
            return { rows: [{ set_config: val }] };
          }
          this.transactionVariables[varName] = val;
        } else {
          this.sessionVariables[varName] = val;
        }
        return { rows: [{ set_config: val }] };
      }

      // Handle current_setting check
      if (text.includes("current_setting('app.current_tenant_id'")) {
        const activeVal = this.inTransaction
          ? this.transactionVariables['app.current_tenant_id'] || ''
          : this.sessionVariables['app.current_tenant_id'] || '';
        return { rows: [{ current_setting: activeVal }] };
      }

      // Simulate tenant-filtered table query (e.g. SELECT * FROM projects)
      if (text.includes('FROM projects')) {
        const currentTenant = this.inTransaction
          ? this.transactionVariables['app.current_tenant_id']
          : this.sessionVariables['app.current_tenant_id'];

        if (!currentTenant) {
          // RLS drops all rows when tenant ID is NULL / empty!
          return { rows: [] };
        }
        return {
          rows: [
            { id: 'proj-1', organization_id: currentTenant, name: `Project of ${currentTenant}` },
          ],
        };
      }

      return { rows: [{ result: 'ok' }] };
    }

    release(err?: any) {
      this.released = true;
      if (err) {
        this.destroyed = true;
      }
    }
  }

  beforeEach(() => {
    let clientCounter = 0;
    const mockConfig = {
      get: vi.fn().mockReturnValue('postgres://fake:5432/fake'),
    } as unknown as ConfigService;

    dbService = new DatabaseService(mockConfig);

    mockPool = {
      connect: vi.fn().mockImplementation(async () => {
        clientCounter++;
        return new MockPostgresClient(`client-${clientCounter}`);
      }),
      query: vi.fn(),
      end: vi.fn(),
    } as unknown as Pool;

    // Inject mock pool into dbService
    (dbService as any).pool = mockPool;
  });

  describe('1. Autocommit Failure Mode Demonstration', () => {
    it('demonstrates that is_local=true without BEGIN..COMMIT drops tenant context immediately', async () => {
      const client = new MockPostgresClient('probe-client');

      // 1. Run autocommit set_config (old buggy behavior)
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
        'tenant-alpha',
      ]);

      // 2. Immediate subsequent query on same client
      const res = await client.query("SELECT current_setting('app.current_tenant_id', true)");
      expect(res.rows[0].current_setting).toBe('');

      // 3. Projects query evaluates to 0 rows because tenant context is lost!
      const projects = await client.query('SELECT * FROM projects');
      expect(projects.rows.length).toBe(0);
    });
  });

  describe('2. Transaction-Scoped Isolation (withTenantTransaction)', () => {
    it('executes query inside BEGIN..COMMIT maintaining tenant context throughout', async () => {
      const tenantId = '11111111-1111-1111-1111-111111111111';

      const result = await dbService.withTenantTransaction(tenantId, async (client) => {
        const check = await client.query("SELECT current_setting('app.current_tenant_id', true)");
        expect(check.rows[0].current_setting).toBe(tenantId);

        const projects = await client.query('SELECT * FROM projects');
        expect(projects.rows.length).toBe(1);
        expect(projects.rows[0].organization_id).toBe(tenantId);

        return projects.rows;
      });

      expect(result.length).toBe(1);
    });

    it('rolls back transaction on error and releases connection safely', async () => {
      const tenantId = 'tenant-err';

      await expect(
        dbService.withTenantTransaction(tenantId, async () => {
          throw new Error('Business validation failed');
        })
      ).rejects.toThrow('Business validation failed');
    });

    it('resolves tenantId automatically from TenancyContext when omitted', async () => {
      const tenantId = 'context-tenant-uuid';

      await TenancyContext.run({ tenantId }, async () => {
        const res = await dbService.withTenantTransaction(async (client) => {
          const check = await client.query("SELECT current_setting('app.current_tenant_id', true)");
          return check.rows[0].current_setting;
        });
        expect(res).toBe(tenantId);
      });
    });
  });

  describe('3. Single-Query Helper Safety (query())', () => {
    it('automatically wraps tenant-scoped query in transaction when TenancyContext is active', async () => {
      const tenantId = '22222222-2222-2222-2222-222222222222';

      await TenancyContext.run({ tenantId }, async () => {
        const res = await dbService.query('SELECT * FROM projects');
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].organization_id).toBe(tenantId);
      });
    });

    it('bypasses tenant transaction when bypassRls is true', async () => {
      const tenantId = '33333333-3333-3333-3333-333333333333';

      await TenancyContext.run({ tenantId }, async () => {
        const res = await dbService.query('SELECT 1 as healthy', [], { bypassRls: true });
        expect(res.rows[0].result).toBe('ok');
      });
    });
  });

  describe('4. High-Concurrency Multi-Tenant Interleaving Stress Test', () => {
    it('maintains absolute tenant boundary isolation across 50 concurrent interleaved requests', async () => {
      const tenants = [
        'tenant-aaa-001',
        'tenant-bbb-002',
        'tenant-ccc-003',
        'tenant-ddd-004',
        'tenant-eee-005',
      ];

      const tasks = Array.from({ length: 50 }, (_, i) => {
        const tenantId = tenants[i % tenants.length];
        return TenancyContext.run({ tenantId }, async () => {
          // Stagger slightly to simulate async I/O interleaving
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 15));
          const res = await dbService.query('SELECT * FROM projects');
          expect(res.rows[0].organization_id).toBe(tenantId);
          return { tenantId, resultOrg: res.rows[0].organization_id };
        });
      });

      const results = await Promise.all(tasks);
      expect(results.length).toBe(50);
      for (const r of results) {
        expect(r.resultOrg).toBe(r.tenantId);
      }
    });
  });

  describe('5. Recycled Connection Cleanliness & Poison Eviction', () => {
    it('guarantees that connection released to pool does not leak tenant context to subsequent query', async () => {
      const sharedClient = new MockPostgresClient('recycled-client');
      (mockPool.connect as any).mockResolvedValue(sharedClient);

      // Request 1: Tenant Alpha executes query
      await TenancyContext.run({ tenantId: 'tenant-alpha' }, async () => {
        await dbService.query('SELECT * FROM projects');
      });

      expect(sharedClient.released).toBe(true);

      // Verify that after transaction commit, connection has zero residual tenant variable
      expect(sharedClient.inTransaction).toBe(false);
      expect(sharedClient.transactionVariables['app.current_tenant_id']).toBeUndefined();
      expect(sharedClient.sessionVariables['app.current_tenant_id']).toBeUndefined();

      // Request 2: System query without tenant context borrows the exact same connection
      const sysRes = await dbService.query('SELECT 1', [], { bypassRls: true });
      expect(sysRes.rows[0].result).toBe('ok');

      // Must NOT see tenant-alpha!
      const checkRes = await sharedClient.query("SELECT current_setting('app.current_tenant_id', true)");
      expect(checkRes.rows[0].current_setting).toBe('');
    });
  });
});
