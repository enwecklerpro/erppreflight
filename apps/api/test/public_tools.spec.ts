import { describe, expect, it, vi, afterEach } from 'vitest';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  evaluateSeoGate,
  objectKeyToSlug,
  slugToObjectKey,
  SEO_MIN_RELATED_OBJECTS,
} from '@erppreflight/schemas';
import { PublicToolsService, GLOBAL_OBJECT_SQL, type ReleaseFact } from '../src/modules/public-tools/public-tools.service';
import {
  PUBLIC_PAGE_DATA_RATE_LIMIT,
  PUBLIC_TOOLS_RATE_LIMIT,
  PUBLIC_XML_CHECK_RATE_LIMIT,
  PublicToolsController,
} from '../src/modules/public-tools/public-tools.controller';
import {
  ApiLifecycleQuerySchema,
  XmlFieldCheckSchema,
} from '../src/modules/public-tools/public-tools.types';
import { AUTH_RATE_LIMIT_KEY } from '../src/modules/auth/guards/auth-rate-limit.guard';

afterEach(() => vi.unstubAllGlobals());

function fact(p: Partial<ReleaseFact>): ReleaseFact {
  return {
    productCode: 'SAP_S4HANA',
    editionCode: 'CLOUD_PRIVATE',
    editionName: 'SAP Cloud ERP Private',
    releaseId: 'r',
    releaseCode: '2023 FPS00',
    releaseLabel: 'SAP S/4HANA 2023 FPS00',
    sortOrder: 202300,
    isRolling: false,
    scheme: 'RELEASE_CONTRACT',
    state: 'released',
    supportState: 'RELEASED',
    cleanCoreLevel: 'A',
    successorClassification: null,
    successorConcept: null,
    successors: [],
    evidence: { title: 'CR', url: 'https://x', trustLevel: 'OFFICIAL_REPOSITORY', retrievedAt: '2026-09-26T00:00:00Z' },
    ...p,
  };
}

/** DatabaseService double recording every statement. */
function makeDb(handler: (sql: string, params: any[]) => any[] = () => []) {
  const statements: { sql: string; params: any[]; opts: any }[] = [];
  const db: any = {
    query: vi.fn(async (sql: string, params: any[] = [], opts: any = {}) => {
      statements.push({ sql, params, opts });
      return { rows: handler(sql, params) };
    }),
  };
  return { db, statements };
}

const config: any = { get: () => 'http://analysis.test' };

describe('object slugs', () => {
  it('maps SAP keys to reversible URL slugs', () => {
    expect(objectKeyToSlug('MARA')).toBe('mara');
    expect(objectKeyToSlug('I_PRODUCT')).toBe('i-product');
    expect(objectKeyToSlug('/SAPAPO/MATKEY')).toBe('~sapapo~matkey');
    expect(slugToObjectKey('i-product')).toBe('I_PRODUCT');
    expect(slugToObjectKey('~sapapo~matkey')).toBe('/SAPAPO/MATKEY');
    expect(objectKeyToSlug('SRVD  X 0001')).toBeNull();
    for (const bad of ['../etc', 'MARA', 'a b', 'x.xml', '']) expect(slugToObjectKey(bad)).toBeNull();
  });
});

describe('SEO quality gate (Part 02 §2.9)', () => {
  const base = {
    isGlobalPublished: true,
    objectType: 'TABLE',
    states: [{ supportState: 'NOT_RELEASED', successorCount: 1, successorConcept: null }],
    evidence: [{ trustLevel: 'OFFICIAL_REPOSITORY', retrievedAt: '2026-09-26T00:00:00Z' }],
    relatedCount: SEO_MIN_RELATED_OBJECTS,
  };
  it('indexes only pages with state, successor (or explicit none), official evidence and related objects', () => {
    expect(evaluateSeoGate(base).indexable).toBe(true);
    expect(evaluateSeoGate({ ...base, relatedCount: 1 }).failed).toEqual(['RELATED_OBJECTS']);
    expect(evaluateSeoGate({ ...base, states: [] }).failed).toContain('RELEASE_STATE');
    expect(
      evaluateSeoGate({ ...base, states: [{ supportState: 'NOT_RELEASED', successorCount: 0, successorConcept: null }] }).failed
    ).toEqual(['SUCCESSOR_OR_EXPLICIT_NONE']);
    // Released objects need no successor: "no successor required" is an explicit statement.
    expect(
      evaluateSeoGate({ ...base, states: [{ supportState: 'RELEASED', successorCount: 0, successorConcept: null }] }).indexable
    ).toBe(true);
    expect(evaluateSeoGate({ ...base, evidence: [{ trustLevel: 'THIRD_PARTY', retrievedAt: 'x' }] }).failed).toEqual(['EVIDENCE_SOURCE']);
    expect(evaluateSeoGate({ ...base, evidence: [{ trustLevel: 'OFFICIAL_REPOSITORY', retrievedAt: null }] }).indexable).toBe(false);
    expect(evaluateSeoGate({ ...base, isGlobalPublished: false }).failed).toEqual(['GLOBAL_REVIEWED']);
  });
});

