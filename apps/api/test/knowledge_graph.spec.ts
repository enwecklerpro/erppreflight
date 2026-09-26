import { describe, expect, it, vi } from 'vitest';
import {
  canonicalObjectType,
  normalizeState,
  parseRepositoryFile,
} from '../src/modules/knowledge-graph/sources/cloudification-normalizer';
import {
  CLOUDIFICATION_FILE_CATALOG,
  CloudificationRepositorySource,
  resolveCloudificationFiles,
} from '../src/modules/knowledge-graph/sources/cloudification-repository.source';
import { assertAllowedSourceUrl, secureFetch, SourceFetchError } from '../src/modules/knowledge-graph/sources/secure-fetch';
import {
  parseRosaExport,
  rosaReleaseContext,
  RosaFileImportSource,
} from '../src/modules/knowledge-graph/sources/rosa-file-import.source';
import { compositeContentHash, stateContentHash } from '../src/modules/knowledge-graph/sync/knowledge-sync.pipeline';
import { extractCandidateNames } from '../src/modules/knowledge-graph/released-objects.provider';
import { ClassifyRequestSchema, LookupQuerySchema } from '../src/modules/knowledge-graph/knowledge-graph.types';
import { parseCliArgs } from '../src/modules/knowledge-graph/cli/knowledge-sync.cli';

// Records copied verbatim from the live Cloudification Repository (2026-09-26).
const RELEASE_INFO = {
  formatVersion: '1',
  objectReleaseInfo: [
    {
      tadirObject: 'TABL', tadirObjName: 'MARA', objectType: 'TABL', objectKey: 'MARA', softwareComponent: 'S4CORE',
      applicationComponent: 'LO-MD-MM', state: 'notToBeReleased', successorClassification: 'multipleObjects',
      successors: [
        { tadirObject: 'DDLS', tadirObjName: 'I_PRODUCTSALES', objectType: 'CDS_STOB', objectKey: 'I_PRODUCTSALES' },
        { tadirObject: 'DDLS', tadirObjName: 'I_PRODUCT', objectType: 'CDS_STOB', objectKey: 'I_PRODUCT' },
      ],
    },
    {
      tadirObject: 'DDLS', tadirObjName: 'I_PRODUCT', objectType: 'CDS_STOB', objectKey: 'I_PRODUCT',
      softwareComponent: 'S4CORE', applicationComponent: 'LO-MD-MM', state: 'released', successorClassification: '',
    },
    {
      tadirObject: 'FUGR', tadirObjName: '1001UEB', objectType: 'FUNC', objectKey: 'BAPI_MATERIAL_SAVEDATA',
      softwareComponent: 'S4CORE', applicationComponent: 'LO-MD-MM', state: 'notToBeReleased',
      successorClassification: 'oneObject',
      successors: [{ tadirObject: 'BDEF', tadirObjName: 'I_PRODUCTTP_2', objectType: 'BDEF', objectKey: 'I_PRODUCTTP_2' }],
    },
    {
      tadirObject: 'BDEF', tadirObjName: 'I_MAINTENANCENOTIFICATIONTP_2', objectType: 'BDEF',
      objectKey: 'I_MAINTENANCENOTIFICATIONTP_2', softwareComponent: 'S4CORE', applicationComponent: 'PM-WOC-MN',
      state: 'deprecated', successorClassification: 'concept', successorConceptName: 'I_MaintenanceNotificationTP_3',
    },
    { tadirObject: 'TABL', objectType: 'TABL', state: 'released' }, // malformed: rejected
    {
      tadirObject: 'TABL', tadirObjName: 'MARA', objectType: 'TABL', objectKey: 'MARA', state: 'released',
    }, // duplicate identity: first wins
  ],
};

