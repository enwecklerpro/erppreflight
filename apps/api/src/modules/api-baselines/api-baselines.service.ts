import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { ApiBaseline, CreateApiBaselineSchema } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { S3StorageService, buildApiBaselineKey } from '../storage/s3-storage.service';
import { ApiSpecError, inspectApiSpec } from './api-spec-inspector';

/** Largest specification accepted as a baseline (EDMX of large SAP services stay well below). */
export const MAX_API_BASELINE_BYTES = 20 * 1024 * 1024;

export interface ApiBaselineRecord extends ApiBaseline {
  storageKey: string;
}

/** Baseline + content handed to the analysis executor (configuration.stored_baseline). */
export interface ResolvedApiBaseline {
  baseline: ApiBaselineRecord;
  explicit: boolean;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapRow(r: any): ApiBaselineRecord {
  const surface = typeof r.surface === 'string' ? JSON.parse(r.surface) : r.surface ?? {};
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    format: r.format,
    specVersion: r.spec_version ?? null,
    version: r.version,
    sha256: String(r.sha256).trim(),
    sizeBytes: Number(r.size_bytes),
    sourceFileId: r.source_file_id ?? null,
    sourceFileName: r.source_file_name ?? null,
    apiTitle: r.api_title ?? null,
    surface,
    isActive: Boolean(r.is_active),
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at) ?? '',
    activatedAt: iso(r.activated_at),
    storageKey: r.storage_key,
  };
}

/** Public projection (the storage key stays server-side). */
export function toPublicBaseline(b: ApiBaselineRecord): ApiBaseline {
  const { storageKey: _storageKey, ...rest } = b;
  return rest;
}

