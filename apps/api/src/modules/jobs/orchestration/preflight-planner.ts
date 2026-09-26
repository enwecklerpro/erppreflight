import type { ArtifactType, EngineType } from '@erppreflight/schemas';
import { type ArtifactSignals, ARTIFACT_SIGNAL_VERSION } from './artifact-signals';
import { buildEngineStages, CANONICAL_ENGINE_ORDER, engineName, ORCHESTRATION_VERSION } from './engine-profiles';

/**
 * Full Project Preflight planner (Part 01 §1.6, Part 05 §5.6). Pure and
 * deterministic: identical artifacts + context => identical plan.
 *
 *  1. candidate engines per artifact = engines whose declared input contract
 *     accepts it (analysis service) ∩ engines with a specific content signal;
 *     when no contract answer is available only content signals are used, and an
 *     artifact accepted by exactly one contract is assigned to that engine;
 *  2. multi-artifact inputs are paired: Adobe Form XDP template + runtime data XML
 *     (FormDoctor), baseline + candidate API specification (API Change Guard);
 *  3. engines relevant to the project context but without a usable artifact are
 *     reported as missing inputs (never run on guessed data);
 *  4. stages = topological levels of the declared engine precedence.
 */

export interface PlannerArtifact {
  fileId: string;
  fileName: string;
  artifactType: ArtifactType;
  /** Engines whose contract accepts the artifact; null when the contract check was unavailable. */
  contractAccepted: EngineType[] | null;
  signals: ArtifactSignals;
}

export interface PlannerContext {
  sourceErp?: string | null;
  targetProduct?: string | null;
  deploymentType?: string | null;
  modules?: string[];
}

export interface CompanionRef {
  fileId: string;
  configKey: string;
}

export interface EngineAssignment {
  engine: EngineType;
  fileId: string;
  companions: CompanionRef[];
  reason: string;
}

export interface UnassignedArtifact {
  fileId: string;
  fileName: string;
  reason: string;
}

export interface MissingEngineInput {
  engine: EngineType;
  engineName: string;
  reason: string;
}

export interface PreflightPlan {
  version: string;
  signalVersion: string;
  engines: EngineType[];
  stages: EngineType[][];
  assignments: EngineAssignment[];
  unassigned: UnassignedArtifact[];
  missingInputs: MissingEngineInput[];
}

/** Engines the project context makes relevant (reported when no artifact feeds them). */
export function contextEngines(ctx: PlannerContext): Array<{ engine: EngineType; reason: string }> {
  const out: Array<{ engine: EngineType; reason: string }> = [];
  const src = (ctx.sourceErp ?? '').toUpperCase();
  const target = (ctx.targetProduct ?? '').toUpperCase();
  const deployment = (ctx.deploymentType ?? '').toUpperCase();
  const cloudTarget = target.includes('CLOUD') || deployment.includes('CLOUD');
  if ((src === 'SAP_ECC' || src === 'SAP_R3') && (target || deployment)) {
    const why = `project migrates from ${src} to ${target || deployment}`;
    out.push({ engine: 'ECC2CLOUD_NAVIGATOR', reason: why });
    out.push({ engine: 'SPRO2CLOUD', reason: why });
    out.push({ engine: 'SAP_GAP_RADAR', reason: why });
  }
  if (cloudTarget) {
    out.push({ engine: 'CLEAN_CORE_OBJECT_GUARD', reason: `target ${target || deployment} requires clean-core extensions` });
  }
  const modules = (ctx.modules ?? []).map((m) => m.toUpperCase());
  if (modules.some((m) => m === 'MM' || m === 'SD')) {
    out.push({ engine: 'OPD_GUARD', reason: `modules ${modules.filter((m) => m === 'MM' || m === 'SD').join('/')} produce output documents` });
  }
  return out;
}

function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !['template', 'payload', 'data', 'form', 'xml', 'xdp'].includes(t))
  );
}

function overlap(a: string, b: string): number {
  const ta = tokens(a);
  let n = 0;
  for (const t of tokens(b)) if (ta.has(t)) n++;
  return n;
}

const byName = (a: PlannerArtifact, b: PlannerArtifact) =>
  a.fileName.localeCompare(b.fileName) || a.fileId.localeCompare(b.fileId);

