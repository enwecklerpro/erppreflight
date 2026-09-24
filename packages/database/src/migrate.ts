import { Pool, PoolClient } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  success: boolean;
  error?: string;
}

export async function runMigrations(
  databaseUrl?: string,
  migrationsDir?: string
): Promise<MigrationResult> {
  let connectionString = databaseUrl || process.env.DATABASE_URL || 'postgres://erppreflight:erppreflight_secret@localhost:5432/erppreflight_dev';
  let pool = new Pool({ connectionString });
  let client: PoolClient;

  try {
    client = await pool.connect();
  } catch (err: any) {
    if (err.message && err.message.includes('password authentication failed')) {
      const altUrl = connectionString.includes('erppreflight_secret_2026_skaf')
        ? connectionString.replace('erppreflight_secret_2026_skaf', 'erppreflight_secret')
        : connectionString.replace('erppreflight_secret', 'erppreflight_secret_2026_skaf');
      try {
        const altPool = new Pool({ connectionString: altUrl });
        client = await altPool.connect();
        pool = altPool;
      } catch {
        throw err;
      }
    } else {
      throw err;
    }
  }

  const result: MigrationResult = {
    applied: [],
    skipped: [],
    success: true,
  };

  try {
    // 1. Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Fetch applied migrations
    const { rows: appliedRows } = await client.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY id ASC'
    );
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    // 3. Locate migration directory
    const candidates = [
      migrationsDir,
      process.env.MIGRATIONS_DIR,
      path.resolve(__dirname, '../migrations'),
      path.resolve(__dirname, '../../migrations'),
      path.resolve(process.cwd(), 'packages/database/migrations'),
      path.resolve(process.cwd(), '../packages/database/migrations'),
      '/app/packages/database/migrations',
    ].filter(Boolean) as string[];

    const dir = candidates.find((c) => fs.existsSync(c));
    if (!dir) {
      throw new Error(`Migrations directory not found. Checked: ${candidates.join(', ')}`);
    }

    const files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    // 4. Apply each pending migration inside its own transaction
    for (const file of files) {
      if (appliedSet.has(file)) {
        result.skipped.push(file);
        continue;
      }

      const filePath = path.join(dir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (err: any) {
        await client.query('ROLLBACK');
        result.success = false;
        result.error = `Failed to apply migration ${file}: ${err.message}`;
        throw new Error(result.error);
      }
    }

    return result;
  } finally {
    client.release();
    await pool.end();
  }
}
