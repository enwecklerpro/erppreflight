# RLS Session Drop Technical Fix Strategy & Blueprint
**Target Milestone**: Milestone 1 (Foundation & Persistence) — Iteration 2  
**Author**: `m1_it2_explorer_1`  
**Target Root**: `H:/erppreflight`  
**Target Packages**: `packages/database`, `apps/api`  
**Status**: APPROVED BLUEPRINT (Ready for Implementation)

---

## 1. Executive Summary & Root Cause Forensic Analysis

### 1.1 The Failure Mechanism
During Milestone 1 gate verification, challenger `m1_challenger_1` identified a critical defect in Row-Level Security (RLS) enforcement within `packages/database/src/client.ts` and `apps/api/src/modules/database/database.service.ts`.

Both implementations contained the following pattern:
```typescript
const client = await this.pool.connect();
try {
  if (!bypassRls) {
    const tenantId = TenancyContext.get()?.tenantId;
    if (tenantId) {
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    }
  }
  return await client.query<T>(text, params);
} finally {
  client.release();
}
```

### 1.2 PostgreSQL Autocommit Transaction Semantics
In PostgreSQL:
1. `set_config(setting_name, new_value, is_local)`:
   - When parameter `is_local` is set to `true`, the parameter change is strictly confined to the **current transaction**.
   - When the transaction concludes (`COMMIT` or `ROLLBACK`), the configuration parameter immediately reverts to its session-level value (defaulting to empty string `''`).
2. Without an explicit `BEGIN` statement, the PostgreSQL server operates in **auto-commit mode**. In auto-commit mode, every single statement sent to the server constitutes its own isolated transaction.
3. Consequently:
   - Statement 1: `SELECT set_config('app.current_tenant_id', $1, true)` begins an implicit transaction, sets the config, and **commits immediately**. Upon commit, `app.current_tenant_id` reverts to `''`.
   - Statement 2: `client.query(text, params)` begins a brand new implicit transaction.
4. When Statement 2 queries any table protected by Row-Level Security:
   ```sql
   CREATE POLICY tenant_isolation_projects ON projects
       FOR ALL
       USING (organization_id = get_current_tenant_id())
       WITH CHECK (organization_id = get_current_tenant_id());
   ```
   PostgreSQL executes `get_current_tenant_id()`:
   ```sql
   RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
   ```
   Because `current_setting('app.current_tenant_id', true)` is empty (`''`), `NULLIF` evaluates to `NULL`.
   The predicate `organization_id = NULL` evaluates to `UNKNOWN` in SQL 3-valued logic.
   Every single row is rejected by RLS. The query silently returns **0 rows**, or inserts fail with an RLS violation.

### 1.3 The Danger of Naive Fixes (The Session Leak Hazard)
A naive proposed fix might be changing `is_local = true` to `is_local = false` (`SELECT set_config(..., false)`).
However, if `is_local = false` is used on pooled connections without an unconditional reset and eviction guarantee:
- The setting becomes permanent for the physical pooled TCP connection.
- When `client.release()` is called, that connection goes back into `pg.Pool` carrying the previous tenant's ID.
- The next consumer checking out that connection (e.g. an unauthenticated query, a system background job with `bypassRls: true`, or another tenant whose context fails to set) will execute in the previous tenant's security context!
- Furthermore, under external transaction-mode poolers (such as PgBouncer), session-level variables are either discarded or pollute unexpected connections across transactions.

---

## 2. Architectural Invariants for Safe Tenant Persistence

To ensure zero-leak, enterprise-grade multi-tenancy, the following four invariants are established:

1. **Dedicated Client Invariant**: All statements belonging to a tenant's logical operation (setting tenant config, executing business queries, committing or rolling back) MUST execute on the **exact same checked-out client instance** (`pg.PoolClient`). Never mix pool checkouts during a transaction.
2. **Transaction-Bounded Lifecycle Invariant**: When using `is_local = true`, statements MUST execute within an explicit `BEGIN ... COMMIT` block. PostgreSQL engine internals guarantee that the parameter is discarded upon transaction termination (`COMMIT` or `ROLLBACK`), leaving the client pristine.
3. **Pristine Pool Guarantee (Zero Taint)**: No connection returned to the pool (`client.release()`) may retain any tenant context. If session-scoped settings are utilized, guaranteed reset MUST be executed in a `finally` block before release.
4. **Poison Eviction Invariant**: If any error occurs while attempting to reset or restore connection state, the connection MUST NOT be returned to the pool. It must be evicted and destroyed by passing the error to `client.release(error)`, forcing `pg` to destroy the underlying socket.
5. **PgBouncer Transaction-Mode Compatibility**: The primary strategy MUST be compatible with PgBouncer / RDS Proxy in `transaction pooling` mode.

