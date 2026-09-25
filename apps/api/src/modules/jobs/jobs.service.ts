import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from '../database/database.service';
import {
  EngineType,
  TargetRelease,
  ArtifactType,
  toWireJobRequest,
  AnalysisJobResponseSchema,
  FindingSchema,
  EvidenceItemSchema,
} from '@erppreflight/schemas';
import { createFindingFingerprint } from '@erppreflight/evidence';
import { v4 as uuidv4 } from 'uuid';

export interface TriggerAnalysisDto {
  projectId: string;
  engineTypes: EngineType[];
  targetRelease?: TargetRelease;
  artifactS3Key?: string;
  artifactType?: ArtifactType;
  rawContent?: string;
  configuration?: Record<string, unknown>;
}

function inferArtifactType(artifactS3Key?: string, rawContent?: string): ArtifactType {
  if (artifactS3Key) {
    const ext = artifactS3Key.split('.').pop()?.toUpperCase();
    if (ext === 'XML') return 'XML';
    if (ext === 'JSON') return 'JSON';
    if (ext === 'CSV') return 'CSV';
    if (ext === 'ZIP') return 'ZIP';
    if (ext === 'ABAP') return 'ABAP';
    if (ext === 'XDP') return 'XDP';
    if (ext === 'WSDL') return 'WSDL';
    if (ext === 'EDMX') return 'EDMX';
    if (ext === 'TXT') return 'TXT';
    if (ext === 'XLSX') return 'XLSX';
  }
  if (rawContent?.trim().startsWith('<')) return 'XML';
  if (rawContent?.trim().startsWith('{') || rawContent?.trim().startsWith('[')) return 'JSON';
  return 'JSON';
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly analysisUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Optional()
    @InjectQueue('analysis-queue')
    private readonly analysisQueue?: Queue
  ) {
    this.analysisUrl =
      this.config.get<string>('ANALYSIS_SERVICE_URL') ||
      'http://localhost:8000';
  }

  async triggerAnalysis(
    organizationId: string,
    userId: string,
    dto: TriggerAnalysisDto
  ) {
    const analysisId = uuidv4();
    const targetRelease = (dto.targetRelease || 'S4H_2023') as TargetRelease;

    // 1. Create analysis record with status QUEUED
    await this.db.query(
      `INSERT INTO analyses (id, organization_id, project_id, status, engine_types, target_release, triggered_by)
       VALUES ($1, $2, $3, 'QUEUED', $4, $5, $6)`,
      [
        analysisId,
        organizationId,
        dto.projectId,
        JSON.stringify(dto.engineTypes),
        targetRelease,
        userId,
      ],
      { tenantId: organizationId }
    );

    // Query organization data governance policy
    let isDeterministicOnly = false;
    let allowAiAssistance = true;
    try {
      const orgRes = await this.db.query(
        `SELECT data_policy FROM organizations WHERE id = $1`,
        [organizationId],
        { bypassRls: true }
      );
      if (orgRes.rows.length > 0 && orgRes.rows[0].data_policy) {
        const policy = typeof orgRes.rows[0].data_policy === 'string'
          ? JSON.parse(orgRes.rows[0].data_policy)
          : orgRes.rows[0].data_policy;
        if (policy.deterministicOnly) isDeterministicOnly = true;
        if (policy.allowAiAssistance === false) allowAiAssistance = false;
      }
    } catch {
      // default to secure deterministic execution
    }

    const effectiveConfig = {
      ...(dto.configuration ?? {}),
      deterministicOnly: isDeterministicOnly || (dto.configuration as any)?.deterministicOnly === true,
      allowAiAssistance: !isDeterministicOnly && allowAiAssistance && (dto.configuration as any)?.allowAiAssistance !== false,
    };

    // 2. Dispatch job to BullMQ analysis queue
    const jobPayload = {
      analysisId,
      organizationId,
      projectId: dto.projectId,
      userId,
      engineTypes: dto.engineTypes,
      targetRelease,
      artifactS3Key: dto.artifactS3Key ?? null,
      artifactType: dto.artifactType,
      rawContent: dto.rawContent ?? null,
      configuration: effectiveConfig,
    };

    if (this.analysisQueue) {
      await this.analysisQueue.add('analyze', jobPayload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      this.logger.log(`Enqueued analysis job ${analysisId} to analysis-queue`);
    } else {
      this.logger.warn(
        `analysisQueue not injected; falling back to direct asynchronous run for analysis ${analysisId}`
      );
      this.runEngines(
        analysisId,
        organizationId,
        dto.projectId,
        dto.engineTypes,
        targetRelease,
        dto.artifactS3Key,
        dto.artifactType,
        dto.rawContent,
        effectiveConfig
      ).catch((err) => {
        this.logger.error(`Error executing analysis job ${analysisId}: ${err.message}`);
      });
    }

    // 3. Immediately return HTTP 202 / queued analysis record
    return {
      analysisId,
      status: 'QUEUED',
      engineTypes: dto.engineTypes,
      targetRelease,
    };
  }

  private async runEngines(
    analysisId: string,
    organizationId: string,
    projectId: string,
    engineTypes: EngineType[],
    targetRelease: string,
    artifactS3Key?: string,
    artifactTypeParam?: ArtifactType,
    rawContent?: string,
    configuration?: Record<string, unknown>
  ) {
    await this.db.query(
      `UPDATE analyses SET status = 'RUNNING' WHERE id = $1`,
      [analysisId],
      { bypassRls: true }
    );

    let totalFindings = 0;
    const failedEngines: EngineType[] = [];
    const artifactType = artifactTypeParam || inferArtifactType(artifactS3Key, rawContent);

    for (const engine of engineTypes) {
      try {
        const wirePayload = toWireJobRequest({
          jobId: analysisId,
          tenantId: organizationId,
          projectId: projectId,
          engineType: engine,
          targetRelease: targetRelease as TargetRelease,
          artifactS3Key: artifactS3Key ?? null,
          artifactType,
          configuration: configuration ?? {},
          rawContent: rawContent ?? null,
        });

        const res = await fetch(`${this.analysisUrl}/api/v1/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Tenant-Id': organizationId,
          },
          body: JSON.stringify(wirePayload),
        });

        if (!res.ok) {
          const errText = await res.text();
          this.logger.error(
            `Engine '${engine}' analysis failed [HTTP ${res.status}]: ${errText}`
          );
          failedEngines.push(engine);
          continue;
        }

        const rawData = await res.json();
        const validatedResponse = AnalysisJobResponseSchema.parse(rawData);

        if (Array.isArray(validatedResponse.findings)) {
          for (const f of validatedResponse.findings) {
            const findingId = f.id || uuidv4();
            const firstObjName = f.affectedObjects[0]?.name || 'GLOBAL';
            const firstArtifact = f.evidence[0]?.artifactPath || 'UNKNOWN_SOURCE';
            const fingerprint =
              f.fingerprint || createFindingFingerprint(f.ruleId, firstObjName, firstArtifact);

            await this.db.query(
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
              ],
              { bypassRls: true }
            );

            if (Array.isArray(f.evidence) && f.evidence.length > 0) {
              for (const ev of f.evidence) {
                await this.db.query(
                  `INSERT INTO evidence (
                    id, organization_id, finding_id, artifact_path, line_number,
                    column_number, snippet, sha256, provenance, source_title,
                    source_url, trust_score
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                  [
                    ev.id || uuidv4(),
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
                  ],
                  { bypassRls: true }
                );
              }
            }

            totalFindings++;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Engine '${engine}' execution skipped/failed: ${err.message}`);
        failedEngines.push(engine);
      }
    }

    const finalStatus =
      failedEngines.length === 0
        ? 'COMPLETED'
        : failedEngines.length === engineTypes.length
        ? 'FAILED'
        : 'PARTIAL';

    await this.db.query(
      `UPDATE analyses SET status = $1, completed_at = NOW() WHERE id = $2`,
      [finalStatus, analysisId],
      { bypassRls: true }
    );
  }

  async getAnalysis(organizationId: string, analysisId: string) {
    const res = await this.db.query(
      `SELECT a.*, COUNT(f.id)::int as total_findings
       FROM analyses a
       LEFT JOIN findings f ON f.analysis_id = a.id
       WHERE a.organization_id = $1 AND a.id = $2
       GROUP BY a.id`,
      [organizationId, analysisId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Analysis job '${analysisId}' not found`);
    }

    const findingsRes = await this.db.query(
      `SELECT * FROM findings WHERE organization_id = $1 AND analysis_id = $2 ORDER BY created_at ASC`,
      [organizationId, analysisId]
    );

    const findingIds = findingsRes.rows.map((r: any) => r.id);
    const evidenceMap = new Map<string, any[]>();

    if (findingIds.length > 0) {
      const evidenceRes = await this.db.query(
        `SELECT * FROM evidence WHERE organization_id = $1 AND finding_id = ANY($2::uuid[])`,
        [organizationId, findingIds]
      );
      for (const evRow of evidenceRes.rows) {
        const ev = EvidenceItemSchema.parse(evRow);
        const list = evidenceMap.get(evRow.finding_id) || [];
        list.push(ev);
        evidenceMap.set(evRow.finding_id, list);
      }
    }

    const normalizedFindings = findingsRes.rows.map((row: any) => {
      const evidence = evidenceMap.get(row.id) || [];
      return FindingSchema.parse({
        ...row,
        evidence,
      });
    });

    return {
      ...res.rows[0],
      findings: normalizedFindings,
    };
  }
}
