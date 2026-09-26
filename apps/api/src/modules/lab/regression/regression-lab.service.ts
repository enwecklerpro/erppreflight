import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  AnalysisJobResponseSchema,
  BatchRunRegressionTestsInput,
  ENGINE_TEST_TYPES,
  EngineTypeEnum,
  FINDING_WRITE_ROLES,
  GenerateRegressionTestInput,
  RegressionFixtureExport,
  RunRegressionTestInput,
  ScheduleRegressionTestsInput,
  TargetReleaseEnum,
  UpdateRegressionFixtureInput,
  toWireJobRequest,
} from '@erppreflight/schemas';
import { DatabaseService } from '../../database/database.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { UsageService } from '../../usage/usage.service';
import { encodeArtifactContent, resolveArtifactType } from '../../jobs/analysis-executor';
import { FindingLifecycleService, LifecycleActor } from '../../findings/lifecycle/finding-lifecycle.service';
import { affectedObjectNames } from '../../findings/lifecycle/lifecycle-keys';
import {
  KNOWLEDGE_AWARE_ENGINES,
  RELEASED_OBJECTS_CONFIG_KEY,
  ReleasedObjectsProvider,
} from '../../knowledge-graph/released-objects.provider';
import {
  compareWithBaseline,
  evaluateRegressionRun,
  RunFindingSummary,
  summarizeFindings,
} from './regression-evaluation';
import { LabAnalysisHandle, LabAnalysisRecorder } from '../lab-analysis-recorder';
import type { AnalysisInputs, LabRunSummary } from '@erppreflight/schemas';
import type { RecordedInputFile } from '../../jobs/analysis-inputs';

/** Options of a lab execution that are not part of the regression API contract. */
export interface LabExecutionOptions {
  /** Analysis this execution re-runs (POST /analyses/:id/rerun). */
  rerunOfAnalysisId?: string | null;
  /** Trigger recorded in the lab analysis inputs (the run rows keep MANUAL / BATCH / SCHEDULED). */
  inputsTrigger?: NonNullable<AnalysisInputs['trigger']>;
  /** Attribution for runs without an interactive actor (schedules). */
  userId?: string | null;
}

export const REGRESSION_LAB_QUEUE = 'regression-lab-queue';
const MAX_EXPORT_CONTENT_BYTES = 1024 * 1024;