describe('verdict and lifecycle', () => {
  it('bases the verdict on the latest private release and never invents a successor', () => {
    const latest = fact({ isRolling: true, sortOrder: 999999, releaseLabel: 'latest', supportState: 'NOT_RELEASED', state: 'notToBeReleased' });
    expect(PublicToolsService.verdict([latest])).toBe('NOT_RELEASED_NO_SUCCESSOR');
    expect(
      PublicToolsService.verdict([{ ...latest, successors: [{ sapObjectType: 'CDS_STOB', objectKey: 'I_PRODUCT', slug: 'i-product', supportState: 'RELEASED' }] }])
    ).toBe('SUCCESSOR_AVAILABLE');
    expect(PublicToolsService.verdict([{ ...latest, successorConcept: 'Use X' }])).toBe('CONCEPT_AVAILABLE');
    expect(PublicToolsService.verdict([latest, fact({ editionCode: 'CLOUD_PUBLIC', supportState: 'RELEASED' })])).toBe('RELEASED_ELSEWHERE');
    expect(PublicToolsService.verdict([fact({ scheme: 'CLASSIC_API_CLASSIFICATION', supportState: 'CLASSIC_API' })])).toBe('CLASSIC_API_ONLY');
    expect(PublicToolsService.verdict([])).toBe('NO_OFFICIAL_STATE');
    // Non-official evidence never drives the verdict.
    expect(PublicToolsService.verdict([fact({ evidence: { ...latest.evidence, trustLevel: 'THIRD_PARTY' } })])).toBe('NO_OFFICIAL_STATE');
  });

  it('computes first released / first deprecated per edition in release order', () => {
    const lc = PublicToolsService.lifecycle([
      fact({ releaseLabel: '2023', sortOrder: 202300, supportState: 'DEPRECATED' }),
      fact({ releaseLabel: '2022', sortOrder: 202200, supportState: 'RELEASED' }),
      fact({ releaseLabel: '2025', sortOrder: 202500, supportState: 'DEPRECATED' }),
    ]);
    expect(lc).toEqual([
      expect.objectContaining({ editionCode: 'CLOUD_PRIVATE', currentState: 'DEPRECATED', currentRelease: '2025', firstReleasedIn: '2022', firstDeprecatedIn: '2023', releaseCount: 3 }),
    ]);
  });
});

