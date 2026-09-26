import type { AnalysisInputs } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import type { AnalysisJobFile, EngineAssignmentInput } from './analysis-executor';

/**
 * Persisted run inputs (analyses.inputs, migration 020): the exact artifacts (id, name,
 * type, SHA-256, size at launch time), requested + effective configuration and the
 * planner assignments/stages. A rerun re-executes exactly these inputs; the run detail
 * page shows them. Written in the same tenant scope as the analysis row.
 */
/** Artifact reference recorded as a run input (storage path is never stored in inputs). */
export type RecordedInputFile = Pick<AnalysisJobFile, 'fileId' | 'fileName' | 'artifactType'>;

export interface RecordInputsArgs {
  files: RecordedInputFile[];
  requestedConfiguration?: Record<string, unknown>;
  effectiveConfiguration?: Record<string, unknown>;
  assignmentMode: AnalysisInputs['assignmentMode'];
  assignments?: EngineAssignmentInput[];
  stages?: string[][];
  testCaseIds?: string[];
  scenarioId?: string | null;
  trigger?: AnalysisInputs['trigger'];
}

export async function buildAnalysisInputs(
  db: DatabaseService,
  organizationId: string,
  args: RecordInputsArgs
): Promise<AnalysisInputs> {
  const ids = Array.from(new Set(args.files.map((f) => f.fileId)));
  const meta = new Map<string, { sha256: string | null; sizeBytes: number | null }>();
  if (ids.length > 0) {
    const res = await db.query(
      `SELECT id, checksum_sha256, file_size FROM uploaded_files WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [organizationId, ids],
      { tenantId: organizationId }
    );
    for (const r of res?.rows ?? []) {
      const size = r.file_size === null || r.file_size === undefined ? null : Number(r.file_size);
      meta.set(r.id, { sha256: r.checksum_sha256 ?? null, sizeBytes: Number.isFinite(size) ? size : null });
    }
  }
  const inputs: AnalysisInputs = {
    version: 1,
    files: args.files.map((f) => ({
      fileId: f.fileId,
      fileName: f.fileName,
      artifactType: f.artifactType,
      sha256: meta.get(f.fileId)?.sha256 ?? null,
      sizeBytes: meta.get(f.fileId)?.sizeBytes ?? null,
    })),
    requestedConfiguration: args.requestedConfiguration ?? {},
    effectiveConfiguration: args.effectiveConfiguration ?? {},
    assignmentMode: args.assignmentMode,
  };
  if (args.assignments?.length) {
    inputs.assignments = args.assignments.map((a) => ({
      engine: a.engine,
      fileId: a.fileId,
      companions: (a.companions ?? []).map((c) => ({ fileId: c.fileId, configKey: c.configKey })),
    }));
  }
  if (args.stages?.length) inputs.stages = args.stages as AnalysisInputs['stages'];
  if (args.testCaseIds?.length) inputs.testCaseIds = args.testCaseIds;
  if (args.scenarioId !== undefined) inputs.scenarioId = args.scenarioId;
  if (args.trigger) inputs.trigger = args.trigger;
  return inputs;
}

/** Stores the inputs on an existing analysis row (best effort for legacy call paths). */
export async function recordAnalysisInputs(
  db: DatabaseService,
  organizationId: string,
  analysisId: string,
  args: RecordInputsArgs
): Promise<void> {
  const inputs = await buildAnalysisInputs(db, organizationId, args);
  const snapshotId = await currentKnowledgeSnapshotId(db, organizationId);
  await db.query(
    `UPDATE analyses SET inputs = $1::jsonb, knowledge_snapshot_id = COALESCE(knowledge_snapshot_id, $4)
      WHERE id = $2 AND organization_id = $3`,
    [JSON.stringify(inputs), analysisId, organizationId, snapshotId],
    { tenantId: organizationId }
  );
}

/** Stores the failure reason of a FAILED run for the run detail (best effort, never throws). */
export async function recordAnalysisError(
  db: DatabaseService,
  organizationId: string,
  analysisId: string,
  err: unknown
): Promise<void> {
  const message = String((err as { message?: unknown })?.message ?? err).slice(0, 2000);
  await db
    .query(
      `UPDATE analyses SET error_message = $3 WHERE id = $1 AND organization_id = $2 AND status = 'FAILED'`,
      [analysisId, organizationId, message],
      { tenantId: organizationId }
    )
    .catch(() => undefined);
}

/**
 * Knowledge snapshot in force right now (latest PUBLISHED, Part 17.3). Recorded on every new
 * run at creation so the run stays reproducible; knowledge-aware engines may refine it with
 * the snapshot they actually used. Null when no snapshot has been published yet.
 */
export async function currentKnowledgeSnapshotId(db: DatabaseService, organizationId: string): Promise<string | null> {
  try {
    const res = await db.query(
      `SELECT id FROM knowledge_snapshots WHERE status = 'PUBLISHED' ORDER BY seq DESC LIMIT 1`,
      [],
      { tenantId: organizationId }
    );
    return res?.rows?.[0]?.id ?? null;
  } catch {
    return null;
  }
}
