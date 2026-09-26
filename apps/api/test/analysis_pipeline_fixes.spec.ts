import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { AnalysisProcessor, AnalysisJobData } from '../src/modules/jobs/analysis.processor';
import {
  encodeArtifactContent,
  resolveArtifactType,
} from '../src/modules/jobs/analysis-executor';
import { mapEvidenceList, mapEvidenceRow } from '../src/modules/findings/evidence.mapper';
import { FindingsService } from '../src/modules/findings/findings.service';
import { AnalysesService } from '../src/modules/analyses/analyses.service';
import { ProjectsService, toProjectResponse } from '../src/modules/projects/projects.service';
import {
  IngestionService,
  REDACTABLE_TEXT_FORMATS,
  toFileListItem,
} from '../src/modules/ingestion/ingestion.service';
import { MimeMagicValidator } from '../src/modules/ingestion/mime-magic.validator';
import { ArchiveSafetyGuard } from '../src/modules/ingestion/archive-safety.guard';
import { ClamAvScanner } from '../src/modules/ingestion/clamav.scanner';
import { SecretRedactorService } from '../src/modules/redaction/secret-redactor.service';
import { S3StorageService } from '../src/modules/storage/s3-storage.service';

const ORG = 'b2222222-2222-4222-8222-222222222222';
const PROJ = 'c3333333-3333-4333-8333-333333333333';
const USER = 'd4444444-4444-4444-8444-444444444444';
const ANALYSIS = 'a1111111-1111-4111-8111-111111111111';
const FILE_A = 'f1111111-1111-4111-8111-111111111111';
const FILE_B = 'f2222222-2222-4222-8222-222222222222';
const SHA = 'a'.repeat(64);

function finding(ruleId: string) {
  return {
    id: 'e5555555-5555-4555-8555-555555555555',
    ruleId,
    severity: 'MAJOR',
    category: 'Cat',
    title: 'T',
    description: 'D',
    confidence: 'VERIFIED',
    confidenceScore: 1.0,
    remediation: 'R',
    affectedObjects: [{ name: 'OBJ' }],
    evidence: [{ artifactPath: 'opd.xml', lineNumber: 3, sha256: SHA }],
  };
}

function pyResponse(status: string, findings: any[] = [], engine = 'OPD_GUARD') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      job_id: ANALYSIS,
      engine_type: engine,
      status,
      findings,
      error_message: status === 'COMPLETED' ? null : 'engine error',
    }),
  };
}

function makeDb() {
  const queries: Array<{ text: string; params?: any[]; options?: any }> = [];
  const txQueries: Array<{ text: string; params?: any[] }> = [];
  const db: any = {
    query: vi.fn().mockImplementation(async (text: string, params?: any[], options?: any) => {
      queries.push({ text, params, options });
      return { rows: [] };
    }),
    withTenantTransaction: vi.fn().mockImplementation(async (_tenant: string, cb: any) =>
      cb({
        query: vi.fn().mockImplementation(async (text: string, params?: any[]) => {
          txQueries.push({ text, params });
          return { rows: [] };
        }),
      })
    ),
  };
  const finalStatus = () =>
    queries.find((q) => q.text.includes('UPDATE analyses SET status = $1'))?.params?.[0];
  return { db, queries, txQueries, finalStatus };
}

const config: any = {
  get: vi.fn((key: string, def?: string) =>
    key === 'ANALYSIS_SERVICE_URL' ? 'http://analysis-test:8000' : def
  ),
};

function job(data: Partial<AnalysisJobData>, name = 'analyze'): Job<AnalysisJobData> {
  return {
    name,
    data: {
      analysisId: ANALYSIS,
      organizationId: ORG,
      projectId: PROJ,
      userId: USER,
      engineTypes: ['OPD_GUARD'],
      targetRelease: 'S4H_2023',
      files: [{ fileId: FILE_A, fileName: 'opd.xml', storagePath: 'tenants/o/projects/p/a/opd.xml', artifactType: 'XML' }],
      configuration: {},
      ...data,
    } as AnalysisJobData,
  } as Job<AnalysisJobData>;
}