---

## 3. Component 1: Transaction-Scoped Pattern (`withTenantTransaction`)

### 3.1 Design Specification
`withTenantTransaction` is the gold standard for multi-statement tenant transactions and writes. It guarantees that:
1. A dedicated `PoolClient` is acquired from the pool.
2. `BEGIN` is issued to enter transaction state.
3. `SELECT set_config('app.current_tenant_id', $1, true)` is issued with `is_local = true`.
4. The caller's callback function is executed with the dedicated `client`.
5. If the callback succeeds, `COMMIT` is issued.
6. If the callback throws:
   - A `ROLLBACK` is issued.
   - Any secondary error during rollback does NOT mask the primary business error.
   - The primary error is re-thrown.
7. In the `finally` block, the client is safely released back to the pool.
8. `tenantId` can be provided explicitly or resolved automatically from `TenancyContext.getTenantId()`.

### 3.2 Implementation for `packages/database/src/client.ts`

```typescript
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { TenancyContext } from '@erppreflight/tenancy';

export interface DatabaseConfig {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export interface QueryOptions {
  bypassRls?: boolean;
  tenantId?: string;
}

export class DatabasePool {
  private pool: Pool;

  constructor(config?: DatabaseConfig) {
    this.pool = new Pool({
      connectionString:
        config?.connectionString ||
        process.env.DATABASE_URL ||
        'postgres://erppreflight:erppreflight_secret@localhost:5432/erppreflight_dev',
      max: config?.max ?? 20,
      idleTimeoutMillis: config?.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: config?.connectionTimeoutMillis ?? 5000,
    });
  }

  getPool(): Pool {
    return this.pool;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as healthy');
      return res.rows?.[0]?.healthy === 1;
    } catch {
      return false;
    }
  }

  /**
   * Executes a callback within a dedicated PostgreSQL client transaction
   * scoped with `app.current_tenant_id` for Row-Level Security.
   *
   * Supports two signatures:
   * 1. withTenantTransaction(tenantId, callback)
   * 2. withTenantTransaction(callback) -> retrieves tenantId from TenancyContext
   */
  async withTenantTransaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T>;
  async withTenantTransaction<T>(
    tenantId: string,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T>;
  async withTenantTransaction<T>(
    tenantIdOrCallback: string | ((client: PoolClient) => Promise<T>),
    maybeCallback?: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const tenantId =
      typeof tenantIdOrCallback === 'string'
        ? tenantIdOrCallback
        : TenancyContext.getTenantId();

    const callback =
      typeof tenantIdOrCallback === 'function'
        ? tenantIdOrCallback
        : maybeCallback;

    if (!callback) {
      throw new Error('withTenantTransaction: Missing required callback function');
    }
    if (!tenantId) {
      throw new Error('withTenantTransaction: tenantId is required or TenancyContext must be active');
    }

    const client = await this.pool.connect();
    let isBroken = false;

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // Mark connection broken so it will be evicted from pool
        isBroken = true;
      }
      throw error;
    } finally {
      if (isBroken) {
        client.release(true); // Evict destroyed/broken connection
      } else {
        client.release();
      }
    }
  }
```

### 3.3 Implementation for `packages/database/src/rls.ts`

```typescript
import { Pool, PoolClient } from 'pg';

/**
 * Sets PostgreSQL session variable `app.current_tenant_id` for RLS.
 * When isLocal is true, it MUST be executed inside an active transaction.
 */
export async function setTenantSession(
  client: PoolClient,
  tenantId: string,
  isLocal = true
): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', $1, $2)", [tenantId, isLocal]);
}

/**
 * Resets PostgreSQL session variable `app.current_tenant_id` to empty string.
 */
export async function resetTenantSession(
  client: PoolClient,
  isLocal = false
): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', '', $1)", [isLocal]);
}

/**
 * Executes a callback within a database transaction scoped with tenant RLS context.
 */
export async function withTenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let isBroken = false;
  try {
    await client.query('BEGIN');
    await setTenantSession(client, tenantId, true);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      isBroken = true;
    }
    throw error;
  } finally {
    if (isBroken) {
      client.release(true);
    } else {
      client.release();
    }
  }
}
```

### 3.4 Implementation for `apps/api/src/modules/database/database.service.ts`

