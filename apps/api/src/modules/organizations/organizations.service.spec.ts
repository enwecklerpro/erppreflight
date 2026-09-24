import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrganizationsService } from './organizations.service';
import { DatabaseService } from '../database/database.service';
import { NotFoundException } from '@nestjs/common';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let mockDb: Partial<DatabaseService>;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new OrganizationsService(mockDb as DatabaseService);
  });

  it('should return current organization details', async () => {
    const org = {
      id: 'org-1',
      name: 'Acme Corp',
      slug: 'acme-corp',
      plan_tier: 'ENTERPRISE',
      status: 'ACTIVE',
      data_policy: {},
    };
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [org] });

    const result = await service.getCurrentOrganization('org-1');
    expect(result.id).toBe('org-1');
    expect(result.name).toBe('Acme Corp');
  });

  it('should throw NotFoundException if organization not found', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await expect(service.getCurrentOrganization('missing')).rejects.toThrow(
      NotFoundException
    );
  });

  it('should return user organizations', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: 'org-1', name: 'Acme', role: 'OWNER' }],
    });

    const list = await service.getUserOrganizations('user-1');
    expect(list.length).toBe(1);
    expect(list[0].role).toBe('OWNER');
  });
});
