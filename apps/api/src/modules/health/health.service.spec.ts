import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthService } from './health.service';
import { DatabaseService } from '../database/database.service';

describe('HealthService', () => {
  let service: HealthService;
  let mockDb: Partial<DatabaseService>;

  beforeEach(() => {
    mockDb = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
    };
    service = new HealthService(mockDb as DatabaseService);
  });

  it('should return liveness status ok', () => {
    const liveness = service.getLiveness();
    expect(liveness.status).toBe('ok');
    expect(liveness.service).toBe('erppreflight-api');
    expect(liveness.version).toBe('1.0.0');
    expect(liveness.timestamp).toBeDefined();
  });

  it('should return readiness status ready when database is healthy', async () => {
    const readiness = await service.getReadiness();
    expect(readiness.status).toBe('ready');
    expect(readiness.checks.database).toBe('healthy');
  });

  it('should return readiness degraded when database is unreachable', async () => {
    mockDb.checkHealth = vi.fn().mockResolvedValue({ healthy: false, error: 'connection refused' });
    const readiness = await service.getReadiness();
    expect(readiness.status).toBe('degraded');
    expect(readiness.checks.database).toContain('unreachable');
  });
});
