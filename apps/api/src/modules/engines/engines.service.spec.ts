import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnginesService } from './engines.service';
import { ConfigService } from '@nestjs/config';

describe('EnginesService', () => {
  let service: EnginesService;
  let mockConfig: Partial<ConfigService>;

  beforeEach(() => {
    mockConfig = {
      get: vi.fn().mockReturnValue('http://localhost:8000'),
    };
    service = new EnginesService(mockConfig as ConfigService);
  });

  it('should return status of all 19 canonical preflight engines', async () => {
    const status = await service.getEngineStatus();
    expect(status.summary.totalEngines).toBe(19);
    expect(status.engines.length).toBe(19);
    const opd = status.engines.find((e) => e.id === 'OPD_GUARD');
    expect(opd).toBeDefined();
    expect(opd?.domain).toBe('Output & Extensibility');
    const mfs = status.engines.find((e) => e.id === 'MFS_BLACKBOX');
    expect(mfs).toBeDefined();
  });
});