describe('AnalysisProcessor: Python status semantics, S3 failures, multi-file, binary encoding', () => {
  let storage: any;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = {
      getCleanStream: vi.fn().mockImplementation(async () => Readable.from([Buffer.from('<a/>')])),
    };
  });

  it('marks analysis FAILED (not COMPLETED) when Python returns status FAILED, and does not persist diagnostic findings', async () => {
    const { db, finalStatus, txQueries } = makeDb();
    global.fetch = vi.fn().mockResolvedValue(pyResponse('FAILED', [finding('ENGINE_EXECUTION_ERROR')])) as any;

    await new AnalysisProcessor(db, storage, config).process(job({}));

    expect(finalStatus()).toBe('FAILED');
    expect(txQueries.some((q) => q.text.includes('INSERT INTO findings'))).toBe(false);
  });

  it('marks analysis PARTIAL when Python returns status PARTIAL, persisting its findings', async () => {
    const { db, finalStatus, txQueries } = makeDb();
    global.fetch = vi.fn().mockResolvedValue(pyResponse('PARTIAL', [finding('R1')])) as any;

    await new AnalysisProcessor(db, storage, config).process(job({}));

    expect(finalStatus()).toBe('PARTIAL');
    expect(txQueries.filter((q) => q.text.includes('INSERT INTO findings')).length).toBe(1);
    expect(txQueries.filter((q) => q.text.includes('INSERT INTO evidence')).length).toBe(1);
  });

  it('marks PARTIAL when one engine COMPLETED and another reported FAILED', async () => {
    const { db, finalStatus } = makeDb();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(pyResponse('COMPLETED', [finding('R1')]))
      .mockResolvedValueOnce(pyResponse('FAILED', [], 'FORM_DOCTOR')) as any;

    await new AnalysisProcessor(db, storage, config).process(
      job({ engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'] })
    );
    expect(finalStatus()).toBe('PARTIAL');
  });

  it('S3 fetch errors are not swallowed: analysis is marked FAILED and the error is rethrown for BullMQ retry', async () => {
    const { db, queries } = makeDb();
    storage.getCleanStream = vi.fn().mockRejectedValue(new Error('NoSuchKey'));
    global.fetch = vi.fn() as any;

    await expect(new AnalysisProcessor(db, storage, config).process(job({}))).rejects.toThrow(/NoSuchKey/);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(
      queries.some((q) => q.text.includes("SET status = 'FAILED'") && q.params?.[0] === ANALYSIS)
    ).toBe(true);
    expect(queries.some((q) => q.text.includes('UPDATE analyses SET status = $1') && q.params?.[0] === 'COMPLETED')).toBe(false);
  });

  it('fans out every engine over every resolved file and aggregates findings', async () => {
    const { db, finalStatus, txQueries } = makeDb();
    const bodies: any[] = [];
    global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return pyResponse('COMPLETED', [finding(`R_${body.engine_type}`)], body.engine_type);
    }) as any;

    await new AnalysisProcessor(db, storage, config).process(
      job({
        engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'],
        files: [
          { fileId: FILE_A, fileName: 'a.xml', storagePath: 'tenants/o/projects/p/a/a.xml', artifactType: 'XML' },
          { fileId: FILE_B, fileName: 'b.json', storagePath: 'tenants/o/projects/p/b/b.json', artifactType: 'JSON' },
        ],
      })
    );

    expect(storage.getCleanStream).toHaveBeenCalledTimes(2);
    expect(storage.getCleanStream).toHaveBeenCalledWith('tenants/o/projects/p/a/a.xml');
    expect(storage.getCleanStream).toHaveBeenCalledWith('tenants/o/projects/p/b/b.json');
    expect(bodies.length).toBe(4);
    expect(bodies.map((b) => `${b.engine_type}:${b.artifact_type}`).sort()).toEqual([
      'FORM_DOCTOR:JSON',
      'FORM_DOCTOR:XML',
      'OPD_GUARD:JSON',
      'OPD_GUARD:XML',
    ]);
    expect(bodies.every((b) => b.configuration.sourceFileId)).toBe(true);
    expect(txQueries.filter((q) => q.text.includes('INSERT INTO findings')).length).toBe(4);
    // Finding row ids are unique even though Python reused the same id
    const ids = txQueries.filter((q) => q.text.includes('INSERT INTO findings')).map((q) => q.params?.[0]);
    expect(new Set(ids).size).toBe(4);
    expect(finalStatus()).toBe('COMPLETED');
  });

  it('sends binary artifacts (ZIP/XLSX) base64-encoded with raw_content_encoding=base64 and text as utf-8', async () => {
    const { db } = makeDb();
    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80, 0x81]);
    storage.getCleanStream = vi.fn().mockImplementation(async (key: string) =>
      Readable.from([key.endsWith('.zip') ? zipBytes : Buffer.from('<root>ü</root>', 'utf-8')])
    );
    const bodies: any[] = [];
    global.fetch = vi.fn().mockImplementation(async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return pyResponse('COMPLETED');
    }) as any;

    await new AnalysisProcessor(db, storage, config).process(
      job({
        files: [
          { fileId: FILE_A, fileName: 't.zip', storagePath: 'k/t.zip', artifactType: 'ZIP' },
          { fileId: FILE_B, fileName: 'c.xml', storagePath: 'k/c.xml', artifactType: 'XML' },
        ],
      })
    );

    const zipBody = bodies.find((b) => b.artifact_type === 'ZIP');
    const xmlBody = bodies.find((b) => b.artifact_type === 'XML');
    expect(zipBody.raw_content_encoding).toBe('base64');
    expect(Buffer.from(zipBody.raw_content, 'base64').equals(zipBytes)).toBe(true);
    expect(xmlBody.raw_content_encoding).toBe('utf-8');
    expect(xmlBody.raw_content).toBe('<root>ü</root>');
  });

  it('processes scheduled-preflight repeatable jobs by creating an analysis over CLEAN project files', async () => {
    const queries: any[] = [];
    const db: any = {
      query: vi.fn().mockImplementation(async (text: string, params: any[], options: any) => {
        queries.push({ text, params, options });
        if (text.includes('FROM uploaded_files')) {
          return {
            rows: [
              { id: FILE_A, file_name: 'a.xml', storage_path: 'k/a.xml', metadata: { detectedFormat: 'XML' } },
              { id: FILE_B, file_name: 'doc.pdf', storage_path: 'k/doc.pdf', metadata: { detectedFormat: 'PDF' } },
            ],
          };
        }
        return { rows: [] };
      }),
      withTenantTransaction: vi.fn(),
    };
    global.fetch = vi.fn().mockResolvedValue(pyResponse('COMPLETED')) as any;

    await new AnalysisProcessor(db, storage, config).process({
      name: 'scheduled-preflight',
      data: { scheduleId: 's1', organizationId: ORG, projectId: PROJ, userId: USER, engineTypes: ['OPD_GUARD'], targetRelease: 'S4H_2023' },
    } as any);

    const fileQuery = queries.find((q) => q.text.includes('FROM uploaded_files'));
    expect(fileQuery.text).toContain("quarantine_status = 'CLEAN'");
    expect(fileQuery.params).toEqual([ORG, PROJ]);
    expect(queries.some((q) => q.text.includes('INSERT INTO analyses'))).toBe(true);
    // PDF is not analysable -> only one engine call
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Artifact type resolution & encoding helpers', () => {
  it('maps ingestion detected formats to analysis artifact types', () => {
    expect(resolveArtifactType('XSD', 'a.xsd')).toBe('XML');
    expect(resolveArtifactType('PROG', 'z.prog')).toBe('ABAP');
    expect(resolveArtifactType('WSDL', 'svc.wsdl')).toBe('WSDL');
    expect(resolveArtifactType(undefined, 'book.xlsx')).toBe('XLSX');
    expect(resolveArtifactType('PDF', 'x.pdf')).toBeNull();
  });

  it('base64 round-trips binary buffers and keeps text as utf-8', () => {
    const bin = Buffer.from([0, 1, 2, 250, 251]);
    const enc = encodeArtifactContent(bin, 'XLSX');
    expect(enc.rawContentEncoding).toBe('base64');
    expect(Buffer.from(enc.rawContent, 'base64').equals(bin)).toBe(true);
    expect(encodeArtifactContent(Buffer.from('{"a":1}'), 'JSON')).toEqual({
      rawContent: '{"a":1}',
      rawContentEncoding: 'utf-8',
    });
  });
});

