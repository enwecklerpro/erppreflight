import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectsService } from './projects.service';
import { DatabaseService } from '../database/database.service';
import { NotFoundException } from '@nestjs/common';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let mockDb: Partial<DatabaseService>;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new ProjectsService(mockDb as DatabaseService);
  });

  it('should create a new project', async () => {
    const mockCreated = {
      id: 'proj-1',
      organization_id: 'org-1',
      name: 'Migration S4 2023',
      target_release: 'S4H_2023',
    };
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [mockCreated] });

    const result = await service.create('org-1', 'user-1', {
      name: 'Migration S4 2023',
      description: 'S/4HANA Clean Core Migration',
      targetRelease: 'S4H_2023',
    });

    expect(result.id).toBe('proj-1');
    expect(result.name).toBe('Migration S4 2023');
  });

  it('should return all projects for organization', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
    });

    const list = await service.findAll('org-1');
    expect(list.length).toBe(2);
  });

  it('should throw NotFoundException when project is missing', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await expect(service.findOne('org-1', 'missing-id')).rejects.toThrow(
      NotFoundException
    );
  });
});
