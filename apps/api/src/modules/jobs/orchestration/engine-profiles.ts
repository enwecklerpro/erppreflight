import type { EngineType, PreflightCategory } from '@erppreflight/schemas';

/**
 * Orchestration metadata per engine (Part 05 §5.6). Versioned together with the
 * planner so a persisted plan can always be explained.
 *
 * `after`: declared correlation precedence. Engines are stateless, so this is not
 * a data dependency: an upstream engine runs in an earlier stage so that a
 * downstream symptom can be attributed to an upstream root cause (e.g. output
 * determination -> form rendering -> custom field data path). Engines in the same
 * stage have no declared relation and run in parallel.
 */
export const ORCHESTRATION_VERSION = 'fpp-2026.09.1';

export interface EngineProfile {
  name: string;
  domain: string;
  after: EngineType[];
  categories: PreflightCategory[];
}

export const ENGINE_PROFILES: Record<EngineType, EngineProfile> = {
  OPD_GUARD: { name: 'OPD Guard', domain: 'Output & Extensibility', after: [], categories: ['OUTPUT_PROBLEMS'] },
  FORM_DOCTOR: { name: 'FormDoctor', domain: 'Output & Extensibility', after: ['OPD_GUARD'], categories: ['FORM_DATA_PATH'] },
  CUSTOM_FIELD_FLOW_DOCTOR: {
    name: 'Custom Field Flow Doctor',
    domain: 'Output & Extensibility',
    after: ['FORM_DOCTOR'],
    categories: ['FORM_DATA_PATH', 'EXTENSION_DEPENDENCIES'],
  },
  EXTENSION_IMPACT_GUARD: {
    name: 'Extension Impact Guard',
    domain: 'Output & Extensibility',
    after: ['CUSTOM_FIELD_FLOW_DOCTOR', 'CLEAN_CORE_OBJECT_GUARD'],
    categories: ['EXTENSION_DEPENDENCIES'],
  },
  SPRO2CLOUD: { name: 'SPRO2Cloud', domain: 'Migration & Clean Core', after: [], categories: [] },
  ECC2CLOUD_NAVIGATOR: { name: 'ECC2Cloud Navigator', domain: 'Migration & Clean Core', after: [], categories: [] },
  SAP_GAP_RADAR: {
    name: 'SAP Gap Radar',
    domain: 'Migration & Clean Core',
    after: ['ECC2CLOUD_NAVIGATOR', 'SPRO2CLOUD'],
    categories: [],
  },
  CLEAN_CORE_OBJECT_GUARD: {
    name: 'Clean Core Object Guard',
    domain: 'Migration & Clean Core',
    after: [],
    categories: ['UNSUPPORTED_APIS'],
  },
  CHANGE_POINTER_COVERAGE_AUDITOR: {
    name: 'Change Pointer Coverage Auditor',
    domain: 'Integration',
    after: ['API_CHANGE_GUARD'],
    categories: ['INTEGRATION_COVERAGE'],
  },
  API_CHANGE_GUARD: { name: 'API Change Guard', domain: 'Integration', after: [], categories: ['UNSUPPORTED_APIS', 'INTEGRATION_COVERAGE'] },
  SOFTWARE_COLLECTION_DEPENDENCY_GUARD: {
    name: 'Software Collection Dependency Guard',
    domain: 'Release & Transport',
    after: ['TRANSPORT_DEPENDENCY_ANALYZER'],
    categories: ['TRANSPORT_DEPENDENCIES'],
  },
  TRANSPORT_DEPENDENCY_ANALYZER: {
    name: 'Transport Dependency Analyzer',
    domain: 'Release & Transport',
    after: ['CLEAN_CORE_OBJECT_GUARD'],
    categories: ['TRANSPORT_DEPENDENCIES'],
  },
  SAFE_DECOMMISSION_PREFLIGHT: { name: 'Safe Decommission Preflight', domain: 'Operations', after: [], categories: ['OPERATIONAL_RISKS'] },
  FIORI_403_ROOT_CAUSE_DOCTOR: { name: 'Fiori 403 Root-Cause Doctor', domain: 'Operations', after: [], categories: ['OPERATIONAL_RISKS'] },
  WORKFLOW_STUCK_EXPLAINER: { name: 'Workflow Stuck Explainer', domain: 'Operations', after: [], categories: ['OPERATIONAL_RISKS'] },
  IAM_COST_OPTIMIZER: { name: 'IAM Cost Optimizer', domain: 'Operations', after: [], categories: ['OPERATIONAL_RISKS'] },
  ACCOUNT_DETERMINATION_PREFLIGHT: {
    name: 'Account Determination Preflight',
    domain: 'Operations',
    after: [],
    categories: ['OPERATIONAL_RISKS'],
  },
  SYSTEM_REFRESH_DELTA_GUARD: { name: 'System Refresh Delta Guard', domain: 'Operations', after: [], categories: ['OPERATIONAL_RISKS'] },
  MFS_BLACKBOX: { name: 'MFS BlackBox', domain: 'Warehouse Automation', after: [], categories: ['OPERATIONAL_RISKS'] },
};

/** Engines whose BLOCKER/CRITICAL findings block a migration (Part 01 §1.6 "Migration blockers"). */
export const MIGRATION_ENGINES: ReadonlySet<EngineType> = new Set<EngineType>([
  'SPRO2CLOUD',
  'ECC2CLOUD_NAVIGATOR',
  'SAP_GAP_RADAR',
  'CLEAN_CORE_OBJECT_GUARD',
  'EXTENSION_IMPACT_GUARD',
  'API_CHANGE_GUARD',
]);

/** Deterministic engine order: dependency order, ties broken by canonical enum order. */
export const CANONICAL_ENGINE_ORDER: EngineType[] = Object.keys(ENGINE_PROFILES) as EngineType[];

export function engineName(engine: string): string {
  return (ENGINE_PROFILES as Record<string, EngineProfile | undefined>)[engine]?.name ?? engine;
}

/**
 * Topological stages over the selected engines using the declared `after` relation
 * (relations to engines that are not selected are ignored). Deterministic.
 */
export function buildEngineStages(engines: EngineType[]): EngineType[][] {
  const selected = CANONICAL_ENGINE_ORDER.filter((e) => engines.includes(e));
  const remaining = new Set(selected);
  const done = new Set<EngineType>();
  const stages: EngineType[][] = [];
  while (remaining.size > 0) {
    const ready = selected.filter(
      (e) => remaining.has(e) && ENGINE_PROFILES[e].after.every((dep) => !remaining.has(dep) || done.has(dep))
    );
    // The declared relation is acyclic; guard anyway so a future cycle cannot hang the planner.
    const stage = ready.length > 0 ? ready : [selected.find((e) => remaining.has(e)) as EngineType];
    stages.push(stage);
    for (const e of stage) {
      remaining.delete(e);
      done.add(e);
    }
  }
  return stages;
}