describe('Evidence camelCase mapping', () => {
  const row = {
    id: 'e1',
    finding_id: 'f1',
    artifact_path: 'src/opd.xml',
    line_number: 12,
    column_number: 4,
    snippet: '<x/>',
    sha256: SHA,
    provenance: 'VERIFIED',
    source_title: null,
    source_url: null,
    trust_score: '0.850',
    created_at: new Date('2026-09-01T00:00:00Z'),
    embedding: [0.1, 0.2],
  };

  it('maps snake_case evidence rows (incl. NUMERIC strings) to the camelCase contract', () => {
    const ev = mapEvidenceRow(row);
    expect(ev).toEqual({
      id: 'e1',
      findingId: 'f1',
      artifactPath: 'src/opd.xml',
      lineNumber: 12,
      columnNumber: 4,
      snippet: '<x/>',
      sha256: SHA,
      provenance: 'VERIFIED',
      sourceTitle: null,
      sourceUrl: null,
      trustScore: 0.85,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    expect(ev).not.toHaveProperty('embedding');
    expect(ev).not.toHaveProperty('artifact_path');
    expect(mapEvidenceList(null)).toEqual([]);
  });

  it('FindingsService and AnalysesService return camelCase evidence', async () => {
    const findingRow = {
      id: 'f1',
      analysis_id: ANALYSIS,
      project_id: PROJ,
      organization_id: ORG,
      engine: 'OPD_GUARD',
      rule_id: 'R',
      severity: 'MAJOR',
      confidence_score: '1.0',
      evidence: [row],
    };
    const db: any = { query: vi.fn().mockResolvedValue({ rows: [findingRow] }) };
    const findings = new FindingsService(db);
    const f = await findings.findById(ORG, 'f1');
    expect(f.evidence[0].artifactPath).toBe('src/opd.xml');
    expect(f.evidence[0].lineNumber).toBe(12);
    expect(db.query.mock.calls[0][0]).not.toContain('json_agg(e.*)');

    const analysesDb: any = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: ANALYSIS, organization_id: ORG }] })
        .mockResolvedValueOnce({ rows: [findingRow] }),
    };
    const analyses = new AnalysesService(analysesDb, {} as any);
    const list = await analyses.getFindingsForAnalysis(ORG, ANALYSIS);
    expect(list[0].evidence[0]).toMatchObject({ artifactPath: 'src/opd.xml', sha256: SHA, trustScore: 0.85 });
  });
});

