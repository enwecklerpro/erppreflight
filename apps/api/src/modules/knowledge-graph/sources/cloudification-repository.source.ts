import {
  CLOUDIFICATION_ADAPTER_ID,
  ReleaseContext,
  ReleasedObjectSource,
  SourceDocument,
  StateScheme,
} from '../knowledge-graph.types';
import { CR_PARSER_VERSION, parseRepositoryFile } from './cloudification-normalizer';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { secureFetch, SecureFetchResult } from './secure-fetch';

async function readLocalMirrorFile(filePath: string, maxBytes: number): Promise<SecureFetchResult> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`${filePath} is not a file`);
  if (stat.size > maxBytes) throw new Error(`${filePath} exceeds the ${maxBytes} byte cap`);
  const body = await fs.readFile(filePath);
  return {
    body,
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: body.length,
    etag: null,
    lastModified: stat.mtime.toUTCString(),
    status: 200,
  };
}

export const CLOUDIFICATION_ALLOWED_HOSTS = ['raw.githubusercontent.com'] as const;
export const CLOUDIFICATION_DEFAULT_BASE_URL =
  'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/';
export const CLOUDIFICATION_REPOSITORY_URL = 'https://github.com/SAP/abap-atc-cr-cv-s4hc';

const S4 = { productCode: 'SAP_S4HANA', productName: 'SAP S/4HANA / SAP Cloud ERP' };
const PUBLIC = {
  editionCode: 'CLOUD_PUBLIC',
  editionName: 'SAP Cloud ERP (S/4HANA Cloud Public Edition)',
  deployment: 'CLOUD_PUBLIC' as const,
};
const PRIVATE = {
  editionCode: 'CLOUD_PRIVATE',
  editionName: 'SAP Cloud ERP Private (S/4HANA Cloud Private Edition / on-premise)',
  deployment: 'CLOUD_PRIVATE' as const,
};
const BTP = {
  productCode: 'SAP_BTP_ABAP',
  productName: 'SAP BTP, ABAP environment',
  editionCode: 'ABAP_ENVIRONMENT',
  editionName: 'SAP BTP ABAP environment (Steampunk)',
  deployment: 'BTP' as const,
};

export interface CloudificationFileSpec {
  fileName: string;
  scheme: StateScheme;
  title: string;
  release: ReleaseContext;
}

function pceRelease(year: number, fps: number | null): ReleaseContext {
  const code = fps === null ? String(year) : `${year} FPS0${fps}`;
  return {
    ...S4,
    ...PRIVATE,
    releaseCode: code,
    releaseLabel: `SAP S/4HANA ${code}`,
    featurePack: fps === null ? null : `FPS0${fps}`,
    sortOrder: year * 100 + (fps ?? 0),
    isRolling: false,
    description:
      fps === null
        ? `Released-object list published as objectReleaseInfo_PCE${year}.json (initial feature pack stack of ${year}).`
        : `Released-object list published as objectReleaseInfo_PCE${year}_${fps}.json.`,
  };
}

/**
 * Every file of the official repository this adapter understands. Names and
 * content were verified against the live repository (2026-09-26). The README
 * documents that *Latest files track the current release and the *_PCE<year>_<n>
 * files are published per Feature Pack Stack of SAP Cloud ERP Private.
 */
export const CLOUDIFICATION_FILE_CATALOG: readonly CloudificationFileSpec[] = [
  {
    fileName: 'objectReleaseInfoLatest.json',
    scheme: 'RELEASE_CONTRACT',
    title: 'Cloudification Repository — released APIs, SAP Cloud ERP (latest)',
    release: {
      ...S4,
      ...PUBLIC,
      releaseCode: 'LATEST',
      releaseLabel: 'SAP Cloud ERP — current release',
      featurePack: null,
      sortOrder: 999_999,
      isRolling: true,
      description: 'Rolling list maintained for the current SAP Cloud ERP (public) release.',
    },
  },
  {
    fileName: 'objectReleaseInfo_PCELatest.json',
    scheme: 'RELEASE_CONTRACT',
    title: 'Cloudification Repository — released APIs, SAP Cloud ERP Private (latest)',
    release: {
      ...S4,
      ...PRIVATE,
      releaseCode: 'LATEST',
      releaseLabel: 'SAP Cloud ERP Private — latest release',
      featurePack: null,
      sortOrder: 999_999,
      isRolling: true,
      description: 'Rolling list valid for the latest SAP Cloud ERP Private version.',
    },
  },
  {
    fileName: 'objectClassifications_SAP.json',
    scheme: 'CLASSIC_API_CLASSIFICATION',
    title: 'Cloudification Repository — classic API classification (Clean Core level B)',
    release: {
      ...S4,
      ...PRIVATE,
      releaseCode: 'LATEST',
      releaseLabel: 'SAP Cloud ERP Private — latest release',
      featurePack: null,
      sortOrder: 999_999,
      isRolling: true,
      description: 'Rolling list valid for the latest SAP Cloud ERP Private version.',
    },
  },
  {
    fileName: 'objectReleaseInfo_BTPLatest.json',
    scheme: 'RELEASE_CONTRACT',
    title: 'Cloudification Repository — released APIs, SAP BTP ABAP environment (latest)',
    release: {
      ...BTP,
      releaseCode: 'LATEST',
      releaseLabel: 'SAP BTP ABAP environment — current release',
      featurePack: null,
      sortOrder: 999_999,
      isRolling: true,
      description: 'Rolling list for the current SAP BTP ABAP environment release.',
    },
  },
  ...(
    [
      [2022, null],
      [2022, 1],
      [2022, 2],
      [2023, 0],
      [2023, 1],
      [2023, 2],
      [2023, 3],
      [2025, 0],
      [2025, 1],
    ] as Array<[number, number | null]>
  ).map(([year, fps]) => ({
    fileName: fps === null ? `objectReleaseInfo_PCE${year}.json` : `objectReleaseInfo_PCE${year}_${fps}.json`,
    scheme: 'RELEASE_CONTRACT' as const,
    title: `Cloudification Repository — released APIs, SAP S/4HANA ${fps === null ? year : `${year} FPS0${fps}`}`,
    release: pceRelease(year, fps),
  })),
];

