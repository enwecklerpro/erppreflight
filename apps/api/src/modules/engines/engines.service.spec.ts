import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return status of all 19 canonical preflight engines', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const status = await service.getEngineStatus();
    expect(status.summary.totalEngines).toBe(19);
    expect(status.engines.length).toBe(19);
    const opd = status.engines.find((e) => e.id === 'OPD_GUARD');
    expect(opd).toBeDefined();
    expect(opd?.domain).toBe('Output & Extensibility');
    const mfs = status.engines.find((e) => e.id === 'MFS_BLACKBOX');
    expect(mfs).toBeDefined();
    // No invented rule counts while the analysis service is unreachable.
    expect(status.summary.totalRules).toBe(0);
    expect(status.engines.every((e) => e.status === 'STANDBY' && e.rulesCount === 0)).toBe(true);
  });

  it('derives rule counts, codes and versions from the analysis engine catalog', async () => {
    const catalog = [
      {
        engine_type: 'CLEAN_CORE_OBJECT_GUARD',
        version: '2.0.0',
        rule_count: 2,
        rule_codes: ['CLEAN_CORE_DIRECT_DB_ACCESS', 'CLEAN_CORE_UNRELEASED_API'],
        supported_artifact_types: ['ABAP', 'ZIP'],
        health: { status: 'OPERATIONAL' },
      },
      { engine_type: 'OPD_GUARD', version: '2.0.0', rule_count: 5, rule_codes: [], health: { status: 'DEGRADED' } },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/health/readiness')) {
          return { ok: true, json: async () => ({ status: 'ready', engines_registered: 19 }) };
        }
        return { ok: true, json: async () => catalog };
      }),
    );
    const status = await service.getEngineStatus();
    const cc = status.engines.find((e) => e.id === 'CLEAN_CORE_OBJECT_GUARD');
    expect(cc?.rulesCount).toBe(2);
    expect(cc?.ruleCodes).toEqual(['CLEAN_CORE_DIRECT_DB_ACCESS', 'CLEAN_CORE_UNRELEASED_API']);
    expect(cc?.version).toBe('2.0.0');
    expect(cc?.status).toBe('OPERATIONAL');
    expect(status.engines.find((e) => e.id === 'OPD_GUARD')?.status).toBe('DEGRADED');
    expect(status.engines.find((e) => e.id === 'MFS_BLACKBOX')?.status).toBe('DEGRADED');
    expect(status.summary.totalRules).toBe(7);
  });
});
