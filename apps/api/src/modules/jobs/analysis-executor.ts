import { Logger } from '@nestjs/common';
import {
  EngineType,
  TargetRelease,
  ArtifactType,
  ArtifactTypeEnum,
  RawContentEncoding,
  toWireJobRequest,
  AnalysisJobResponseSchema,
} from '@erppreflight/schemas';
import { createFindingFingerprint } from '@erppreflight/evidence';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { S3StorageService } from '../storage/s3-storage.service';
import {
  KNOWLEDGE_AWARE_ENGINES,
  RELEASED_OBJECTS_CONFIG_KEY,
  ReleasedObjectsConfiguration,
} from '../knowledge-graph/released-objects.provider';
import { AnalysisProgressTracker } from './analysis-progress';
import { correlate, type EngineCallRecord, type PreflightSummary } from './orchestration/correlation';
import { buildRegressionTests, REGRESSION_TEST_VERSION, type TestSourceFinding } from './orchestration/regression-tests';

export type { EngineCallRecord, PreflightSummary };

/** Supplies the snapshot-derived released-object list for knowledge-aware engines (optional). */
export interface ReleasedObjectsSource {
  forArtifact(
    rawContent: string | null,
    encoding: RawContentEncoding,
    targetRelease: string
  ): Promise<ReleasedObjectsConfiguration | null>;
}

/** A server-resolved, tenant-verified CLEAN artifact to analyse. */
export interface AnalysisJobFile {
  fileId: string;
  fileName: string;
  storagePath: string;
  artifactType: ArtifactType;
}

export interface AnalysisRunInput {
  analysisId: string;
  organizationId: string;
  projectId: string;
  engineTypes: EngineType[];
  targetRelease: TargetRelease;
  files: AnalysisJobFile[];
  configuration?: Record<string, unknown>;
  /** Legacy (pre-fileIds) jobs already sitting in the queue: inline payload. */
  legacyRawContent?: string | null;
  legacyArtifactS3Key?: string | null;
  legacyArtifactType?: ArtifactType;
  /**
   * Orchestrated runs (Full Project Preflight / planned launches): explicit
   * engine -> artifact assignments, optionally with companion artifacts injected
   * into the engine configuration (e.g. FormDoctor `xdp_content`). When absent,
   * every engine runs on every artifact (original behaviour).
   */
  assignments?: EngineAssignmentInput[];
  /** Dependency stages; engines inside one stage run in parallel (bounded by `concurrency`). */
  stages?: EngineType[][];
  concurrency?: number;
  kind?: 'STANDARD' | 'FULL_PREFLIGHT';
}

export interface EngineAssignmentInput {
  engine: EngineType;
  fileId: string;
  companions?: Array<{ fileId: string; configKey: string }>;
}

export type EngineRunOutcome = 'COMPLETED' | 'PARTIAL' | 'FAILED';

export interface AnalysisRunResult {
  finalStatus: EngineRunOutcome;
  totalFindings: number;
  engineOutcomes: Record<string, EngineRunOutcome>;
  /** Per engine x artifact call outcome (orchestration summary input). */
  calls?: EngineCallRecord[];
  summary?: PreflightSummary;
  testsGenerated?: number;
}

interface WorkUnit {
  engine: EngineType;
  artifact: PreparedArtifact;
  companions: Array<{ configKey: string; artifact: PreparedArtifact }>;
}

type AnalysisFindingRow = TestSourceFinding & { technicalDetails: Record<string, unknown> | null };

function safeObject(value: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function toStringArray(value: unknown): string[] {
  const v = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as any).name ?? (x as any).id ?? '') : String(x)))
    .filter((x) => x.length > 0);
}

/** Runs `worker` over `items` with at most `limit` in flight; preserves no ordering guarantees. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

/** Artifact formats that are binary and must be transported base64-encoded. */
export const BINARY_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>(['ZIP', 'XLSX']);

/**
 * Maps an ingestion-detected format (MimeMagicValidator.detectedFormat) or a file
 * extension onto the analysis-service ArtifactType enum. Returns null when the
 * format cannot be analysed by any engine (e.g. PDF).
 */
