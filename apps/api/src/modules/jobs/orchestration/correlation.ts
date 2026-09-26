import type { PreflightCategory } from '@erppreflight/schemas';
import { CANONICAL_ENGINE_ORDER, ENGINE_PROFILES, MIGRATION_ENGINES, engineName } from './engine-profiles';

/**
 * Cross-engine correlation pass of the Full Project Preflight (Part 05 §5.6):
 * deduplicate by fingerprint, group correlated findings across engines and compute
 * the project summary. Pure and deterministic. It never creates, edits or deletes
 * findings (findings are immutable, AGENTS.md §4.3); it only references them.
 *
 * Correlation is asserted ONLY when it is supportable: two findings of different
 * engines are linked when they name the same affected SAP object (normalised
 * identifier). A group's root cause is the finding of the most upstream engine in
 * the declared precedence (e.g. OPD Guard before FormDoctor before Custom Field
 * Flow Doctor), then highest severity.
 */
export const CORRELATION_VERSION = 'corr-2026.09.1';

export interface CorrelationFinding {
  id: string;
  engine: string;
  ruleId: string;
  severity: string;
  category: string | null;
  title: string;
  confidenceClass: string | null;
  affectedObjects: string[];
  fingerprint: string | null;
  artifactPaths: string[];
  /** Engine technical details (evidence facts such as the missing data leaf of a form binding). */
  technicalDetails?: Record<string, unknown> | null;
}

/** Technical-detail keys whose values name SAP objects / fields (engine evidence facts). */
const OBJECT_DETAIL_KEYS = [
  'missingLeaf',
  'field_name',
  'fieldName',
  'object',
  'objectName',
  'object_name',
  'table',
  'tableName',
  'badi',
  'service',
  'messageType',
  'message_type',
  'targetObject',
  'target_object',
];

/** Correlation keys of a finding: affected objects plus object-naming technical details. */
export function correlationKeys(f: Pick<CorrelationFinding, 'affectedObjects' | 'technicalDetails'>): string[] {
  const extra: string[] = [];
  const td = f.technicalDetails && typeof f.technicalDetails === 'object' ? f.technicalDetails : {};
  for (const k of OBJECT_DETAIL_KEYS) {
    const v = (td as Record<string, unknown>)[k];
    if (typeof v === 'string') extra.push(v);
    else if (Array.isArray(v)) extra.push(...v.filter((x): x is string => typeof x === 'string'));
  }
  return objectKeys([...(f.affectedObjects ?? []), ...extra]);
}

export interface EngineCallRecord {
  engine: string;
  fileId: string | null;
  fileName: string | null;
  outcome: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  findings: number;
  rulesEvaluated: number;
  durationMs: number;
  error?: string | null;
  /** Engine version reported by the analysis service for this call (run detail / reproducibility). */
  engineVersion?: string | null;
}

export interface CorrelationGroup {
  id: string;
  kind: 'OUTPUT_CHAIN' | 'FORM_DATA_PATH' | 'CODE_TRANSPORT' | 'EXTENSION_CHAIN' | 'SHARED_OBJECT';
  rootCauseFindingId: string;
  findingIds: string[];
  engines: string[];
  sharedObjects: string[];
  explanation: string;
}

export interface PreflightSummary {
  version: string;
  totals: {
    findings: number;
    uniqueFindings: number;
    duplicates: number;
    inputValidation: number;
    artifactsAnalyzed: number;
    engineRuns: number;
    checksPassed: number;
    checksWithFindings: number;
    checksFailed: number;
    rulesEvaluated: number;
    objectsWithFindings: number;
    correlatedGroups: number;
  };
  bySeverity: Record<string, number>;
  categories: Record<PreflightCategory, number>;
  engines: Array<{
    engine: string;
    engineName: string;
    outcome: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NOT_RUN';
    runs: number;
    findings: number;
    bySeverity: Record<string, number>;
  }>;
  duplicates: Array<{ fingerprint: string; keptFindingId: string; duplicateFindingIds: string[] }>;
  groups: CorrelationGroup[];
}

const SEVERITY_RANK: Record<string, number> = { BLOCKER: 0, CRITICAL: 1, MAJOR: 2, MEDIUM: 3, MINOR: 4, LOW: 5, INFO: 6 };
const OBJECT_TYPE_WORDS = new Set([
  'CLAS', 'TABL', 'PROG', 'FUNC', 'FUGR', 'DDLS', 'INTF', 'VIEW', 'DTEL', 'DOMA', 'TRAN', 'ENHO', 'BADI', 'SICF', 'IWSV',
  'GLOBAL', 'UNKNOWN', 'NONE', 'TRUE', 'FALSE', 'SELECT', 'FORM', 'PERFORM', 'TABLES', 'CALL', 'SYSTEM', 'INLINE_PAYLOAD',
]);

export function isInputValidation(f: Pick<CorrelationFinding, 'category' | 'ruleId'>): boolean {
  return (
    (f.category ?? '').toUpperCase() === 'INPUT_VALIDATION' ||
    /_(INSUFFICIENT_INPUT|PARSE_ERROR|INVALID_INPUT|PAYLOAD_TOO_LARGE|ARCHIVE_REJECTED)$/.test(f.ruleId)
  );
}