describe('Cloudification normalizer', () => {
  it('parses the real file shape, rejects malformed records and dedupes by (objectType, objectKey)', () => {
    const parsed = parseRepositoryFile(RELEASE_INFO, 'RELEASE_CONTRACT');
    expect(parsed.formatVersion).toBe('1');
    expect(parsed.records).toHaveLength(4);
    expect(parsed.rejectedRecords).toBe(1);
    expect(parsed.duplicateRecords).toBe(1);
    const mara = parsed.records.find((r) => r.objectKey === 'MARA')!;
    expect(mara.supportState).toBe('NOT_RELEASED');
    expect(mara.objectType).toBe('TABLE');
    // successors sorted deterministically
    expect(mara.successors.map((s) => s.objectKey)).toEqual(['I_PRODUCT', 'I_PRODUCTSALES']);
    const bapi = parsed.records.find((r) => r.objectKey === 'BAPI_MATERIAL_SAVEDATA')!;
    expect(bapi.objectType).toBe('BAPI');
    expect(bapi.tadirObjName).toBe('1001UEB');
    const concept = parsed.records.find((r) => r.objectKey === 'I_MAINTENANCENOTIFICATIONTP_2')!;
    expect(concept.successorConcept).toBe('I_MaintenanceNotificationTP_3');
    expect(concept.supportState).toBe('DEPRECATED');
  });

  it('parses the classification (format 2) file and derives clean core levels only when unambiguous', () => {
    const parsed = parseRepositoryFile(
      {
        formatVersion: '2',
        objectClassifications: [
          { tadirObject: 'CLAS', tadirObjName: 'CL_ABAP_TYPEDESCR', objectType: 'CLAS', objectKey: 'CL_ABAP_TYPEDESCR',
            softwareComponent: 'SAP_BASIS', applicationComponent: 'BC-ABA-LA', state: 'classicAPI',
            labels: ['transactional-consistent', 'remote-enabled', 'remote-enabled'] },
          { tadirObject: 'CLAS', tadirObjName: 'CF_REBD_BUILDING', objectType: 'CLAS', objectKey: 'CF_REBD_BUILDING',
            state: 'noAPI' },
        ],
      },
      'CLASSIC_API_CLASSIFICATION'
    );
    expect(parsed.records.map((r) => [r.objectKey, r.supportState, r.cleanCoreLevel])).toEqual([
      ['CL_ABAP_TYPEDESCR', 'CLASSIC_API', 'B'],
      ['CF_REBD_BUILDING', 'NO_API', 'D'],
    ]);
    expect(parsed.records[0].labels).toEqual(['remote-enabled', 'transactional-consistent']);
    expect(normalizeState('RELEASE_CONTRACT', 'deprecated').cleanCoreLevel).toBeNull();
    expect(normalizeState('RELEASE_CONTRACT', 'released')).toEqual({ supportState: 'RELEASED', cleanCoreLevel: 'A' });
  });

  it('refuses a file with the wrong top-level shape', () => {
    expect(() => parseRepositoryFile({ objectClassifications: [] }, 'RELEASE_CONTRACT')).toThrow(/objectReleaseInfo/);
  });

  it('maps repository types to canonical knowledge types', () => {
    expect(canonicalObjectType('CDS_STOB', 'I_PRODUCT')).toBe('CDS_VIEW');
    expect(canonicalObjectType('BADI_DEF', 'X')).toBe('BADI');
    expect(canonicalObjectType('FUNC', 'RFC_READ_TABLE')).toBe('FUNCTION_MODULE');
    expect(canonicalObjectType('SUSO', 'M_MATE_WRK')).toBe('AUTHORIZATION_OBJECT');
    expect(canonicalObjectType('ZZZZ', 'X')).toBe('SAP_OBJECT');
  });

  it('content hashes are deterministic and sensitive to successor changes', () => {
    const [a] = parseRepositoryFile(RELEASE_INFO, 'RELEASE_CONTRACT').records;
    const [b] = parseRepositoryFile(JSON.parse(JSON.stringify(RELEASE_INFO)), 'RELEASE_CONTRACT').records;
    expect(stateContentHash(a)).toBe(stateContentHash(b));
    expect(stateContentHash({ ...a, successors: a.successors.slice(1) })).not.toBe(stateContentHash(a));
  });
});

