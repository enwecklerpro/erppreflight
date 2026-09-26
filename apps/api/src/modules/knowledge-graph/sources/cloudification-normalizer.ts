import { z } from 'zod';
import type {
  CleanCoreLevel,
  KnowledgeObjectType,
  NormalizedObjectState,
  StateScheme,
  SupportState,
  SuccessorRef,
} from '../knowledge-graph.types';

/**
 * Parser/normalizer for the SAP Cloudification Repository JSON formats
 * (https://github.com/SAP/abap-atc-cr-cv-s4hc, folder src/). Shapes verified
 * against the live files on 2026-09-26:
 *
 *   objectReleaseInfo*.json      { formatVersion: "1", objectReleaseInfo: Record[] }
 *   objectClassifications_*.json { formatVersion: "2", objectClassifications: Record[] }
 *
 *   Record = { tadirObject, tadirObjName, objectType, objectKey, softwareComponent,
 *              applicationComponent, state, successorClassification?, successors?,
 *              successorConceptName?, labels? }
 *
 * Object identity is (objectType, objectKey): the same key can exist with two
 * types (e.g. I_PRODUCTTP_2 as BDEF and as CDS_STOB).
 */
export const CR_PARSER_VERSION = 'cloudification-normalizer/1.0.0';

const IDENT = z.string().trim().min(1).max(200);

const CrSuccessorSchema = z.object({
  tadirObject: z.string().max(10).optional(),
  tadirObjName: z.string().max(200).optional(),
  objectType: z.string().trim().min(1).max(20),
  objectKey: IDENT,
});

export const CrRecordSchema = z.object({
  tadirObject: z.string().trim().min(1).max(10),
  tadirObjName: IDENT,
  objectType: z.string().trim().min(1).max(20),
  objectKey: IDENT,
  softwareComponent: z.string().max(60).optional().nullable(),
  applicationComponent: z.string().max(60).optional().nullable(),
  state: z.string().trim().min(1).max(40),
  successorClassification: z.string().max(40).optional().nullable(),
  successorConceptName: z.string().max(300).optional().nullable(),
  successors: z.array(CrSuccessorSchema).max(200).optional(),
  labels: z.array(z.string().max(60)).max(20).optional(),
});
export type CrRecord = z.infer<typeof CrRecordSchema>;

const ReleaseInfoFileSchema = z.object({
  formatVersion: z.string().max(10).optional(),
  objectReleaseInfo: z.array(z.unknown()),
});
const ClassificationFileSchema = z.object({
  formatVersion: z.string().max(10).optional(),
  objectClassifications: z.array(z.unknown()),
});

/** Maps SAP repository object types (TADIR / CR objectType) to the canonical knowledge type. */
export function canonicalObjectType(sapObjectType: string, objectKey: string, tadirObject?: string | null): KnowledgeObjectType {
  const t = sapObjectType.toUpperCase();
  switch (t) {
    case 'TABL':
      return 'TABLE';
    case 'CDS_STOB':
    case 'DDLS':
      return 'CDS_VIEW';
    case 'CLAS':
      return 'CLASS';
    case 'INTF':
      return 'INTERFACE';
    case 'FUNC':
      return /^BAPI_/i.test(objectKey) ? 'BAPI' : 'FUNCTION_MODULE';
    case 'FUGR':
      return 'FUNCTION_GROUP';
    case 'BADI_DEF':
      return 'BADI';
    case 'ENHS':
      return 'ENHANCEMENT_SPOT';
    case 'BDEF':
      return 'BEHAVIOR_DEFINITION';
    case 'DTEL':
      return 'DATA_ELEMENT';
    case 'DOMA':
      return 'DOMAIN';
    case 'TTYP':
      return 'TABLE_TYPE';
    case 'SUSO':
    case 'AUTH':
      return 'AUTHORIZATION_OBJECT';
    case 'IWSV':
      return 'ODATA_SERVICE';
    case 'SRVD':
      return 'SERVICE_DEFINITION';
    case 'MSAG':
      return 'MESSAGE_CLASS';
    case 'XSLT':
      return 'TRANSFORMATION';
    case 'CHKO':
    case 'CHKC':
    case 'CHKV':
      return 'ATC_CHECK';
    case 'SAJC':
    case 'SAJT':
      return 'APPLICATION_JOB';
    case 'EVTB':
      return 'EVENT';
    case 'TRAN':
      return 'TRANSACTION_CODE';
    case 'IDOC':
      return 'IDOC_TYPE';
    default:
      if (tadirObject && tadirObject.toUpperCase() !== t) {
        return canonicalObjectType(tadirObject, objectKey, null);
      }
      return 'SAP_OBJECT';
  }
}