export interface ScheduledRegressionJobData {
  scheduleId: string;
  organizationId: string;
  projectId: string;
  userId: string | null;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string | Uint8Array>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function mapTestCase(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceFindingId: row.source_finding_id ?? null,
    lifecycleId: row.lifecycle_id ?? null,
    title: row.title,
    testType: row.test_type,
    engine: row.engine,
    ruleId: row.rule_id,
    matchObjects: json<string[]>(row.match_objects, []),
    preconditions: json<string[]>(row.preconditions, []),
    artifact: {
      fileId: row.artifact_file_id ?? null,
      name: row.artifact_name ?? null,
      sha256: row.artifact_sha256 ?? null,
      type: row.artifact_type,
      available: row.artifact_file_id ? row.artifact_quarantine_status === 'CLEAN' : false,
    },
    configuration: json<Record<string, unknown>>(row.configuration, {}),
    expectedOutcome: row.expected_outcome,
    targetRelease: row.target_release,
    fixtureVersion: Number(row.fixture_version),
    engineVersion: row.engine_version ?? null,
    ruleVersion: row.rule_version ?? null,
    status: row.status,
    baselineRunId: row.baseline_run_id ?? null,
    lastRun: row.last_run_id
      ? { id: row.last_run_id, status: row.last_run_status, at: iso(row.last_run_at) }
      : null,
    findingStatus: row.lifecycle_status ?? null,
    /** Generated test (analysis GENERATING_TESTS stage) this case was promoted from, and its analysis. */
    generatedTestId: row.generated_test_id ?? null,
    originAnalysisId: row.origin_analysis_id ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapRun(row: any) {
  return {
    id: row.id,
    testCaseId: row.test_case_id,
    batchId: row.batch_id ?? null,
    trigger: row.trigger_kind,
    fixtureVersion: Number(row.fixture_version),
    artifactFileId: row.artifact_file_id ?? null,
    artifactSha256: row.artifact_sha256 ?? null,
    targetRelease: row.target_release,
    engineVersion: row.engine_version ?? null,
    status: row.status,
    findingPresent: row.finding_present,
    matchedFindings: json<RunFindingSummary[]>(row.matched_findings, []),
    findings: json<RunFindingSummary[]>(row.findings_summary, []),
    baselineComparison: json<Record<string, unknown> | null>(row.baseline_comparison, null),
    executionTimeMs: row.execution_time_ms ?? null,
    errorMessage: row.error_message ?? null,
    triggeredBy: row.triggered_by ?? null,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    analysisId: row.analysis_id ?? null,
  };
}

const TEST_CASE_SELECT = `SELECT t.*, uf.quarantine_status AS artifact_quarantine_status, l.status AS lifecycle_status,
       gt.analysis_id AS origin_analysis_id
  FROM regression_test_cases t
  LEFT JOIN uploaded_files uf ON uf.id = t.artifact_file_id
  LEFT JOIN finding_lifecycles l ON l.id = t.lifecycle_id
  LEFT JOIN tests gt ON gt.id = t.generated_test_id AND gt.organization_id = t.organization_id`;

function fixtureFiles(rows: any[], overrideFileId?: string | null): RecordedInputFile[] {
  const seen = new Set<string>();
  const out: RecordedInputFile[] = [];
  for (const r of rows) {
    const fileId = overrideFileId ?? r.artifact_file_id;
    if (!fileId || seen.has(fileId)) continue;
    seen.add(fileId);
    out.push({
      fileId,
      fileName: overrideFileId && overrideFileId !== r.artifact_file_id ? '' : r.artifact_name ?? '',
      artifactType: r.artifact_type,
    });
  }
  return out;
}

function summarizeLab(
  runs: Array<{ status: string }>,
  planned: number,
  trigger: string,
  batchId: string | null
): LabRunSummary {
  return {
    type: 'REGRESSION',
    trigger,
    batchId,
    total: planned,
    passed: runs.filter((r) => r.status === 'PASSED').length,
    failed: runs.filter((r) => r.status === 'FAILED').length,
    errored: runs.filter((r) => r.status === 'ERROR').length,
  };
}

/**
 * Customer-facing regression Test Lab (Part 05 §5.5, Section C §18): turns any finding
 * into a rule-scenario / contract test bound to the evidence-bearing artifact, re-runs
 * the engine through the analysis service wire contract on the stored (or a fixed)
 * artifact, compares against the baseline run and exports a machine-readable fixture.
 */
@Injectable()
export class RegressionLabService {
  private readonly logger = new Logger(RegressionLabService.name);
  private readonly analysisUrl: string;
  private readonly recorder: LabAnalysisRecorder;

  constructor(
    private readonly db: DatabaseService,
    private readonly lifecycle: FindingLifecycleService,
    @Optional() private readonly storage?: S3StorageService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly usage?: UsageService,
    @Optional() @InjectQueue(REGRESSION_LAB_QUEUE) private readonly queue?: Queue,
    @Optional() private readonly releasedObjects?: ReleasedObjectsProvider
  ) {
    this.analysisUrl =
      this.config?.get<string>('ANALYSIS_SERVICE_URL') || process.env.ANALYSIS_SERVICE_URL || 'http://localhost:8000';
    this.recorder = new LabAnalysisRecorder(db, this.logger);
  }

  private async cleanFile(client: any, tenantId: string, projectId: string, fileId: string) {
    const res = await client.query(
      `SELECT id, file_name, storage_path, checksum_sha256, quarantine_status, metadata
         FROM uploaded_files WHERE id = $1 AND organization_id = $2 AND project_id = $3`,
      [fileId, tenantId, projectId]
    );
    const f = res.rows[0];
    if (!f) throw new NotFoundException({ code: 'ARTIFACT_NOT_FOUND', message: 'Artifact not found in this project.' });
    if (f.quarantine_status !== 'CLEAN') {
      throw new BadRequestException({
        code: 'ARTIFACT_NOT_CLEAN',
        message: `Artifact '${f.file_name}' is not usable as a fixture (quarantine status ${f.quarantine_status}).`,
      });
    }
    const metadata = json<Record<string, any>>(f.metadata, {});
    const artifactType = resolveArtifactType(metadata?.detectedFormat, f.file_name);
    if (!artifactType) {
      throw new BadRequestException({
        code: 'ARTIFACT_FORMAT_NOT_ANALYSABLE',
        message: `Artifact '${f.file_name}' has a format that no preflight engine can analyse.`,
      });
    }
    return { ...f, artifactType };
  }

  // ------------------------------------------------------------------ generate

  async generateFromFinding(tenantId: string, actor: LifecycleActor, dto: GenerateRegressionTestInput) {
    FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Generating a regression test');
    return this.db.withTenantTransaction(tenantId, (client) => this.createFromFinding(client, tenantId, actor, dto));
  }

  /**
   * Creates a regression test case from a finding inside the caller's tenant transaction
   * (role already checked). `generatedTestId` links the case to the generated test it was
   * promoted from (GeneratedTestsService).
   */
  async createFromFinding(
    client: any,
    tenantId: string,
    actor: LifecycleActor,
    dto: GenerateRegressionTestInput,
    generatedTestId: string | null = null
  ) {
    const { lifecycle } = await this.lifecycle.ensureLifecycle(client, tenantId, dto.findingId);
    const fRes = await client.query(
      `SELECT f.id, f.project_id, f.engine, f.rule_id, f.title, f.affected_objects, f.source_file_id,
              f.target_release, f.engine_version, f.rule_version, a.target_release AS analysis_release,
              a.created_at AS analysis_created_at, p.target_release AS project_release
         FROM findings f
         JOIN projects p ON p.id = f.project_id
         LEFT JOIN analyses a ON a.id = f.analysis_id
        WHERE f.id = $1 AND f.organization_id = $2`,
      [dto.findingId, tenantId]
    );
    const f = fRes.rows[0];
    const fileId = dto.fileId ?? f.source_file_id;
    if (!fileId) {
      throw new BadRequestException({
        code: 'FIXTURE_ARTIFACT_REQUIRED',
        message: 'This finding has no recorded source artifact. Pass fileId of a CLEAN project artifact.',
      });
    }
    const file = await this.cleanFile(client, tenantId, f.project_id, fileId);
    const engine = EngineTypeEnum.safeParse(f.engine);
    if (!engine.success) throw new BadRequestException(`Engine '${f.engine}' cannot be re-run by the Test Lab.`);
    const targetRelease = f.target_release ?? f.analysis_release ?? f.project_release ?? 'S4H_2023';
    const matchObjects = affectedObjectNames(f.affected_objects);
    const evaluationDate = f.analysis_created_at
      ? new Date(f.analysis_created_at).toISOString().slice(0, 10)
      : undefined;
    const configuration = evaluationDate ? { evaluation_date: evaluationDate } : {};
    const scope = matchObjects.length ? matchObjects.join(', ') : file.file_name;
    const title =
      dto.title ??
      `${dto.expectedOutcome === 'FINDING_ABSENT' ? 'Fix verification' : 'Reproduction'}: ${f.rule_id} on ${scope}`;
    const preconditions = dto.preconditions ?? [
      `Artifact '${file.file_name}' (SHA-256 ${String(file.checksum_sha256).slice(0, 12)}…) passed ingestion scanning and is CLEAN.`,
      `Engine ${f.engine}${f.engine_version ? ` v${f.engine_version}` : ''} is registered in the analysis service.`,
      `Evaluation against target release ${targetRelease}${evaluationDate ? ` with evaluation date ${evaluationDate}` : ''}.`,
    ];
    const ins = await client.query(
      `INSERT INTO regression_test_cases (
         organization_id, project_id, source_finding_id, lifecycle_id, title, test_type, engine, rule_id,
         match_objects, preconditions, artifact_file_id, artifact_name, artifact_sha256, artifact_type,
         configuration, expected_outcome, target_release, fixture_version, engine_version, rule_version, created_by,
         generated_test_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1, $18, $19, $20, $21)
       RETURNING id`,
      [
        tenantId,
        f.project_id,
        f.id,
        lifecycle.id,
        title,
        ENGINE_TEST_TYPES[f.engine] ?? 'RULE_SCENARIO',
        f.engine,
        f.rule_id,
        JSON.stringify(matchObjects),
        JSON.stringify(preconditions),
        file.id,
        file.file_name,
        file.checksum_sha256,
        file.artifactType,
        JSON.stringify(configuration),
        dto.expectedOutcome,
        targetRelease,
        f.engine_version,
        f.rule_version,
        actor.id,
        generatedTestId,
      ]
    );
    const testCaseId = ins.rows[0].id;
    await this.lifecycle.markRegressionTestCreated(client, tenantId, lifecycle, f.id, testCaseId, actor.id);
    const row = await client.query(`${TEST_CASE_SELECT} WHERE t.id = $1 AND t.organization_id = $2`, [testCaseId, tenantId]);
    return mapTestCase(row.rows[0]);
  }

  // ------------------------------------------------------------------ reads

  async list(tenantId: string, projectId: string) {
    const res = await this.db.query(
      `${TEST_CASE_SELECT} WHERE t.organization_id = $1 AND t.project_id = $2 ORDER BY t.created_at DESC`,
      [tenantId, projectId],
      { tenantId }
    );
    return { items: res.rows.map(mapTestCase) };
  }

  async get(tenantId: string, testCaseId: string) {
    const res = await this.db.query(`${TEST_CASE_SELECT} WHERE t.id = $1 AND t.organization_id = $2`, [testCaseId, tenantId], {
      tenantId,
    });
    if (!res.rows[0]) throw new NotFoundException('Regression test not found');
    const runs = await this.db.query(
      `SELECT * FROM regression_test_runs WHERE test_case_id = $1 AND organization_id = $2 ORDER BY started_at DESC LIMIT 50`,
      [testCaseId, tenantId],
      { tenantId }
    );
    return { ...mapTestCase(res.rows[0]), runs: runs.rows.map(mapRun) };
  }

  // ------------------------------------------------------------------ fixture management

  async updateFixture(tenantId: string, actor: LifecycleActor, testCaseId: string, dto: UpdateRegressionFixtureInput) {
    FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Updating a regression fixture');
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const t = await client.query(
        `SELECT id, project_id, status FROM regression_test_cases WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [testCaseId, tenantId]
      );
      if (!t.rows[0]) throw new NotFoundException('Regression test not found');
      if (t.rows[0].status !== 'ACTIVE') throw new ConflictException('Archived tests cannot be changed');
      const file = await this.cleanFile(client, tenantId, t.rows[0].project_id, dto.fileId);
      await client.query(
        `UPDATE regression_test_cases SET artifact_file_id = $2, artifact_name = $3, artifact_sha256 = $4,
                artifact_type = $5, fixture_version = fixture_version + 1, baseline_run_id = NULL, updated_at = NOW()
          WHERE id = $1`,
        [testCaseId, file.id, file.file_name, file.checksum_sha256, file.artifactType]
      );
      const row = await client.query(`${TEST_CASE_SELECT} WHERE t.id = $1`, [testCaseId]);
      return mapTestCase(row.rows[0]);
    });
  }

  async archive(tenantId: string, actor: LifecycleActor, testCaseId: string) {
    FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Archiving a regression test');
    const res = await this.db.query(
      `UPDATE regression_test_cases SET status = 'ARCHIVED', updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [testCaseId, tenantId],
      { tenantId }
    );
    if (!res.rows[0]) throw new NotFoundException('Regression test not found');
    return this.get(tenantId, testCaseId);
  }

  // ------------------------------------------------------------------ run

  private async loadRunnableCase(tenantId: string, testCaseId: string) {
    const tRes = await this.db.query(`${TEST_CASE_SELECT} WHERE t.id = $1 AND t.organization_id = $2`, [testCaseId, tenantId], {
      tenantId,
    });
    const t = tRes.rows[0];
    if (!t) throw new NotFoundException('Regression test not found');
    if (t.status !== 'ACTIVE') throw new ConflictException('Archived tests cannot be run');
    return t;
  }

  /**
   * Manual single-test run. Recorded as a Test Lab analysis (kind LAB_REGRESSION) so it
   * appears in the project run history and on the analysis detail page; cancellable.
   */
  async run(
    tenantId: string,
    actor: LifecycleActor | null,
    testCaseId: string,
    dto: RunRegressionTestInput,
    options: LabExecutionOptions = {}
  ) {
    if (actor) FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Running a regression test');
    const t = await this.loadRunnableCase(tenantId, testCaseId);
    const lab = await this.recorder.begin({
      organizationId: tenantId,
      projectId: t.project_id,
      userId: actor?.id ?? options.userId ?? null,
      kind: 'LAB_REGRESSION',
      engineTypes: [t.engine],
      targetRelease: t.target_release,
      files: fixtureFiles([t], dto.fileId ?? null),
      total: 1,
      trigger: options.inputsTrigger ?? 'MANUAL',
      testCaseIds: [testCaseId],
      rerunOfAnalysisId: options.rerunOfAnalysisId ?? null,
    });
    const result = await this.executeRun(tenantId, actor, t, dto, 'MANUAL', null, lab).catch(async (err: any) => {
      await this.recorder.fail(lab, String(err?.message ?? err));
      throw err;
    });
    if (!result) {
      await this.recorder.cancelled(lab, summarizeLab([], 1, 'MANUAL', null));
      throw new ConflictException({ code: 'ANALYSIS_CANCELLED', message: 'The Test Lab run was cancelled before the test finished.' });
    }
    const analysisStatus = await this.recorder.finish(
      lab,
      summarizeLab([result], 1, 'MANUAL', null),
      result.status === 'ERROR' ? result.errorMessage : null
    );
    return { ...result, analysisId: lab.analysisId, analysisStatus };
  }

  /**
   * Executes one regression test and records its run row. Returns null when the lab
   * analysis was cancelled while the engine call was in flight (no run row is written).
   */
  private async executeRun(
    tenantId: string,
    actor: LifecycleActor | null,
    t: any,
    dto: RunRegressionTestInput,
    trigger: 'MANUAL' | 'BATCH' | 'SCHEDULED',
    batchId: string | null,
    lab: LabAnalysisHandle | null
  ) {
    const testCaseId: string = t.id;
    const runId = uuidv4();
    const started = Date.now();
    const triggeredBy = actor?.id ?? null;
    const test = mapTestCase(t);
    let status: 'PASSED' | 'FAILED' | 'ERROR' = 'ERROR';
    let findingPresent: boolean | null = null;
    let matched: RunFindingSummary[] = [];
    let findings: RunFindingSummary[] = [];
    let engineVersion: string | null = null;
    let errorMessage: string | null = null;
    let artifactFileId: string | null = dto.fileId ?? t.artifact_file_id ?? null;
    let artifactSha256: string | null = null;
    let rulesEvaluated = 0;

    try {
      if (!artifactFileId) {
        throw new Error('The fixture artifact is no longer available (removed by retention). Update the fixture.');
      }
      const file = await this.db.withTenantTransaction(tenantId, (client) =>
        this.cleanFile(client, tenantId, t.project_id, artifactFileId as string)
      );
      if (!this.storage) throw new Error('Object storage is not configured');
      const buffer = await streamToBuffer(await this.storage.getCleanStream(file.storage_path));
      artifactSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const encoded = encodeArtifactContent(buffer, file.artifactType);
      const release = TargetReleaseEnum.safeParse(t.target_release);
      // Same knowledge input as the analysis pipeline for knowledge-aware engines.
      const knowledge =
        this.releasedObjects && KNOWLEDGE_AWARE_ENGINES.has(t.engine)
          ? await this.releasedObjects
              .forArtifact(encoded.rawContent, encoded.rawContentEncoding, t.target_release)
              .catch(() => null)
          : null;
      const wire = toWireJobRequest({
        jobId: runId,
        tenantId,
        projectId: t.project_id,
        engineType: EngineTypeEnum.parse(t.engine),
        targetRelease: release.success ? release.data : 'S4H_2023',
        artifactS3Key: file.storage_path,
        artifactType: file.artifactType,
        configuration: {
          ...test.configuration,
          deterministicOnly: true,
          allowAiAssistance: false,
          sourceFileId: file.id,
          sourceFileName: file.file_name,
          ...(knowledge ? { [RELEASED_OBJECTS_CONFIG_KEY]: knowledge } : {}),
        },
        rawContent: encoded.rawContent,
        rawContentEncoding: encoded.rawContentEncoding,
      });
      const res = await fetch(`${this.analysisUrl}/api/v1/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify(wire),
        signal: lab ? AbortSignal.any([AbortSignal.timeout(120_000), lab.cancellation.signal]) : AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Analysis service returned HTTP ${res.status}`);
      const validated = AnalysisJobResponseSchema.parse(await res.json());
      rulesEvaluated = validated.metrics?.rulesEvaluated ?? 0;
      const extra = (validated.metrics?.additionalMetrics ?? {}) as Record<string, any>;
      engineVersion = typeof extra.engineVersion === 'string' ? extra.engineVersion : null;
      if (validated.status === 'FAILED') {
        throw new Error(`Engine reported FAILED: ${validated.errorMessage ?? 'no error message'}`);
      }
      findings = summarizeFindings(validated.findings as any[]);
      const verdict = evaluateRegressionRun(
        { ruleId: test.ruleId, matchObjects: test.matchObjects, expectedOutcome: test.expectedOutcome },
        findings
      );
      status = verdict.status;
      findingPresent = verdict.findingPresent;
      matched = verdict.matched;
      await this.usage?.recordSafe(tenantId, 'ENGINE_EXECUTION', 1, {
        resourceType: 'REGRESSION_TEST',
        resourceId: testCaseId,
        actorId: triggeredBy ?? undefined,
        metadata: { engine: t.engine, trigger, runId },
      } as any);
    } catch (err: any) {
      if (lab?.cancellation.cancelled) {
        this.logger.log(`Regression run ${runId} for test ${testCaseId} aborted: lab analysis ${lab.analysisId} cancelled`);
        return null;
      }
      const resp = err?.getResponse?.();
      errorMessage = String((resp && typeof resp === 'object' && resp.message) || err?.message || err).slice(0, 1000);
      this.logger.warn(`Regression run ${runId} for test ${testCaseId} errored: ${errorMessage}`);
    }

    const stored = await this.db.withTenantTransaction(tenantId, async (client) => {
      let baselineComparison: Record<string, unknown> | null = null;
      let becomesBaseline = false;
      const usesStoredFixture = !dto.fileId || dto.fileId === t.artifact_file_id;
      if (status !== 'ERROR' && usesStoredFixture) {
        if (t.baseline_run_id) {
          const b = await client.query(
            `SELECT id, status, finding_present, findings_summary FROM regression_test_runs WHERE id = $1`,
            [t.baseline_run_id]
          );
          if (b.rows[0]) {
            baselineComparison = compareWithBaseline(
              {
                id: b.rows[0].id,
                status: b.rows[0].status,
                findingPresent: b.rows[0].finding_present,
                findings: json<RunFindingSummary[]>(b.rows[0].findings_summary, []),
              },
              { status, findingPresent, findings }
            ) as unknown as Record<string, unknown>;
          }
        } else {
          becomesBaseline = true;
        }
      }
      await client.query(
        `INSERT INTO regression_test_runs (
           id, organization_id, project_id, test_case_id, batch_id, trigger_kind, fixture_version, artifact_file_id,
           artifact_sha256, target_release, engine_version, status, finding_present, matched_findings,
           findings_summary, baseline_comparison, execution_time_ms, error_message, triggered_by, started_at, completed_at,
           analysis_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), $21)`,
        [
          runId,
          tenantId,
          t.project_id,
          testCaseId,
          batchId,
          trigger,
          t.fixture_version,
          artifactFileId,
          artifactSha256,
          t.target_release,
          engineVersion,
          status,
          findingPresent,
          JSON.stringify(matched),
          JSON.stringify(findings),
          baselineComparison ? JSON.stringify(baselineComparison) : null,
          Date.now() - started,
          errorMessage,
          triggeredBy,
          new Date(started).toISOString(),
          lab?.analysisId ?? null,
        ]
      );
      await client.query(
        `UPDATE regression_test_cases SET last_run_id = $2, last_run_status = $3, last_run_at = NOW(),
                baseline_run_id = CASE WHEN $4 THEN $2 ELSE baseline_run_id END, updated_at = NOW()
          WHERE id = $1`,
        [testCaseId, runId, status, becomesBaseline]
      );
      let findingResolved = false;
      if (status === 'PASSED' && t.expected_outcome === 'FINDING_ABSENT' && t.lifecycle_id) {
        findingResolved = await this.lifecycle.markResolvedByTest(client, tenantId, t.lifecycle_id, {
          runId,
          testCaseId,
          triggeredBy,
          fixtureVersion: Number(t.fixture_version),
        });
      }
      const row = await client.query(`SELECT * FROM regression_test_runs WHERE id = $1`, [runId]);
      return { ...mapRun(row.rows[0]), isBaseline: becomesBaseline, findingResolved };
    });
    if (lab) {
      await this.recorder.step(lab, {
        engine: t.engine,
        fileId: artifactFileId,
        fileName: t.artifact_name ?? null,
        outcome: status === 'ERROR' ? 'FAILED' : 'COMPLETED',
        findings: findings.length,
        rulesEvaluated,
        durationMs: Date.now() - started,
        error: errorMessage,
        engineVersion,
      });
    }
    return stored;
  }

  async batchRun(
    tenantId: string,
    actor: LifecycleActor | null,
    dto: BatchRunRegressionTestsInput,
    trigger: 'BATCH' | 'SCHEDULED' = 'BATCH',
    options: LabExecutionOptions = {}
  ) {
    if (actor) FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Running regression tests');
    const res = await this.db.query(
      `${TEST_CASE_SELECT}
        WHERE t.organization_id = $1 AND t.project_id = $2 AND t.status = 'ACTIVE'
          AND ($3::uuid[] IS NULL OR t.id = ANY($3::uuid[]))
        ORDER BY t.created_at ASC`,
      [tenantId, dto.projectId, dto.testCaseIds ?? null],
      { tenantId }
    );
    const batchId = uuidv4();
    const runs: any[] = [];
    const rows: any[] = res.rows ?? [];
    // One lab analysis per batch (manual batch, schedule firing or rerun) in the run history.
    const lab = rows.length
      ? await this.recorder.begin({
          organizationId: tenantId,
          projectId: dto.projectId,
          userId: actor?.id ?? options.userId ?? null,
          kind: 'LAB_REGRESSION',
          engineTypes: rows.map((r) => r.engine),
          targetRelease: rows[0].target_release,
          files: fixtureFiles(rows),
          total: rows.length,
          trigger: options.inputsTrigger ?? trigger,
          testCaseIds: rows.map((r) => r.id),
          rerunOfAnalysisId: options.rerunOfAnalysisId ?? null,
        })
      : null;
    let cancelled = false;
    for (const r of rows) {
      if (lab && (lab.cancellation.cancelled || (await lab.cancellation.check()))) {
        cancelled = true;
        break;
      }
      const run = await this.executeRun(tenantId, null, r, {}, trigger, batchId, lab).then(
        (value) => value,
        (err: any) => ({ testCaseId: r.id, status: 'ERROR', errorMessage: err?.message ?? String(err) })
      );
      if (run === null) {
        cancelled = true;
        break;
      }
      runs.push(run);
      // Batch runs are attributed to the caller (actor already authorized above).
      if (actor && runs[runs.length - 1]?.id) {
        await this.db.query(`UPDATE regression_test_runs SET triggered_by = $2 WHERE id = $1`, [runs[runs.length - 1].id, actor.id], {
          tenantId,
        });
      }
    }
    let analysisStatus: string | null = null;
    if (lab) {
      const summary = summarizeLab(runs, rows.length, trigger, batchId);
      if (cancelled) {
        await this.recorder.cancelled(lab, summary);
        analysisStatus = 'CANCELLED';
      } else {
        analysisStatus = await this.recorder.finish(lab, summary);
      }
    }
    return {
      batchId,
      projectId: dto.projectId,
      total: runs.length,
      passed: runs.filter((r) => r.status === 'PASSED').length,
      failed: runs.filter((r) => r.status === 'FAILED').length,
      errored: runs.filter((r) => r.status === 'ERROR').length,
      runs,
      analysisId: lab?.analysisId ?? null,
      analysisStatus,
      cancelled,
    };
  }

  /**
   * Re-runs a LAB_REGRESSION analysis (POST /analyses/:id/rerun): the same regression test
   * cases, as a new lab analysis linked to the source. Archived cases are skipped; when none
   * is runnable any more the rerun is refused (409 RERUN_INPUTS_UNAVAILABLE).
   */
  async rerunLabAnalysis(
    tenantId: string,
    actor: LifecycleActor,
    source: { id: string; projectId: string; testCaseIds: string[]; trigger: string | null }
  ): Promise<{ analysisId: string; status: string; engineTypes: string[]; targetRelease: string | null }> {
    if (source.testCaseIds.length === 0) {
      throw new ConflictException({ code: 'RERUN_INPUTS_UNAVAILABLE', message: 'The Test Lab run has no recorded test cases.' });
    }
    const options: LabExecutionOptions = { rerunOfAnalysisId: source.id, inputsTrigger: 'RERUN' };
    let analysisId: string | null = null;
    if (source.testCaseIds.length === 1 && source.trigger !== 'BATCH' && source.trigger !== 'SCHEDULED') {
      try {
        analysisId = (await this.run(tenantId, actor, source.testCaseIds[0], {}, options)).analysisId;
      } catch (err: any) {
        const code = String((err?.getResponse?.() as { code?: unknown } | undefined)?.code ?? '');
        if (err instanceof NotFoundException || (err instanceof ConflictException && !code.startsWith('ANALYSIS_'))) {
          throw new ConflictException({ code: 'RERUN_INPUTS_UNAVAILABLE', message: 'The regression test of this run was deleted or archived.' });
        }
        throw err;
      }
    } else {
      const batch = await this.batchRun(tenantId, actor, { projectId: source.projectId, testCaseIds: source.testCaseIds }, 'BATCH', options);
      analysisId = batch.analysisId;
    }
    if (!analysisId) {
      throw new ConflictException({ code: 'RERUN_INPUTS_UNAVAILABLE', message: 'None of the regression tests of this run is active any more.' });
    }
    const row = await this.db.query(`SELECT status, engine_types, target_release FROM analyses WHERE id = $1 AND organization_id = $2`, [analysisId, tenantId], {
      tenantId,
    });
    const a = row.rows[0] ?? {};
    return {
      analysisId,
      status: a.status ?? 'COMPLETED',
      engineTypes: json<string[]>(a.engine_types, []),
      targetRelease: a.target_release ?? null,
    };
  }

  // ------------------------------------------------------------------ export

  async exportFixture(tenantId: string, testCaseId: string): Promise<RegressionFixtureExport> {
    const detail = await this.get(tenantId, testCaseId);
    const baseline = detail.baselineRunId ? detail.runs.find((r) => r.id === detail.baselineRunId) : null;
    let content: string | null = null;
    let contentEncoding: 'utf-8' | 'base64' | null = null;
    let contentOmittedReason: string | null = null;
    if (!detail.artifact.fileId || !detail.artifact.available) {
      contentOmittedReason = 'Fixture artifact is no longer available in object storage.';
    } else if (!this.storage) {
      contentOmittedReason = 'Object storage is not configured.';
    } else {
      try {
        const file = await this.db.withTenantTransaction(tenantId, (client) =>
          this.cleanFile(client, tenantId, detail.projectId, detail.artifact.fileId as string)
        );
        const buffer = await streamToBuffer(await this.storage.getCleanStream(file.storage_path));
        if (buffer.length > MAX_EXPORT_CONTENT_BYTES) {
          contentOmittedReason = `Artifact is larger than ${MAX_EXPORT_CONTENT_BYTES} bytes; reference it by SHA-256.`;
        } else {
          const enc = encodeArtifactContent(buffer, file.artifactType);
          content = enc.rawContent;
          contentEncoding = enc.rawContentEncoding;
        }
      } catch (err: any) {
        contentOmittedReason = `Artifact could not be read: ${err?.message ?? err}`;
      }
    }
    return {
      schema: 'erppreflight.regression-fixture/v1',
      testCase: {
        id: detail.id,
        title: detail.title,
        testType: detail.testType,
        engine: detail.engine,
        ruleId: detail.ruleId,
        matchObjects: detail.matchObjects,
        preconditions: detail.preconditions,
        expectedOutcome: detail.expectedOutcome,
        targetRelease: detail.targetRelease,
        fixtureVersion: detail.fixtureVersion,
        engineVersion: detail.engineVersion,
        ruleVersion: detail.ruleVersion,
        sourceFindingId: detail.sourceFindingId,
      },
      input: {
        artifactName: detail.artifact.name,
        artifactType: detail.artifact.type,
        artifactSha256: detail.artifact.sha256,
        configuration: detail.configuration,
        content,
        contentEncoding,
        contentOmittedReason,
      },
      baseline: baseline ? { runId: baseline.id, status: baseline.status, findingPresent: baseline.findingPresent } : null,
      exportedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------ schedules

  async createSchedule(tenantId: string, actor: LifecycleActor, dto: ScheduleRegressionTestsInput) {
    FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Scheduling regression tests');
    if (!this.queue) {
      throw new BadRequestException({ code: 'SCHEDULER_UNAVAILABLE', message: 'The job scheduler (Redis) is not available.' });
    }
    const project = await this.db.query(`SELECT id FROM projects WHERE id = $1 AND organization_id = $2`, [dto.projectId, tenantId], {
      tenantId,
    });
    if (!project.rows[0]) throw new NotFoundException('Project not found');
    const id = uuidv4();
    const repeatJobKey = `regression:${tenantId}:${dto.projectId}:${id}`;
    const cron = dto.cronExpression.trim().split(/\s+/).join(' ');
    await this.queue.add(
      'scheduled-regression-run',
      { scheduleId: id, organizationId: tenantId, projectId: dto.projectId, userId: actor.id } satisfies ScheduledRegressionJobData,
      { repeat: { pattern: cron, key: repeatJobKey }, jobId: repeatJobKey, removeOnComplete: 50, removeOnFail: 100 }
    );
    const res = await this.db.query(
      `INSERT INTO regression_test_schedules (id, organization_id, project_id, cron_expression, test_case_ids, status, repeat_job_key, created_by)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7) RETURNING *`,
      [id, tenantId, dto.projectId, cron, JSON.stringify(dto.testCaseIds ?? []), repeatJobKey, actor.id],
      { tenantId }
    );
    return this.mapSchedule(res.rows[0]);
  }

  async listSchedules(tenantId: string, projectId: string) {
    const res = await this.db.query(
      `SELECT * FROM regression_test_schedules WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [tenantId, projectId],
      { tenantId }
    );
    return { items: res.rows.map((r: any) => this.mapSchedule(r)) };
  }

  async cancelSchedule(tenantId: string, actor: LifecycleActor, scheduleId: string) {
    FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Cancelling a regression schedule');
    const res = await this.db.query(
      `UPDATE regression_test_schedules SET status = 'CANCELLED', updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status = 'ACTIVE' RETURNING *`,
      [scheduleId, tenantId],
      { tenantId }
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundException('Active schedule not found');
    if (this.queue && row.repeat_job_key) {
      try {
        await this.queue.removeRepeatable('scheduled-regression-run', { pattern: row.cron_expression, key: row.repeat_job_key });
      } catch (err: any) {
        this.logger.warn(`Could not remove repeatable job ${row.repeat_job_key}: ${err?.message ?? err}`);
      }
    }
    return this.mapSchedule(row);
  }

  /** Worker entry point for a repeatable schedule firing. */
  async runScheduled(data: ScheduledRegressionJobData) {
    const s = await this.db.query(
      `SELECT * FROM regression_test_schedules WHERE id = $1 AND organization_id = $2`,
      [data.scheduleId, data.organizationId],
      { tenantId: data.organizationId }
    );
    const schedule = s.rows[0];
    if (!schedule || schedule.status !== 'ACTIVE') {
      this.logger.warn(`Regression schedule ${data.scheduleId} is not active; skipping run`);
      return null;
    }
    const ids = json<string[]>(schedule.test_case_ids, []);
    const result = await this.batchRun(
      data.organizationId,
      null,
      { projectId: schedule.project_id, testCaseIds: ids.length ? ids : undefined },
      'SCHEDULED',
      { userId: data.userId }
    );
    await this.db.query(
      `UPDATE regression_test_schedules SET last_run_at = NOW(), last_batch_id = $2, updated_at = NOW() WHERE id = $1`,
      [schedule.id, result.batchId],
      { tenantId: data.organizationId }
    );
    return result;
  }

  private mapSchedule(r: any) {
    return {
      id: r.id,
      projectId: r.project_id,
      cronExpression: r.cron_expression,
      testCaseIds: json<string[]>(r.test_case_ids, []),
      status: r.status,
      lastRunAt: iso(r.last_run_at),
      lastBatchId: r.last_batch_id ?? null,
      createdAt: iso(r.created_at),
    };
  }
}
