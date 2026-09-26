import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FindingsService } from './findings.service';
import { DatabaseService } from '../database/database.service';
import { NotFoundException } from '@nestjs/common';

describe('FindingsService', () => {
  let service: FindingsService;
  let mockDb: Partial<DatabaseService>;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      withTenantTransaction: vi.fn(async (_tenantIdOrCb: any, maybeCb?: any) => {
        const cb = typeof _tenantIdOrCb === 'function' ? _tenantIdOrCb : maybeCb;
        return await cb(mockDb);
      }),
    };
    service = new FindingsService(mockDb as DatabaseService);
  });

  it('should return paginated findings with evidence', async () => {
    mockDb.query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'find-1',
            analysis_id: 'job-1',
            project_id: 'proj-1',
            organization_id: 'org-1',
            engine: 'OPD_GUARD',
            rule_id: 'OPD_001',
            severity: 'CRITICAL',
            category: 'OUTPUT',
            title: 'Output Determination Missing',
            description: 'BRFplus determination table missing default condition',
            confidence_class: 'RULE_DERIVED',
            confidence_score: 0.85,
            remediation: 'Maintain condition table in transaction OPD',
            affected_objects: ['OPD_TABLE_1'],
            technical_details: {},
            fingerprint: 'fp-123',
            created_at: new Date().toISOString(),
            evidence: [{ file: 'test.xml', line: 10 }],
          },
        ],
      });

    const result = await service.findAll('org-1', { page: 1, pageSize: 10 });
    expect(result.pagination.total).toBe(1);
    expect(result.items.length).toBe(1);
    expect(result.items[0].engineType).toBe('OPD_GUARD');
    expect(result.items[0].severity).toBe('CRITICAL');
  });

  it('should throw NotFoundException if finding not found by id', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await expect(service.findById('org-1', 'nonexistent')).rejects.toThrow(
      NotFoundException
    );
  });

  it('should calculate clean core stats and penalty accurately', async () => {
    mockDb.query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          { severity: 'BLOCKER', count: 1 },
          { severity: 'CRITICAL', count: 1 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ engine: 'OPD_GUARD', count: 2 }],
      })
      .mockResolvedValueOnce({
        rows: [{ total: 2 }],
      })
      .mockResolvedValueOnce({
        rows: [{ total: 1 }],
      });

    const stats = await service.getStats('org-1');
    expect(stats.totalFindings).toBe(2);
    expect(stats.blockerAndCriticalCount).toBe(2);
    // penalty = 1 * 15 + 1 * 8 = 23 -> cleanCoreIndex = 100 - 23 = 77
    expect(stats.cleanCoreIndex).toBe(77);
  });

  it('reports no clean core score before any analysis has completed', async () => {
    mockDb.query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    const stats = await service.getStats('org-1', 'project-1');
    expect(stats.totalFindings).toBe(0);
    expect(stats.cleanCoreIndex).toBeNull();
  });

  describe('lifecycle filters', () => {
    it('joins the lifecycle and filters by status, assignee=me, overdue and latest detection', async () => {
      const query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      mockDb.query = query;
      await service.findAll('org-1', {
        projectId: 'p-1',
        status: 'open,accepted_risk',
        assignee: 'me',
        currentUserId: '11111111-1111-4111-8111-111111111111',
        due: 'overdue',
        latest: true,
      });
      const [countSql, countParams] = query.mock.calls[0];
      expect(countSql).toContain('LEFT JOIN finding_lifecycles l');
      expect(countSql).toContain("COALESCE(l.status, 'OPEN') = ANY($3::text[])");
      expect(countSql).toContain('l.assignee_id = $4');
      expect(countSql).toContain('l.due_date < CURRENT_DATE');
      expect(countSql).toContain('l.latest_finding_id = f.id');
      expect(countParams).toEqual(['org-1', 'p-1', ['OPEN', 'ACCEPTED_RISK'], '11111111-1111-4111-8111-111111111111']);
    });

    it('rejects unknown status and malformed assignee filters', async () => {
      await expect(service.findAll('org-1', { status: 'BOGUS' })).rejects.toThrow(/status/);
      await expect(service.findAll('org-1', { assignee: 'not-a-uuid' })).rejects.toThrow(/assignee/);
      await expect(service.findAll('org-1', { due: 'yesterday' })).rejects.toThrow(/due/);
    });

    it('maps lifecycle and reproducibility fields; findings without lifecycle are OPEN', async () => {
      mockDb.query = vi.fn().mockResolvedValueOnce({
        rows: [
          {
            id: 'f-1',
            analysis_id: 'a-1',
            project_id: 'p-1',
            organization_id: 'org-1',
            engine: 'OPD_GUARD',
            rule_id: 'OPD_DETERMINATION_STEP_MISSING',
            severity: 'MAJOR',
            category: 'OUTPUT',
            title: 't',
            description: 'd',
            confidence_class: 'VERIFIED',
            confidence_score: 1,
            remediation: 'r',
            affected_objects: [],
            technical_details: {},
            fingerprint: 'fp',
            created_at: '2026-09-01T00:00:00.000Z',
            evidence: [],
            engine_version: '2.0.0',
            rule_version: '2.0.0#abcdef0123456789',
            target_release: 'S4H_2023',
            lifecycle_id: 'lc-1',
            lc_status: 'ACCEPTED_RISK',
            lc_due_date: '2026-10-01',
            lc_first_detected_at: '2026-08-01T00:00:00.000Z',
            lc_last_evaluated_at: '2026-09-01T00:00:00.000Z',
            lc_latest_finding_id: 'f-1',
            lc_revision: 3,
          },
        ],
      });
      const f = await service.findById('org-1', 'f-1');
      expect(f.engineVersion).toBe('2.0.0');
      expect(f.ruleVersion).toBe('2.0.0#abcdef0123456789');
      expect(f.lifecycle.status).toBe('ACCEPTED_RISK');
      expect(f.lifecycle.dueDate).toBe('2026-10-01');
      expect(f.lifecycle.firstDetectedAt).toBe('2026-08-01T00:00:00.000Z');
      expect(f.lifecycle.isLatestDetection).toBe(true);

      mockDb.query = vi.fn().mockResolvedValueOnce({
        rows: [{ id: 'f-2', created_at: '2026-09-02T00:00:00.000Z', evidence: [], confidence_score: 1 }],
      });
      const legacy = await service.findById('org-1', 'f-2');
      expect(legacy.lifecycle.status).toBe('OPEN');
      expect(legacy.lifecycle.firstDetectedAt).toBe('2026-09-02T00:00:00.000Z');
    });
  });
});
