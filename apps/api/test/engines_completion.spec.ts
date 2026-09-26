/**
 * Engines completion (KNOWN_LIMITATIONS E1, E3, E4):
 *  - API Change Guard stored baselines: spec recognition, registry service, trigger validation,
 *    stored_baseline hand-over to the analysis service;
 *  - MFS BlackBox streaming: large delimited logs read only by streaming engines are piped from object
 *    storage to /api/v1/analyze/stream (never buffered), small ones stay inline;
 *  - Clean Core snapshot overlay scans object names inside abapGit ZIP uploads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { ZipArchive } from 'archiver';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Job } from 'bullmq';
import { inspectApiSpec, ApiSpecError } from '../src/modules/api-baselines/api-spec-inspector';
import { ApiBaselinesService, toPublicBaseline } from '../src/modules/api-baselines/api-baselines.service';
import { AnalysisProcessor, AnalysisJobData } from '../src/modules/jobs/analysis.processor';
import { JobsService, TriggerAnalysisSchema } from '../src/modules/jobs/jobs.service';
import {
  abapGitObjectName,
  extractAbapGitCandidateNames,
  isZipBuffer,
} from '../src/modules/knowledge-graph/abapgit-object-scan';
import { ReleasedObjectsProvider } from '../src/modules/knowledge-graph/released-objects.provider';
import { buildApiBaselineKey } from '../src/modules/storage/s3-storage.service';

const ORG = 'b2222222-2222-4222-8222-222222222222';
const PROJ = 'c3333333-3333-4333-8333-333333333333';
const USER = 'd4444444-4444-4444-8444-444444444444';
const ANALYSIS = 'a1111111-1111-4111-8111-111111111111';
const FILE_A = 'f1111111-1111-4111-8111-111111111111';
const BASELINE = 'e7777777-7777-4777-8777-777777777777';

const OPENAPI_JSON = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Sales Order API', version: '1.4.0' },
  paths: { '/salesOrders': { get: { responses: { 200: { description: 'ok' } } }, post: {} } },
  components: { schemas: { SalesOrder: { type: 'object' } } },
});
const EDMX = `<?xml version="1.0"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices><Schema Namespace="API_SALES_ORDER_SRV">
    <EntityType Name="A_SalesOrderType"><Key><PropertyRef Name="SalesOrder"/></Key></EntityType>
    <EntityContainer Name="C"><EntitySet Name="A_SalesOrder" EntityType="API_SALES_ORDER_SRV.A_SalesOrderType"/></EntityContainer>
  </Schema></edmx:DataServices>
</edmx:Edmx>`;

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------------------------------------ spec inspector
describe('inspectApiSpec', () => {
  it('recognises OpenAPI 3 JSON with version, title and surface', () => {
    const r = inspectApiSpec(OPENAPI_JSON);
    expect(r).toEqual({
      format: 'OPENAPI',
      specVersion: '3.0.3',
      apiVersion: '1.4.0',
      title: 'Sales Order API',
      surface: { paths: 1, operations: 2, schemas: 1 },
    });
  });

  it('recognises Swagger 2.0 JSON (definitions)', () => {
    const r = inspectApiSpec(JSON.stringify({ swagger: '2.0', info: { version: '7' }, paths: {}, definitions: { A: {}, B: {} } }));
    expect(r.specVersion).toBe('2.0');
    expect(r.surface).toEqual({ paths: 0, operations: 0, schemas: 2 });
  });

  it.each([2, 4])('recognises OpenAPI YAML with %i-space indentation', (n) => {
    const i = ' '.repeat(n);
    const yaml = [
      'openapi: "3.1.0"',
      'info:',
      `${i}title: 'Purchase Orders'`,
      `${i}version: 2.3.1 # comment`,
      'paths:',
      `${i}/orders:`,
      `${i}${i}get:`,
      `${i}${i}${i}summary: x`,
      `${i}${i}post:`,
      `${i}${i}${i}summary: y`,
      `${i}/orders/{id}:`,
      `${i}${i}delete: {}`,
      'components:',
      `${i}schemas:`,
      `${i}${i}Order:`,
      `${i}${i}${i}type: object`,
    ].join('\n');
    expect(inspectApiSpec(yaml)).toEqual({
      format: 'OPENAPI',
      specVersion: '3.1.0',
      apiVersion: '2.3.1',
      title: 'Purchase Orders',
      surface: { paths: 2, operations: 3, schemas: 1 },
    });
  });

  it('recognises OData EDMX and counts entity types / sets', () => {
    expect(inspectApiSpec(EDMX)).toEqual({
      format: 'EDMX',
      specVersion: '1.0',
      apiVersion: null,
      title: 'API_SALES_ORDER_SRV',
      surface: { entityTypes: 1, entitySets: 1 },
    });
  });

  it.each([
    ['plain prose', 'The quick brown fox jumps over the lazy dog', 'API_BASELINE_UNSUPPORTED_FORMAT'],
    ['JSON that is not OpenAPI', '{"hello":"world"}', 'API_BASELINE_UNSUPPORTED_FORMAT'],
    ['broken JSON', '{"openapi": ', 'API_BASELINE_UNSUPPORTED_FORMAT'],
    ['XML that is not EDMX', '<root><a/></root>', 'API_BASELINE_UNSUPPORTED_FORMAT'],
    ['EDMX with DTD', `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${EDMX}`, 'API_BASELINE_XML_DTD_FORBIDDEN'],
    ['OpenAPI without paths or schemas', '{"openapi":"3.0.0","paths":{}}', 'API_BASELINE_EMPTY_SURFACE'],
  ])('rejects %s', (_label, text, code) => {
    expect(() => inspectApiSpec(text)).toThrow(ApiSpecError);
    try {
      inspectApiSpec(text);
    } catch (e: any) {
      expect(e.code).toBe(code);
    }
  });
});

// ------------------------------------------------------------------------------------------------ baseline service
function baselineRow(over: Record<string, any> = {}) {
  return {
    id: BASELINE, organization_id: ORG, project_id: PROJ, name: 'SO API', format: 'OPENAPI', spec_version: '3.0.3',
    version: '1.4.0', sha256: sha(OPENAPI_JSON), size_bytes: Buffer.byteLength(OPENAPI_JSON), storage_key: 'k',
    source_file_id: FILE_A, source_file_name: 'so.json', api_title: 'Sales Order API', surface: { paths: 1 },
    is_active: true, created_by: USER, created_at: new Date('2026-09-26T10:00:00Z'), activated_at: new Date('2026-09-26T10:00:00Z'),
    ...over,
  };
}

function serviceHarness(opts: { file?: any; content?: string; activeExists?: boolean; insertError?: any } = {}) {
  const tx: Array<{ text: string; params?: any[] }> = [];
  const db: any = {
    query: vi.fn(async (text: string, params?: any[]) => {
      if (text.includes('FROM projects')) return { rows: [{ id: PROJ }] };
      if (text.includes('FROM uploaded_files')) return { rows: opts.file === null ? [] : [opts.file ?? {
        id: FILE_A, file_name: 'so.json', file_size: 400, storage_path: 'tenants/o/projects/p/f/so.json', quarantine_status: 'CLEAN',
      }] };
      if (text.includes('SELECT * FROM api_baselines')) return { rows: [baselineRow({ id: params?.[0] ?? BASELINE })] };
      return { rows: [] };
    }),
    withTenantTransaction: vi.fn(async (_t: string, cb: any) =>
      cb({
        query: vi.fn(async (text: string, params?: any[]) => {
          tx.push({ text, params });
          if (text.includes('FOR UPDATE')) return { rows: opts.activeExists ? [{ id: 'other' }] : [] };
          if (text.startsWith('INSERT') && opts.insertError) throw opts.insertError;
          return { rows: [] };
        }),
      })
    ),
  };
  const storage: any = {
    getCleanStream: vi.fn(async () => Readable.from([Buffer.from(opts.content ?? OPENAPI_JSON)])),
    putCleanObject: vi.fn(async () => undefined),
    deleteCleanObject: vi.fn(async () => undefined),
  };
  return { svc: new ApiBaselinesService(db, storage), db, storage, tx };
}

describe('ApiBaselinesService', () => {
  it('validates the request body (Zod, strict)', async () => {
    const { svc } = serviceHarness();
    await expect(svc.create(ORG, USER, PROJ, { fileId: 'nope', name: '' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create(ORG, USER, PROJ, { fileId: FILE_A, name: 'x', storageKey: 'evil' })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('rejects artifacts that are not CLEAN, missing or not an API specification', async () => {
    await expect(
      serviceHarness({ file: { id: FILE_A, file_name: 'a', file_size: 10, storage_path: 'x', quarantine_status: 'QUARANTINED' } })
        .svc.create(ORG, USER, PROJ, { fileId: FILE_A, name: 'x' })
    ).rejects.toMatchObject({ response: { code: 'ARTIFACT_NOT_CLEAN' } });
    await expect(serviceHarness({ file: null }).svc.create(ORG, USER, PROJ, { fileId: FILE_A, name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(
      serviceHarness({ content: 'purchase order prose, not a spec' }).svc.create(ORG, USER, PROJ, { fileId: FILE_A, name: 'x' })
    ).rejects.toMatchObject({ response: { code: 'API_BASELINE_UNSUPPORTED_FORMAT' } });
  });

  it('stores an immutable tenant-scoped copy, hashes it and activates the first baseline', async () => {
    const { svc, storage, tx } = serviceHarness();
    await svc.create(ORG, USER, PROJ, { fileId: FILE_A, name: 'SO API' });
    const [key, buffer] = storage.putCleanObject.mock.calls[0];
    expect(key).toMatch(new RegExp(`^tenants/${ORG}/projects/${PROJ}/api-baselines/[0-9a-f-]{36}/so.json$`));
    expect(Buffer.from(buffer).toString()).toBe(OPENAPI_JSON);
    const insert = tx.find((q) => q.text.startsWith('INSERT INTO api_baselines'))!;
    expect(insert.params?.[1]).toBe(ORG);
    expect(insert.params?.[2]).toBe(PROJ);
    expect(insert.params?.[4]).toBe('OPENAPI');
    expect(insert.params?.[6]).toBe('1.4.0'); // default version = info.version
    expect(insert.params?.[7]).toBe(sha(OPENAPI_JSON));
    expect(insert.params?.[14]).toBe(true); // first baseline of the project -> active
    expect(tx.some((q) => q.text.includes('SET is_active = FALSE'))).toBe(false);
  });

  it('keeps the current active baseline unless activate=true; EDMX defaults to a hash version label', async () => {
    const h = serviceHarness({ activeExists: true, content: EDMX });
    await h.svc.create(ORG, USER, PROJ, { fileId: FILE_A, name: 'SO EDMX' });
    const insert = h.tx.find((q) => q.text.startsWith('INSERT INTO api_baselines'))!;
    expect(insert.params?.[4]).toBe('EDMX');
    expect(insert.params?.[6]).toBe(`sha-${sha(EDMX).slice(0, 12)}`);
    expect(insert.params?.[14]).toBe(false);
    const h2 = serviceHarness({ activeExists: true });
    await h2.svc.create(ORG, USER, PROJ, { fileId: FILE_A, name: 'SO API', version: '2', activate: true });
    expect(h2.tx.some((q) => q.text.includes('SET is_active = FALSE'))).toBe(true);
  });

  it('maps a duplicate name+version to 409 and removes the stored copy', async () => {
    const { svc, storage } = serviceHarness({ insertError: Object.assign(new Error('dup'), { code: '23505' }) });
    await expect(svc.create(ORG, USER, PROJ, { fileId: FILE_A, name: 'SO API' })).rejects.toMatchObject({
      response: { code: 'API_BASELINE_EXISTS' },
    });
    expect(storage.deleteCleanObject).toHaveBeenCalledTimes(1);
  });

  it('never exposes the storage key', () => {
    const pub = toPublicBaseline({ ...(baselineRow() as any), storageKey: 'secret' } as any);
    expect(Object.keys(pub)).not.toContain('storageKey');
  });

  it('loadContent verifies the registered SHA-256', async () => {
    const { svc } = serviceHarness({ content: OPENAPI_JSON });
    const record: any = { ...baselineRow(), storageKey: 'k', sha256: sha(OPENAPI_JSON), name: 'SO API' };
    await expect(svc.loadContent(record)).resolves.toBe(OPENAPI_JSON);
    await expect(svc.loadContent({ ...record, sha256: '0'.repeat(64) })).rejects.toThrow(/integrity/);
  });

  it('buildApiBaselineKey is tenant + project scoped and sanitised', () => {
    expect(buildApiBaselineKey(ORG, PROJ, BASELINE, '../../etc/passwd')).toBe(
      `tenants/${ORG}/projects/${PROJ}/api-baselines/${BASELINE}/passwd`
    );
  });
});

// ------------------------------------------------------------------------------------------------ trigger validation
describe('TriggerAnalysisSchema / JobsService apiBaselineId', () => {
  const base = { projectId: PROJ, engineTypes: ['API_CHANGE_GUARD'], fileIds: [FILE_A] };

  it('accepts a uuid apiBaselineId and rejects others', () => {
    expect(TriggerAnalysisSchema.safeParse({ ...base, apiBaselineId: BASELINE }).success).toBe(true);
    expect(TriggerAnalysisSchema.safeParse({ ...base, apiBaselineId: 'x' }).success).toBe(false);
  });

  function jobs(assertSelectable = vi.fn(async () => ({}))) {
    const db: any = {
      query: vi.fn(async (text: string) => {
        if (text.includes('FROM projects')) return { rows: [{ id: PROJ, target_release: 'S4H_2023' }] };
        if (text.includes('FROM uploaded_files'))
          return { rows: [{ id: FILE_A, file_name: 'v2.json', storage_path: 'k', quarantine_status: 'CLEAN', metadata: { detectedFormat: 'JSON' } }] };
        return { rows: [] };
      }),
    };
    const queue: any = { add: vi.fn(async () => undefined) };
    const config: any = { get: vi.fn(() => undefined) };
    const svc = new JobsService(db, config, queue, undefined, undefined, { assertSelectable } as any);
    return { svc, queue, assertSelectable };
  }

  it('requires API_CHANGE_GUARD among the engines', async () => {
    const { svc } = jobs();
    await expect(
      svc.triggerAnalysis(ORG, USER, { ...base, engineTypes: ['OPD_GUARD'], apiBaselineId: BASELINE })
    ).rejects.toMatchObject({ response: { code: 'API_BASELINE_REQUIRES_API_CHANGE_GUARD' } });
  });

  it('404s a foreign / unknown baseline and queues a valid selection', async () => {
    const missing = jobs(vi.fn(async () => {
      throw new NotFoundException({ code: 'API_BASELINE_NOT_FOUND' });
    }));
    await expect(missing.svc.triggerAnalysis(ORG, USER, { ...base, apiBaselineId: BASELINE })).rejects.toBeInstanceOf(
      NotFoundException
    );
    const ok = jobs();
    await ok.svc.triggerAnalysis(ORG, USER, { ...base, apiBaselineId: BASELINE });
    expect(ok.assertSelectable).toHaveBeenCalledWith(ORG, PROJ, BASELINE);
    expect(ok.queue.add.mock.calls[0][1].apiBaselineId).toBe(BASELINE);
  });
});

// ------------------------------------------------------------------------------------------------ executor
function makeDb() {
  const queries: Array<{ text: string; params?: any[] }> = [];
  const db: any = {
    query: vi.fn(async (text: string, params?: any[]) => {
      queries.push({ text, params });
      return { rows: [] };
    }),
    withTenantTransaction: vi.fn(async (_t: string, cb: any) => cb({ query: vi.fn(async () => ({ rows: [] })) })),
  };
  return { db, queries };
}

function pyOk(engine: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      job_id: ANALYSIS, engine_type: engine, status: 'COMPLETED', findings: [],
      metrics: { additional_metrics: { telemetry: { peakMemoryBytes: 1234 }, ...extra } },
    }),
  };
}

const config = (threshold = '8'): any => ({
  get: vi.fn((key: string, def?: string) =>
    key === 'ANALYSIS_SERVICE_URL' ? 'http://analysis-test:8000' : key === 'ANALYSIS_STREAM_THRESHOLD_MB' ? threshold : def
  ),
});

function job(data: Partial<AnalysisJobData>): Job<AnalysisJobData> {
  return {
    name: 'analyze',
    data: {
      analysisId: ANALYSIS, organizationId: ORG, projectId: PROJ, userId: USER,
      engineTypes: ['MFS_BLACKBOX'], targetRelease: 'S4H_2023',
      files: [{ fileId: FILE_A, fileName: 'telegrams.csv', storagePath: 'tenants/o/projects/p/f/telegrams.csv', artifactType: 'CSV' }],
      configuration: {},
      ...data,
    } as AnalysisJobData,
  } as Job<AnalysisJobData>;
}

async function readWebStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

describe('AnalysisExecutor: MFS streaming transport', () => {
  const LOG = 'timestamp,type,hu_id,cp\n' + 'x,MOVE,HU_1,CP01\n'.repeat(1000);
  let storage: any;
  beforeEach(() => {
    vi.clearAllMocks();
    storage = {
      headCleanObject: vi.fn(async () => ({ sizeBytes: 20 * 1024 * 1024 })),
      getCleanStream: vi.fn(async () => Readable.from([Buffer.from(LOG.slice(0, 5000)), Buffer.from(LOG.slice(5000))])),
    };
  });

  it('streams large logs read only by MFS_BLACKBOX to /api/v1/analyze/stream (framed, no raw_content)', async () => {
    const { db, queries } = makeDb();
    let url = '';
    let body: Buffer = Buffer.alloc(0);
    let init: any;
    global.fetch = vi.fn(async (u: string, i: any) => {
      url = u;
      init = i;
      body = await readWebStream(i.body);
      return pyOk('MFS_BLACKBOX', { inputMode: 'STREAM' });
    }) as any;

    await new AnalysisProcessor(db, storage, config()).process(job({}));

    expect(url).toBe('http://analysis-test:8000/api/v1/analyze/stream');
    expect(init.duplex).toBe('half');
    const nl = body.indexOf(0x0a);
    const meta = JSON.parse(body.subarray(0, nl).toString());
    expect(meta.engine_type).toBe('MFS_BLACKBOX');
    expect(meta.tenant_id).toBe(ORG);
    expect(meta.raw_content).toBeUndefined();
    expect(meta.configuration.sourceFileId).toBe(FILE_A);
    expect(body.subarray(nl + 1).toString()).toBe(LOG);
    expect(storage.headCleanObject).toHaveBeenCalledTimes(1);
    const orchestration = queries.find((q) => q.text.includes('SET orchestration') && String(q.params?.[0]).includes('"calls"'));
    const calls = JSON.parse(orchestration!.params![0]).calls;
    expect(calls[0]).toMatchObject({ transport: 'STREAM', bytes: 20 * 1024 * 1024, peakMemoryBytes: 1234, outcome: 'COMPLETED' });
  });

  it('keeps small logs inline', async () => {
    storage.headCleanObject = vi.fn(async () => ({ sizeBytes: 1024 }));
    const { db } = makeDb();
    const urls: string[] = [];
    global.fetch = vi.fn(async (u: string, i: any) => {
      urls.push(u);
      expect(JSON.parse(i.body).raw_content).toBe(LOG);
      return pyOk('MFS_BLACKBOX');
    }) as any;
    await new AnalysisProcessor(db, storage, config()).process(job({}));
    expect(urls).toEqual(['http://analysis-test:8000/api/v1/analyze']);
  });

  it('stays inline when a non-streaming engine reads the same artifact', async () => {
    const { db } = makeDb();
    const urls: string[] = [];
    global.fetch = vi.fn(async (u: string) => {
      urls.push(u);
      return pyOk('MFS_BLACKBOX');
    }) as any;
    await new AnalysisProcessor(db, storage, config()).process(job({ engineTypes: ['MFS_BLACKBOX', 'OPD_GUARD'] }));
    expect(storage.headCleanObject).not.toHaveBeenCalled();
    expect(urls.every((u) => u.endsWith('/api/v1/analyze'))).toBe(true);
  });
});

describe('AnalysisExecutor: stored API baselines', () => {
  const record = { id: BASELINE, name: 'SO API', version: '1.4.0', format: 'OPENAPI', sha256: sha(OPENAPI_JSON), storageKey: 'k' };
  const storage: any = { getCleanStream: vi.fn(async () => Readable.from([Buffer.from(OPENAPI_JSON)])) };
  const apiJob = (extra: Partial<AnalysisJobData> = {}) =>
    job({
      engineTypes: ['API_CHANGE_GUARD'],
      files: [{ fileId: FILE_A, fileName: 'v2.json', storagePath: 'k2', artifactType: 'JSON' }],
      ...extra,
    });

  it('passes the explicitly selected baseline as configuration.stored_baseline and records it', async () => {
    const { db, queries } = makeDb();
    const baselines = {
      resolveForAnalysis: vi.fn(async () => ({ baseline: record, explicit: true })),
      loadContent: vi.fn(async () => OPENAPI_JSON),
    };
    let sent: any;
    global.fetch = vi.fn(async (_u: string, i: any) => {
      sent = JSON.parse(i.body);
      return pyOk('API_CHANGE_GUARD');
    }) as any;
    const proc = new AnalysisProcessor(db, storage, config(), undefined, undefined, undefined, undefined, undefined, undefined, baselines as any);
    await proc.process(apiJob({ apiBaselineId: BASELINE }));
    expect(baselines.resolveForAnalysis).toHaveBeenCalledWith(ORG, PROJ, BASELINE);
    expect(sent.configuration.stored_baseline).toMatchObject({ id: BASELINE, explicit: true, sha256: sha(OPENAPI_JSON), content: OPENAPI_JSON });
    expect(queries.some((q) => String(q.params?.[0]).includes('"apiBaseline"') && String(q.params?.[0]).includes('EXPLICIT'))).toBe(true);
  });

  it('fails the API_CHANGE_GUARD call (no service call) when the stored baseline cannot be loaded', async () => {
    const { db, queries } = makeDb();
    const baselines = {
      resolveForAnalysis: vi.fn(async () => ({ baseline: record, explicit: false })),
      loadContent: vi.fn(async () => {
        throw new Error("API baseline 'SO API' failed its integrity check");
      }),
    };
    global.fetch = vi.fn() as any;
    const proc = new AnalysisProcessor(db, storage, config(), undefined, undefined, undefined, undefined, undefined, undefined, baselines as any);
    await proc.process(apiJob());
    expect(global.fetch).not.toHaveBeenCalled();
    expect(queries.find((q) => q.text.includes('UPDATE analyses SET status = $1'))?.params?.[0]).toBe('FAILED');
  });

  it('does not touch baselines for other engines', async () => {
    const { db } = makeDb();
    const baselines = { resolveForAnalysis: vi.fn(), loadContent: vi.fn() };
    global.fetch = vi.fn(async () => pyOk('OPD_GUARD')) as any;
    const proc = new AnalysisProcessor(db, storage, config(), undefined, undefined, undefined, undefined, undefined, undefined, baselines as any);
    await proc.process(apiJob({ engineTypes: ['OPD_GUARD'] }));
    expect(baselines.resolveForAnalysis).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------------------------------ abapGit overlay
async function zip(entries: Array<[string, string]>): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on('data', (c: Buffer) => chunks.push(c));
  await new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', reject);
    for (const [name, content] of entries) archive.append(content, { name });
    archive.finalize();
  });
  return Buffer.concat(chunks);
}

/** Minimal STORED zip writer that keeps entry names verbatim (archiver normalises '../'). */
function rawZip(entries: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = zlibCrc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('abapGit ZIP object-name scan (snapshot overlay)', () => {
  it('maps abapGit file names to object names', () => {
    expect(abapGitObjectName('src/zcl_sales_helper.clas.abap')).toBe('ZCL_SALES_HELPER');
    expect(abapGitObjectName('src/#bobf#cl_lib.clas.locals_imp.abap')).toBe('/BOBF/CL_LIB');
    expect(abapGitObjectName('src/zsales.tabl.xml')).toBe('ZSALES');
    expect(abapGitObjectName('README.md')).toBeNull();
    expect(abapGitObjectName('.abapgit.xml')).toBeNull();
  });

  it('scans .abap and .xml members (content + object names), ignores other files', async () => {
    const buffer = await zip([
      ['.abapgit.xml', '<asx:abap><DATA><MASTER_LANGUAGE>E</MASTER_LANGUAGE></DATA></asx:abap>'],
      ['src/zcl_sales_helper.clas.abap', "SELECT * FROM mara INTO TABLE @lt. CALL FUNCTION 'BAPI_SALESORDER_CREATEFROMDAT2'."],
      ['src/zsales.tabl.xml', '<ROLLNAME>MATNR</ROLLNAME><CHECKTABLE>T001W</CHECKTABLE>'],
      ['docs/notes.txt', 'SHOULD_NOT_BE_SCANNED'],
    ]);
    expect(isZipBuffer(buffer)).toBe(true);
    const result = await extractAbapGitCandidateNames(buffer);
    expect(result.names).toEqual(expect.arrayContaining(['MARA', 'BAPI_SALESORDER_CREATEFROMDAT2', 'MATNR', 'T001W', 'ZCL_SALES_HELPER', 'ZSALES']));
    expect(result.names).not.toContain('SHOULD_NOT_BE_SCANNED');
    expect(result.membersScanned).toBe(3);
  });

  it('rejects zip-slip archives before inflating members', async () => {
    const buffer = rawZip([['../../evil.prog.abap', 'SELECT * FROM mara.']]);
    await expect(extractAbapGitCandidateNames(buffer)).rejects.toMatchObject({ response: { code: 'ZIP_SLIP_PATH_TRAVERSAL_DETECTED' } });
  });

  it('ReleasedObjectsProvider classifies names found inside a base64 abapGit ZIP', async () => {
    const buffer = await zip([['src/zcl_x.clas.abap', 'SELECT * FROM mara. DATA lo TYPE REF TO cl_gui_alv_grid.']]);
    const classifyObjects = vi.fn(async ({ names }: { names: string[] }) => ({
      source: 'SAP/abap-atc-cr-cv-s4hc', snapshotId: 'snap', snapshotSeq: 1, contentSha256: 'c',
      release: { productCode: 'S4H', editionCode: 'CLOUD', releaseCode: '2408', label: '2408', exactMatch: true },
      objects: names.filter((n) => n === 'MARA').map((n) => ({
        sapObjectType: 'TABL', name: n, tadirObject: 'TABL', state: 'released', cleanCoreLevel: 'A',
        classicApiState: null, successorClassification: null, successorConcept: null, successors: [],
      })),
    }));
    const provider = new ReleasedObjectsProvider({ classifyObjects } as any);
    const result = await provider.forArtifact(buffer.toString('base64'), 'base64', 'S4HANA_CLOUD_2408');
    expect(classifyObjects).toHaveBeenCalledTimes(1);
    const names = (classifyObjects.mock.calls[0] as any)[0].names as string[];
    expect(names).toEqual(expect.arrayContaining(['MARA', 'CL_GUI_ALV_GRID', 'ZCL_X']));
    expect(result?.objects.map((o) => o.objectName)).toEqual(['MARA']);
    // Non-ZIP binaries still get no overlay
    expect(await provider.forArtifact(Buffer.from('%PDF-1.7').toString('base64'), 'base64', 'S4HANA_CLOUD_2408')).toBeNull();
  });
});