describe('PublicToolsService tenant isolation (Part 04 §4.14)', () => {
  it('filters every object statement to GLOBAL + PUBLISHED knowledge', async () => {
    const { db, statements } = makeDb((sql) => {
      if (sql.includes('FROM knowledge_snapshots')) return [{ id: 's', seq: 1 }];
      if (sql.includes('WITH c AS')) return [{ id: 'o1', object_key: 'MARA', sap_object_type: 'TABL', object_type: 'TABLE' }];
      return [];
    });
    const svc = new PublicToolsService(db, {} as any, {} as any, config);
    const res = await svc.successorLookup({ q: 'mara', limit: 5 });
    expect(res.results[0]).toMatchObject({ objectKey: 'MARA', slug: 'mara', verdict: 'NO_OFFICIAL_STATE' });
    expect((res.results[0] as any).id).toBeUndefined();
    const objectStatements = statements.filter((s) => /FROM knowledge_objects o/.test(s.sql));
    expect(objectStatements.length).toBeGreaterThan(0);
    for (const s of objectStatements) expect(s.sql).toContain(GLOBAL_OBJECT_SQL);
    const stateStatements = statements.filter((s) => s.sql.includes('knowledge_object_release_states s'));
    for (const s of stateStatements) expect(s.sql).toContain('s.organization_id IS NULL');
  });

  it('seo page 404s for unknown or non-slug keys without querying tenant rows', async () => {
    const { db, statements } = makeDb(() => []);
    const svc = new PublicToolsService(db, {} as any, {} as any, config);
    await expect(svc.seoObject('BAD SLUG')).rejects.toBeInstanceOf(NotFoundException);
    expect(statements).toHaveLength(0);
    await expect(svc.seoObject('va01')).rejects.toBeInstanceOf(NotFoundException);
    expect(statements[0].sql).toContain(GLOBAL_OBJECT_SQL);
    expect(statements[0].params).toEqual(['VA01']);
  });

  it('release diff runs in public-only mode and strips internal ids', async () => {
    const releases: any = {
      releaseDiff: vi.fn(async () => ({ summary: {}, total: 1, items: [{ objectId: 'x', objectKey: 'MARA', changeType: 'ADDED' }] })),
    };
    const svc = new PublicToolsService(makeDb().db, {} as any, releases, config);
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    const out: any = await svc.releaseDiff({ fromRelease: a, toRelease: b, limit: 10, offset: 0 });
    expect(releases.releaseDiff).toHaveBeenCalledWith(expect.objectContaining({ publicOnly: true }));
    expect(out.items[0]).toEqual({ objectId: undefined, objectKey: 'MARA', changeType: 'ADDED', slug: 'mara' });
    await expect(svc.releaseDiff({ fromRelease: a, toRelease: a, limit: 10, offset: 0 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('XML field checker proxy', () => {
  const svc = () => new PublicToolsService(makeDb().db, {} as any, {} as any, config);
  const ok = {
    path: '/a', bytes: 7, wellFormed: true, rejected: null, error: null, exists: true, matchCount: 1,
    matches: [{ kind: 'element', path: '/a[1]', localName: 'a', namespaceUri: null, line: 1, column: 1, value: 'x', valueTruncated: false, childElementCount: 0 }],
    issues: [], document: { rootLocalName: 'a', rootNamespaceUri: null, namespaces: [], elementCount: 1, maxDepth: 1 },
  };

  it('validates input strictly (size cap, path syntax, no extra fields)', () => {
    expect(XmlFieldCheckSchema.safeParse({ xml: '<a/>', path: '/a' }).success).toBe(true);
    expect(XmlFieldCheckSchema.safeParse({ xml: '<a/>', path: 'a' }).success).toBe(false);
    expect(XmlFieldCheckSchema.safeParse({ xml: 'x'.repeat(90_001), path: '/a' }).success).toBe(false);
    expect(XmlFieldCheckSchema.safeParse({ xml: '<a/>', path: '/a', store: true }).success).toBe(false);
  });

  it('forwards to the stateless analysis-service checker and validates the answer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ok), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await svc().xmlFieldCheck({ xml: '<a>x</a>', path: '/a' });
    expect(res.exists).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('http://analysis.test/api/v1/tools/xml-field-check');
    expect(JSON.parse(init.body)).toEqual({ xml: '<a>x</a>', path: '/a' });
  });

  it('maps path errors to 400 and outages or contract drift to 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'bad step' }), { status: 422 })));
    await expect(svc().xmlFieldCheck({ xml: '<a/>', path: '/a' })).rejects.toBeInstanceOf(BadRequestException);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(svc().xmlFieldCheck({ xml: '<a/>', path: '/a' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ exists: 'yes' }), { status: 200 })));
    await expect(svc().xmlFieldCheck({ xml: '<a/>', path: '/a' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('PublicToolsController', () => {
  it('is rate limited per endpoint class', () => {
    const r = new Reflector();
    expect(r.get(AUTH_RATE_LIMIT_KEY, PublicToolsController)).toBe(PUBLIC_TOOLS_RATE_LIMIT);
    expect(r.get(AUTH_RATE_LIMIT_KEY, PublicToolsController.prototype.xmlFieldCheck)).toBe(PUBLIC_XML_CHECK_RATE_LIMIT);
    expect(r.get(AUTH_RATE_LIMIT_KEY, PublicToolsController.prototype.seoObject)).toBe(PUBLIC_PAGE_DATA_RATE_LIMIT);
    expect(r.get(AUTH_RATE_LIMIT_KEY, PublicToolsController.prototype.successors)).toBeUndefined();
  });

  it('rejects invalid queries before touching the service', () => {
    const svc: any = { successorLookup: vi.fn(), seoObject: vi.fn(), apiLifecycle: vi.fn() };
    const ctrl = new PublicToolsController(svc);
    expect(() => ctrl.successors({ q: '' })).toThrow(BadRequestException);
    expect(() => ctrl.seoObject('../../etc/passwd')).toThrow(BadRequestException);
    expect(() => ctrl.apiLifecycle({})).toThrow(BadRequestException);
    expect(svc.successorLookup).not.toHaveBeenCalled();
    expect(ApiLifecycleQuerySchema.safeParse({ deprecated: 'true' }).success).toBe(true);
  });
});
