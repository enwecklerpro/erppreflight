import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsageMetricEnum } from '@erppreflight/schemas';
import { IngestionService, processedOutcome } from '../src/modules/ingestion/ingestion.service';
import { ConnectorsService } from '../src/modules/connectors/connectors.service';
import { RateLimiterService } from '../src/modules/rate-limit/rate-limiter.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const FILE = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

/**
 * In-memory stand-in for uploaded_files that honours the confirm claim
 * (UPDATE ... WHERE quarantine_status IN ('PENDING_SCAN','REJECTED') ... RETURNING *).
 */
function fakeDb(initialStatus: string, extra: Record<string, unknown> = {}) {
  const row: any = {
    id: FILE,
    organization_id: ORG,
    project_id: PROJECT,
    file_name: 'orders.xml',
    file_size: 10,
    storage_path: `tenants/${ORG}/projects/${PROJECT}/${FILE}/orders.xml`,
    checksum_sha256: 'a'.repeat(64),
    quarantine_status: initialStatus,
    metadata: {},
    ...extra,
  };
  const query = vi.fn(async (sql: string) => {
    if (/^\s*UPDATE uploaded_files\s+SET quarantine_status = 'SCANNING'/.test(sql)) {
      const stale = row.quarantine_status === 'SCANNING' && !row.metadata.scanStartedAt;
      if (['PENDING_SCAN', 'REJECTED'].includes(row.quarantine_status) || stale) {
        row.quarantine_status = 'SCANNING';
        row.metadata = { ...row.metadata, scanStartedAt: new Date().toISOString() };
        return { rows: [{ ...row }] };
      }
      return { rows: [] };
    }
    if (/^SELECT \* FROM uploaded_files/.test(sql)) return { rows: [{ ...row }] };
    return { rows: [] };
  });
  return { row, query };
}

function ingestion(db: any, usage: any) {
  const svc = new IngestionService(db, {} as any, {} as any, {} as any, {} as any, {} as any, usage);
  const processFile = vi.spyOn(svc, 'processFile').mockImplementation(async (file: any) => {
    db.__row.quarantine_status = 'CLEAN';
    db.__row.file_size = 4096;
    db.__row.metadata = { ...db.__row.metadata, detectedFormat: 'XML', redactionsCount: 0 };
    return { fileId: file.id, status: 'CLEAN', detectedFormat: 'XML', checksumSha256: 'b'.repeat(64), redactionsCount: 0, cleanStoragePath: 'clean', sizeBytes: 4096 } as any;
  });
  return { svc, processFile };
}