export function planFullPreflight(
  artifacts: PlannerArtifact[],
  context: PlannerContext = {},
  restrictTo?: EngineType[]
): PreflightPlan {
  const allowed = (e: EngineType) => !restrictTo || restrictTo.includes(e);
  const sorted = [...artifacts].sort(byName);
  const assignments: EngineAssignment[] = [];
  const unassigned: UnassignedArtifact[] = [];
  const consumed = new Set<string>();

  // --- 1. Pairing: FormDoctor (XDP template + runtime data XML) ---------------------------
  const xdps = sorted.filter((a) => a.signals.roles.includes('XDP_TEMPLATE'));
  const dataXmls = sorted.filter(
    (a) =>
      a.signals.roles.includes('GENERIC_XML') &&
      (a.contractAccepted === null || a.contractAccepted.includes('FORM_DOCTOR'))
  );
  if (allowed('FORM_DOCTOR')) {
    const freeData = [...dataXmls];
    for (const xdp of xdps) {
      if (freeData.length === 0) {
        unassigned.push({
          fileId: xdp.fileId,
          fileName: xdp.fileName,
          reason: 'Adobe Form XDP template without a runtime data XML: upload the form data XML (print preview / ADS trace) to verify bindings.',
        });
        consumed.add(xdp.fileId);
        continue;
      }
      // Best filename overlap, ties by name order (deterministic).
      let best = 0;
      for (let i = 1; i < freeData.length; i++) {
        if (overlap(xdp.fileName, freeData[i].fileName) > overlap(xdp.fileName, freeData[best].fileName)) best = i;
      }
      const data = freeData.splice(best, 1)[0];
      assignments.push({
        engine: 'FORM_DOCTOR',
        fileId: data.fileId,
        companions: [{ fileId: xdp.fileId, configKey: 'xdp_content' }],
        reason: `runtime data XML '${data.fileName}' paired with XDP template '${xdp.fileName}'`,
      });
      consumed.add(xdp.fileId);
      consumed.add(data.fileId);
    }
  }

  // --- 2. Pairing: API Change Guard (baseline + candidate) ---------------------------------
  if (allowed('API_CHANGE_GUARD')) {
    const specs = sorted.filter((a) => a.signals.engines.API_CHANGE_GUARD && !consumed.has(a.fileId));
    const baselines = specs.filter((a) => a.signals.roles.includes('API_SPEC_BASELINE'));
    const candidates = specs.filter((a) => a.signals.roles.includes('API_SPEC_CANDIDATE'));
    const pairs = Math.min(baselines.length, candidates.length);
    for (let i = 0; i < pairs; i++) {
      const base = baselines[i];
      const cand = candidates[i];
      assignments.push({
        engine: 'API_CHANGE_GUARD',
        fileId: base.fileId,
        companions: [
          { fileId: base.fileId, configKey: 'baseline' },
          { fileId: cand.fileId, configKey: 'candidate' },
        ],
        reason: `baseline '${base.fileName}' compared with candidate '${cand.fileName}'`,
      });
      consumed.add(base.fileId);
      consumed.add(cand.fileId);
    }
    for (const spec of specs) {
      if (consumed.has(spec.fileId)) continue;
      // A single bundle file {baseline, candidate} is self-contained.
      if (spec.signals.jsonKeys.includes('baseline') && spec.signals.jsonKeys.includes('candidate')) {
        assignments.push({ engine: 'API_CHANGE_GUARD', fileId: spec.fileId, companions: [], reason: 'baseline + candidate bundle' });
      } else {
        unassigned.push({
          fileId: spec.fileId,
          fileName: spec.fileName,
          reason: 'API specification without a counterpart: name one file *baseline* and the other *candidate* to compare them.',
        });
      }
      consumed.add(spec.fileId);
    }
  }

  // --- 3. Single-artifact engines -----------------------------------------------------------
  for (const art of sorted) {
    if (consumed.has(art.fileId)) continue;
    const signalled = CANONICAL_ENGINE_ORDER.filter(
      (e) => art.signals.engines[e] && e !== 'API_CHANGE_GUARD' && allowed(e)
    );
    let chosen: Array<{ engine: EngineType; reason: string }> = [];
    if (art.contractAccepted !== null) {
      chosen = signalled
        .filter((e) => art.contractAccepted!.includes(e))
        .map((e) => ({ engine: e, reason: `${art.signals.engines[e]}; accepted by the ${engineName(e)} input contract` }));
      if (chosen.length === 0 && art.contractAccepted.length === 1 && allowed(art.contractAccepted[0])) {
        const only = art.contractAccepted[0];
        if (only !== 'FORM_DOCTOR' && only !== 'API_CHANGE_GUARD') {
          chosen = [{ engine: only, reason: `only the ${engineName(only)} input contract accepts this artifact` }];
        }
      }
    } else {
      chosen = signalled.map((e) => ({ engine: e, reason: `${art.signals.engines[e]} (contract check unavailable)` }));
    }
    if (chosen.length === 0) {
      unassigned.push({
        fileId: art.fileId,
        fileName: art.fileName,
        reason:
          art.contractAccepted !== null && art.contractAccepted.length === 0
            ? 'No engine input contract accepts this artifact.'
            : art.signals.roles.includes('GENERIC_XML')
            ? 'Generic XML without an engine-specific structure (for FormDoctor upload the matching XDP template).'
            : 'Ambiguous artifact: several engine contracts accept it but none has a specific content signal. Launch it manually with an explicit engine.',
      });
      continue;
    }
    for (const c of chosen) assignments.push({ engine: c.engine, fileId: art.fileId, companions: [], reason: c.reason });
  }

  // Deterministic order: canonical engine order, then file id.
  assignments.sort(
    (a, b) =>
      CANONICAL_ENGINE_ORDER.indexOf(a.engine) - CANONICAL_ENGINE_ORDER.indexOf(b.engine) || a.fileId.localeCompare(b.fileId)
  );
  unassigned.sort((a, b) => a.fileName.localeCompare(b.fileName) || a.fileId.localeCompare(b.fileId));

  const engines = CANONICAL_ENGINE_ORDER.filter((e) => assignments.some((a) => a.engine === e));
  const missingInputs: MissingEngineInput[] = [];
  const seen = new Set<EngineType>();
  for (const { engine, reason } of contextEngines(context)) {
    if (seen.has(engine) || engines.includes(engine) || !allowed(engine)) continue;
    seen.add(engine);
    missingInputs.push({ engine, engineName: engineName(engine), reason });
  }

  return {
    version: ORCHESTRATION_VERSION,
    signalVersion: ARTIFACT_SIGNAL_VERSION,
    engines,
    stages: buildEngineStages(engines),
    assignments,
    unassigned,
    missingInputs,
  };
}