/** Normalised SAP object identifiers named by a finding (e.g. 'CLAS ZCL_X' -> ZCL_X). */
export function objectKeys(affected: string[]): string[] {
  const keys = new Set<string>();
  for (const raw of affected ?? []) {
    for (const token of String(raw).toUpperCase().split(/[\s,;:()"'=]+/)) {
      const t = token.replace(/^[/$.]+|[/.]+$/g, '');
      if (t.length < 4 || OBJECT_TYPE_WORDS.has(t)) continue;
      if (!/^[A-Z/][A-Z0-9_/.-]*$/.test(t)) continue;
      if (!/[A-Z]/.test(t.replace(/^\//, ''))) continue;
      keys.add(t);
    }
  }
  return [...keys].sort();
}

function engineRank(engine: string): number {
  const idx = CANONICAL_ENGINE_ORDER.indexOf(engine as any);
  // Upstream = fewer transitive predecessors; approximate by depth in the precedence relation.
  const depth = (e: string, seen = new Set<string>()): number => {
    const profile = (ENGINE_PROFILES as Record<string, { after: string[] } | undefined>)[e];
    if (!profile || seen.has(e)) return 0;
    seen.add(e);
    return profile.after.length === 0 ? 0 : 1 + Math.max(...profile.after.map((d) => depth(d, seen)));
  };
  return depth(engine) * 100 + (idx < 0 ? 99 : idx);
}

function groupKind(engines: string[]): CorrelationGroup['kind'] {
  const has = (e: string) => engines.includes(e);
  if (has('OPD_GUARD') && (has('FORM_DOCTOR') || has('CUSTOM_FIELD_FLOW_DOCTOR'))) return 'OUTPUT_CHAIN';
  if (has('FORM_DOCTOR') && has('CUSTOM_FIELD_FLOW_DOCTOR')) return 'FORM_DATA_PATH';
  if (has('TRANSPORT_DEPENDENCY_ANALYZER') && (has('CLEAN_CORE_OBJECT_GUARD') || has('SOFTWARE_COLLECTION_DEPENDENCY_GUARD')))
    return 'CODE_TRANSPORT';
  if (has('EXTENSION_IMPACT_GUARD')) return 'EXTENSION_CHAIN';
  return 'SHARED_OBJECT';
}

const KIND_TEXT: Record<CorrelationGroup['kind'], string> = {
  OUTPUT_CHAIN: 'Output determination and form/data-path findings on the same object share one root cause',
  FORM_DATA_PATH: 'Form binding and custom-field propagation findings on the same field share one root cause',
  CODE_TRANSPORT: 'Code and transport findings on the same object share one root cause',
  EXTENSION_CHAIN: 'Extension dependency findings on the same object share one root cause',
  SHARED_OBJECT: 'Findings of several engines name the same affected object',
};

function emptyCategories(): Record<PreflightCategory, number> {
  return {
    MIGRATION_BLOCKERS: 0,
    OUTPUT_PROBLEMS: 0,
    FORM_DATA_PATH: 0,
    UNSUPPORTED_APIS: 0,
    TRANSPORT_DEPENDENCIES: 0,
    EXTENSION_DEPENDENCIES: 0,
    INTEGRATION_COVERAGE: 0,
    OPERATIONAL_RISKS: 0,
  };
}

/** Summary categories a finding counts towards (a finding may count in several). */
export function categoriesFor(f: CorrelationFinding): PreflightCategory[] {
  const profile = (ENGINE_PROFILES as Record<string, { categories: PreflightCategory[] } | undefined>)[f.engine];
  const out = new Set<PreflightCategory>(profile?.categories ?? []);
  if (f.engine === 'CLEAN_CORE_OBJECT_GUARD' && !/UNRELEASED|DIRECT_DB|DYNAMIC_CALL/.test(f.ruleId)) {
    out.delete('UNSUPPORTED_APIS');
  }
  if (f.engine === 'API_CHANGE_GUARD' && !/BREAKING|DEPRECATION/.test(f.ruleId)) out.delete('UNSUPPORTED_APIS');
  const sev = f.severity.toUpperCase();
  if (sev === 'BLOCKER' || (sev === 'CRITICAL' && MIGRATION_ENGINES.has(f.engine as any))) out.add('MIGRATION_BLOCKERS');
  return [...out].sort();
}

export function correlate(findings: CorrelationFinding[], calls: EngineCallRecord[]): PreflightSummary {
  const ordered = [...findings].sort((a, b) => a.id.localeCompare(b.id));
  const inputValidation = ordered.filter(isInputValidation);
  const substantive = ordered.filter((f) => !isInputValidation(f));

  // 1. Dedupe by fingerprint (keep the lexicographically first id — stable across reads).
  const byFp = new Map<string, CorrelationFinding[]>();
  for (const f of substantive) {
    const fp = f.fingerprint || `id:${f.id}`;
    const list = byFp.get(fp) ?? [];
    list.push(f);
    byFp.set(fp, list);
  }
  const unique: CorrelationFinding[] = [];
  const duplicates: PreflightSummary['duplicates'] = [];
  for (const [fp, list] of [...byFp.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    unique.push(list[0]);
    if (list.length > 1) {
      duplicates.push({ fingerprint: fp, keptFindingId: list[0].id, duplicateFindingIds: list.slice(1).map((f) => f.id) });
    }
  }
  unique.sort((a, b) => a.id.localeCompare(b.id));

  // 2. Cross-engine correlation via shared object keys (union-find).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const keysOf = new Map<string, string[]>();
  const byKey = new Map<string, CorrelationFinding[]>();
  for (const f of unique) {
    parent.set(f.id, f.id);
    const keys = correlationKeys(f);
    keysOf.set(f.id, keys);
    for (const k of keys) byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  for (const list of byKey.values()) {
    const engines = new Set(list.map((f) => f.engine));
    if (engines.size < 2) continue;
    for (let i = 1; i < list.length; i++) union(list[0].id, list[i].id);
  }
  const components = new Map<string, CorrelationFinding[]>();
  for (const f of unique) {
    const r = find(f.id);
    components.set(r, [...(components.get(r) ?? []), f]);
  }
  const groups: CorrelationGroup[] = [];
  for (const members of components.values()) {
    const engines = [...new Set(members.map((m) => m.engine))];
    if (engines.length < 2) continue;
    const sortedMembers = [...members].sort(
      (a, b) =>
        engineRank(a.engine) - engineRank(b.engine) ||
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        a.ruleId.localeCompare(b.ruleId) ||
        a.id.localeCompare(b.id)
    );
    const root = sortedMembers[0];
    const keyCount = new Map<string, Set<string>>();
    for (const m of members) for (const k of keysOf.get(m.id) ?? []) keyCount.set(k, new Set([...(keyCount.get(k) ?? []), m.engine]));
    const shared = [...keyCount.entries()].filter(([, e]) => e.size >= 2).map(([k]) => k).sort();
    const orderedEngines = [...engines].sort((a, b) => engineRank(a) - engineRank(b));
    const kind = groupKind(orderedEngines);
    groups.push({
      id: `grp-${root.id}`,
      kind,
      rootCauseFindingId: root.id,
      findingIds: sortedMembers.map((m) => m.id),
      engines: orderedEngines,
      sharedObjects: shared,
      explanation: `${KIND_TEXT[kind]} (${shared.join(', ')}). Root cause candidate: ${engineName(root.engine)} ${root.ruleId}.`,
    });
  }
  groups.sort((a, b) => a.id.localeCompare(b.id));

  // 3. Summary counts over unique substantive findings.
  const bySeverity: Record<string, number> = {};
  const categories = emptyCategories();
  const objects = new Set<string>();
  for (const f of unique) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    for (const c of categoriesFor(f)) categories[c]++;
    for (const k of keysOf.get(f.id) ?? []) objects.add(k);
  }

  const engineIds = [...new Set([...calls.map((c) => c.engine), ...findings.map((f) => f.engine)])].sort(
    (a, b) => CANONICAL_ENGINE_ORDER.indexOf(a as any) - CANONICAL_ENGINE_ORDER.indexOf(b as any)
  );
  const engines = engineIds.map((engine) => {
    const runs = calls.filter((c) => c.engine === engine);
    const efs = unique.filter((f) => f.engine === engine);
    const sev: Record<string, number> = {};
    for (const f of efs) sev[f.severity] = (sev[f.severity] ?? 0) + 1;
    const outcome: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NOT_RUN' =
      runs.length === 0
        ? 'NOT_RUN'
        : runs.every((r) => r.outcome === 'FAILED')
        ? 'FAILED'
        : runs.every((r) => r.outcome === 'COMPLETED')
        ? 'COMPLETED'
        : 'PARTIAL';
    return { engine, engineName: engineName(engine), outcome, runs: runs.length, findings: efs.length, bySeverity: sev };
  });

  const artifacts = new Set(calls.map((c) => c.fileId ?? c.fileName ?? 'inline'));
  const substantiveByCall = (c: EngineCallRecord) => c.findings;
  return {
    version: CORRELATION_VERSION,
    totals: {
      findings: findings.length,
      uniqueFindings: unique.length,
      duplicates: duplicates.reduce((n, d) => n + d.duplicateFindingIds.length, 0),
      inputValidation: inputValidation.length,
      artifactsAnalyzed: artifacts.size,
      engineRuns: calls.length,
      checksPassed: calls.filter((c) => c.outcome === 'COMPLETED' && substantiveByCall(c) === 0).length,
      checksWithFindings: calls.filter((c) => c.outcome !== 'FAILED' && substantiveByCall(c) > 0).length,
      checksFailed: calls.filter((c) => c.outcome === 'FAILED').length,
      rulesEvaluated: calls.reduce((n, c) => n + (c.rulesEvaluated || 0), 0),
      objectsWithFindings: objects.size,
      correlatedGroups: groups.length,
    },
    bySeverity,
    categories,
    engines,
    duplicates,
    groups,
  };
}
