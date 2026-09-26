import { Injectable, Logger, Optional } from '@nestjs/common';
import type { EngineType } from '@erppreflight/schemas';
import { DatabaseService } from '../../database/database.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { AnalysisJobFile, BINARY_ARTIFACT_TYPES, resolveArtifactType } from '../analysis-executor';
import { detectArtifactSignals } from './artifact-signals';
import { EngineCatalogService, MAX_CONTRACT_MATCH_CHARS } from './engine-catalog.service';
import type { PlannerArtifact } from './preflight-planner';

/** Bytes read per artifact for profiling (contract matching needs the whole JSON/XML document). */
const MAX_PROFILE_BYTES = 1536 * 1024;

export interface ArtifactProfileResult {
  artifacts: PlannerArtifact[];
  files: AnalysisJobFile[];
  skipped: Array<{ fileId: string; fileName: string; reason: string }>;
}

/**
 * Profiles a project's CLEAN artifacts for routing and planning: artifact type,
 * deterministic content signals and the engines whose declared input contract
 * accepts the artifact. Reads only tenant-scoped rows and redacted clean copies.
 */
@Injectable()
export class ArtifactProfilerService {
  private readonly logger = new Logger(ArtifactProfilerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly catalog: EngineCatalogService,
    @Optional() private readonly storage?: S3StorageService
  ) {}

  async profileProjectArtifacts(
    organizationId: string,
    projectId: string,
    fileIds?: string[]
  ): Promise<ArtifactProfileResult> {
    const params: unknown[] = [organizationId, projectId];
    let filter = '';
    if (fileIds && fileIds.length > 0) {
      params.push(Array.from(new Set(fileIds)));
      filter = ' AND id = ANY($3::uuid[])';
    }
    const res = await this.db.query(
      `SELECT id, file_name, storage_path, metadata, file_size
         FROM uploaded_files
        WHERE organization_id = $1 AND project_id = $2 AND quarantine_status = 'CLEAN'${filter}
        ORDER BY file_name ASC, id ASC`,
      params,
      { tenantId: organizationId }
    );

    const out: ArtifactProfileResult = { artifacts: [], files: [], skipped: [] };
    for (const row of res.rows ?? []) {
      const metadata = typeof row.metadata === 'string' ? safeJson(row.metadata) : row.metadata ?? {};
      const artifactType = resolveArtifactType(metadata?.detectedFormat, row.file_name);
      if (!artifactType) {
        out.skipped.push({ fileId: row.id, fileName: row.file_name, reason: 'Format is not analysable by any engine.' });
        continue;
      }
      const file: AnalysisJobFile = {
        fileId: row.id,
        fileName: row.file_name,
        storagePath: row.storage_path,
        artifactType,
      };
      const content = await this.readPrefix(row.storage_path);
      const binary = BINARY_ARTIFACT_TYPES.has(artifactType);
      let text: string | null = null;
      let contractAccepted: EngineType[] | null = null;
      if (content) {
        const complete = !content.truncated;
        if (!binary) text = content.buffer.toString('utf-8');
        if (complete) {
          const payload = binary ? content.buffer.toString('base64') : (text as string);
          if (payload.length <= MAX_CONTRACT_MATCH_CHARS) {
            contractAccepted = await this.catalog.matchContracts(payload, binary ? 'base64' : 'utf-8', row.file_name);
          }
        }
      }
      const signals = detectArtifactSignals({ fileId: row.id, fileName: row.file_name, artifactType, text });
      out.files.push(file);
      out.artifacts.push({ fileId: row.id, fileName: row.file_name, artifactType, contractAccepted, signals });
    }
    return out;
  }

  private async readPrefix(storagePath: string): Promise<{ buffer: Buffer; truncated: boolean } | null> {
    if (!this.storage) return null;
    try {
      const stream = await this.storage.getCleanStream(storagePath);
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      for await (const chunk of stream as AsyncIterable<Buffer | string | Uint8Array>) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : Buffer.from(chunk);
        chunks.push(buf);
        size += buf.length;
        if (size > MAX_PROFILE_BYTES) {
          truncated = true;
          (stream as any).destroy?.();
          break;
        }
      }
      const buffer = Buffer.concat(chunks);
      return { buffer: truncated ? buffer.subarray(0, MAX_PROFILE_BYTES) : buffer, truncated };
    } catch (err: any) {
      this.logger.warn(`Could not read clean artifact '${storagePath}' for profiling: ${err?.message ?? err}`);
      return null;
    }
  }
}

function safeJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