describe('P3: artifact metering on the presigned confirm path (exactly once)', () => {
  it('records ARTIFACT_UPLOAD and ARTIFACT_BYTES once, with the real byte count and the confirming user', async () => {
    const { row, query } = fakeDb('PENDING_SCAN');
    const db: any = { query, __row: row };
    const usage = { recordSafe: vi.fn(async () => true) };
    const { svc, processFile } = ingestion(db, usage);

    const first: any = await svc.confirmUpload(ORG, PROJECT, FILE, undefined, { actorId: USER, source: 'presigned' });
    expect(first.status).toBe('CLEAN');
    expect(processFile).toHaveBeenCalledTimes(1);
    expect(usage.recordSafe).toHaveBeenCalledTimes(2);
    expect(usage.recordSafe).toHaveBeenCalledWith(ORG, 'ARTIFACT_UPLOAD', 1, expect.objectContaining({ resourceId: FILE, actorId: USER, metadata: { status: 'CLEAN', source: 'presigned' } }));
    expect(usage.recordSafe).toHaveBeenCalledWith(ORG, 'ARTIFACT_BYTES', 4096, expect.objectContaining({ resourceId: FILE }));

    // Client retries the confirm (network glitch, double click): stored outcome, no re-scan, no re-metering.
    const second: any = await svc.confirmUpload(ORG, PROJECT, FILE, undefined, { actorId: USER, source: 'presigned' });
    expect(second).toMatchObject({ fileId: FILE, status: 'CLEAN', alreadyProcessed: true, sizeBytes: 4096, detectedFormat: 'XML' });
    expect(processFile).toHaveBeenCalledTimes(1);
    expect(usage.recordSafe).toHaveBeenCalledTimes(2);
  });

  it('meters quarantined uploads (bytes were received and scanned) but not rejected ones', async () => {
    const { row, query } = fakeDb('PENDING_SCAN');
    const usage = { recordSafe: vi.fn(async () => true) };
    const svc = new IngestionService({ query } as any, {} as any, {} as any, {} as any, {} as any, {} as any, usage as any);
    vi.spyOn(svc, 'processFile').mockResolvedValueOnce({ fileId: FILE, status: 'QUARANTINED', virusName: 'Eicar', sizeBytes: 68 } as any);
    await svc.confirmUpload(ORG, PROJECT, FILE);
    expect(usage.recordSafe).toHaveBeenCalledWith(ORG, 'ARTIFACT_BYTES', 68, expect.anything());

    row.quarantine_status = 'PENDING_SCAN';
    usage.recordSafe.mockClear();
    vi.spyOn(svc, 'processFile').mockRejectedValueOnce(new Error('magic bytes mismatch'));
    await expect(svc.confirmUpload(ORG, PROJECT, FILE)).rejects.toThrow(/magic bytes/);
    expect(usage.recordSafe).not.toHaveBeenCalled();
  });

  it('answers 409 while another confirm is scanning and 404 for a foreign file', async () => {
    const { query } = fakeDb('SCANNING', { metadata: { scanStartedAt: new Date().toISOString() } });
    const svc = new IngestionService({ query } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.confirmUpload(ORG, PROJECT, FILE)).rejects.toBeInstanceOf(ConflictException);

    const empty = new IngestionService({ query: vi.fn(async () => ({ rows: [] })) } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(empty.confirmUpload(ORG, PROJECT, FILE)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the claim is an atomic conditional UPDATE scoped to tenant + project', async () => {
    const { query } = fakeDb('PENDING_SCAN');
    const svc = new IngestionService({ query } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    vi.spyOn(svc, 'processFile').mockResolvedValue({ fileId: FILE, status: 'CLEAN', sizeBytes: 1 } as any);
    await svc.confirmUpload(ORG, PROJECT, FILE);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/UPDATE uploaded_files[\s\S]+WHERE id = \$1 AND organization_id = \$2 AND project_id = \$3[\s\S]+quarantine_status IN \('PENDING_SCAN', 'REJECTED'\)[\s\S]+RETURNING \*/);
    expect(params.slice(0, 3)).toEqual([FILE, ORG, PROJECT]);
  });

  it('processedOutcome exposes the stored result of quarantined files', () => {
    expect(processedOutcome({ id: FILE, quarantine_status: 'QUARANTINED', file_size: '68', metadata: { virusName: 'Eicar' } })).toEqual({
      fileId: FILE,
      status: 'QUARANTINED',
      alreadyProcessed: true,
      sizeBytes: 68,
      virusName: 'Eicar',
    });
  });
});

describe('P3: connector outbound requests are metered (CONNECTOR_REQUEST)', () => {
  it('declares the metric', () => {
    expect(UsageMetricEnum.options).toContain('CONNECTOR_REQUEST');
  });

  it('buildContext wires the shared limiter and records one usage event per outbound request', async () => {
    const usage = { recordSafe: vi.fn(async () => true) };
    const svc = new ConnectorsService({} as any, {} as any, {} as any, undefined, undefined, undefined, RateLimiterService.inMemory(), usage as any);
    const row: any = { id: '55555555-5555-4555-8555-555555555555', organization_id: ORG, connector_type: 'JIRA', config: {}, credentials_ciphertext: null };
    const ctx = svc.buildContext(row);
    await ctx.recordOutbound!({ connectorKey: row.id, method: 'GIT_CLONE', host: 'git.example.com', attempt: 1, status: 200, error: null });
    expect(usage.recordSafe).toHaveBeenCalledWith(
      ORG,
      'CONNECTOR_REQUEST',
      1,
      expect.objectContaining({
        resourceType: 'CONNECTOR',
        resourceId: row.id,
        metadata: expect.objectContaining({ connectorType: 'JIRA', method: 'GIT_CLONE', host: 'git.example.com', status: 200 }),
      })
    );
  });
});
