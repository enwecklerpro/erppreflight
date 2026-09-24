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

  async close(): Promise<void> {
    await this.pool.end();
  }
}

let defaultPool: DatabasePool | null = null;

export function getDatabasePool(config?: DatabaseConfig): DatabasePool {
  if (!defaultPool) {
    defaultPool = new DatabasePool(config);
  }
  return defaultPool;
}
