import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalysesService } from './analyses.service';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { NotFoundException } from '@nestjs/common';

describe('AnalysesService', () => {
  let service: AnalysesService;
  let mockDb: Partial<DatabaseService>;
  let mockJobs: Partial<JobsService>;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    mockJobs = {
      triggerAnalysis: vi.fn(),
    };
    service = new AnalysesService(
      mockDb as DatabaseService,
      mockJobs as JobsService
    );
  });

  it('should delegate triggering analysis to JobsService', async () => {
    const mockRes = {
      analysisId: 'ana-1',
      status: 'QUEUED',
      findingsCount: 0,
      findings: [],
    };
    mockJobs.triggerAnalysis = vi.fn().mockResolvedValueOnce(mockRes);

    const res = await service.triggerAnalysis('org-1', 'user-1', {
      projectId: 'proj-1',
      engineTypes: ['OPD_GUARD'],
      targetRelease: 'S4H_2023',
    });

    expect(res).toEqual(mockRes);
    expect(mockJobs.triggerAnalysis).toHaveBeenCalledWith('org-1', 'user-1', {
      projectId: 'proj-1',
      engineTypes: ['OPD_GUARD'],
      targetRelease: 'S4H_2023',
    });
  });

  it('should find all analyses for a tenant and project', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 'ana-1',
          organization_id: 'org-1',
          project_id: 'proj-1',
          status: 'COMPLETED',
          engine_types: ['OPD_GUARD'],
          target_release: 'S4H_2023',
          triggered_by: 'user-1',
          findings_count: 5,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ],
    });

    const res = await service.findAll('org-1', 'proj-1');
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('ana-1');
    expect(res[0].findingsCount).toBe(5);
  });

  it('should throw NotFoundException when analysis not found', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await expect(service.findById('org-1', 'missing')).rejects.toThrow(
      NotFoundException
    );
  });
});
