import { describe, it, expect, vi } from 'vitest';
import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { FindingLifecycleService } from './finding-lifecycle.service';

const LC = {
  id: 'lc-1',
  project_id: 'p-1',
  status: 'OPEN',
  revision: 3,
  last_object_hash: 'a'.repeat(64),
  last_target_release: 'S4H_2023',
  latest_finding_id: 'f-1',
};

/** Fake tenant transaction client answering the lifecycle queries by SQL shape. */
function fakeDb(lcOverrides: Record<string, unknown> = {}, memberExists = true) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM findings f') && sql.includes('LEFT JOIN analyses')) {
        return { rows: [{ id: 'f-1', project_id: 'p-1', engine: 'OPD_GUARD', rule_id: 'R', lifecycle_id: 'lc-1', affected_objects: [] }] };
      }
      if (sql.includes('FROM finding_lifecycles WHERE id = $1')) return { rows: [{ ...LC, ...lcOverrides }] };
      if (sql.includes('FROM organization_members')) return { rows: memberExists ? [{ '?column?': 1 }] : [] };
      if (sql.includes('FROM finding_lifecycles l')) return { rows: [{ ...LC, ...lcOverrides }] };
      return { rows: [] };
    }),
  };
  const db = {
    withTenantTransaction: vi.fn(async (_t: string, cb: (c: any) => Promise<unknown>) => cb(client)),
  };
  return { db, calls };
}

const owner = { id: 'u-1', role: 'ORGANIZATION_OWNER' };

describe('FindingLifecycleService', () => {
  it('denies risk acceptance to roles outside the governance set', async () => {
    const { db } = fakeDb();
    const svc = new FindingLifecycleService(db as any);
    await expect(
      svc.transition('org', { id: 'u', role: 'MIGRATION_CONSULTANT' }, 'f-1', { status: 'ACCEPTED_RISK', reason: 'long enough reason' })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.transition('org', { id: 'u', role: 'VIEWER' }, 'f-1', { status: 'ACKNOWLEDGED' })).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(db.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('rejects stale revisions and invalid transitions with 409', async () => {
    const { db } = fakeDb();
    const svc = new FindingLifecycleService(db as any);
    await expect(svc.transition('org', owner, 'f-1', { status: 'ACKNOWLEDGED', expectedRevision: 2 })).rejects.toBeInstanceOf(
      ConflictException
    );
    const { db: db2 } = fakeDb({ status: 'FALSE_POSITIVE' });
    await expect(
      new FindingLifecycleService(db2 as any).transition('org', owner, 'f-1', { status: 'RESOLVED' })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records the transition, the suppression scope and an append-only history row', async () => {
    const { db, calls } = fakeDb();
    const svc = new FindingLifecycleService(db as any);
    await svc.transition('org', owner, 'f-1', {
      status: 'SUPPRESSED',
      reason: 'Tracked in CR-4711 until object change',
      suppression: { mode: 'UNTIL_OBJECT_CHANGE' },
      expectedRevision: 3,
    });
    const update = calls.find((c) => c.sql.includes('UPDATE finding_lifecycles SET') && c.sql.includes('suppression_mode = $5'));
    expect(update?.params).toEqual(['lc-1', 'SUPPRESSED', 'Tracked in CR-4711 until object change', 'u-1', 'UNTIL_OBJECT_CHANGE', null, null, 'a'.repeat(64)]);
    const history = calls.find((c) => c.sql.includes('INSERT INTO finding_status_history'));
    expect(history?.params.slice(5, 8)).toEqual(['STATUS_CHANGED', 'OPEN', 'SUPPRESSED']);
  });

  it('only assigns organization members', async () => {
    const { db } = fakeDb({}, false);
    await expect(
      new FindingLifecycleService(db as any).assign('org', owner, 'f-1', { assigneeId: '11111111-1111-4111-8111-111111111111' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bulk acknowledge reports per-finding failures instead of aborting', async () => {
    const { db } = fakeDb({ status: 'RESOLVED' });
    const res = await new FindingLifecycleService(db as any).bulk('org', owner, { findingIds: ['f-1'], action: 'ACKNOWLEDGE' });
    expect(res).toMatchObject({ requested: 1, succeeded: 0, failed: 1 });
  });
});
