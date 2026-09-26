import type { ArtifactType, EngineType } from '@erppreflight/schemas';

/**
 * Deterministic artifact content signals (Part 05 §5.6 "detect relevant engines",
 * Part 15.21 artifact auto-detection).
 *
 * The analysis service's declared input contracts (POST /api/v1/contracts/match)
 * decide which engines *can accept* an artifact. Several contracts are permissive
 * (any XML, any JSON adjacency map, any text), so an artifact is only assigned to an
 * engine when the content carries a signal that is specific to that engine. The JSON
 * signal keys mirror each engine's contract model `signal_fields`
 * (services/analysis-python/src/engines/*.py); CSV columns mirror `csv_signal_columns`.
 */
export const ARTIFACT_SIGNAL_VERSION = 'signals-2026.09.1';

export type ArtifactRole =
  | 'XDP_TEMPLATE'
  | 'LEGACY_FORM_SOURCE'
  | 'GENERIC_XML'
  | 'API_SPEC_BASELINE'
  | 'API_SPEC_CANDIDATE'
  | 'API_SPEC'
  | 'ABAP_SOURCE'
  | 'ARCHIVE';

export interface ArtifactSignalInput {
  fileId: string;
  fileName: string;
  artifactType: ArtifactType;
  /** UTF-8 content (null for binary artifacts or content too large to inspect). */
  text: string | null;
}

export interface ArtifactSignals {
  roles: ArtifactRole[];
  /** Engine -> human-readable reason for the specific content signal. */
  engines: Partial<Record<EngineType, string>>;
  jsonKeys: string[];
  csvColumns: string[];
  xmlRoot: string | null;
}