/**
 * Normalizes the raw `state` of a repository record.
 * Clean Core level (SAP clean core extensibility model, Aug 2025): level A =
 * released APIs, level B = classic APIs, level D = objects classified "noAPI".
 * Other states carry no unambiguous level and stay null (never guessed).
 */
export function normalizeState(
  scheme: StateScheme,
  rawState: string
): { supportState: SupportState; cleanCoreLevel: CleanCoreLevel | null } {
  const s = rawState.trim();
  if (scheme === 'CLASSIC_API_CLASSIFICATION') {
    if (s === 'classicAPI') return { supportState: 'CLASSIC_API', cleanCoreLevel: 'B' };
    if (s === 'noAPI') return { supportState: 'NO_API', cleanCoreLevel: 'D' };
    return { supportState: 'UNKNOWN', cleanCoreLevel: null };
  }
  switch (s) {
    case 'released':
      return { supportState: 'RELEASED', cleanCoreLevel: 'A' };
    case 'deprecated':
      return { supportState: 'DEPRECATED', cleanCoreLevel: null };
    case 'notToBeReleased':
      return { supportState: 'NOT_RELEASED', cleanCoreLevel: null };
    case 'notToBeReleasedStable':
      return { supportState: 'NOT_TO_BE_RELEASED_STABLE', cleanCoreLevel: null };
    default:
      return { supportState: 'UNKNOWN', cleanCoreLevel: null };
  }
}

function blankToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export function normalizeRecord(record: CrRecord, scheme: StateScheme): NormalizedObjectState {
  const sapObjectType = record.objectType.toUpperCase();
  const objectKey = record.objectKey.toUpperCase();
  const { supportState, cleanCoreLevel } = normalizeState(scheme, record.state);
  const successors: SuccessorRef[] = (record.successors ?? [])
    .map((s) => ({
      sapObjectType: s.objectType.toUpperCase(),
      objectKey: s.objectKey.toUpperCase(),
      tadirObject: s.tadirObject?.toUpperCase(),
      tadirObjName: s.tadirObjName?.toUpperCase(),
    }))
    // Deterministic order: identical input yields identical hashes.
    .sort((a, b) =>
      a.sapObjectType === b.sapObjectType
        ? a.objectKey.localeCompare(b.objectKey)
        : a.sapObjectType.localeCompare(b.sapObjectType)
    );

  return {
    sapObjectType,
    objectKey,
    objectType: canonicalObjectType(sapObjectType, objectKey, record.tadirObject),
    tadirObject: record.tadirObject.toUpperCase(),
    tadirObjName: record.tadirObjName.toUpperCase(),
    softwareComponent: blankToNull(record.softwareComponent),
    applicationComponent: blankToNull(record.applicationComponent),
    scheme,
    state: record.state.trim(),
    supportState,
    cleanCoreLevel,
    successorClassification: blankToNull(record.successorClassification),
    successorConcept: blankToNull(record.successorConceptName),
    successors,
    labels: [...new Set(record.labels ?? [])].sort(),
  };
}

export interface ParsedRepositoryFile {
  formatVersion: string | null;
  records: NormalizedObjectState[];
  rejectedRecords: number;
  duplicateRecords: number;
}

/**
 * Parses one repository file. Individual malformed records are rejected and
 * counted (never persisted); a file whose top-level shape is wrong fails.
 * Duplicate (objectType, objectKey) pairs keep the first occurrence.
 */
export function parseRepositoryFile(json: unknown, scheme: StateScheme): ParsedRepositoryFile {
  let formatVersion: string | null;
  let rawRecords: unknown[];
  if (scheme === 'CLASSIC_API_CLASSIFICATION') {
    const parsed = ClassificationFileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('Unexpected classification file shape: missing objectClassifications[]');
    }
    formatVersion = parsed.data.formatVersion ?? null;
    rawRecords = parsed.data.objectClassifications;
  } else {
    const parsed = ReleaseInfoFileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('Unexpected release info file shape: missing objectReleaseInfo[]');
    }
    formatVersion = parsed.data.formatVersion ?? null;
    rawRecords = parsed.data.objectReleaseInfo;
  }

  const seen = new Set<string>();
  const records: NormalizedObjectState[] = [];
  let rejectedRecords = 0;
  let duplicateRecords = 0;
  for (const raw of rawRecords) {
    const parsed = CrRecordSchema.safeParse(raw);
    if (!parsed.success) {
      rejectedRecords++;
      continue;
    }
    const normalized = normalizeRecord(parsed.data, scheme);
    const key = `${normalized.sapObjectType}|${normalized.objectKey}`;
    if (seen.has(key)) {
      duplicateRecords++;
      continue;
    }
    seen.add(key);
    records.push(normalized);
  }
  return { formatVersion, records, rejectedRecords, duplicateRecords };
}
