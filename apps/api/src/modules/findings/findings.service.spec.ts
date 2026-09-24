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
      });

    const stats = await service.getStats('org-1');
    expect(stats.totalFindings).toBe(2);
    expect(stats.blockerAndCriticalCount).toBe(2);
    // penalty = 1 * 15 + 1 * 8 = 23 -> cleanCoreIndex = 100 - 23 = 77
    expect(stats.cleanCoreIndex).toBe(77);
  });
});
