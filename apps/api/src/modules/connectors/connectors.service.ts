import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { CredentialVault } from './credential-vault';
import {
  CONNECTOR_DEFINITIONS,
  CONNECTOR_TYPES,
  ConnectorType,
  describeConnectorType,
  getConnectorDefinition,
} from './connector-registry';
import { createConnectorHttp, describeConnectorError } from './connector-http';
import {
  CircuitOpenError,
  CircuitSnapshot,
  afterFailure,
  afterSuccess,
  beforeCall,
  circuitSettings,
} from './circuit-breaker';
import { ConnectorAdapter, ConnectorContext, createAdapterRegistry, isWorkItemAdapter, WorkItemAdapter } from './adapters';
import { HttpOpenApiAdapter, ODataAdapter } from './adapters/metadata.adapters';
import { GitAdapter } from './adapters/git.adapter';
import { CloudAlmAdapter } from './adapters/cloud-alm.adapter';
import { IntegrationAuditService } from './integration-audit.service';
import { parseBody } from './zod-body';

export const CREDENTIALS_PURPOSE = 'connector-credentials';

export const CreateConnectorSchema = z
  .object({
    type: z.enum(CONNECTOR_TYPES),
    name: z.string().trim().min(2).max(200),
    config: z.record(z.unknown()).default({}),
    credentials: z.record(z.unknown()).optional(),
    accessMode: z.enum(['READ_ONLY', 'READ_WRITE']).default('READ_ONLY'),
  })
  .strict();

export const UpdateConnectorSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    config: z.record(z.unknown()).optional(),
    credentials: z.record(z.unknown()).optional(),
    accessMode: z.enum(['READ_ONLY', 'READ_WRITE']).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    /** Must be true when the change grants write access (Part 18.3/18.4). */
    confirmWriteAccess: z.boolean().optional(),
  })
  .strict();

export const ProjectLinkSchema = z
  .object({
    projectId: z.string().uuid(),
    externalProjectId: z.string().trim().min(1).max(255),
    syncDirection: z.enum(['PULL_ONLY', 'PUSH_ONLY', 'BIDIRECTIONAL']).default('PUSH_ONLY'),
    systemOfRecord: z.enum(['EXTERNAL', 'ERP_PREFLIGHT']).default('EXTERNAL'),
  })
  .strict();