describe('secure source retrieval', () => {
  it('only allows https on allow-listed hosts without credentials or custom ports', () => {
    const hosts = ['raw.githubusercontent.com'];
    expect(assertAllowedSourceUrl('https://raw.githubusercontent.com/SAP/x.json', hosts).hostname).toBe(
      'raw.githubusercontent.com'
    );
    for (const bad of [
      'http://raw.githubusercontent.com/x.json',
      'https://evil.example.com/x.json',
      'https://user:pw@raw.githubusercontent.com/x.json',
      'https://raw.githubusercontent.com:8443/x.json',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(() => assertAllowedSourceUrl(bad, hosts)).toThrow(SourceFetchError);
    }
  });

  const hosts = ['raw.githubusercontent.com'] as const;
  const body = (text: string, headers: Record<string, string> = {}) =>
    vi.fn(async () => new Response(text, { status: 200, headers }));

  it('hashes the body and returns provenance headers', async () => {
    const res = await secureFetch('https://raw.githubusercontent.com/a.json', {
      allowedHosts: hosts,
      maxBytes: 1000,
      timeoutMs: 1000,
      fetchImpl: body('{"a":1}', { etag: '"abc"' }) as any,
    });
    expect(res.sha256).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
    expect(res.etag).toBe('"abc"');
    expect(res.bytes).toBe(7);
  });

  it('enforces the size cap on declared and streamed length', async () => {
    await expect(
      secureFetch('https://raw.githubusercontent.com/a.json', {
        allowedHosts: hosts,
        maxBytes: 3,
        timeoutMs: 1000,
        fetchImpl: body('{"a":1}') as any,
      })
    ).rejects.toThrow(/cap/);
  });

  it('never follows redirects and reports HTTP errors', async () => {
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
    await expect(
      secureFetch('https://raw.githubusercontent.com/a.json', { allowedHosts: hosts, maxBytes: 10, timeoutMs: 1000, fetchImpl: redirect as any })
    ).rejects.toThrow(/redirect/);
    const notFound = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(
      secureFetch('https://raw.githubusercontent.com/a.json', { allowedHosts: hosts, maxBytes: 10, timeoutMs: 1000, fetchImpl: notFound as any })
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('Cloudification adapter', () => {
  it('knows every verified repository file with a release context', () => {
    const names = CLOUDIFICATION_FILE_CATALOG.map((f) => f.fileName);
    expect(names).toContain('objectReleaseInfoLatest.json');
    expect(names).toContain('objectReleaseInfo_PCE2023_3.json');
    expect(CLOUDIFICATION_FILE_CATALOG.find((f) => f.fileName === 'objectReleaseInfo_PCE2023_3.json')!.release.releaseCode).toBe(
      '2023 FPS03'
    );
    expect(() => resolveCloudificationFiles(['objectReleaseInfo_PCE1999.json'])).toThrow(/Unknown/);
  });

  it('retrieves, hashes and normalizes through the injected fetch (no network)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(RELEASE_INFO), { status: 200, headers: { etag: '"e1"' } }));
    const src = new CloudificationRepositorySource({ files: ['objectReleaseInfoLatest.json'], fetchImpl: fetchImpl as any });
    const [doc] = await src.retrieve();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/objectReleaseInfoLatest.json',
      expect.objectContaining({ redirect: 'manual' })
    );
    expect(doc.trustLevel).toBe('OFFICIAL_REPOSITORY');
    expect(doc.release).toMatchObject({ productCode: 'SAP_S4HANA', editionCode: 'CLOUD_PUBLIC', releaseCode: 'LATEST' });
    expect(doc.records).toHaveLength(4);
    expect(doc.sourceVersion).toBe('"e1"');
  });

  it('composite content hash is order independent and changes with any document', () => {
    const d = (k: string, sha: string) =>
      ({ sourceKey: k, scheme: 'RELEASE_CONTRACT', release: { productCode: 'P', editionCode: 'E', releaseCode: 'R' }, sha256: sha }) as any;
    expect(compositeContentHash('v1', [d('a', '1'), d('b', '2')])).toBe(compositeContentHash('v1', [d('b', '2'), d('a', '1')]));
    expect(compositeContentHash('v1', [d('a', '1')])).not.toBe(compositeContentHash('v1', [d('a', '2')]));
    expect(compositeContentHash('v1', [d('a', '1')])).not.toBe(compositeContentHash('v2', [d('a', '1')]));
  });
});

describe('ROSA file import adapter', () => {
  const exportFile = {
    rosaExportVersion: 1,
    system_type: 'private_cloud',
    version: '2023_3',
    responses: [
      {
        found: true,
        object: {
          objectType: 'TABL', objectName: 'MARA', state: 'deprecated', cleanCoreLevel: 'A', applicationComponent: 'LO-MD-MM',
          softwareComponent: 'S4CORE',
          successor: { classification: 'successor available', objects: [{ objectType: 'DDLS', objectName: 'I_PRODUCT' }] },
        },
      },
      {
        results: [
          { input: 'BSEG', status: 'not_found' },
          { input: 'CL_X', status: 'compliant', objectType: 'CLAS', objectName: 'CL_ABAP_TYPEDESCR', state: 'classicAPI' },
        ],
      },
    ],
  };

  it('maps ROSA responses to normalized states without leaking ROSA shapes', async () => {
    const docs = await new RosaFileImportSource([{ label: 'x.json', content: Buffer.from(JSON.stringify(exportFile)) }]).retrieve();
    expect(docs.map((d) => d.scheme).sort()).toEqual(['CLASSIC_API_CLASSIFICATION', 'RELEASE_CONTRACT']);
    const contract = docs.find((d) => d.scheme === 'RELEASE_CONTRACT')!;
    expect(contract.trustLevel).toBe('THIRD_PARTY');
    expect(contract.release.releaseCode).toBe('2023 FPS03');
    expect(contract.records[0]).toMatchObject({
      sapObjectType: 'TABL',
      objectKey: 'MARA',
      supportState: 'DEPRECATED',
      successors: [{ sapObjectType: 'CDS_STOB', objectKey: 'I_PRODUCT' }],
    });
  });

  it('rejects invalid exports and unsupported versions', () => {
    expect(() => parseRosaExport(Buffer.from('{'), 'bad')).toThrow(/JSON/);
    expect(() => parseRosaExport(Buffer.from(JSON.stringify({ ...exportFile, responses: [{}] })), 'empty')).toThrow(/no valid/);
    expect(() => rosaReleaseContext('private_cloud', 'next')).toThrow(/Unsupported/);
    expect(rosaReleaseContext('public_cloud', 'latest')).toMatchObject({ editionCode: 'CLOUD_PUBLIC', releaseCode: 'LATEST' });
  });
});

describe('knowledge API contracts', () => {
  it('extracts candidate ABAP identifiers including namespaces', () => {
    const names = extractCandidateNames("SELECT * FROM mara. CALL FUNCTION 'BAPI_USER_GET_DETAIL'. /bobf/cl_tra_x=>y( ).");
    expect(names).toEqual(expect.arrayContaining(['MARA', 'BAPI_USER_GET_DETAIL', '/BOBF/CL_TRA_X', 'SELECT']));
  });

  it('validates lookup and classify requests', () => {
    expect(LookupQuerySchema.parse({ q: ' mara ' })).toEqual({ q: 'mara', limit: 20 });
    expect(LookupQuerySchema.safeParse({ q: '' }).success).toBe(false);
    expect(LookupQuerySchema.safeParse({ q: 'x', limit: 500 }).success).toBe(false);
    expect(ClassifyRequestSchema.safeParse({ names: [] }).success).toBe(false);
    expect(ClassifyRequestSchema.safeParse({ names: ['MARA'], targetRelease: 'S4H_2023' }).success).toBe(true);
  });

  it('parses CLI arguments', () => {
    expect(parseCliArgs(['--', '--files', 'a.json,b.json', '--no-watches', '--json'])).toEqual({
      files: ['a.json', 'b.json'],
      localDir: null,
      rosaFiles: [],
      watches: false,
      json: true,
    });
    expect(() => parseCliArgs(['--bogus'])).toThrow(/Unknown/);
  });
});
