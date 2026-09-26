import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  NormalizedObjectState,
  ROSA_FILE_ADAPTER_ID,
  ReleaseContext,
  ReleasedObjectSource,
  SourceDocument,
  StateScheme,
} from '../knowledge-graph.types';
import { canonicalObjectType, normalizeState } from './cloudification-normalizer';

/**
 * ROSA (Released Objects Search Assistant, github.com/ClementRingot/ROSA) adapter.
 *
 * ROSA is a self-hosted MCP/REST server over the SAP Cloudification Repository.
 * There is NO public ROSA instance (the hosted one was retired), so a live
 * adapter cannot be verified without a customer-operated endpoint. This adapter
 * therefore imports ROSA REST responses saved to a file ("ROSA export").
 *
 * Expected file format (JSON):
 *
 *   {
 *     "rosaExportVersion": 1,
 *     "system_type": "public_cloud" | "btp" | "private_cloud" | "on_premise",
 *     "version": "latest" | "2022" | "2023_3" | ...,        // PCE version, as ROSA's `version` param
 *     "retrievedAt": "2026-09-26T00:00:00Z",                  // optional
 *     "instanceUrl": "https://rosa.internal.example/",         // optional provenance
 *     "responses": [ <body of GET /api/search | /api/object | /api/successor | /api/compliance> , ... ]
 *   }
 *
 * Object/state fields are read from ROSA's documented response shapes
 * (objectType, objectName, state, cleanCoreLevel, applicationComponent,
 * softwareComponent, successor.objects[]). Domain code only ever sees the
 * normalized NormalizedObjectState — never ROSA's response structure (C §28).
 *
 * ROSA is a third-party mirror, so its facts carry trust level THIRD_PARTY and
 * never override the official repository adapter (they are stored as separate
 * evidence for the same fact).
 */
export const ROSA_PARSER_VERSION = 'rosa-file-import/1.0.0';

const RosaSuccessorObject = z.object({
  objectType: z.string().trim().min(1).max(20),
  objectName: z.string().trim().min(1).max(200),
});

const RosaObject = z.object({
  objectType: z.string().trim().min(1).max(20),
  objectName: z.string().trim().min(1).max(200),
  state: z.string().trim().min(1).max(40),
  cleanCoreLevel: z.string().max(2).optional().nullable(),
  applicationComponent: z.string().max(60).optional().nullable(),
  softwareComponent: z.string().max(60).optional().nullable(),
  successor: z
    .object({
      classification: z.string().max(80).optional().nullable(),
      objects: z.array(RosaSuccessorObject).max(200).optional(),
    })
    .optional()
    .nullable(),
});
type RosaObjectT = z.infer<typeof RosaObject>;

export const RosaExportSchema = z.object({
  rosaExportVersion: z.literal(1),
  system_type: z.enum(['public_cloud', 'btp', 'private_cloud', 'on_premise']),
  version: z.string().trim().min(1).max(20).default('latest'),
  retrievedAt: z.string().datetime().optional(),
  instanceUrl: z.string().url().max(500).optional(),
  responses: z.array(z.unknown()).min(1).max(10_000),
});
export type RosaExport = z.infer<typeof RosaExportSchema>;

/** ROSA uses TADIR types (DDLS) where the repository uses CDS_STOB for CDS entities. */
function toRepositoryObjectType(rosaType: string): string {
  const t = rosaType.toUpperCase();
  return t === 'DDLS' ? 'CDS_STOB' : t;
}

export function rosaReleaseContext(systemType: RosaExport['system_type'], version: string): ReleaseContext {
  if (systemType === 'public_cloud') {
    return {
      productCode: 'SAP_S4HANA',
      productName: 'SAP S/4HANA / SAP Cloud ERP',
      editionCode: 'CLOUD_PUBLIC',
      editionName: 'SAP Cloud ERP (S/4HANA Cloud Public Edition)',
      deployment: 'CLOUD_PUBLIC',
      releaseCode: 'LATEST',
      releaseLabel: 'SAP Cloud ERP — current release',
      featurePack: null,
      sortOrder: 999_999,
      isRolling: true,
    };
  }
  if (systemType === 'btp') {
    return {
      productCode: 'SAP_BTP_ABAP',
      productName: 'SAP BTP, ABAP environment',
      editionCode: 'ABAP_ENVIRONMENT',
      editionName: 'SAP BTP ABAP environment (Steampunk)',
      deployment: 'BTP',
      releaseCode: 'LATEST',
      releaseLabel: 'SAP BTP ABAP environment — current release',
      featurePack: null,
      sortOrder: 999_999,
      isRolling: true,
    };
  }
  const base = {
    productCode: 'SAP_S4HANA',
    productName: 'SAP S/4HANA / SAP Cloud ERP',
    editionCode: 'CLOUD_PRIVATE',
    editionName: 'SAP Cloud ERP Private (S/4HANA Cloud Private Edition / on-premise)',
    deployment: 'CLOUD_PRIVATE' as const,
  };
  const v = version.trim().toLowerCase();
  if (v === 'latest') {
    return {
      ...base,
      releaseCode: 'LATEST',
      releaseLabel: 'SAP Cloud ERP Private — latest release',
      featurePack: null,
      sortOrder: 999_999,
      isRolling: true,
    };
  }
  const m = /^(\d{4})(?:_(\d))?$/.exec(v);
  if (!m) {
    throw new Error(`Unsupported ROSA version '${version}' (expected latest, YYYY or YYYY_N)`);
  }
  const year = Number(m[1]);
  const fps = m[2] === undefined ? null : Number(m[2]);
  const code = fps === null ? String(year) : `${year} FPS0${fps}`;
  return {
    ...base,
    releaseCode: code,
    releaseLabel: `SAP S/4HANA ${code}`,
    featurePack: fps === null ? null : `FPS0${fps}`,
    sortOrder: year * 100 + (fps ?? 0),
    isRolling: false,
  };
}