describe('Projects camelCase contract & tenant scoping', () => {
  const row = {
    id: PROJ,
    organization_id: ORG,
    name: 'Migration',
    slug: 'migration-1234',
    description: null,
    target_release: 'S4H_2023',
    created_by: USER,
    baseline_analysis_id: null,
    created_at: new Date('2026-09-01T00:00:00Z'),
    updated_at: new Date('2026-09-02T00:00:00Z'),
    total_findings: 3,
  };

  it('maps rows to { id, organizationId, name, description, targetRelease, status, createdAt, updatedAt }', () => {
    expect(toProjectResponse(row)).toMatchObject({
      id: PROJ,
      organizationId: ORG,
      name: 'Migration',
      description: null,
      targetRelease: 'S4H_2023',
      status: 'ACTIVE',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      totalFindings: 3,
    });
  });

  it('findAll/findOne return camelCase; update and delete are scoped by organization_id', async () => {
    const db: any = { query: vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 }) };
    const svc = new ProjectsService(db);
    const all = await svc.findAll(ORG);
    expect(all[0].organizationId).toBe(ORG);
    expect(all[0]).not.toHaveProperty('organization_id');
    expect((await svc.findOne(ORG, PROJ)).targetRelease).toBe('S4H_2023');

    db.query.mockClear();
    await svc.update(ORG, PROJ, { name: 'New' });
    const updateCall = db.query.mock.calls.find((c: any[]) => c[0].includes('UPDATE projects'));
    expect(updateCall[0]).toContain('WHERE organization_id = $4 AND id = $5');
    expect(updateCall[1].slice(3)).toEqual([ORG, PROJ]);

    db.query.mockClear();
    await svc.remove(ORG, PROJ);
    const deleteCall = db.query.mock.calls.find((c: any[]) => c[0].includes('DELETE FROM projects'));
    expect(deleteCall[0]).toContain('organization_id = $1 AND id = $2');
    expect(deleteCall[1]).toEqual([ORG, PROJ]);
  });

  it('cross-tenant update/delete are rejected with 404 before any mutation', async () => {
    const db: any = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const svc = new ProjectsService(db);
    await expect(svc.update('other-org', PROJ, { name: 'x' })).rejects.toThrow(/not found/);
    await expect(svc.remove('other-org', PROJ)).rejects.toThrow(/not found/);
    expect(db.query.mock.calls.some((c: any[]) => /UPDATE projects|DELETE FROM projects/.test(c[0]))).toBe(false);
  });

  it('diagnostic bundle reads artifacts from uploaded_files (no non-existent artifacts table)', async () => {
    const db: any = { query: vi.fn().mockResolvedValue({ rows: [row] }) };
    await new ProjectsService(db).generateDiagnosticBundle(ORG, PROJ);
    const sqls = db.query.mock.calls.map((c: any[]) => c[0] as string);
    expect(sqls.some((q: string) => /FROM artifacts\b/.test(q))).toBe(false);
    expect(sqls.some((q: string) => q.includes('FROM uploaded_files'))).toBe(true);
    expect(sqls.some((q: string) => q.includes('a.name'))).toBe(false);
  });
});

