import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';

/**
 * Runs `fn` in a transaction on the login role (no tenant context). Used for
 * user-global account state (users, user_action_tokens, recovery codes) that is
 * not tenant data. Tenant-owned rows must use DatabaseService.withTenantTransaction.
 */
export async function withGlobalTransaction<T>(
  db: DatabaseService,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.getPool().connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw err;
  } finally {
    client.release(broken);
  }
}