function collectObjects(response: unknown): RosaObjectT[] {
  if (!response || typeof response !== 'object') return [];
  const r = response as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (Array.isArray(r.objects)) candidates.push(...r.objects); // /api/search
  if (r.object) candidates.push(r.object); // /api/object
  if (Array.isArray(r.results)) {
    // /api/successor and /api/compliance (not_found entries fail validation and are skipped)
    candidates.push(...r.results);
  }
  const out: RosaObjectT[] = [];
  for (const c of candidates) {
    const parsed = RosaObject.safeParse(c);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function toNormalized(o: RosaObjectT): NormalizedObjectState {
  const sapObjectType = toRepositoryObjectType(o.objectType);
  const objectKey = o.objectName.toUpperCase();
  const scheme: StateScheme =
    o.state === 'classicAPI' || o.state === 'noAPI' ? 'CLASSIC_API_CLASSIFICATION' : 'RELEASE_CONTRACT';
  const { supportState, cleanCoreLevel } = normalizeState(scheme, o.state);
  const successors = (o.successor?.objects ?? [])
    .map((s) => ({ sapObjectType: toRepositoryObjectType(s.objectType), objectKey: s.objectName.toUpperCase() }))
    .sort((a, b) => `${a.sapObjectType}|${a.objectKey}`.localeCompare(`${b.sapObjectType}|${b.objectKey}`));
  return {
    sapObjectType,
    objectKey,
    objectType: canonicalObjectType(sapObjectType, objectKey, o.objectType.toUpperCase()),
    tadirObject: o.objectType.toUpperCase(),
    tadirObjName: objectKey,
    softwareComponent: o.softwareComponent?.trim() || null,
    applicationComponent: o.applicationComponent?.trim() || null,
    scheme,
    state: o.state,
    supportState,
    cleanCoreLevel,
    successorClassification: o.successor?.classification?.trim() || null,
    successorConcept: null,
    successors,
    labels: [],
  };
}

export function parseRosaExport(raw: Buffer, sourceLabel: string, now: () => Date = () => new Date()): SourceDocument {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new Error(`${sourceLabel}: ROSA export is not valid JSON`);
  }
  const exp = RosaExportSchema.parse(json);
  const release = rosaReleaseContext(exp.system_type, exp.version);
  const byKey = new Map<string, NormalizedObjectState>();
  let rejected = 0;
  for (const response of exp.responses) {
    const objects = collectObjects(response);
    if (objects.length === 0) rejected++;
    for (const o of objects) {
      const n = toNormalized(o);
      const key = `${n.scheme}|${n.sapObjectType}|${n.objectKey}`;
      if (!byKey.has(key)) byKey.set(key, n);
    }
  }
  const records = [...byKey.values()];
  if (records.length === 0) {
    throw new Error(`${sourceLabel}: ROSA export contains no valid objects`);
  }
  // One scheme per document: classic-API records go to a sibling document.
  return {
    sourceKey: `rosa-export:${exp.system_type}:${exp.version}`,
    title: `ROSA export (${exp.system_type}, version ${exp.version})`,
    url: exp.instanceUrl ?? null,
    publisher: 'ROSA — Released Objects Search Assistant (community, MIT)',
    trustLevel: 'THIRD_PARTY',
    release,
    scheme: 'RELEASE_CONTRACT',
    sha256: createHash('sha256').update(raw).digest('hex'),
    bytes: raw.length,
    etag: null,
    lastModified: null,
    sourceVersion: exp.version,
    formatVersion: String(exp.rosaExportVersion),
    retrievedAt: exp.retrievedAt ?? now().toISOString(),
    records,
    rejectedRecords: rejected,
  };
}

/** Splits a parsed ROSA document by scheme so each persisted document has exactly one scheme. */
export function splitByScheme(doc: SourceDocument): SourceDocument[] {
  const groups = new Map<StateScheme, NormalizedObjectState[]>();
  for (const r of doc.records) {
    const list = groups.get(r.scheme) ?? [];
    list.push(r);
    groups.set(r.scheme, list);
  }
  return [...groups.entries()].map(([scheme, records]) => ({
    ...doc,
    sourceKey: scheme === 'RELEASE_CONTRACT' ? doc.sourceKey : `${doc.sourceKey}:classic`,
    scheme,
    records,
  }));
}

export class RosaFileImportSource implements ReleasedObjectSource {
  readonly adapterId = ROSA_FILE_ADAPTER_ID;
  readonly parserVersion = ROSA_PARSER_VERSION;

  constructor(
    private readonly files: Array<{ label: string; content: Buffer }>,
    private readonly now: () => Date = () => new Date()
  ) {}

  describe() {
    return {
      adapterId: this.adapterId,
      title: 'ROSA export file import',
      documents: this.files.map((f) => ({ sourceKey: `rosa-file:${f.label}`, url: null })),
    };
  }

  async retrieve(): Promise<SourceDocument[]> {
    return this.files.flatMap((f) => splitByScheme(parseRosaExport(f.content, f.label, this.now)));
  }
}