export const GitIngestSchema = z
  .object({
    projectId: z.string().uuid(),
    maxFiles: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

export interface ConnectorRow {
  id: string;
  organization_id: string;
  connector_type: ConnectorType;
  name: string;
  config: Record<string, any>;
  credentials_ciphertext: string | null;
  credentials_key_id: string | null;
  credentials_updated_at: Date | null;
  access_mode: 'READ_ONLY' | 'READ_WRITE';
  status: 'ACTIVE' | 'DISABLED';
  health_status: string;
  last_checked_at: Date | null;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_error: string | null;
  consecutive_failures: number;
  circuit_state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  circuit_opened_at: Date | null;
  capabilities: Record<string, any>;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ExecuteOptions {
  actorId?: string | null;
  objectType?: string;
  objectRef?: string;
  /** Record the call in connector_sync_log (default true). */
  log?: boolean;
}

@Injectable()
export class ConnectorsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorsService.name);
  private readonly adapters: Record<ConnectorType, ConnectorAdapter>;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly vault: CredentialVault,
    private readonly audit: IntegrationAuditService,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly telemetry?: TelemetryService,
    @Optional() private readonly ingestion?: IngestionService
  ) {
    this.adapters = createAdapterRegistry(async (ctx) => {
      const res = await this.db.query(
        `SELECT status, last_seen_at FROM agent_devices WHERE organization_id = $1 AND id = $2`,
        [ctx.organizationId, ctx.config?.deviceId],
        { tenantId: ctx.organizationId }
      );
      const row = res.rows[0];
      return row ? { status: row.status, lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null } : null;
    });
  }

  onModuleInit() {
    const interval = Number(process.env.CONNECTOR_HEALTH_INTERVAL_MS || 15 * 60_000);
    if (process.env.NODE_ENV !== 'test' && Number.isFinite(interval) && interval > 0) {
      this.sweepTimer = setInterval(() => {
        this.runHealthSweep().catch((err) => this.logger.error(`Connector health sweep failed: ${err?.message}`));
      }, interval);
      this.sweepTimer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // -------------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------------
  listTypes() {
    return CONNECTOR_TYPES.map((t) => describeConnectorType(CONNECTOR_DEFINITIONS[t]));
  }

  getAdapter(type: ConnectorType): ConnectorAdapter {
    return this.adapters[type];
  }

  // -------------------------------------------------------------------------
  // Serialization — secrets never leave the service
  // -------------------------------------------------------------------------
  toPublic(row: ConnectorRow) {
    return {
      id: row.id,
      type: row.connector_type,
      name: row.name,
      config: row.config,
      accessMode: row.access_mode,
      status: row.status,
      hasCredentials: Boolean(row.credentials_ciphertext),
      credentialsKeyId: row.credentials_key_id,
      credentialsRotationDue: row.credentials_ciphertext ? this.vault.needsRotation(row.credentials_ciphertext) : false,
      credentialsUpdatedAt: row.credentials_updated_at,
      health: {
        status: row.health_status,
        lastCheckedAt: row.last_checked_at,
        lastSuccessAt: row.last_success_at,
        lastFailureAt: row.last_failure_at,
        lastError: row.last_error,
        consecutiveFailures: row.consecutive_failures,
        circuitState: row.circuit_state,
        circuitOpenedAt: row.circuit_opened_at,
      },
      capabilities: row.capabilities,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private validateConfig(type: ConnectorType, config: unknown) {
    const def = getConnectorDefinition(type)!;
    const parsed = def.configSchema.safeParse(config ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: parsed.error.issues.map((i: z.ZodIssue) => `config.${i.path.join('.')}: ${i.message}`),
      });
    }
    return parsed.data as Record<string, unknown>;
  }

  private validateCredentials(type: ConnectorType, credentials: unknown) {
    const def = getConnectorDefinition(type)!;
    const parsed = def.credentialsSchema.safeParse(credentials ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: parsed.error.issues.map((i: z.ZodIssue) => `credentials.${i.path.join('.') || '(root)'}: ${i.message}`),
      });
    }
    return parsed.data as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------
  async list(organizationId: string) {
    const res = await this.db.query<ConnectorRow>(
      `SELECT * FROM connector_instances WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId],
      { tenantId: organizationId }
    );
    return res.rows.map((r) => this.toPublic(r));
  }

  async getRow(organizationId: string, id: string): Promise<ConnectorRow> {
    const res = await this.db.query<ConnectorRow>(
      `SELECT * FROM connector_instances WHERE organization_id = $1 AND id = $2`,
      [organizationId, id],
      { tenantId: organizationId }
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundException(`Connector ${id} not found`);
    return row;
  }

  async get(organizationId: string, id: string) {
    return this.toPublic(await this.getRow(organizationId, id));
  }

  async create(organizationId: string, actorId: string | null, body: unknown, opts: { systemManaged?: boolean } = {}) {
    const dto = parseBody(CreateConnectorSchema, body);
    const def = getConnectorDefinition(dto.type)!;
    if (def.systemManaged && !opts.systemManaged) {
      throw new BadRequestException(`${def.displayName} connectors are created automatically (e.g. by agent enrollment)`);
    }
    if (dto.accessMode === 'READ_WRITE' && def.writeActions.length === 0) {
      throw new BadRequestException(`${def.displayName} connectors are read-only; no write actions are registered`);
    }
    const config = this.validateConfig(dto.type, dto.config);
    let ciphertext: string | null = null;
    let keyId: string | null = null;
    if (dto.credentials && Object.keys(dto.credentials).length > 0) {
      const creds = this.validateCredentials(dto.type, dto.credentials);
      const enc = this.vault.encryptJson(organizationId, CREDENTIALS_PURPOSE, creds);
      ciphertext = enc.ciphertext;
      keyId = enc.keyId;
    } else {
      // Required credential fields must be present at creation.
      const empty = def.credentialsSchema.safeParse({});
      if (!empty.success) this.validateCredentials(dto.type, {});
    }
    const id = uuidv4();
    try {
      const res = await this.db.query<ConnectorRow>(
        `INSERT INTO connector_instances (
          id, organization_id, connector_type, name, config, credentials_ciphertext, credentials_key_id,
          credentials_updated_at, access_mode, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [id, organizationId, dto.type, dto.name, JSON.stringify(config), ciphertext, keyId, ciphertext ? new Date() : null, dto.accessMode, actorId],
        { tenantId: organizationId }
      );
      await this.audit.record({
        organizationId,
        action: 'connector.created',
        resourceType: 'CONNECTOR',
        resourceId: id,
        actorId,
        payload: { type: dto.type, name: dto.name, accessMode: dto.accessMode, hasCredentials: Boolean(ciphertext) },
      });
      return this.toPublic(res.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException(`A connector named '${dto.name}' already exists`);
      throw err;
    }
  }

  /** Part 18.3 permission diff between the stored and the requested connector state. */
  permissionDiff(row: ConnectorRow, next: { accessMode: string }) {
    const def = getConnectorDefinition(row.connector_type)!;
    const gainedWrite = row.access_mode === 'READ_ONLY' && next.accessMode === 'READ_WRITE';
    const lostWrite = row.access_mode === 'READ_WRITE' && next.accessMode === 'READ_ONLY';
    return {
      accessModeBefore: row.access_mode,
      accessModeAfter: next.accessMode,
      permissionsAdded: gainedWrite ? def.writeActions.map((w) => w.action) : [],
      permissionsRemoved: lostWrite ? def.writeActions.map((w) => w.action) : [],
      riskIncrease: gainedWrite,
      unexpectedWriteScope: gainedWrite,
    };
  }

  async update(organizationId: string, actorId: string | null, id: string, body: unknown) {
    const dto = parseBody(UpdateConnectorSchema, body);
    const row = await this.getRow(organizationId, id);
    const def = getConnectorDefinition(row.connector_type)!;
    const nextMode = dto.accessMode ?? row.access_mode;
    if (nextMode === 'READ_WRITE' && def.writeActions.length === 0) {
      throw new BadRequestException(`${def.displayName} connectors are read-only`);
    }
    const diff = this.permissionDiff(row, { accessMode: nextMode });
    if (diff.riskIncrease && dto.confirmWriteAccess !== true) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Granting write access requires explicit confirmation (confirmWriteAccess=true)',
        permissionDiff: diff,
      });
    }
    const config = dto.config ? this.validateConfig(row.connector_type, { ...row.config, ...dto.config }) : row.config;
    let ciphertext = row.credentials_ciphertext;
    let keyId = row.credentials_key_id;
    let credsChanged = false;
    if (dto.credentials) {
      const creds = this.validateCredentials(row.connector_type, dto.credentials);
      const enc = this.vault.encryptJson(organizationId, CREDENTIALS_PURPOSE, creds);
      ciphertext = enc.ciphertext;
      keyId = enc.keyId;
      credsChanged = true;
    }
    try {
      const res = await this.db.query<ConnectorRow>(
        `UPDATE connector_instances
           SET name = $3, config = $4, credentials_ciphertext = $5, credentials_key_id = $6,
               credentials_updated_at = CASE WHEN $7::boolean THEN NOW() ELSE credentials_updated_at END,
               access_mode = $8, status = $9::varchar,
               -- re-enabling or new credentials reset the circuit
               circuit_state = CASE WHEN $7::boolean OR ($9::varchar = 'ACTIVE' AND status = 'DISABLED') THEN 'CLOSED' ELSE circuit_state END,
               consecutive_failures = CASE WHEN $7::boolean THEN 0 ELSE consecutive_failures END,
               updated_at = NOW()
         WHERE organization_id = $1 AND id = $2
         RETURNING *`,
        [organizationId, id, dto.name ?? row.name, JSON.stringify(config), ciphertext, keyId, credsChanged, nextMode, dto.status ?? row.status],
        { tenantId: organizationId }
      );
      await this.audit.record({
        organizationId,
        action: diff.riskIncrease ? 'connector.write_access_granted' : 'connector.updated',
        resourceType: 'CONNECTOR',
        resourceId: id,
        actorId,
        payload: {
          type: row.connector_type,
          changedFields: Object.keys(dto).filter((k) => k !== 'credentials' && k !== 'confirmWriteAccess'),
          credentialsRotated: credsChanged,
          permissionDiff: diff,
          status: dto.status ?? row.status,
        },
      });
      return { connector: this.toPublic(res.rows[0]), permissionDiff: diff };
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException(`A connector with this name already exists`);
      throw err;
    }
  }

  async remove(organizationId: string, actorId: string | null, id: string) {
    const row = await this.getRow(organizationId, id);
    if (row.connector_type === 'LOCAL_AGENT') {
      throw new BadRequestException('Local agent connectors are removed by revoking the device');
    }
    await this.db.query(`DELETE FROM connector_instances WHERE organization_id = $1 AND id = $2`, [organizationId, id], {
      tenantId: organizationId,
    });
    await this.audit.record({
      organizationId,
      action: 'connector.deleted',
      resourceType: 'CONNECTOR',
      resourceId: id,
      actorId,
      payload: { type: row.connector_type, name: row.name },
    });
    return { success: true, deletedId: id };
  }

  // -------------------------------------------------------------------------
  // Execution with circuit breaker, health tracking and sync log
  // -------------------------------------------------------------------------
  buildContext(row: ConnectorRow): ConnectorContext {
    let credentials: Record<string, unknown> = {};
    if (row.credentials_ciphertext) {
      credentials = this.vault.decryptJson(row.organization_id, CREDENTIALS_PURPOSE, row.credentials_ciphertext);
    }
    return {
      organizationId: row.organization_id,
      connectorId: row.id,
      type: row.connector_type,
      config: row.config,
      credentials,
      http: createConnectorHttp(row.id),
    };
  }

  async execute<T>(
    row: ConnectorRow,
    operation: string,
    fn: (ctx: ConnectorContext, adapter: ConnectorAdapter) => Promise<T>,
    opts: ExecuteOptions = {}
  ): Promise<T> {
    if (row.status !== 'ACTIVE') {
      throw new ForbiddenException('Connector is disabled');
    }
    const settings = circuitSettings();
    const snap: CircuitSnapshot = {
      circuitState: row.circuit_state,
      consecutiveFailures: row.consecutive_failures,
      circuitOpenedAt: row.circuit_opened_at ? new Date(row.circuit_opened_at) : null,
    };
    const gate = beforeCall(snap, settings, new Date());
    if (!gate.allowed) {
      await this.log(row, operation, 'BLOCKED', { error: 'circuit open', actorId: opts.actorId, ...opts });
      throw new ServiceUnavailableException(new CircuitOpenError(gate.retryAfterMs).message);
    }
    const trial = gate.state === 'HALF_OPEN';
    const started = Date.now();
    try {
      const ctx = this.buildContext(row);
      const result = await fn(ctx, this.adapters[row.connector_type]);
      await this.recordOutcome(row, true, null);
      if (opts.log !== false) {
        await this.log(row, operation, 'SUCCESS', { durationMs: Date.now() - started, ...opts });
      }
      this.telemetry?.recordConnectorCall?.(row.connector_type, operation, 'SUCCESS', Date.now() - started);
      return result;
    } catch (err: any) {
      const described = describeConnectorError(err);
      const next = afterFailure(snap, settings, new Date(), trial);
      await this.recordOutcome(row, false, described.message, next);
      await this.log(row, operation, 'FAILED', {
        durationMs: Date.now() - started,
        error: described.message,
        httpStatus: described.httpStatus,
        ...opts,
      });
      this.telemetry?.recordConnectorCall?.(row.connector_type, operation, 'FAILED', Date.now() - started);
      const e: any = new ServiceUnavailableException({
        statusCode: 502,
        error: 'Connector Error',
        message: described.message,
        httpStatus: described.httpStatus,
      });
      e.connectorError = described;
      throw e;
    }
  }

  private async recordOutcome(row: ConnectorRow, ok: boolean, error: string | null, failureSnap?: CircuitSnapshot) {
    const prevHealth = row.health_status;
    if (ok) {
      const s = afterSuccess();
      await this.db.query(
        `UPDATE connector_instances
            SET health_status = 'HEALTHY', last_checked_at = NOW(), last_success_at = NOW(), last_error = NULL,
                consecutive_failures = $3, circuit_state = $4, circuit_opened_at = NULL, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2`,
        [row.organization_id, row.id, s.consecutiveFailures, s.circuitState],
        { tenantId: row.organization_id }
      );
      row.health_status = 'HEALTHY';
      row.circuit_state = 'CLOSED';
      row.consecutive_failures = 0;
      return;
    }
    const s = failureSnap!;
    const health = s.circuitState === 'OPEN' ? 'UNHEALTHY' : 'DEGRADED';
    await this.db.query(
      `UPDATE connector_instances
          SET health_status = $3, last_checked_at = NOW(), last_failure_at = NOW(), last_error = $4,
              consecutive_failures = $5, circuit_state = $6, circuit_opened_at = $7, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2`,
      [row.organization_id, row.id, health, (error || '').slice(0, 1000), s.consecutiveFailures, s.circuitState, s.circuitOpenedAt],
      { tenantId: row.organization_id }
    );
    row.health_status = health;
    row.circuit_state = s.circuitState;
    row.consecutive_failures = s.consecutiveFailures;
    row.circuit_opened_at = s.circuitOpenedAt;
    if (health === 'UNHEALTHY' && prevHealth !== 'UNHEALTHY') {
      await this.emitUnhealthy(row, error);
    }
  }

  async emitUnhealthy(row: Pick<ConnectorRow, 'organization_id' | 'id' | 'connector_type' | 'name'>, error: string | null) {
    try {
      await this.outbox?.recordEvent(
        row.organization_id,
        'connector.unhealthy',
        'CONNECTOR' as any,
        row.id,
        { connectorId: row.id, type: row.connector_type, name: row.name, error }
      );
    } catch (err: any) {
      this.logger.warn(`Could not record connector.unhealthy event: ${err?.message}`);
    }
  }

  async log(
    row: Pick<ConnectorRow, 'organization_id' | 'id'>,
    operation: string,
    outcome: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'CONFLICT' | 'BLOCKED',
    extra: { durationMs?: number; error?: string; httpStatus?: number; objectType?: string; objectRef?: string; actorId?: string | null; attempt?: number } = {}
  ) {
    try {
      await this.db.query(
        `INSERT INTO connector_sync_log (id, organization_id, connector_id, operation, object_type, object_ref, outcome,
           http_status, error, duration_ms, attempt, actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          uuidv4(),
          row.organization_id,
          row.id,
          operation,
          extra.objectType ?? null,
          extra.objectRef ?? null,
          outcome,
          extra.httpStatus ?? null,
          extra.error ? extra.error.slice(0, 1000) : null,
          extra.durationMs ?? null,
          extra.attempt ?? 1,
          extra.actorId ?? null,
        ],
        { tenantId: row.organization_id }
      );
    } catch (err: any) {
      this.logger.warn(`Could not write connector sync log: ${err?.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------
  async testConnection(organizationId: string, actorId: string | null, id: string) {
    const row = await this.getRow(organizationId, id);
    const started = Date.now();
    try {
      const result = await this.execute(
        row,
        'connection.test',
        async (ctx, adapter) => {
          const r = await adapter.testConnection(ctx);
          if (!r.ok) {
            const err: any = new Error(r.message);
            err.testResult = r;
            throw err;
          }
          return r;
        },
        { actorId }
      );
      const capabilities = {
        ...(result.capabilities || {}),
        canWrite: row.access_mode === 'READ_WRITE' && getConnectorDefinition(row.connector_type)!.writeActions.length > 0,
        handshakeAt: new Date().toISOString(),
      };
      await this.db.query(
        `UPDATE connector_instances SET capabilities = $3 WHERE organization_id = $1 AND id = $2`,
        [organizationId, id, JSON.stringify(capabilities)],
        { tenantId: organizationId }
      );
      return { ok: true, message: result.message, latencyMs: result.latencyMs ?? Date.now() - started, capabilities, connector: await this.get(organizationId, id) };
    } catch (err: any) {
      const message = err?.response?.message || err?.message || 'Connection test failed';
      return { ok: false, message, latencyMs: Date.now() - started, connector: await this.get(organizationId, id) };
    }
  }

  async syncLog(organizationId: string, id: string, limit = 50) {
    await this.getRow(organizationId, id);
    const res = await this.db.query(
      `SELECT id, operation, object_type, object_ref, outcome, http_status, error, duration_ms, attempt, actor_id, created_at
         FROM connector_sync_log WHERE organization_id = $1 AND connector_id = $2
        ORDER BY created_at DESC LIMIT $3`,
      [organizationId, id, Math.min(Math.max(limit, 1), 200)],
      { tenantId: organizationId }
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      operation: r.operation,
      objectType: r.object_type,
      objectRef: r.object_ref,
      outcome: r.outcome,
      httpStatus: r.http_status,
      error: r.error,
      durationMs: r.duration_ms,
      attempt: r.attempt,
      actorId: r.actor_id,
      createdAt: r.created_at,
    }));
  }

  async fetchMetadata(organizationId: string, actorId: string | null, id: string) {
    const row = await this.getRow(organizationId, id);
    if (row.connector_type !== 'ODATA' && row.connector_type !== 'HTTP_OPENAPI') {
      throw new BadRequestException('Metadata snapshots are supported for OData and HTTP/OpenAPI connectors');
    }
    const snap = await this.execute(
      row,
      'metadata.fetch',
      (ctx, adapter) =>
        row.connector_type === 'ODATA'
          ? (adapter as ODataAdapter).fetchMetadata(ctx)
          : (adapter as HttpOpenApiAdapter).fetchOpenApi(ctx),
      { actorId, objectType: 'METADATA' }
    );
    const prev = await this.db.query(
      `SELECT id, content_sha256 FROM connector_metadata_snapshots
        WHERE organization_id = $1 AND connector_id = $2 ORDER BY fetched_at DESC LIMIT 1`,
      [organizationId, id],
      { tenantId: organizationId }
    );
    const snapshotId = uuidv4();
    await this.db.query(
      `INSERT INTO connector_metadata_snapshots (id, organization_id, connector_id, kind, service_path, protocol_version,
         content_sha256, content_bytes, normalized, summary, fetched_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        snapshotId,
        organizationId,
        id,
        snap.kind,
        snap.servicePath,
        snap.protocolVersion,
        snap.contentSha256,
        snap.contentBytes,
        JSON.stringify(snap.normalized),
        JSON.stringify(snap.summary),
        actorId,
      ],
      { tenantId: organizationId }
    );
    const previous = prev.rows[0];
    return {
      id: snapshotId,
      kind: snap.kind,
      servicePath: snap.servicePath,
      protocolVersion: snap.protocolVersion,
      contentSha256: snap.contentSha256,
      contentBytes: snap.contentBytes,
      summary: snap.summary,
      changedSincePrevious: previous ? previous.content_sha256 !== snap.contentSha256 : null,
      previousSnapshotId: previous?.id ?? null,
    };
  }

  async listSnapshots(organizationId: string, id: string) {
    await this.getRow(organizationId, id);
    const res = await this.db.query(
      `SELECT id, kind, service_path, protocol_version, content_sha256, content_bytes, summary, fetched_at
         FROM connector_metadata_snapshots WHERE organization_id = $1 AND connector_id = $2
        ORDER BY fetched_at DESC LIMIT 50`,
      [organizationId, id],
      { tenantId: organizationId }
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      servicePath: r.service_path,
      protocolVersion: r.protocol_version,
      contentSha256: r.content_sha256,
      contentBytes: r.content_bytes,
      summary: r.summary,
      fetchedAt: r.fetched_at,
    }));
  }

  async getSnapshot(organizationId: string, id: string, snapshotId: string) {
    const res = await this.db.query(
      `SELECT * FROM connector_metadata_snapshots WHERE organization_id = $1 AND connector_id = $2 AND id = $3`,
      [organizationId, id, snapshotId],
      { tenantId: organizationId }
    );
    const r = res.rows[0];
    if (!r) throw new NotFoundException('Snapshot not found');
    return {
      id: r.id,
      kind: r.kind,
      servicePath: r.service_path,
      protocolVersion: r.protocol_version,
      contentSha256: r.content_sha256,
      summary: r.summary,
      normalized: r.normalized,
      fetchedAt: r.fetched_at,
    };
  }

  /** Git: records the tree snapshot of the configured branch. */
  async gitSnapshot(organizationId: string, actorId: string | null, id: string) {
    const row = await this.getRow(organizationId, id);
    if (row.connector_type !== 'GIT') throw new BadRequestException('Not a Git connector');
    const tree = await this.execute(row, 'git.snapshot', (ctx, adapter) => (adapter as GitAdapter).snapshot(ctx as any), {
      actorId,
      objectType: 'GIT_TREE',
    });
    const snapshotId = uuidv4();
    const normalized = { commit: tree.commit, branch: tree.branch, files: tree.files };
    const crypto = await import('node:crypto');
    const sha = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    await this.db.query(
      `INSERT INTO connector_metadata_snapshots (id, organization_id, connector_id, kind, service_path, protocol_version,
         content_sha256, content_bytes, normalized, summary, fetched_by)
       VALUES ($1,$2,$3,'GIT_TREE',$4,$5,$6,$7,$8,$9,$10)`,
      [
        snapshotId,
        organizationId,
        id,
        tree.branch,
        tree.commit.slice(0, 20),
        sha,
        tree.totalBytes,
        JSON.stringify(normalized),
        JSON.stringify({ totalFiles: tree.totalFiles, abapFiles: tree.abapFiles, objectTypes: tree.objectTypes, commit: tree.commit }),
        actorId,
      ],
      { tenantId: organizationId }
    );
    return { id: snapshotId, commit: tree.commit, branch: tree.branch, totalFiles: tree.totalFiles, totalBytes: tree.totalBytes, abapFiles: tree.abapFiles, objectTypes: tree.objectTypes };
  }

  /**
   * Git → project ingestion: every ABAP source of the branch goes through the
   * regular ingestion pipeline (magic bytes, ClamAV, secret redaction,
   * tenant-scoped storage) exactly like a manual upload.
   */
  async gitIngest(organizationId: string, actorId: string | null, id: string, body: unknown) {
    const { projectId, maxFiles } = parseBody(GitIngestSchema, body);
    if (!this.ingestion) throw new ServiceUnavailableException('Ingestion pipeline unavailable');
    const row = await this.getRow(organizationId, id);
    if (row.connector_type !== 'GIT') throw new BadRequestException('Not a Git connector');
    const proj = await this.db.query(`SELECT id FROM projects WHERE organization_id = $1 AND id = $2`, [organizationId, projectId], {
      tenantId: organizationId,
    });
    if (!proj.rows.length) throw new NotFoundException('Project not found');
    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const result = await this.execute(
      row,
      'git.ingest',
      async (ctx, adapter) => {
        const git = adapter as GitAdapter;
        return git.withCheckout(ctx as any, async (dir, commit) => {
          const files = (await git.listFiles(dir, (ctx.config as any).pathFilter)).filter((f) => f.path.endsWith('.abap'));
          const selected = files.slice(0, Math.min(maxFiles, 500));
          const ingested: Array<{ path: string; fileId?: string; status: string; error?: string }> = [];
          for (const f of selected) {
            const buf = await fs.readFile(pathMod.join(dir, f.path));
            try {
              const presigned = await this.ingestion!.requestPresignedUpload(organizationId, projectId, actorId, {
                fileName: pathMod.basename(f.path),
                fileSize: buf.length,
                mimeType: 'text/x-abap',
              } as any);
              const confirmed: any = await this.ingestion!.confirmUpload(organizationId, projectId, presigned.fileId, buf);
              ingested.push({ path: f.path, fileId: presigned.fileId, status: confirmed?.quarantineStatus || confirmed?.status || 'PROCESSED' });
            } catch (err: any) {
              ingested.push({ path: f.path, status: 'REJECTED', error: String(err?.response?.message || err?.message).slice(0, 200) });
            }
          }
          return { commit, discovered: files.length, ingested };
        });
      },
      { actorId, objectType: 'PROJECT', objectRef: projectId }
    );
    await this.audit.record({
      organizationId,
      action: 'connector.git_ingested',
      resourceType: 'PROJECT',
      resourceId: projectId,
      actorId,
      payload: { connectorId: id, commit: result.commit, discovered: result.discovered, ingested: result.ingested.length },
    });
    return result;
  }

  /** Cloud ALM: projects visible to the configured client (for project mapping). */
  async cloudAlmProjects(organizationId: string, actorId: string | null, id: string) {
    const row = await this.getRow(organizationId, id);
    if (row.connector_type !== 'SAP_CLOUD_ALM') throw new BadRequestException('Not a Cloud ALM connector');
    return this.execute(row, 'projects.list', (ctx, adapter) => (adapter as CloudAlmAdapter).listProjects(ctx as any), {
      actorId,
      objectType: 'PROJECT',
    });
  }

  // -------------------------------------------------------------------------
  // Project mapping
  // -------------------------------------------------------------------------
  async listProjectLinks(organizationId: string, id: string) {
    await this.getRow(organizationId, id);
    const res = await this.db.query(
      `SELECT l.*, p.name AS project_name FROM connector_project_links l JOIN projects p ON p.id = l.project_id
        WHERE l.organization_id = $1 AND l.connector_id = $2 ORDER BY p.name`,
      [organizationId, id],
      { tenantId: organizationId }
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name,
      externalProjectId: r.external_project_id,
      syncDirection: r.sync_direction,
      systemOfRecord: r.system_of_record,
    }));
  }

  async upsertProjectLink(organizationId: string, actorId: string | null, id: string, body: unknown) {
    const dto = parseBody(ProjectLinkSchema, body);
    await this.getRow(organizationId, id);
    const proj = await this.db.query(`SELECT id FROM projects WHERE organization_id = $1 AND id = $2`, [organizationId, dto.projectId], {
      tenantId: organizationId,
    });
    if (!proj.rows.length) throw new NotFoundException('Project not found');
    const res = await this.db.query(
      `INSERT INTO connector_project_links (id, organization_id, connector_id, project_id, external_project_id, sync_direction, system_of_record)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (connector_id, project_id) DO UPDATE
         SET external_project_id = EXCLUDED.external_project_id, sync_direction = EXCLUDED.sync_direction,
             system_of_record = EXCLUDED.system_of_record, updated_at = NOW()
       RETURNING *`,
      [uuidv4(), organizationId, id, dto.projectId, dto.externalProjectId, dto.syncDirection, dto.systemOfRecord],
      { tenantId: organizationId }
    );
    await this.audit.record({
      organizationId,
      action: 'connector.project_mapped',
      resourceType: 'PROJECT',
      resourceId: dto.projectId,
      actorId,
      payload: { connectorId: id, externalProjectId: dto.externalProjectId, syncDirection: dto.syncDirection },
    });
    return res.rows[0];
  }

  async getProjectLink(organizationId: string, connectorId: string, projectId: string) {
    const res = await this.db.query(
      `SELECT * FROM connector_project_links WHERE organization_id = $1 AND connector_id = $2 AND project_id = $3`,
      [organizationId, connectorId, projectId],
      { tenantId: organizationId }
    );
    return res.rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Write safety (Part 18.4/18.5)
  // -------------------------------------------------------------------------
  assertWriteAllowed(row: ConnectorRow, action: string, confirmed: boolean): WorkItemAdapter | ConnectorAdapter {
    const def = getConnectorDefinition(row.connector_type)!;
    const registered = def.writeActions.find((w) => w.action === action);
    if (!registered) {
      throw new ForbiddenException(`Write action '${action}' is not registered for ${def.displayName}`);
    }
    if (row.status !== 'ACTIVE') throw new ForbiddenException('Connector is disabled');
    if (row.access_mode !== 'READ_WRITE') {
      throw new ForbiddenException(`Connector '${row.name}' is read-only; an administrator must grant write access first`);
    }
    if (!confirmed) {
      throw new BadRequestException(`'${action}' writes to ${def.displayName}; explicit confirmation (confirm=true) is required`);
    }
    const adapter = this.adapters[row.connector_type];
    if (action.startsWith('work_item.') && !isWorkItemAdapter(adapter)) {
      throw new BadRequestException(`${def.displayName} does not support work items`);
    }
    return adapter;
  }

  // -------------------------------------------------------------------------
  // Periodic health sweep (all tenants; each check runs in its tenant context)
  // -------------------------------------------------------------------------
  async runHealthSweep(): Promise<{ checked: number }> {
    const res = await this.db.query(
      `SELECT organization_id, id FROM connector_instances
        WHERE status = 'ACTIVE' AND connector_type NOT IN ('FILE')
          AND (last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '10 minutes')
          -- No outbound calls with the credentials of a suspended organization (spec 10.7).
          AND NOT EXISTS (SELECT 1 FROM organizations o
                           WHERE o.id = connector_instances.organization_id AND o.status = 'SUSPENDED')
        ORDER BY last_checked_at NULLS FIRST LIMIT 50`,
      [],
      { bypassRls: true }
    );
    let checked = 0;
    for (const r of res.rows) {
      await this.testConnection(r.organization_id, null, r.id).catch(() => undefined);
      checked++;
    }
    return { checked };
  }
}
