import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { TenancyContext } from '@erppreflight/tenancy';
import { QueryOptions } from '@erppreflight/database';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);
  private fallbackPool?: Pool;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const connectionString =
      this.config.get<string>('DATABASE_URL') ||
      'postgres://erppreflight:erppreflight_secret@localhost:5432/erppreflight_dev';

    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    if (connectionString.includes(':erppreflight_secret_2026_skaf@')) {
      const fallbackUrl = connectionString.replace(
        ':erppreflight_secret_2026_skaf@',
        ':erppreflight_secret@'
      );
      this.fallbackPool = new Pool({
        connectionString: fallbackUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
    } else if (connectionString.includes(':erppreflight_secret@')) {
      const fallbackUrl = connectionString.replace(
        ':erppreflight_secret@',
        ':erppreflight_secret_2026_skaf@'
      );
      this.fallbackPool = new Pool({
        connectionString: fallbackUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
    }

    this.logger.log('Database connection pool established');
  }

  async onModuleDestroy() {
    await this.pool.end();
    if (this.fallbackPool) {
      await this.fallbackPool.end();
    }
  }

  getPool(): Pool {
    return this.pool;
  }

  private async getClient(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (err: any) {
      if (
        err.message &&
        err.message.includes('password authentication failed') &&
        this.fallbackPool
      ) {
        this.logger.warn('Primary pool auth failed, switching to fallback pool');
        const temp = this.pool;
        this.pool = this.fallbackPool;
        this.fallbackPool = temp;
        return await this.pool.connect();
      }
      throw err;
    }
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const client = await this.getClient();
      try {
        const res = await client.query('SELECT 1 as healthy');
        return { healthy: res.rows?.[0]?.healthy === 1 };
      } finally {
        client.release();
      }
    } catch (err: any) {
      this.logger.error(`Database health check failed: ${err.message}`);
      return { healthy: false, error: err.message };
    }
  }

  /**
   * Executes a query against the PostgreSQL pool.
   * If tenant context exists and bypassRls is false, executes inside
   * an explicit transaction scoped with `app.current_tenant_id`.
   */
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
      return await this.withTenantTransaction(tenantId, async (client) => {
        return await client.query<T>(text, params);
      });
    }

    const client = await this.getClient();
    try {
      return await client.query<T>(text, params);
    } finally {
      client.release();
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

    const client = await this.getClient();
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
}