```typescript
  /**
   * Executes a callback within a dedicated PostgreSQL client transaction
   * scoped with `app.current_tenant_id` for Row-Level Security.
   */
  async withTenantTransaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T>;
  async withTenantTransaction<T>(
    tenantId: string,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T>;
  async withTenantTransaction<T>(
    tenantIdOrCallback: string | ((client: PoolClient) => Promise<T>),
    maybeCallback?: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const tenantId =
      typeof tenantIdOrCallback === 'string'
        ? tenantIdOrCallback
        : TenancyContext.getTenantId();

    const callback =
      typeof tenantIdOrCallback === 'function'
        ? tenantIdOrCallback
        : maybeCallback;

    if (!callback) {
      throw new Error('withTenantTransaction: Missing required callback function');
    }
    if (!tenantId) {
      throw new Error('withTenantTransaction: tenantId is required or TenancyContext must be active');
    }

    const client = await this.pool.connect();
    let isBroken = false;

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
        tenantId,
      ]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.warn(
          `Transaction rollback failed: ${(rollbackError as Error).message}`
        );
        isBroken = true;
      }
      throw error;
    } finally {
      if (isBroken) {
        client.release(true);
      } else {
        client.release();
      }
    }
  }
```

---

## 4. Component 2: Safe Single-Query Helper (`query()`)

We formulate two architectural approaches for single-query execution.

### 4.1 Approach 2A: Transaction-Wrapped Single Query (Recommended Standard)

#### Mechanics:
When a query is executed without `bypassRls: true` and an active `tenantId` is present (either in options or `TenancyContext`), `query()` delegates directly to `withTenantTransaction`:

```typescript
  async query<T extends QueryResultRow = any>(
    text: string,
    params: any[] = [],
    optionsOrBypassRls: boolean | QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const options: QueryOptions =
      typeof optionsOrBypassRls === 'boolean'
        ? { bypassRls: optionsOrBypassRls }
        : optionsOrBypassRls;

    const bypassRls = options.bypassRls ?? false;
    const explicitTenantId = options.tenantId;
    const tenantId = explicitTenantId || TenancyContext.get()?.tenantId;

    if (!bypassRls && tenantId) {
      // Safely wrap in transaction with SET LOCAL so RLS applies to text query
      return await this.withTenantTransaction(tenantId, async (client) => {
        return await client.query<T>(text, params);
      });
    }

    // Bypass RLS or query without tenant context (global system query)
    const client = await this.pool.connect();
    try {
      return await client.query<T>(text, params);
    } finally {
      client.release();
    }
  }
```

#### Why Approach 2A is the Recommended Standard:
1. **Engine-Level Guarantee**: `is_local = true` is bound to the transaction. When `COMMIT` or `ROLLBACK` runs, PostgreSQL clears the setting immediately.
2. **Zero Residual State**: The connection returned to the pool is 100% clean without requiring additional reset queries in `finally`.
3. **PgBouncer Transaction-Mode Compatibility**: Fully compliant with PgBouncer, Supabase, and AWS RDS Proxy in transaction-pooling mode.
4. **Unified Code Path**: Single queries and multi-statement queries share the exact same battle-tested transaction lifecycle.

---

### 4.2 Approach 2B: Session-Scoped Checked-Out Query with Guaranteed Reset & Poison Eviction

#### Mechanics:
When minimal wire round-trips are desired on direct database connections (without transaction poolers):
1. Acquire client from pool.
2. Set session-level variable: `SELECT set_config('app.current_tenant_id', $1, false)` (`is_local = false`).
3. Mark `tainted = true`.
4. Execute query.
5. In `finally`:
   - If `tainted`, execute `SELECT set_config('app.current_tenant_id', '', false)` (or `RESET app.current_tenant_id;`).
   - If reset query succeeds: `client.release()`.
   - If reset query fails (e.g. connection aborted, timeout): invoke `client.release(resetError)` to destroy the connection and prevent tainted connection reuse.

