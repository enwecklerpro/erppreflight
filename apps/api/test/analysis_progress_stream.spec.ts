import { describe, it, expect, vi, afterEach } from 'vitest';
import { firstValueFrom, toArray } from 'rxjs';
import { NotFoundException } from '@nestjs/common';
import { AnalysesService } from '../src/modules/analyses/analyses.service';
import { formatSse } from '../src/modules/analyses/analyses.controller';
import { ReportsHubService } from '../src/modules/export/reports-hub.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const ANA = '22222222-2222-4222-8222-222222222222';

function progressDb(opts: { found?: boolean; statuses: string[]; events: any[][] }) {
  let statusIdx = 0;
  let eventIdx = 0;
  const queries: any[] = [];
  const db: any = {
    query: vi.fn(async (sql: string, params: any[], options: any) => {
      queries.push({ sql, params, options });
      if (sql.includes('FROM analysis_progress_events')) {
        return { rows: opts.events[Math.min(eventIdx++, opts.events.length - 1)] ?? [] };
      }
      if (sql.includes('FROM analyses')) {
        if (opts.found === false) return { rows: [] };
        const status = opts.statuses[Math.min(statusIdx++, opts.statuses.length - 1)];
        return { rows: [{ id: ANA, status, kind: 'STANDARD', progress: {}, current_stage: null }] };
      }
      return { rows: [] };
    }),
  };
  return { db, queries };
}

describe('Analysis progress stream', () => {
  const original = AnalysesService.SSE_POLL_MS;
  afterEach(() => {
    AnalysesService.SSE_POLL_MS = original;
  });

  it('rejects a foreign / unknown analysis before streaming (tenant-scoped query)', async () => {
    const { db, queries } = progressDb({ found: false, statuses: [], events: [] });
    const svc = new AnalysesService(db, {} as any);
    await expect(svc.streamProgress(ORG, ANA)).rejects.toBeInstanceOf(NotFoundException);
    expect(queries[0].params).toEqual([ORG, ANA]);
    expect(queries[0].options).toEqual({ tenantId: ORG });
  });

  it('streams stage events with ids, snapshots, and ends at a terminal status', async () => {
    AnalysesService.SSE_POLL_MS = 1;
    const ev = (id: number, stage: string, status: string) => ({ id, analysis_id: ANA, stage, status, detail: {}, created_at: new Date('2026-01-01T00:00:00Z') });
    const { db } = progressDb({
      statuses: ['RUNNING', 'RUNNING', 'RUNNING', 'COMPLETED', 'COMPLETED'],
      events: [[ev(1, 'PARSING', 'STARTED')], [ev(2, 'FINALIZING', 'COMPLETED')], []],
    });
    const svc = new AnalysesService(db, {} as any);
    const stream = await svc.streamProgress(ORG, ANA, '0');
    const msgs = await firstValueFrom(stream.pipe(toArray()));
    const types = msgs.map((m) => m.type);
    expect(types.filter((t) => t === 'stage')).toHaveLength(2);
    expect(types[types.length - 1]).toBe('end');
    expect(msgs.find((m) => m.type === 'end')?.id).toBe('2');
    expect(formatSse(msgs[0])).toBe(`id: 1\nevent: stage\ndata: ${JSON.stringify(msgs[0].data)}\n\n`);
  });

  it('resumes after Last-Event-ID', async () => {
    AnalysesService.SSE_POLL_MS = 1;
    const { db, queries } = progressDb({ statuses: ['COMPLETED'], events: [[]] });
    const svc = new AnalysesService(db, {} as any);
    await firstValueFrom((await svc.streamProgress(ORG, ANA, '41')).pipe(toArray()));
    const evQuery = queries.find((q) => q.sql.includes('FROM analysis_progress_events'));
    expect(evQuery.params).toEqual([ORG, ANA, 41]);
  });
});

describe('Reports hub listing', () => {
  it('filters tenant-scoped with bound parameters and paginates', async () => {
    const calls: any[] = [];
    const db: any = {
      query: vi.fn(async (sql: string, params: any[], options: any) => {
        calls.push({ sql, params, options });
        if (sql.includes('COUNT(*)')) return { rows: [{ total: 3 }] };
        return {
          rows: [
            { id: 'r1', project_id: 'p1', project_name: 'P', analysis_id: 'a1', analysis_kind: 'FULL_PREFLIGHT', format: 'PDF', report_type: 'EXECUTIVE', file_name: 'f.pdf', file_size: '12', checksum_sha256: 'c', created_at: '2026-01-01T00:00:00Z', created_by: null },
          ],
        };
      }),
    };
    const res = await new ReportsHubService(db).list(ORG, {
      projectId: '33333333-3333-4333-8333-333333333333',
      format: 'pdf',
      from: '2026-01-01',
      page: '2',
      pageSize: '2',
    });
    expect(calls[0].sql).toContain('r.organization_id = $1');
    expect(calls[0].params).toEqual([ORG, '33333333-3333-4333-8333-333333333333', 'PDF', '2026-01-01']);
    expect(calls[1].sql).toContain('LIMIT 2 OFFSET 2');
    expect(calls.every((c) => c.options.tenantId === ORG)).toBe(true);
    expect(res.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(res.items[0]).toMatchObject({ fileSize: 12, analysisKind: 'FULL_PREFLIGHT', reportType: 'EXECUTIVE' });
  });

  it('rejects invalid filters', async () => {
    const svc = new ReportsHubService({ query: vi.fn() } as any);
    await expect(svc.list(ORG, { page: '0' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.list(ORG, { projectId: 'nope' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.list(ORG, { evil: '1' })).rejects.toMatchObject({ status: 400 });
  });
});