export function resolveArtifactType(
  detectedFormat?: string | null,
  fileName?: string | null
): ArtifactType | null {
  const candidates = [
    detectedFormat,
    fileName ? fileName.split('.').pop() : undefined,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const fmt = String(raw).trim().toUpperCase();
    if (fmt === 'XSD') return 'XML';
    if (fmt === 'PROG' || fmt === 'INCL') return 'ABAP';
    const parsed = ArtifactTypeEnum.safeParse(fmt);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/** Encodes an artifact buffer for the analysis-service wire contract. */
export function encodeArtifactContent(
  buffer: Buffer,
  artifactType: ArtifactType
): { rawContent: string; rawContentEncoding: RawContentEncoding } {
  if (BINARY_ARTIFACT_TYPES.has(artifactType)) {
    return { rawContent: buffer.toString('base64'), rawContentEncoding: 'base64' };
  }
  return { rawContent: buffer.toString('utf-8'), rawContentEncoding: 'utf-8' };
}

function inferLegacyArtifactType(key?: string | null, rawContent?: string | null): ArtifactType {
  const fromKey = key ? resolveArtifactType(null, key) : null;
  if (fromKey) return fromKey;
  const trimmed = rawContent?.trim() ?? '';
  if (trimmed.startsWith('<')) return 'XML';
  return 'JSON';
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string | Uint8Array>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class ArtifactFetchError extends Error {
  constructor(storagePath: string, cause: string) {
    super(`Failed to fetch clean artifact '${storagePath}' from object storage: ${cause}`);
    this.name = 'ArtifactFetchError';
  }
}

interface PreparedArtifact {
  fileId: string | null;
  fileName: string | null;
  storagePath: string | null;
  artifactType: ArtifactType;
  rawContent: string | null;
  rawContentEncoding: RawContentEncoding;
}

/**
 * Shared execution pipeline for an analysis run: fetches every resolved CLEAN
 * artifact, dispatches each (engine x artifact) pair to the Python analysis
 * service, persists findings + evidence under the tenant's RLS transaction, and
 * aggregates a truthful final status.
 *
 * Status semantics per (engine, artifact) call:
 *  - HTTP error / network error / schema error / response status FAILED -> failed
 *    (findings of a FAILED response are diagnostic only and are NOT persisted)
 *  - response status PARTIAL -> findings persisted, run counted as partial
 *  - response status COMPLETED -> success
 * Final analysis status: COMPLETED only if every call completed; FAILED if every
 * call failed; PARTIAL otherwise.
 *
 * Artifact fetch errors are NOT swallowed: they throw ArtifactFetchError so the
 * caller marks the analysis FAILED (and BullMQ may retry).
 */
export class AnalysisExecutor {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: S3StorageService | undefined,
    private readonly analysisUrl: string,
    private readonly logger: Logger,
    private readonly releasedObjects?: ReleasedObjectsSource,
    /** Observability hook: engine call latency + outcome (C §57). */
    private readonly onEngineCall?: (engine: string, outcome: EngineRunOutcome, durationMs: number) => void
  ) {}

  /**
   * Knowledge-graph integration (additive): for CLEAN_CORE_OBJECT_GUARD the
   * objects referenced by the artifact are classified against the latest
   * immutable knowledge snapshot and passed as configuration.released_objects;
   * the snapshot id is recorded on the analysis for reproducibility (Part 17.3).
   */
  private async knowledgeConfiguration(
    engine: EngineType,
    artifact: PreparedArtifact,
    input: AnalysisRunInput,
    cache: Map<string, ReleasedObjectsConfiguration | null>,
    recorded: Set<string>
  ): Promise<Record<string, unknown>> {
    if (!this.releasedObjects || !KNOWLEDGE_AWARE_ENGINES.has(engine)) return {};
    const key = artifact.fileId ?? artifact.storagePath ?? 'inline';
    if (!cache.has(key)) {
      cache.set(
        key,
        await this.releasedObjects
          .forArtifact(artifact.rawContent, artifact.rawContentEncoding, input.targetRelease)
          .catch(() => null)
      );
    }
    const list = cache.get(key);
    if (!list) return {};
    if (!recorded.has(list.snapshotId)) {
      recorded.add(list.snapshotId);
      await this.db
        .query(
          `UPDATE analyses SET knowledge_snapshot_id = $1 WHERE id = $2 AND organization_id = $3`,
          [list.snapshotId, input.analysisId, input.organizationId],
          { tenantId: input.organizationId }
        )
        .catch((err: any) => this.logger.warn(`Could not record knowledge snapshot on analysis: ${err?.message ?? err}`));
    }
    return { [RELEASED_OBJECTS_CONFIG_KEY]: list };
  }

  private async prepareArtifacts(input: AnalysisRunInput): Promise<PreparedArtifact[]> {
    const prepared: PreparedArtifact[] = [];

    for (const file of input.files ?? []) {
      if (!this.storage) {
        throw new ArtifactFetchError(file.storagePath, 'object storage service unavailable');
      }
      let buffer: Buffer;
      try {
        const stream = await this.storage.getCleanStream(file.storagePath);
        buffer = await streamToBuffer(stream);
      } catch (err: any) {
        throw new ArtifactFetchError(file.storagePath, err?.message ?? String(err));
      }
      const encoded = encodeArtifactContent(buffer, file.artifactType);
      prepared.push({
        fileId: file.fileId,
        fileName: file.fileName,
        storagePath: file.storagePath,
        artifactType: file.artifactType,
        ...encoded,
      });
    }

    // Legacy job payloads (enqueued before fileIds were mandatory).
    if (prepared.length === 0 && (input.legacyArtifactS3Key || input.legacyRawContent)) {
      const artifactType =
        input.legacyArtifactType ||
        inferLegacyArtifactType(input.legacyArtifactS3Key, input.legacyRawContent);
      if (input.legacyRawContent) {
        prepared.push({
          fileId: null,
          fileName: null,
          storagePath: input.legacyArtifactS3Key ?? null,
          artifactType,
          rawContent: input.legacyRawContent,
          rawContentEncoding: 'utf-8',
        });
      } else if (input.legacyArtifactS3Key) {
        if (!this.storage) {
          throw new ArtifactFetchError(input.legacyArtifactS3Key, 'object storage service unavailable');
        }
        let buffer: Buffer;
        try {
          const stream = await this.storage.getCleanStream(input.legacyArtifactS3Key);
          buffer = await streamToBuffer(stream);
        } catch (err: any) {
          throw new ArtifactFetchError(input.legacyArtifactS3Key, err?.message ?? String(err));
        }
        prepared.push({
          fileId: null,
          fileName: null,
          storagePath: input.legacyArtifactS3Key,
          artifactType,
          ...encodeArtifactContent(buffer, artifactType),
        });
      }
    }

    return prepared;
  }

  async run(input: AnalysisRunInput): Promise<AnalysisRunResult> {
    const { analysisId, organizationId, projectId, targetRelease } = input;

    const runningRes = await this.db.query(
      `UPDATE analyses SET status = 'RUNNING' WHERE id = $1 AND organization_id = $2 RETURNING created_at`,
      [analysisId, organizationId],
      { tenantId: organizationId }
    );
    // Time-based rules (e.g. decommission recency) need a stable reference date. Use the
    // analysis creation date so re-runs of the same analysis stay reproducible; an
    // evaluation date inside the artifact or the requested configuration still wins.
    const createdAt = runningRes?.rows?.[0]?.created_at;
    const evaluationDate = createdAt ? new Date(createdAt).toISOString().slice(0, 10) : undefined;

    const progress = await AnalysisProgressTracker.resume(this.db, organizationId, analysisId, this.logger);

    // --- Stage: PARSING (fetch + decode every artifact) ---------------------------------
    await progress.start('PARSING', { artifacts: input.files?.length ?? 0 });
    let artifacts: PreparedArtifact[];
    try {
      artifacts = await this.prepareArtifacts(input);
      if (artifacts.length === 0) {
        throw new Error(`Analysis ${analysisId} has no resolvable artifacts to analyse`);
      }
    } catch (err: any) {
      await progress.fail(String(err?.message ?? err), 'PARSING');
      throw err;
    }
    await progress.complete('PARSING', {
      artifacts: artifacts.length,
      bytes: artifacts.reduce((n, a) => n + (a.rawContent?.length ?? 0), 0),
    });

    // --- Stage: RUNNING_RULES ------------------------------------------------------------
    const units = this.buildWorkUnits(input, artifacts);
    const stages = this.groupUnitsIntoStages(input, units);
    const concurrency = input.stages?.length ? Math.max(1, Math.min(8, input.concurrency ?? 4)) : 1;

    let totalFindings = 0;
    const calls: EngineCallRecord[] = [];
    const perEngine = new Map<EngineType, { completed: number; partial: number; failed: number; units: number }>();
    for (const u of units) {
      const s = perEngine.get(u.engine) ?? { completed: 0, partial: 0, failed: 0, units: 0 };
      s.units++;
      perEngine.set(u.engine, s);
    }
    const knowledgeCache = new Map<string, ReleasedObjectsConfiguration | null>();
    const recordedSnapshots = new Set<string>();
    let done = 0;

    await progress.start('RUNNING_RULES', {
      done: 0,
      total: units.length,
      stages: stages.map((s) => [...new Set(s.map((u) => u.engine))]),
      parallel: concurrency > 1,
    });

    for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
      const stageUnits = stages[stageIdx];
      await runPool(stageUnits, concurrency, async (unit) => {
        const record = await this.executeUnit(unit, input, evaluationDate, knowledgeCache, recordedSnapshots);
        totalFindings += record.persisted;
        calls.push(record.call);
        const s = perEngine.get(unit.engine)!;
        if (record.call.outcome === 'COMPLETED') s.completed++;
        else if (record.call.outcome === 'PARTIAL') s.partial++;
        else s.failed++;
        done++;
        await progress.progress('RUNNING_RULES', {
          done,
          total: units.length,
          stage: stageIdx + 1,
          lastEngine: unit.engine,
          findings: totalFindings,
        });
      });
    }

    let completedCalls = 0;
    let partialCalls = 0;
    let failedCalls = 0;
    const engineOutcomes: Record<string, EngineRunOutcome> = {};
    for (const [engine, s] of perEngine) {
      completedCalls += s.completed;
      partialCalls += s.partial;
      failedCalls += s.failed;
      engineOutcomes[engine] = s.failed === s.units ? 'FAILED' : s.completed === s.units ? 'COMPLETED' : 'PARTIAL';
    }

    const totalCalls = completedCalls + partialCalls + failedCalls;
    const finalStatus: EngineRunOutcome =
      completedCalls === totalCalls
        ? 'COMPLETED'
        : failedCalls === totalCalls
        ? 'FAILED'
        : 'PARTIAL';

    await progress.complete('RUNNING_RULES', {
      done,
      total: units.length,
      completed: completedCalls,
      partial: partialCalls,
      failed: failedCalls,
      findings: totalFindings,
    });

    // --- Stage: MATCHING_EVIDENCE (evidence integrity + cross-engine correlation) --------
    let summary: PreflightSummary | undefined;
    let findingRows: AnalysisFindingRow[] = [];
    await progress.start('MATCHING_EVIDENCE');
    try {
      findingRows = await this.loadFindingsForPostProcessing(organizationId, analysisId);
      const withEvidence = findingRows.filter((f) => f.evidence.some((e) => e.sha256)).length;
      summary = correlate(
        findingRows.map((f) => ({
          id: f.id,
          engine: f.engine,
          ruleId: f.ruleId,
          severity: f.severity,
          category: f.category,
          title: f.title,
          confidenceClass: f.confidenceClass,
          affectedObjects: f.affectedObjects,
          fingerprint: f.fingerprint,
          artifactPaths: f.evidence.map((e) => e.artifactPath).filter((p): p is string => Boolean(p)),
          technicalDetails: f.technicalDetails,
        })),
        calls
      );
      await this.db.query(
        `UPDATE analyses SET orchestration = COALESCE(orchestration, '{}'::jsonb) || $1::jsonb WHERE id = $2 AND organization_id = $3`,
        [JSON.stringify({ summary, calls: calls.slice(0, 500) }), analysisId, organizationId],
        { tenantId: organizationId }
      );
      await progress.complete('MATCHING_EVIDENCE', {
        findings: findingRows.length,
        withEvidence,
        withoutEvidence: findingRows.length - withEvidence,
        duplicates: summary.totals.duplicates,
        correlatedGroups: summary.totals.correlatedGroups,
      });
    } catch (err: any) {
      this.logger.warn(`Evidence matching / correlation failed for ${analysisId}: ${err?.message ?? err}`);
      await progress.fail(`Evidence matching failed: ${err?.message ?? err}`, 'MATCHING_EVIDENCE');
    }

    // --- Stage: GENERATING_TESTS ---------------------------------------------------------
    let testsGenerated = 0;
    try {
      const tests = buildRegressionTests(findingRows, targetRelease);
      if (tests.length === 0) {
        await progress.skip('GENERATING_TESTS', 'No evidence-backed BLOCKER/CRITICAL/MAJOR finding to derive a regression test from.');
      } else {
        await progress.start('GENERATING_TESTS', { eligible: tests.length });
        await this.db.withTenantTransaction(organizationId, async (client) => {
          for (const t of tests) {
            await client.query(
              `INSERT INTO tests (id, organization_id, project_id, finding_id, title, test_type, steps, expected_result, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')`,
              [uuidv4(), organizationId, projectId, t.findingId, t.title, t.testType, JSON.stringify(t.steps), t.expectedResult]
            );
          }
        });
        testsGenerated = tests.length;
        await progress.complete('GENERATING_TESTS', { generated: testsGenerated, version: REGRESSION_TEST_VERSION });
      }
    } catch (err: any) {
      this.logger.warn(`Regression test generation failed for ${analysisId}: ${err?.message ?? err}`);
      await progress.fail(`Test generation failed: ${err?.message ?? err}`, 'GENERATING_TESTS');
    }

    // --- Stage: FINALIZING ---------------------------------------------------------------
    await progress.start('FINALIZING');
    await this.db.query(
      `UPDATE analyses SET status = $1, completed_at = NOW() WHERE id = $2 AND organization_id = $3`,
      [finalStatus, analysisId, organizationId],
      { tenantId: organizationId }
    );
    await progress.complete('FINALIZING', { status: finalStatus, findings: totalFindings, tests: testsGenerated });

    this.logger.log(
      `Analysis ${analysisId} finished with status ${finalStatus}: ${completedCalls} completed, ${partialCalls} partial, ${failedCalls} failed engine/artifact runs; ${totalFindings} findings persisted`
    );

    return { finalStatus, totalFindings, engineOutcomes, calls, summary, testsGenerated };
  }

  /**
   * Work units: explicit planner assignments when given, otherwise every engine over
   * every artifact (engine-major order, the original behaviour).
   */
  private buildWorkUnits(input: AnalysisRunInput, artifacts: PreparedArtifact[]): WorkUnit[] {
    if (input.assignments && input.assignments.length > 0) {
      const byId = new Map(artifacts.filter((a) => a.fileId).map((a) => [a.fileId as string, a]));
      const units: WorkUnit[] = [];
      for (const asg of input.assignments) {
        const artifact = byId.get(asg.fileId);
        if (!artifact) {
          this.logger.warn(`Assignment ${asg.engine} -> ${asg.fileId} references an artifact that is not part of the run; skipped`);
          continue;
        }
        const companions = (asg.companions ?? [])
          .map((c) => ({ configKey: c.configKey, artifact: byId.get(c.fileId) }))
          .filter((c): c is { configKey: string; artifact: PreparedArtifact } => Boolean(c.artifact));
        units.push({ engine: asg.engine, artifact, companions });
      }
      return units;
    }
    const units: WorkUnit[] = [];
    for (const engine of input.engineTypes) {
      for (const artifact of artifacts) units.push({ engine, artifact, companions: [] });
    }
    return units;
  }

  private groupUnitsIntoStages(input: AnalysisRunInput, units: WorkUnit[]): WorkUnit[][] {
    if (!input.stages || input.stages.length === 0) return [units];
    const stages: WorkUnit[][] = [];
    const placed = new Set<WorkUnit>();
    for (const stageEngines of input.stages) {
      const stageUnits = units.filter((u) => stageEngines.includes(u.engine));
      stageUnits.forEach((u) => placed.add(u));
      if (stageUnits.length) stages.push(stageUnits);
    }
    const rest = units.filter((u) => !placed.has(u));
    if (rest.length) stages.push(rest);
    return stages;
  }

  private async executeUnit(
    unit: WorkUnit,
    input: AnalysisRunInput,
    evaluationDate: string | undefined,
    knowledgeCache: Map<string, ReleasedObjectsConfiguration | null>,
    recordedSnapshots: Set<string>
  ): Promise<{ call: EngineCallRecord; persisted: number }> {
    const { analysisId, organizationId, projectId, targetRelease } = input;
    const { engine, artifact } = unit;
    const label = `Engine '${engine}' on artifact '${artifact.fileName ?? artifact.storagePath ?? 'inline'}'`;
    const started = Date.now();
    const call: EngineCallRecord = {
      engine,
      fileId: artifact.fileId,
      fileName: artifact.fileName,
      outcome: 'FAILED',
      findings: 0,
      rulesEvaluated: 0,
      durationMs: 0,
      error: null,
    };
    let persisted = 0;
    try {
      const knowledgeConfig = await this.knowledgeConfiguration(engine, artifact, input, knowledgeCache, recordedSnapshots);
      const companionConfig: Record<string, unknown> = {};
      for (const c of unit.companions) {
        if (c.artifact.rawContentEncoding === 'utf-8' && c.artifact.rawContent !== null) {
          companionConfig[c.configKey] = c.artifact.rawContent;
        }
      }
      const wirePayload = toWireJobRequest({
        jobId: analysisId,
        tenantId: organizationId,
        projectId,
        engineType: engine,
        targetRelease,
        artifactS3Key: artifact.storagePath,
        artifactType: artifact.artifactType,
        configuration: {
          ...(evaluationDate ? { evaluation_date: evaluationDate } : {}),
          ...(input.configuration ?? {}),
          ...(artifact.fileId ? { sourceFileId: artifact.fileId } : {}),
          ...(artifact.fileName ? { sourceFileName: artifact.fileName } : {}),
          ...companionConfig,
          ...knowledgeConfig,
        },
        rawContent: artifact.rawContent,
        rawContentEncoding: artifact.rawContentEncoding,
      });

      const res = await fetch(`${this.analysisUrl}/api/v1/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Tenant-Id': organizationId,
        },
        body: JSON.stringify(wirePayload),
      });

      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`${label} failed [HTTP ${res.status}]: ${errText}`);
        call.error = `HTTP ${res.status}`;
        return { call, persisted };
      }

      const validated = AnalysisJobResponseSchema.parse(await res.json());
      call.rulesEvaluated = validated.metrics?.rulesEvaluated ?? 0;

      if (validated.status === 'FAILED') {
        this.logger.error(
          `${label} reported FAILED: ${validated.errorMessage ?? 'no error message'} (diagnostic findings not persisted)`
        );
        call.error = (validated.errorMessage ?? 'engine reported FAILED').slice(0, 300);
        return { call, persisted };
      }

      if (validated.findings.length > 0) {
        persisted = await this.persistFindings(organizationId, projectId, analysisId, engine, validated.findings);
      }
      call.findings = persisted;

      if (validated.status === 'PARTIAL') {
        this.logger.warn(`${label} reported PARTIAL: ${validated.errorMessage ?? 'no error message'}`);
        call.outcome = 'PARTIAL';
        call.error = validated.errorMessage ? validated.errorMessage.slice(0, 300) : null;
      } else {
        call.outcome = 'COMPLETED';
      }
    } catch (err: any) {
      this.logger.warn(`${label} execution failed: ${err?.message ?? err}`);
      call.error = String(err?.message ?? err).slice(0, 300);
    } finally {
      call.durationMs = Date.now() - started;
      try {
        this.onEngineCall?.(engine, call.outcome, call.durationMs);
      } catch {
        /* metrics must never break analysis */
      }
    }
    return { call, persisted };
  }

  /** Findings of this analysis with their evidence pointers (for correlation + tests). */
  private async loadFindingsForPostProcessing(organizationId: string, analysisId: string): Promise<AnalysisFindingRow[]> {
    const res = await this.db.query(
      `SELECT f.id, f.engine, f.rule_id, f.severity, f.category, f.title, f.confidence_class, f.remediation,
              f.affected_objects, f.fingerprint, f.technical_details,
              COALESCE(
                json_agg(json_build_object('artifactPath', e.artifact_path, 'lineNumber', e.line_number, 'sha256', e.sha256)
                         ORDER BY e.artifact_path, e.line_number) FILTER (WHERE e.id IS NOT NULL),
                '[]'::json
              ) AS evidence
         FROM findings f
         LEFT JOIN evidence e ON e.finding_id = f.id AND e.organization_id = f.organization_id
        WHERE f.organization_id = $1 AND f.analysis_id = $2
        GROUP BY f.id
        ORDER BY f.id`,
      [organizationId, analysisId],
      { tenantId: organizationId }
    );
    return (res?.rows ?? []).map((r: any) => ({
      id: String(r.id),
      engine: String(r.engine),
      ruleId: String(r.rule_id),
      severity: String(r.severity),
      category: r.category ?? null,
      title: String(r.title ?? ''),
      confidenceClass: r.confidence_class ?? null,
      remediation: r.remediation ?? null,
      affectedObjects: toStringArray(r.affected_objects),
      fingerprint: r.fingerprint ?? null,
      technicalDetails: typeof r.technical_details === 'string' ? safeObject(r.technical_details) : r.technical_details ?? null,
      evidence: (Array.isArray(r.evidence) ? r.evidence : []).map((e: any) => ({
        artifactPath: e?.artifactPath ?? null,
        lineNumber: typeof e?.lineNumber === 'number' ? e.lineNumber : e?.lineNumber ? Number(e.lineNumber) : null,
        sha256: e?.sha256 ?? null,
      })),
    }));
  }

  private async persistFindings(
    organizationId: string,
    projectId: string,
    analysisId: string,
    engine: EngineType,
    findings: Array<Record<string, any>>
  ): Promise<number> {
    let count = 0;
    await this.db.withTenantTransaction(organizationId, async (client) => {
      for (const f of findings) {
        // Always mint a fresh row id: the same rule may fire on several artifacts
        // and engines may reuse deterministic ids across runs.
        const findingId = uuidv4();
        const firstObjName = f.affectedObjects?.[0]?.name || 'GLOBAL';
        const firstArtifact = f.evidence?.[0]?.artifactPath || 'UNKNOWN_SOURCE';
        const fingerprint =
          f.fingerprint || createFindingFingerprint(f.ruleId, firstObjName, firstArtifact);

        await client.query(
          `INSERT INTO findings (
            id, organization_id, project_id, analysis_id, engine, rule_id,
            severity, category, title, description, confidence_class,
            confidence_score, remediation, affected_objects, technical_details, fingerprint
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            findingId,
            organizationId,
            projectId,
            analysisId,
            engine,
            f.ruleId,
            f.severity,
            f.category,
            f.title,
            f.description,
            f.confidence,
            f.confidenceScore,
            f.remediation,
            JSON.stringify(f.affectedObjects || []),
            JSON.stringify(f.technicalDetails || {}),
            fingerprint,
          ]
        );

        for (const ev of Array.isArray(f.evidence) ? f.evidence : []) {
          await client.query(
            `INSERT INTO evidence (
              id, organization_id, finding_id, artifact_path, line_number,
              column_number, snippet, sha256, provenance, source_title,
              source_url, trust_score
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              uuidv4(),
              organizationId,
              findingId,
              ev.artifactPath,
              ev.lineNumber ?? null,
              ev.columnNumber ?? null,
              ev.snippet ?? null,
              ev.sha256,
              ev.provenance || 'VERIFIED',
              ev.sourceTitle ?? null,
              ev.sourceUrl ?? null,
              ev.trustScore ?? 1.0,
            ]
          );
        }
        count++;
      }
    });
    return count;
  }
}

/**
 * Applies the organization's data-governance policy (deterministicOnly /
 * allowAiAssistance) on top of a requested engine configuration. Defaults to the
 * requested values when no policy row can be read.
 */
export async function applyDataPolicy(
  db: DatabaseService,
  organizationId: string,
  configuration?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let isDeterministicOnly = false;
  let allowAiAssistance = true;
  try {
    const orgRes = await db.query(
      `SELECT data_policy FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    if (orgRes.rows?.length > 0 && orgRes.rows[0].data_policy) {
      const policy =
        typeof orgRes.rows[0].data_policy === 'string'
          ? JSON.parse(orgRes.rows[0].data_policy)
          : orgRes.rows[0].data_policy;
      if (policy.deterministicOnly) isDeterministicOnly = true;
      if (policy.allowAiAssistance === false) allowAiAssistance = false;
    }
  } catch {
    // default to requested configuration
  }

  const cfg = configuration ?? {};
  return {
    ...cfg,
    deterministicOnly: isDeterministicOnly || (cfg as any).deterministicOnly === true,
    allowAiAssistance:
      !isDeterministicOnly && allowAiAssistance && (cfg as any).allowAiAssistance !== false,
  };
}
