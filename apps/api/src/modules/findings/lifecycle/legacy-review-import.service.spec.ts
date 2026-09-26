import { describe, it, expect, vi } from 'vitest';
import { LegacyReviewImportService, mapLegacyReview } from './legacy-review-import.service';

const REVIEWER = '11111111-2222-4333-8444-555555555555';

function fakeLifecycle(lc: Record<string, unknown>) {
  return {
    ensureLifecycle: vi.fn(async () => ({
      finding: { id: 'f-1' },
      lifecycle: { id: 'lc-1', project_id: 'p-1', status: 'OPEN', status_changed_at: null, ...lc },
    })),
  };
}

function fakeClient(opts: { reviewerExists?: boolean; updateMatches?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id FROM users')) return { rows: opts.reviewerExists === false ? [] : [{ id: params[0] }] };
      if (sql.includes('UPDATE finding_lifecycles')) return { rows: opts.updateMatches === false ? [] : [{ id: 'lc-1' }] };
      return { rows: [] };
    }),
  };
  return { client, calls };
}

describe('mapLegacyReview', () => {
  it('maps v0 review statuses onto lifecycle statuses and ignores OPEN / unknown values', () => {
    expect(mapLegacyReview({ status: 'ACCEPTED_RISK' })).toBe('ACCEPTED_RISK');
    expect(mapLegacyReview({ status: 'SUPPRESSED_FALSE_POSITIVE' })).toBe('FALSE_POSITIVE');
    expect(mapLegacyReview({ status: 'VERIFIED' })).toBe('ACKNOWLEDGED');
    expect(mapLegacyReview({ status: 'OPEN' })).toBeNull();
    expect(mapLegacyReview({ status: 'constructor' })).toBeNull();
    expect(mapLegacyReview({ status: 42 })).toBeNull();
    expect(mapLegacyReview(null)).toBeNull();
  });
});

describe('LegacyReviewImportService.importOne', () => {
  it('imports an accepted risk with the original reviewer, time and justification plus a history row', async () => {
    const svc = new LegacyReviewImportService({} as any, fakeLifecycle({}) as any);
    const { client, calls } = fakeClient();
    const done = await svc.importOne(client as any, 'org-1', 'f-1', {
      status: 'ACCEPTED_RISK',
      justification: 'Accepted by CoE board',
      reviewedBy: REVIEWER,
      reviewedAt: '2025-11-03T10:00:00.000Z',
      suppressScope: 'FINDING_ONLY',
    });
    expect(done).toBe(true);
    const upd = calls.find((c) => c.sql.includes('UPDATE finding_lifecycles'))!;
    expect(upd.sql).toContain("status = 'OPEN' AND status_changed_at IS NULL");
    expect(upd.params).toEqual(['lc-1', 'ACCEPTED_RISK', 'Imported from legacy review: Accepted by CoE board', REVIEWER, '2025-11-03T10:00:00.000Z']);
    const hist = calls.find((c) => c.sql.includes('INSERT INTO finding_status_history'))!;
    expect(hist.params.slice(5, 11)).toEqual(['STATUS_CHANGED', 'OPEN', 'ACCEPTED_RISK', 'Imported from legacy review: Accepted by CoE board', REVIEWER, 'USER']);
    expect(JSON.parse(String(hist.params[11]))).toMatchObject({ source: 'legacy-review', legacyStatus: 'ACCEPTED_RISK' });
  });

  it('falls back to a SYSTEM actor when the reviewer no longer exists', async () => {
    const svc = new LegacyReviewImportService({} as any, fakeLifecycle({}) as any);
    const { client, calls } = fakeClient({ reviewerExists: false });
    await svc.importOne(client as any, 'org-1', 'f-1', { status: 'SUPPRESSED_FALSE_POSITIVE', reviewedBy: REVIEWER, reviewedAt: 'not a date' });
    const upd = calls.find((c) => c.sql.includes('UPDATE finding_lifecycles'))!;
    expect(upd.params).toEqual(['lc-1', 'FALSE_POSITIVE', 'Imported from legacy review', null, null]);
    const hist = calls.find((c) => c.sql.includes('INSERT INTO finding_status_history'))!;
    expect(hist.params[10]).toBe('SYSTEM');
  });

  it('only links (never overrides) when the lifecycle was already decided or the review is OPEN', async () => {
    for (const [lc, review] of [
      [{ status: 'RESOLVED', status_changed_at: new Date() }, { status: 'ACCEPTED_RISK' }],
      [{ status: 'OPEN', status_changed_at: new Date() }, { status: 'ACCEPTED_RISK' }],
      [{}, { status: 'OPEN' }],
    ] as const) {
      const life = fakeLifecycle(lc);
      const svc = new LegacyReviewImportService({} as any, life as any);
      const { client, calls } = fakeClient();
      expect(await svc.importOne(client as any, 'org-1', 'f-1', review)).toBe(false);
      expect(life.ensureLifecycle).toHaveBeenCalledOnce();
      expect(calls.some((c) => c.sql.includes('UPDATE finding_lifecycles'))).toBe(false);
    }
  });
});

describe('LegacyReviewImportService.importAll', () => {
  it('visits only unlinked findings with a legacy review, per tenant, and survives a failing row', async () => {
    const rows = [
      { id: 'f-1', organization_id: 'org-a', review: { status: 'ACCEPTED_RISK' } },
      { id: 'f-2', organization_id: 'org-b', review: { status: 'VERIFIED' } },
    ];
    let selects = 0;
    const tenants: string[] = [];
    const db = {
      query: vi.fn(async (sql: string, _params: unknown[], opts: any) => {
        expect(sql).toContain('f.lifecycle_id IS NULL');
        expect(sql).toContain("jsonb_typeof(f.technical_details -> 'review') = 'object'");
        expect(opts).toEqual({ bypassRls: true });
        selects++;
        return { rows: selects === 1 ? rows : [] };
      }),
      withTenantTransaction: vi.fn(async (tenant: string, cb: (c: any) => Promise<unknown>) => {
        tenants.push(tenant);
        if (tenant === 'org-b') throw new Error('boom');
        return cb(fakeClient().client);
      }),
    };
    const svc = new LegacyReviewImportService(db as any, fakeLifecycle({}) as any);
    expect(await svc.importAll()).toEqual({ imported: 1, linked: 1 });
    expect(tenants).toEqual(['org-a', 'org-b']);
  });
});
