import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardService } from './dashboard.service';
import { DatabaseService } from '../database/database.service';
import { EnginesService } from '../engines/engines.service';
import { FindingsService } from '../findings/findings.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let mockDb: Partial<DatabaseService>;
  let mockEngines: Partial<EnginesService>;
  let mockFindings: Partial<FindingsService>;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    mockEngines = {
      getEngineStatus: vi.fn().mockResolvedValue({
        summary: {
          totalEngines: 19,
          operationalCount: 19,
          totalRules: 290,
          serviceStatus: 'ONLINE',
        },
        engines: [],
      }),
    };
    mockFindings = {
      getStats: vi.fn().mockResolvedValue({
        totalFindings: 10,
        cleanCoreIndex: 85.5,
        bySeverity: { BLOCKER: 1, CRITICAL: 2, MAJOR: 3, MEDIUM: 4, MINOR: 0, LOW: 0, INFO: 0 },
        byEngine: { OPD_GUARD: 10 },
        blockerAndCriticalCount: 3,
      }),
    };
    service = new DashboardService(
      mockDb as DatabaseService,
      mockEngines as EnginesService,
      mockFindings as FindingsService
    );
  });

  it('should return aggregated real dashboard summary', async () => {
    mockDb.query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'p1', name: 'Proj 1', slug: 'proj-1', target_release: 'S4H_2023', created_at: new Date().toISOString() }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'a1', project_id: 'p1', status: 'COMPLETED', target_release: 'S4H_2023', created_at: new Date().toISOString(), completed_at: null, findings_count: 5 }],
      })
      .mockResolvedValueOnce({
        rows: [{ total: 1, active: 1 }],
      })
      .mockResolvedValueOnce({ rows: [{ last24h: 1, last7d: 3, last30d: 7, failed7d: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'p1', name: 'Proj 1', latest_analysis_id: 'a1', blockers: 1, criticals: 2 }],
      });

    const summary = await service.getSummary('org-1');
    expect(summary.cleanCoreIndex).toBe(85.5);
    expect(summary.totalProjects).toBe(1);
    expect(summary.activeProjects).toBe(1);
    expect(summary.blockersAndCritical).toBe(3);
    expect(summary.totalFindings).toBe(10);
    expect(summary.enginesOperational).toBe('19 / 19');
    expect(summary.recentProjects.length).toBe(1);
    expect(summary.recentAnalyses.length).toBe(1);
    expect(summary.analysisActivity).toEqual({ last24h: 1, last7d: 3, last30d: 7, failed7d: 1 });
    expect(summary.newFindings7d).toBe(4);
    expect(summary.projectsAtRisk).toEqual([
      { id: 'p1', name: 'Proj 1', blockers: 1, criticals: 2, latestAnalysisId: 'a1' },
    ]);
  });
});
