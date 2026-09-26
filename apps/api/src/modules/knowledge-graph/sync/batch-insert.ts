import type { PoolClient } from 'pg';

export interface BatchColumn {
  name: string;
  /** Element type of the unnest array (text, uuid, bigint, boolean). */
  arrayType: 'text' | 'uuid' | 'bigint' | 'boolean';
  /** Optional cast applied in the SELECT list, e.g. 'jsonb'. */
  cast?: string;
}

/**
 * High-throughput bulk insert: each batch is ONE statement that unnests
 * column arrays (`INSERT ... SELECT ... FROM unnest($1::text[], $2::uuid[], ...)`).
 * This avoids the 65k bind-parameter limit of multi-row VALUES and is within a
 * small factor of COPY for the ~100k-500k rows a knowledge sync writes.
 */
export async function batchInsert(
  client: PoolClient,
  table: string,
  columns: BatchColumn[],
  rows: unknown[][],
  batchSize = 5000
): Promise<number> {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table identifier: ${table}`);
  }
  for (const c of columns) {
    if (!/^[a-z_][a-z0-9_]*$/.test(c.name) || (c.cast && !/^[a-z_]+$/.test(c.cast))) {
      throw new Error(`Invalid column definition: ${c.name}`);
    }
  }
  const colList = columns.map((c) => c.name).join(', ');
  const aliasList = columns.map((_, i) => `c${i}`).join(', ');
  const unnestArgs = columns.map((c, i) => `$${i + 1}::${c.arrayType}[]`).join(', ');
  const selectList = columns.map((c, i) => (c.cast ? `c${i}::${c.cast}` : `c${i}`)).join(', ');
  const sql = `INSERT INTO ${table} (${colList}) SELECT ${selectList} FROM unnest(${unnestArgs}) AS t(${aliasList})`;

  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const slice = rows.slice(offset, offset + batchSize);
    const arrays = columns.map((_, i) => slice.map((r) => (r[i] === undefined ? null : r[i])));
    const res = await client.query(sql, arrays);
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}