/** Top-level JSON keys that identify an engine's input (mirrors python `signal_fields`). */
const JSON_KEY_SIGNALS: Array<{ engine: EngineType; anyOf: string[] }> = [
  { engine: 'OPD_GUARD', anyOf: ['tables', 'decision_tables'] },
  { engine: 'CUSTOM_FIELD_FLOW_DOCTOR', anyOf: ['field_name'] },
  { engine: 'EXTENSION_IMPACT_GUARD', anyOf: ['extensions', 'target_object', 'graph'] },
  { engine: 'SPRO2CLOUD', anyOf: ['activities'] },
  { engine: 'ECC2CLOUD_NAVIGATOR', anyOf: ['usage', 'tcodes', 'transactions'] },
  { engine: 'SAP_GAP_RADAR', anyOf: ['requirement', 'requirements'] },
  { engine: 'CLEAN_CORE_OBJECT_GUARD', anyOf: ['abap_references', 'objects'] },
  {
    engine: 'CHANGE_POINTER_COVERAGE_AUDITOR',
    anyOf: ['target_message_type', 'bd52_fields', 'bd61_active', 'bd50_msg_types', 'bdcp2_samples'],
  },
  { engine: 'API_CHANGE_GUARD', anyOf: ['baseline', 'candidate', 'openapi', 'swagger', 'paths'] },
  { engine: 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD', anyOf: ['collections', 'target_system_collections'] },
  { engine: 'TRANSPORT_DEPENDENCY_ANALYZER', anyOf: ['transports', 'e070', 'e071', 'planned_sequence'] },
  { engine: 'SAFE_DECOMMISSION_PREFLIGHT', anyOf: ['target_user', 'usr02'] },
  {
    engine: 'FIORI_403_ROOT_CAUSE_DOCTOR',
    anyOf: ['http_response', 'su53', 'su53_failed_objects', 'iwfnd_error_log', 'icf_inactive_paths', 'icf_services'],
  },
  { engine: 'WORKFLOW_STUCK_EXPLAINER', anyOf: ['swwwihead', 'work_items', 'swwloghist'] },
  { engine: 'IAM_COST_OPTIMIZER', anyOf: ['roles', 'agr_users', 'price_categories'] },
  { engine: 'ACCOUNT_DETERMINATION_PREFLIGHT', anyOf: ['obyc_rules', 'vkoa_rules', 'valuation_classes'] },
  {
    engine: 'SYSTEM_REFRESH_DELTA_GUARD',
    anyOf: ['rfc_destinations', 'pre_refresh_rfcs', 'post_refresh_rfcs', 'logical_systems', 'scot'],
  },
  { engine: 'MFS_BLACKBOX', anyOf: ['telegrams', 'conveyor_edges'] },
];

/** CSV header columns (normalised: lower-case alphanumerics) per engine. */
const CSV_COLUMN_SIGNALS: Array<{ engine: EngineType; anyOf: string[] }> = [
  { engine: 'OPD_GUARD', anyOf: ['step', 'decisionstep'] },
  { engine: 'TRANSPORT_DEPENDENCY_ANALYZER', anyOf: ['trkorr'] },
  { engine: 'ECC2CLOUD_NAVIGATOR', anyOf: ['tcode', 'transaction', 'transactioncode'] },
  { engine: 'SPRO2CLOUD', anyOf: ['activityid', 'imgactivity', 'imgnode'] },
  { engine: 'ACCOUNT_DETERMINATION_PREFLIGHT', anyOf: ['ktosl', 'ktopl', 'bklas'] },
  { engine: 'WORKFLOW_STUCK_EXPLAINER', anyOf: ['wiid', 'wistat', 'witype'] },
  { engine: 'IAM_COST_OPTIMIZER', anyOf: ['agrname'] },
  { engine: 'MFS_BLACKBOX', anyOf: ['huid', 'senderplc', 'receiverplc'] },
  { engine: 'CHANGE_POINTER_COVERAGE_AUDITOR', anyOf: ['mestyp', 'messagetype'] },
  { engine: 'SYSTEM_REFRESH_DELTA_GUARD', anyOf: ['rfcdest', 'rfcdestination'] },
];

/** XML root element (local name, lower-case) per engine. */
const XML_ROOT_SIGNALS: Array<{ engine: EngineType; roots: string[] }> = [
  { engine: 'OPD_GUARD', roots: ['outputparameterdetermination', 'decisiontables', 'decisiontable', 'brfplus', 'table'] },
  { engine: 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD', roots: ['software_collections', 'softwarecollections'] },
  { engine: 'TRANSPORT_DEPENDENCY_ANALYZER', roots: ['transports', 'transport', 'cts', 'e070'] },
  { engine: 'API_CHANGE_GUARD', roots: ['edmx', 'definitions'] },
];

const LEGACY_FORM_MARKERS = [/<\s*SMARTFORM\b/i, /\bSSFFORM\b/, /\bTDFORM\b/, /\bSAPSCRIPT\b/i, /<\s*SAPSCRIPT/i];

export function normalizeColumn(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function csvHeader(text: string): string[] {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const delims = [',', ';', '\t', '|'];
  let delim = ',';
  let best = -1;
  for (const d of delims) {
    const n = first.split(d).length - 1;
    if (n > best) {
      best = n;
      delim = d;
    }
  }
  return first.split(delim).map((c) => normalizeColumn(c.replace(/^"|"$/g, ''))).filter(Boolean);
}

function xmlRootName(text: string): string | null {
  // Skip prolog, comments, doctype and processing instructions; return the first element's local name.
  const re = /<([A-Za-z_][\w.:-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text.slice(0, 20_000))) !== null) {
    const before = text.slice(Math.max(0, m.index - 1), m.index + 2);
    if (before.startsWith('<?') || before.startsWith('<!')) continue;
    const name = m[1];
    const local = name.includes(':') ? name.split(':').pop()! : name;
    return local.toLowerCase();
  }
  return null;
}

function hasAnyWord(name: string, words: string[]): boolean {
  const lower = name.toLowerCase();
  return words.some((w) => lower.includes(w));
}

/** Detects deterministic content signals for one artifact. Pure; never throws. */
export function detectArtifactSignals(input: ArtifactSignalInput): ArtifactSignals {
  const signals: ArtifactSignals = { roles: [], engines: {}, jsonKeys: [], csvColumns: [], xmlRoot: null };
  const name = input.fileName || '';
  const lowerName = name.toLowerCase();
  const text = input.text;
  const add = (engine: EngineType, reason: string) => {
    if (!signals.engines[engine]) signals.engines[engine] = reason;
  };

  if (input.artifactType === 'ZIP' || input.artifactType === 'XLSX') {
    signals.roles.push('ARCHIVE');
    if (hasAnyWord(lowerName, ['abapgit', 'abap'])) add('CLEAN_CORE_OBJECT_GUARD', `archive name '${name}' indicates an abapGit export`);
    if (hasAnyWord(lowerName, ['software_collection', 'softwarecollection', 'software-collection']))
      add('SOFTWARE_COLLECTION_DEPENDENCY_GUARD', `archive name '${name}' indicates a software collection export`);
    if (hasAnyWord(lowerName, ['opd', 'brf', 'decision'])) add('OPD_GUARD', `workbook name '${name}' indicates BRFplus decision tables`);
    return signals;
  }

  if (input.artifactType === 'ABAP' || /\.(abap|prog|incl)$/i.test(name)) {
    signals.roles.push('ABAP_SOURCE');
    add('CLEAN_CORE_OBJECT_GUARD', 'ABAP source code');
    return signals;
  }

  if (text === null) return signals;
  const trimmed = text.replace(/^﻿/, '').trimStart();

  const isApiName = hasAnyWord(lowerName, ['baseline', 'candidate', 'openapi', 'swagger', 'edmx', 'metadata']);

  if (input.artifactType === 'XDP' || /\.xdp$/i.test(name) || /<\s*xdp:xdp\b/i.test(trimmed.slice(0, 4000))) {
    signals.roles.push('XDP_TEMPLATE');
    add('FORM_DOCTOR', 'Adobe Form XDP template');
    return signals;
  }

  if (trimmed.startsWith('<')) {
    const root = xmlRootName(trimmed);
    signals.xmlRoot = root;
    if (LEGACY_FORM_MARKERS.some((re) => re.test(trimmed.slice(0, 50_000)))) {
      signals.roles.push('LEGACY_FORM_SOURCE');
      add('FORM_DOCTOR', 'SAPscript / Smart Forms source markers');
    }
    for (const rule of XML_ROOT_SIGNALS) {
      if (root && rule.roots.includes(root)) add(rule.engine, `XML root element <${root}>`);
    }
    if (signals.engines.API_CHANGE_GUARD) {
      signals.roles.push(apiRole(lowerName));
    }
    if (Object.keys(signals.engines).length === 0) signals.roles.push('GENERIC_XML');
    return signals;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return signals;
    }
    const obj = Array.isArray(parsed) ? {} : (parsed as Record<string, unknown>);
    if (!obj || typeof obj !== 'object') return signals;
    const keys = Object.keys(obj).map((k) => k.toLowerCase());
    signals.jsonKeys = keys.slice(0, 50).sort();
    const nonEmpty = (k: string) => {
      const orig = Object.keys(obj).find((x) => x.toLowerCase() === k);
      const v = orig ? obj[orig] : undefined;
      return !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0));
    };
    for (const rule of JSON_KEY_SIGNALS) {
      const hit = rule.anyOf.filter((k) => keys.includes(k) && nonEmpty(k));
      if (hit.length > 0) add(rule.engine, `JSON keys: ${hit.join(', ')}`);
    }
    if (signals.engines.API_CHANGE_GUARD) signals.roles.push(apiRole(lowerName));
    if (isApiName && keys.includes('paths')) add('API_CHANGE_GUARD', `OpenAPI 'paths' in '${name}'`);
    return signals;
  }

  // CSV / text
  const header = csvHeader(trimmed);
  signals.csvColumns = header.slice(0, 50);
  if (header.length > 1) {
    for (const rule of CSV_COLUMN_SIGNALS) {
      const hit = rule.anyOf.filter((c) => header.includes(c));
      if (hit.length > 0) add(rule.engine, `CSV columns: ${hit.join(', ')}`);
    }
  }
  if (Object.keys(signals.engines).length === 0 && (input.artifactType === 'TXT' || /\.txt$/i.test(name))) {
    if (hasAnyWord(lowerName, ['requirement', 'gap'])) add('SAP_GAP_RADAR', `requirement statement file '${name}'`);
  }
  return signals;
}

function apiRole(lowerName: string): ArtifactRole {
  if (lowerName.includes('baseline') || lowerName.includes('current')) return 'API_SPEC_BASELINE';
  if (lowerName.includes('candidate') || lowerName.includes('target') || lowerName.includes('breaking')) return 'API_SPEC_CANDIDATE';
  return 'API_SPEC';
}