async function readBounded(stream: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string | Uint8Array>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) {
      (stream as any).destroy?.();
      throw new PayloadTooLargeException({
        code: 'API_BASELINE_TOO_LARGE',
        message: `API specifications registered as baselines are limited to ${limit} bytes.`,
      });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Stored API Change Guard baselines per project (migration 023). Every query runs in the tenant's RLS
 * transaction and additionally filters on organization_id + project_id.
 */
@Injectable()
export class ApiBaselinesService {
  private readonly logger = new Logger(ApiBaselinesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: S3StorageService
  ) {}

  private async assertProject(tenantId: string, projectId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new NotFoundException(`Project '${projectId}' not found`);
    const res = await this.db.query(
      `SELECT id FROM projects WHERE id = $1 AND organization_id = $2`,
      [projectId, tenantId],
      { tenantId }
    );
    if (!res.rows?.length) throw new NotFoundException(`Project '${projectId}' not found`);
  }

  private async getRecord(tenantId: string, projectId: string, id: string): Promise<ApiBaselineRecord> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new NotFoundException({ code: 'API_BASELINE_NOT_FOUND', message: `API baseline '${id}' not found.` });
    }
    const res = await this.db.query(
      `SELECT * FROM api_baselines WHERE id = $1 AND organization_id = $2 AND project_id = $3`,
      [id, tenantId, projectId],
      { tenantId }
    );
    if (!res.rows?.length) {
      throw new NotFoundException({ code: 'API_BASELINE_NOT_FOUND', message: `API baseline '${id}' not found.` });
    }
    return mapRow(res.rows[0]);
  }

  async list(tenantId: string, projectId: string): Promise<ApiBaseline[]> {
    await this.assertProject(tenantId, projectId);
    const res = await this.db.query(
      `SELECT * FROM api_baselines WHERE organization_id = $1 AND project_id = $2
        ORDER BY is_active DESC, created_at DESC, id`,
      [tenantId, projectId],
      { tenantId }
    );
    return (res.rows ?? []).map((r: any) => toPublicBaseline(mapRow(r)));
  }

  async get(tenantId: string, projectId: string, id: string): Promise<ApiBaseline> {
    return toPublicBaseline(await this.getRecord(tenantId, projectId, id));
  }

  /** Registers an immutable baseline copy of a CLEAN project artifact. */
  async create(tenantId: string, userId: string | null, projectId: string, body: unknown): Promise<ApiBaseline> {
    const parsed = CreateApiBaselineSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_API_BASELINE_REQUEST',
        message: 'Invalid API baseline request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const dto = parsed.data;
    await this.assertProject(tenantId, projectId);

    const fileRes = await this.db.query(
      `SELECT id, file_name, file_size, storage_path, quarantine_status
         FROM uploaded_files WHERE id = $1 AND organization_id = $2 AND project_id = $3`,
      [dto.fileId, tenantId, projectId],
      { tenantId }
    );
    const file = fileRes.rows?.[0];
    if (!file) {
      throw new NotFoundException({ code: 'ARTIFACT_NOT_FOUND', message: `Artifact '${dto.fileId}' not found in this project.` });
    }
    if (file.quarantine_status !== 'CLEAN') {
      throw new BadRequestException({
        code: 'ARTIFACT_NOT_CLEAN',
        message: `Artifact '${file.file_name}' cannot be used as a baseline: quarantine status is '${file.quarantine_status}'.`,
      });
    }
    if (Number(file.file_size) > MAX_API_BASELINE_BYTES) {
      throw new PayloadTooLargeException({
        code: 'API_BASELINE_TOO_LARGE',
        message: `API specifications registered as baselines are limited to ${MAX_API_BASELINE_BYTES} bytes.`,
      });
    }

    const buffer = await readBounded(await this.storage.getCleanStream(file.storage_path), MAX_API_BASELINE_BYTES);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new UnprocessableEntityException({
        code: 'API_BASELINE_NOT_TEXT',
        message: 'The artifact is not UTF-8 text; OpenAPI (JSON/YAML) and OData EDMX specifications are required.',
      });
    }
    let spec;
    try {
      spec = inspectApiSpec(text);
    } catch (err) {
      if (err instanceof ApiSpecError) throw new UnprocessableEntityException({ code: err.code, message: err.message });
      throw err;
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const version = dto.version ?? spec.apiVersion ?? `sha-${sha256.slice(0, 12)}`;
    const id = uuidv4();
    const storageKey = buildApiBaselineKey(tenantId, projectId, id, file.file_name);
    await this.storage.putCleanObject(
      storageKey,
      buffer,
      spec.format === 'EDMX' ? 'application/xml' : text.trimStart().startsWith('{') ? 'application/json' : 'application/yaml'
    );

    try {
      await this.db.withTenantTransaction(tenantId, async (client) => {
        const active = await client.query(
          `SELECT id FROM api_baselines WHERE organization_id = $1 AND project_id = $2 AND is_active FOR UPDATE`,
          [tenantId, projectId]
        );
        const activate = dto.activate === true || !active.rows?.length;
        if (activate && active.rows?.length) {
          await client.query(
            `UPDATE api_baselines SET is_active = FALSE WHERE organization_id = $1 AND project_id = $2 AND is_active`,
            [tenantId, projectId]
          );
        }
        await client.query(
          `INSERT INTO api_baselines (
             id, organization_id, project_id, name, format, spec_version, version, sha256, size_bytes,
             storage_key, source_file_id, source_file_name, api_title, surface, is_active, created_by, activated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16, CASE WHEN $15 THEN NOW() ELSE NULL END)`,
          [
            id, tenantId, projectId, dto.name, spec.format, spec.specVersion, version, sha256, buffer.length,
            storageKey, file.id, file.file_name, spec.title, JSON.stringify(spec.surface), activate, userId,
          ]
        );
      });
    } catch (err: any) {
      await this.storage.deleteCleanObject(storageKey).catch(() => undefined);
      if (err?.code === '23505') {
        throw new ConflictException({
          code: 'API_BASELINE_EXISTS',
          message: `A baseline named '${dto.name}' with version '${version}' already exists in this project.`,
        });
      }
      throw err;
    }
    return this.get(tenantId, projectId, id);
  }

  /** Makes a baseline the project's active one (at most one active baseline per project). */
  async activate(tenantId: string, projectId: string, id: string): Promise<ApiBaseline> {
    await this.getRecord(tenantId, projectId, id);
    await this.db.withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `UPDATE api_baselines SET is_active = FALSE
          WHERE organization_id = $1 AND project_id = $2 AND is_active AND id <> $3`,
        [tenantId, projectId, id]
      );
      await client.query(
        `UPDATE api_baselines SET is_active = TRUE, activated_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND NOT is_active`,
        [id, tenantId, projectId]
      );
    });
    return this.get(tenantId, projectId, id);
  }

  /** Deletes the registry row and the stored copy. Past analyses keep the baseline hash in their findings. */
  async remove(tenantId: string, projectId: string, id: string): Promise<{ id: string; deleted: true; wasActive: boolean }> {
    const record = await this.getRecord(tenantId, projectId, id);
    await this.db.query(
      `DELETE FROM api_baselines WHERE id = $1 AND organization_id = $2 AND project_id = $3`,
      [id, tenantId, projectId],
      { tenantId }
    );
    try {
      await this.storage.deleteCleanObject(record.storageKey);
    } catch (err: any) {
      // The row is gone (the baseline can no longer be selected); the object stays under the tenant prefix
      // and is removed with the tenant's storage on organisation deletion.
      this.logger.warn(`Stored copy of API baseline ${id} could not be deleted: ${err?.message ?? err}`);
    }
    return { id, deleted: true, wasActive: record.isActive };
  }

  /** Validates an explicitly requested baseline at trigger time (404 for foreign / unknown ids). */
  async assertSelectable(tenantId: string, projectId: string, id: string): Promise<ApiBaseline> {
    return this.get(tenantId, projectId, id);
  }

  /** Baseline an API_CHANGE_GUARD run compares against: the explicit one, else the active one, else none. */
  async resolveForAnalysis(tenantId: string, projectId: string, explicitId?: string | null): Promise<ResolvedApiBaseline | null> {
    if (explicitId) {
      return { baseline: await this.getRecord(tenantId, projectId, explicitId), explicit: true };
    }
    const res = await this.db.query(
      `SELECT * FROM api_baselines WHERE organization_id = $1 AND project_id = $2 AND is_active LIMIT 1`,
      [tenantId, projectId],
      { tenantId }
    );
    return res.rows?.length ? { baseline: mapRow(res.rows[0]), explicit: false } : null;
  }

  /** Reads the stored copy (bounded) and verifies it against the registered SHA-256. */
  async loadContent(baseline: ApiBaselineRecord): Promise<string> {
    const buffer = await readBounded(await this.storage.getCleanStream(baseline.storageKey), MAX_API_BASELINE_BYTES);
    const sha = createHash('sha256').update(buffer).digest('hex');
    if (sha !== baseline.sha256) {
      throw new Error(`API baseline '${baseline.name}' failed its integrity check (stored object hash ${sha} != ${baseline.sha256}).`);
    }
    return buffer.toString('utf-8');
  }
}
