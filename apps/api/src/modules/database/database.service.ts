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

/** Default non-privileged runtime role created by migration 010_app_runtime_role.sql */
export const DEFAULT_RUNTIME_ROLE = 'erppreflight_app';

const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const DISABLED_ROLE_VALUES = new Set(['', 'none', 'off', 'false', 'disabled']);

/**
 * Resolves the PostgreSQL role that tenant-scoped transactions switch to with
 * `SET LOCAL ROLE`. Switching to a NOSUPERUSER / NOBYPASSRLS role that does not
 * own the tables makes Row-Level Security apply even if the pool's login user
 * is the table owner or a superuser.
 *
 * - DB_RUNTIME_ROLE unset: enabled with `erppreflight_app` in production, disabled otherwise.
 * - DB_RUNTIME_ROLE=none|off|false|'' : disabled explicitly.
 * - Any other value must be a plain lower-case PostgreSQL identifier.
 */
export function resolveRuntimeRole(
  rawValue: string | undefined | null,
  nodeEnv: string | undefined
): string | null {
  if (rawValue === undefined || rawValue === null) {
    return nodeEnv === 'production' ? DEFAULT_RUNTIME_ROLE : null;
  }
  const value = String(rawValue).trim();
  if (DISABLED_ROLE_VALUES.has(value.toLowerCase())) {
    return null;
  }
  if (!ROLE_NAME_PATTERN.test(value)) {
    throw new Error(
      'DB_RUNTIME_ROLE must be a lower-case PostgreSQL identifier (letters, digits, underscore)'
    );
  }
  return value;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);
  /** Role applied via SET LOCAL ROLE inside tenant transactions (null = disabled). */
  private runtimeRole: string | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const nodeEnv = this.config.get<string>('NODE_ENV') || process.env.NODE_ENV;
    // Runtime queries may use a dedicated, less-privileged login (APP_DATABASE_URL);
    // migrations always run with DATABASE_URL (schema owner).
    const connectionString =
      this.config.get<string>('APP_DATABASE_URL') ||
      this.config.get<string>('DATABASE_URL');

    if (!connectionString) {
      throw new Error('DATABASE_URL (or APP_DATABASE_URL) must be configured');
    }

    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.runtimeRole = resolveRuntimeRole(
      this.config.get<string>('DB_RUNTIME_ROLE') ?? process.env.DB_RUNTIME_ROLE,
      nodeEnv
    );

    if (this.runtimeRole) {
      await this.verifyRuntimeRole(this.runtimeRole);
    } else if (nodeEnv === 'production') {
      this.logger.warn(
        'DB_RUNTIME_ROLE is disabled in production: tenant queries run with the login role and ' +
          'Row-Level Security is NOT enforced if that role is a superuser or table owner.'
      );
    }

    this.logger.log(
      `Database connection pool established (tenant runtime role: ${this.runtimeRole ?? 'disabled'})`
    );
  }

  /**
   * Verifies that the configured runtime role exists, is usable by the login user,
   * and cannot bypass RLS. Misconfiguration is fatal: silently continuing would
   * either break every tenant query or disable tenant isolation.
   */
  private async verifyRuntimeRole(role: string): Promise<void> {
    let row: any;
    try {
      const res = await this.pool.query(
        `SELECT r.rolsuper, r.rolbypassrls, pg_has_role(current_user, r.oid, 'MEMBER') AS is_member
         FROM pg_roles r WHERE r.rolname = $1`,
        [role]
      );
      row = res.rows[0];
    } catch (err: any) {
      // Database unreachable at boot: tenant queries will fail closed on SET ROLE.
      this.logger.warn(`Could not verify DB runtime role '${role}' at startup: ${err.message}`);
      return;
    }

    if (!row) {
      throw new Error(
        `DB runtime role '${role}' does not exist. Apply migration 010_app_runtime_role.sql or set DB_RUNTIME_ROLE=none.`
      );
    }
    if (row.rolsuper || row.rolbypassrls) {
      throw new Error(`DB runtime role '${role}' must be NOSUPERUSER NOBYPASSRLS`);
    }
    if (!row.is_member) {
      throw new Error(
        `Database login user is not a member of runtime role '${role}' (GRANT ${role} TO <login user>)`
      );
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  getPool(): Pool {
    return this.pool;
  }

  /** The role tenant transactions run as, or null when disabled. */
  getRuntimeRole(): string | null {
    return this.runtimeRole;
  }

  private async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
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
   * an explicit transaction scoped with `app.current_tenant_id` (and the
   * non-privileged runtime role, when configured).
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
      if (this.runtimeRole) {
        // Transaction-scoped: reverts automatically at COMMIT/ROLLBACK, so pooled
        // connections never leak the role. Identifier validated by resolveRuntimeRole().
        await client.query(`SET LOCAL ROLE "${this.runtimeRole}"`);
      }
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