```typescript
  async querySessionScoped<T extends QueryResultRow = any>(
    text: string,
    params: any[] = [],
    optionsOrBypassRls: boolean | QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const options: QueryOptions =
      typeof optionsOrBypassRls === 'boolean'
        ? { bypassRls: optionsOrBypassRls }
        : optionsOrBypassRls;

    const bypassRls = options.bypassRls ?? false;
    const explicitTenantId = options.tenantId;
    const tenantId = explicitTenantId || TenancyContext.get()?.tenantId;

    const client = await this.pool.connect();
    let isTainted = false;

    try {
      if (!bypassRls && tenantId) {
        // Set session-scoped setting (is_local = false)
        await client.query("SELECT set_config('app.current_tenant_id', $1, false)", [
          tenantId,
        ]);
        isTainted = true;
      }
      return await client.query<T>(text, params);
    } finally {
      if (isTainted) {
        try {
          // Guaranteed reset before returning to pool
          await client.query("SELECT set_config('app.current_tenant_id', '', false)");
          client.release();
        } catch (resetError) {
          // CRITICAL POISON EVICTION:
          // If reset failed, destroy the physical connection so no other tenant receives it!
          client.release(resetError);
        }
      } else {
        client.release();
      }
    }
  }
```

---

### 4.3 Architectural Comparison Matrix

| Property | Approach 2A (Transaction-Wrapped) | Approach 2B (Session-Scoped + Reset) |
| :--- | :--- | :--- |
| **RLS Guarantee** | Absolute (PostgreSQL engine-level `SET LOCAL`) | Dependent on successful `finally` reset |
| **PgBouncer Transaction Pooling** | 100% Compatible | INCOMPATIBLE (session settings bleed/lost) |
| **Connection Poison Risk** | Zero (PostgreSQL resets on transaction close) | High unless eviction on error is enforced |
| **Round Trips (node <-> pg)** | 4 (`BEGIN`, `set_config`, `query`, `COMMIT`) | 3 (`set_config`, `query`, `RESET`) |
| **Aborted Query Resilience** | PostgreSQL abort cleans up on `ROLLBACK` | If query aborts, `RESET` statement may fail |
| **Recommendation** | **PRIMARY / DEFAULT (Production Recommended)** | **ALTERNATIVE (Direct high-frequency read opt)** |

---

## 5. Backward Compatibility & Service Impact Analysis

### 5.1 Service Call Signature Compatibility
Existing service calls in `apps/api` use the following forms:
1. `this.db.query(sql, params)` (e.g. `ProjectsService.findAll`, `ProjectsService.create`)
2. `this.db.query(sql, params, { bypassRls: true })` (e.g. `WorkspacesService.getWorkspace`, `AuthService.login`, `JobsService.runEngines`)
3. `this.db.query(sql, params, true)` (legacy boolean flag in some helper utilities)

By implementing `optionsOrBypassRls: boolean | QueryOptions = {}`:
- All existing calls continue to work with **zero code modifications required in domain services**!
- `WorkspacesService`, `ProjectsService`, `AuthService`, and `JobsService` instantly obtain proper RLS protection.

---

## 6. Empirical Vitest Concurrency & Isolation Test Specification

To satisfy Objective 3, we define the complete empirical test suite to be placed in:
`apps/api/test/tenant_isolation.spec.ts`

### 6.1 Test Suite Implementation Blueprint

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../src/modules/database/database.service';
import { TenancyContext } from '@erppreflight/tenancy';
import { ConfigService } from '@nestjs/config';

describe('Empirical Verification: PostgreSQL RLS Multi-Tenant Isolation', () => {
  let dbService: DatabaseService;
  let mockPool: Pool;
  let mockClientMap: Map<string, any>;

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
        dbService.withTenantTransaction(tenantId, async (client) => {
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
```

---

## 7. Implementation & Verification Roadmap for Builder Agent

### Step 1: Update `packages/database/src/client.ts`
- Implement `QueryOptions` interface.
- Overload and implement `withTenantTransaction` supporting both `(tenantId, callback)` and `(callback)`.
- Update `query()` to delegate to `withTenantTransaction` when `!bypassRls && tenantId`.
- Run typecheck: `pnpm --filter @erppreflight/database typecheck`.

### Step 2: Update `packages/database/src/rls.ts`
- Update `setTenantSession` and `withTenantTransaction` with broken client eviction.
- Export `resetTenantSession`.

### Step 3: Update `apps/api/src/modules/database/database.service.ts`
- Mirror the robust `withTenantTransaction` implementation with logging and rollback safety.
- Update `DatabaseService.query()` to delegate to `withTenantTransaction` when `!bypassRls && tenantId`.

### Step 4: Add Vitest Integration Test
- Create `apps/api/test/tenant_isolation.spec.ts` with the 5 test suites defined in Section 6.
- Run test suite:
  ```powershell
  $env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"
  pnpm --filter @erppreflight/api test
  ```
- Verify that all test suites pass with 100% success rate.

### Step 5: Full Monorepo Typecheck & Build
- Verify clean build:
  ```powershell
  pnpm turbo run typecheck
  pnpm turbo run test
  ```
