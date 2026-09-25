import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthService } from './health.service';
import { DatabaseService } from '../database/database.service';
import { ConfigService } from '@nestjs/config';

describe('HealthService', () => {
  let service: HealthService;
  let mockDb: Partial<DatabaseService>;
  let mockConfig: Partial<ConfigService>;

  beforeEach(() => {
    mockDb = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
    };
    mockConfig = {
      get: vi.fn().mockReturnValue(undefined), // Defaults
    };
    service = new HealthService(mockDb as DatabaseService, mockConfig as ConfigService);
  });

  it('should return liveness status ok', () => {
    const liveness = service.getLiveness();
    expect(liveness.status).toBe('ok');
    expect(liveness.service).toBe('erppreflight-api');
    expect(liveness.version).toBe('1.0.0');
    expect(liveness.timestamp).toBeDefined();
  });

  it('should return readiness status when database is healthy', async () => {
    const readiness = await service.getReadiness();
    // Since mock doesn't actually ping redis, it will be unhealthy
    expect(readiness.dependencies.postgres.status).toBe('up');
  });

  it('should report postgres down', async () => {
    mockDb.checkHealth = vi.fn().mockResolvedValue({ healthy: false, error: 'connection refused' });
    const readiness = await service.getReadiness();
    expect(readiness.dependencies.postgres.status).toBe('down');
  });
});