describe('Ingestion: redaction coverage, clean promotion, file list contract', () => {
  const cfg = new ConfigService({ CLAMAV_MOCK_MODE: 'true' });
  const redactor = new SecretRedactorService(new ConfigService({}));

  function makeService(storage: any, db: any) {
    return new IngestionService(
      db,
      storage,
      new MimeMagicValidator(),
      new ArchiveSafetyGuard(),
      new ClamAvScanner(cfg),
      redactor
    );
  }

  it('covers every text format the MIME validator can return (incl. WSDL, EDMX, XSD)', () => {
    for (const fmt of ['XML', 'XSD', 'WSDL', 'EDMX', 'XDP', 'JSON', 'CSV', 'ABAP', 'TXT', 'PROG', 'INCL']) {
      expect(REDACTABLE_TEXT_FORMATS.has(fmt)).toBe(true);
    }
    expect(REDACTABLE_TEXT_FORMATS.has('ZIP')).toBe(false);
  });

  for (const [ext, content] of [
    ['wsdl', '<?xml version="1.0"?><definitions><binding password="Sup3rS3cretP@ssw0rd!"/></definitions>'],
    ['edmx', '<?xml version="1.0"?><Edmx><Annotation password="Sup3rS3cretP@ssw0rd!"/></Edmx>'],
    ['xsd', '<?xml version="1.0"?><schema><element default="x" password="Sup3rS3cretP@ssw0rd!"/></schema>'],
  ] as const) {
    it(`redacts secrets in .${ext} before writing the clean object, and deletes the quarantine original`, async () => {
      const storage: any = {
        putCleanObject: vi.fn().mockResolvedValue(undefined),
        deleteQuarantineObject: vi.fn().mockResolvedValue(undefined),
      };
      const db: any = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      const svc = makeService(storage, db);
      const res: any = await svc.processFile(
        { id: 'f1', organization_id: 'o1', project_id: 'p1', file_name: `svc.${ext}`, storage_path: 'q/key' },
        Buffer.from(content)
      );
      expect(res.status).toBe('CLEAN');
      const written = storage.putCleanObject.mock.calls[0][1].toString('utf-8');
      expect(written).not.toContain('Sup3rS3cretP@ssw0rd!');
      expect(storage.deleteQuarantineObject).toHaveBeenCalledWith('q/key');
      const cleanUpdate = db.query.mock.calls.find((c: any[]) => c[0].includes("quarantine_status = 'CLEAN'"));
      expect(cleanUpdate[1][0]).toBe('REDACTED');
      expect(JSON.parse(cleanUpdate[1][4]).detectedFormat).toBe(ext.toUpperCase());
    });
  }

  it('rejects (never promotes) an artifact whose quarantine object cannot be read', async () => {
    const storage: any = {
      getQuarantineStream: vi.fn().mockRejectedValue(new Error('NoSuchKey')),
      putCleanObject: vi.fn(),
      deleteQuarantineObject: vi.fn(),
    };
    const db: any = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const svc = makeService(storage, db);
    await expect(
      svc.processFile({ id: 'f1', organization_id: 'o1', project_id: 'p1', file_name: 'a.xml', storage_path: 'q/key' })
    ).rejects.toThrow();
    expect(storage.putCleanObject).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some((c: any[]) => c[0].includes("quarantine_status = 'REJECTED'"))).toBe(true);
  });

  it('listFiles returns id, fileName, originalName, detectedFormat, sizeBytes, quarantineStatus, createdAt', async () => {
    const db: any = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: FILE_A,
            project_id: PROJ,
            file_name: 'svc.wsdl',
            file_size: '2048',
            mime_type: 'application/xml',
            quarantine_status: 'CLEAN',
            redaction_status: 'PASSED',
            checksum_sha256: SHA,
            metadata: { originalName: 'svc.wsdl', detectedFormat: 'WSDL' },
            created_at: new Date('2026-09-01T00:00:00Z'),
          },
        ],
      }),
    };
    const svc = makeService({}, db);
    const [item] = await svc.listFiles(ORG, PROJ);
    expect(item).toMatchObject({
      id: FILE_A,
      fileName: 'svc.wsdl',
      originalName: 'svc.wsdl',
      detectedFormat: 'WSDL',
      sizeBytes: 2048,
      quarantineStatus: 'CLEAN',
      createdAt: '2026-09-01T00:00:00.000Z',
      file_name: 'svc.wsdl',
      quarantine_status: 'CLEAN',
    });
    expect(db.query.mock.calls[0][1]).toEqual([ORG, PROJ]);
    expect(toFileListItem({ id: 'x', file_name: 'a.json', metadata: '{}' }).detectedFormat).toBe('JSON');
  });

  it('download pre-signed URL requested by ingestion is 900s', async () => {
    const storage: any = {
      createDownloadPresignedUrl: vi.fn().mockResolvedValue({ downloadUrl: 'u', expiresInSeconds: 900 }),
    };
    const db: any = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'f', file_name: 'a.xml', storage_path: 'k', quarantine_status: 'CLEAN', checksum_sha256: SHA }],
      }),
    };
    await makeService(storage, db).getPresignedDownloadUrl('o', 'p', 'f');
    expect(storage.createDownloadPresignedUrl.mock.calls[0][0].ttlSeconds).toBeLessThanOrEqual(900);
  });
});

describe('S3StorageService.ensureBucketsExist', () => {
  it('does not cache initialization when a bucket could not be created, and retries on next use', async () => {
    const svc = new S3StorageService(new ConfigService({}));
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' }));
    (svc as any).s3 = { send };
    await svc.ensureBucketsExist();
    expect((svc as any).bucketsInitialized).toBe(false);
    const callsAfterFirst = send.mock.calls.length;

    send.mockReset();
    send.mockResolvedValue({});
    await svc.ensureBucketsExist();
    expect(send.mock.calls.length).toBeGreaterThan(0);
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect((svc as any).bucketsInitialized).toBe(true);

    send.mockClear();
    await svc.ensureBucketsExist();
    expect(send).not.toHaveBeenCalled();
  });
});