export interface CloudificationSourceOptions {
  baseUrl?: string;
  /** Subset of catalog file names to retrieve (default: all). */
  files?: string[];
  maxBytesPerFile?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /**
   * Operator-only (CLI) offline mode: read the catalog files from a local mirror
   * directory instead of HTTPS (air-gapped installs, reproducing a snapshot).
   * Never exposed through the HTTP API.
   */
  localDirectory?: string;
}

export function resolveCloudificationFiles(files?: string[]): CloudificationFileSpec[] {
  if (!files || files.length === 0) {
    return [...CLOUDIFICATION_FILE_CATALOG];
  }
  const wanted = new Set(files.map((f) => f.trim()).filter(Boolean));
  const selected = CLOUDIFICATION_FILE_CATALOG.filter((f) => wanted.has(f.fileName));
  const unknown = [...wanted].filter((f) => !CLOUDIFICATION_FILE_CATALOG.some((c) => c.fileName === f));
  if (unknown.length > 0) {
    throw new Error(`Unknown Cloudification Repository file(s): ${unknown.join(', ')}`);
  }
  return selected;
}

/**
 * Official SAP Cloudification Repository adapter (C §27, Part 11.2).
 * Retrieval is HTTPS-only against an allow-listed host, streamed with a size
 * cap, and hashed; parsing validates every record.
 */
export class CloudificationRepositorySource implements ReleasedObjectSource {
  readonly adapterId = CLOUDIFICATION_ADAPTER_ID;
  readonly parserVersion = CR_PARSER_VERSION;
  private readonly baseUrl: string;
  private readonly files: CloudificationFileSpec[];

  constructor(private readonly options: CloudificationSourceOptions = {}) {
    const base = options.baseUrl ?? CLOUDIFICATION_DEFAULT_BASE_URL;
    this.baseUrl = base.endsWith('/') ? base : `${base}/`;
    this.files = resolveCloudificationFiles(options.files);
  }

  describe() {
    return {
      adapterId: this.adapterId,
      title: 'SAP Cloudification Repository (SAP/abap-atc-cr-cv-s4hc)',
      documents: this.files.map((f) => ({
        sourceKey: this.sourceKey(f),
        url: this.options.localDirectory ? `file://${path.resolve(this.options.localDirectory, f.fileName)}` : this.baseUrl + f.fileName,
      })),
    };
  }

  private sourceKey(f: CloudificationFileSpec): string {
    return `sap-cloudification-repository:${f.fileName}`;
  }

  async retrieve(): Promise<SourceDocument[]> {
    const documents: SourceDocument[] = [];
    // Sequential retrieval keeps peak memory at one file (~12 MB) at a time.
    for (const spec of this.files) {
      const maxBytes = this.options.maxBytesPerFile ?? 64 * 1024 * 1024;
      const local = this.options.localDirectory;
      const url = local ? `file://${path.resolve(local, spec.fileName)}` : this.baseUrl + spec.fileName;
      const fetched = local
        ? await readLocalMirrorFile(path.resolve(local, spec.fileName), maxBytes)
        : await secureFetch(url, {
            allowedHosts: CLOUDIFICATION_ALLOWED_HOSTS,
            maxBytes,
            timeoutMs: this.options.timeoutMs ?? 120_000,
            fetchImpl: this.options.fetchImpl,
          });
      let json: unknown;
      try {
        json = JSON.parse(fetched.body.toString('utf-8'));
      } catch {
        throw new Error(`${spec.fileName}: body is not valid JSON`);
      }
      const parsed = parseRepositoryFile(json, spec.scheme);
      if (parsed.records.length === 0) {
        throw new Error(`${spec.fileName}: no valid records (refusing to publish an empty snapshot)`);
      }
      documents.push({
        sourceKey: this.sourceKey(spec),
        title: spec.title,
        url,
        publisher: 'SAP SE',
        trustLevel: 'OFFICIAL_REPOSITORY',
        release: spec.release,
        scheme: spec.scheme,
        sha256: fetched.sha256,
        bytes: fetched.bytes,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        sourceVersion: fetched.etag,
        formatVersion: parsed.formatVersion,
        retrievedAt: (this.options.now?.() ?? new Date()).toISOString(),
        records: parsed.records,
        rejectedRecords: parsed.rejectedRecords,
      });
    }
    return documents;
  }
}
