/** Concurrent activation of two baselines of one project maps the single-active index violation to 409. */
import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ApiBaselinesService } from '../src/modules/api-baselines/api-baselines.service';

const ORG = 'b2222222-2222-4222-8222-222222222222';
const PROJ = 'c3333333-3333-4333-8333-333333333333';
const ID = 'e7777777-7777-4777-8777-777777777777';

describe('ApiBaselinesService.activate', () => {
  it('answers 409 when a concurrent activation wins the unique active index', async () => {
    const row = {
      id: ID, project_id: PROJ, name: 'n', format: 'OPENAPI', version: '1', sha256: 'a'.repeat(64), size_bytes: 1,
      surface: {}, is_active: false, created_at: new Date(), storage_key: 'k',
    };
    const db = {
      query: vi.fn(async () => ({ rows: [row] })),
      withTenantTransaction: vi.fn(async () => {
        throw Object.assign(new Error('duplicate key value violates unique constraint "uq_api_baselines_active"'), { code: '23505' });
      }),
    } as any;
    const svc = new ApiBaselinesService(db, {} as any);
    await expect(svc.activate(ORG, PROJ, ID)).rejects.toBeInstanceOf(ConflictException);
  });
});
