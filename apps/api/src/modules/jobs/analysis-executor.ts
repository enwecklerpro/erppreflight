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
}

export type EngineRunOutcome = 'COMPLETED' | 'PARTIAL' | 'FAILED';

export interface AnalysisRunResult {
  finalStatus: EngineRunOutcome;
  totalFindings: number;
  engineOutcomes: Record<string, EngineRunOutcome>;
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
    /** Observability hook: engine call latency + outcome (C §57). */
    private readonly onEngineCall?: (engine: string, outcome: EngineRunOutcome, durationMs: number) => void
  ) {}

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
    const { analysisId, organizationId, projectId, engineTypes, targetRelease } = input;

    await this.db.query(
      `UPDATE analyses SET status = 'RUNNING' WHERE id = $1 AND organization_id = $2`,
      [analysisId, organizationId],
      { tenantId: organizationId }
    );

    const artifacts = await this.prepareArtifacts(input);
    if (artifacts.length === 0) {
      throw new Error(`Analysis ${analysisId} has no resolvable artifacts to analyse`);
    }

    let totalFindings = 0;
    let completedCalls = 0;
    let partialCalls = 0;
    let failedCalls = 0;
    const engineOutcomes: Record<string, EngineRunOutcome> = {};

    for (const engine of engineTypes) {
      let engineCompleted = 0;
      let engineFailed = 0;
      let enginePartial = 0;

      for (const artifact of artifacts) {
        const label = `Engine '${engine}' on artifact '${artifact.fileName ?? artifact.storagePath ?? 'inline'}'`;
        const callStarted = Date.now();
        const observe = (outcome: EngineRunOutcome) => {
          try {
            this.onEngineCall?.(engine, outcome, Date.now() - callStarted);
          } catch {
            /* metrics must never break analysis */
          }
        };
        try {
          const wirePayload = toWireJobRequest({
            jobId: analysisId,
            tenantId: organizationId,
            projectId,
            engineType: engine,
            targetRelease,
            artifactS3Key: artifact.storagePath,
            artifactType: artifact.artifactType,
            configuration: {
              ...(input.configuration ?? {}),
              ...(artifact.fileId ? { sourceFileId: artifact.fileId } : {}),
              ...(artifact.fileName ? { sourceFileName: artifact.fileName } : {}),
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
            observe('FAILED');
            engineFailed++;
            continue;
          }

          const validated = AnalysisJobResponseSchema.parse(await res.json());

          if (validated.status === 'FAILED') {
            this.logger.error(
              `${label} reported FAILED: ${validated.errorMessage ?? 'no error message'} (diagnostic findings not persisted)`
            );
            observe('FAILED');
            engineFailed++;
            continue;
          }

          if (validated.findings.length > 0) {
            totalFindings += await this.persistFindings(
              organizationId,
              projectId,
              analysisId,
              engine,
              validated.findings
            );
          }

          if (validated.status === 'PARTIAL') {
            this.logger.warn(
              `${label} reported PARTIAL: ${validated.errorMessage ?? 'no error message'}`
            );
            observe('PARTIAL');
            enginePartial++;
          } else {
            observe('COMPLETED');
            engineCompleted++;
          }
        } catch (err: any) {
          this.logger.warn(`${label} execution failed: ${err?.message ?? err}`);
          observe('FAILED');
          engineFailed++;
        }
      }

      completedCalls += engineCompleted;
      partialCalls += enginePartial;
      failedCalls += engineFailed;
      engineOutcomes[engine] =
        engineFailed === artifacts.length
          ? 'FAILED'
          : engineCompleted === artifacts.length
          ? 'COMPLETED'
          : 'PARTIAL';
    }

    const totalCalls = completedCalls + partialCalls + failedCalls;
    const finalStatus: EngineRunOutcome =
      completedCalls === totalCalls
        ? 'COMPLETED'
        : failedCalls === totalCalls
        ? 'FAILED'
        : 'PARTIAL';

    await this.db.query(
      `UPDATE analyses SET status = $1, completed_at = NOW() WHERE id = $2 AND organization_id = $3`,
      [finalStatus, analysisId, organizationId],
      { tenantId: organizationId }
    );

    this.logger.log(
      `Analysis ${analysisId} finished with status ${finalStatus}: ${completedCalls} completed, ${partialCalls} partial, ${failedCalls} failed engine/artifact runs; ${totalFindings} findings persisted`
    );

    return { finalStatus, totalFindings, engineOutcomes };
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
