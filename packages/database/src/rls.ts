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
