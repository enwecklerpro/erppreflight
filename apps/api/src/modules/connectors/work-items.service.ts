import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { ConnectorRow, ConnectorsService } from './connectors.service';
import { isWorkItemConnector } from './connector-registry';
import { ExternalWorkItemState, WorkItemAdapter, WorkItemInput } from './adapters';
import { IntegrationAuditService } from './integration-audit.service';
import { parseBody } from './zod-body';

/**
 * Finding → work item workflow (Part 15.3/15.4/15.7/15.8, C §33/§34).
 *
 * - One shared WorkItemConnector abstraction; engines never talk to trackers.
 * - The task body contains finding id, title, severity, concise reason, exact
 *   evidence (path:line + SHA-256), affected objects, remediation, deep link,
 *   target release and a reproducibility/support id. Raw files are never sent.
 * - A finding is linked at most once per connector (idempotent create).
 * - Remote completion does NOT close the finding: it moves the remediation to
 *   PENDING_VERIFICATION; only a later completed analysis in which the finding's
 *   fingerprint no longer appears marks it VERIFIED_RESOLVED.
 * - Explicit updates carry the last known remote version; if the remote object
 *   changed since the last sync the update is refused and a CONFLICT is recorded
 *   (never silently overwrite human changes) until a user resolves it.
 */

export const CreateWorkItemSchema = z
  .object({
    findingId: z.string().uuid(),
    connectorId: z.string().uuid(),
    confirm: z.boolean().default(false),
    dryRun: z.boolean().default(false),
    assignee: z.string().trim().max(255).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export const UpdateWorkItemSchema = z
  .object({
    title: z.string().trim().min(3).max(255).optional(),
    body: z.string().trim().max(20_000).optional(),
    priority: z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO']).optional(),
    confirm: z.boolean().default(false),
  })
  .strict();

export const ResolveConflictSchema = z
  .object({
    resolution: z.enum(['ACCEPT_REMOTE', 'OVERWRITE_REMOTE']),
    confirm: z.boolean().default(false),
  })
  .strict();

export const CommentSchema = z.object({ text: z.string().trim().min(1).max(5000), confirm: z.boolean().default(false) }).strict();

export function appBaseUrl(): string {
  const explicit = process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const cors = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  return (cors || 'http://localhost:3000').replace(/\/+$/, '');
}

export function mapWorkItemRow(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    findingId: r.finding_id,
    connectorId: r.connector_id,
    connectorName: r.connector_name ?? undefined,
    externalSystem: r.external_system,
    externalProjectId: r.external_project_id,
    externalId: r.external_id,
    externalKey: r.external_key,
    externalUrl: r.external_url,
    externalStatus: r.external_status,
    statusCategory: r.status_category,
    remediationState: r.remediation_state,
    syncDirection: r.sync_direction,
    syncVersion: r.sync_version,
    lastSyncedAt: r.last_synced_at,
    lastRemoteModifiedAt: r.last_remote_modified_at,
    lastLocalModifiedAt: r.last_local_modified_at,
    conflictState: r.conflict_state,
    conflictDetails: r.conflict_details,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

@Injectable()
export class WorkItemsService {
  private readonly logger = new Logger(WorkItemsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly connectors: ConnectorsService,
    private readonly audit: IntegrationAuditService,
    @Optional() private readonly outbox?: OutboxService
  ) {}

  /** Builds the Part 15.8 task body from persisted finding + evidence data. */
  async buildInput(organizationId: string, findingId: string, overrides: { assignee?: string; dueDate?: string } = {}) {
    const fRes = await this.db.query(
      `SELECT f.*, p.name AS project_name, p.target_release AS project_target_release, a.target_release AS analysis_target_release
         FROM findings f
         JOIN projects p ON p.id = f.project_id
         LEFT JOIN analyses a ON a.id = f.analysis_id
        WHERE f.organization_id = $1 AND f.id = $2`,
      [organizationId, findingId],
      { tenantId: organizationId }
    );
    const f = fRes.rows[0];
    if (!f) throw new NotFoundException(`Finding ${findingId} not found`);
    const evRes = await this.db.query(
      `SELECT artifact_path, line_number, column_number, sha256 FROM evidence
        WHERE organization_id = $1 AND finding_id = $2 ORDER BY line_number NULLS LAST LIMIT 5`,
      [organizationId, findingId],
      { tenantId: organizationId }
    );
    const affected: any[] = Array.isArray(f.affected_objects) ? f.affected_objects : [];
    const deepLink = `${appBaseUrl()}/projects/${f.project_id}/findings?id=${f.id}`;
    const supportId = `${String(f.analysis_id).slice(0, 8)}-${String(f.fingerprint).slice(0, 12)}`;
    const reason = String(f.description || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    const lines = [
      `ERP Preflight finding ${f.rule_id} (${f.severity}, confidence ${f.confidence_class})`,
      '',
      `Finding ID: ${f.id}`,
      `Title: ${f.title}`,
      `Severity: ${f.severity}`,
      `Reason: ${reason}`,
      '',
      'Evidence:',
      ...(evRes.rows.length
        ? evRes.rows.map(
            (e: any) =>
              `- ${e.artifact_path}${e.line_number ? `:${e.line_number}` : ''}${e.column_number ? `:${e.column_number}` : ''} (SHA-256 ${e.sha256})`
          )
        : ['- none recorded (finding confidence is limited accordingly)']),
      '',
      'Affected objects:',
      ...(affected.length ? affected.slice(0, 20).map((o: any) => `- ${o.type ? `${o.type} ` : ''}${o.name ?? JSON.stringify(o)}`) : ['- none']),
      '',
      `Recommended remediation: ${String(f.remediation || 'See finding details').trim()}`,
      '',
      `Target release: ${f.analysis_target_release || f.project_target_release || 'n/a'}`,
      `Project: ${f.project_name}`,
      `Reproducibility / support ID: ${supportId}`,
      `Open in ERP Preflight: ${deepLink}`,
      '',
      'Note: completing this task does not close the finding; ERP Preflight verifies the fix on the next analysis run.',
    ];
    const input: WorkItemInput = {
      title: `[ERP Preflight] ${f.rule_id}: ${String(f.title).slice(0, 180)}`,
      body: lines.join('\n'),
      severity: String(f.severity || 'MEDIUM'),
      labels: ['erp-preflight', String(f.engine || '').toLowerCase(), String(f.severity || '').toLowerCase()].filter(Boolean),
      findingUrl: deepLink,
      assignee: overrides.assignee,
      dueDate: overrides.dueDate,
    };
    return { finding: f, input, supportId };
  }

  private payloadHash(input: WorkItemInput) {
    return crypto.createHash('sha256').update(JSON.stringify({ t: input.title, b: input.body })).digest('hex');
  }

  async createForFinding(organizationId: string, actorId: string | null, body: unknown) {
    const dto = parseBody(CreateWorkItemSchema, body);
    const connector = await this.connectors.getRow(organizationId, dto.connectorId);
    if (!isWorkItemConnector(connector.connector_type)) {
      throw new BadRequestException(`Connector '${connector.name}' is not a work item connector`);
    }
    const { finding, input, supportId } = await this.buildInput(organizationId, dto.findingId, dto);
    const link = await this.connectors.getProjectLink(organizationId, connector.id, finding.project_id);
    if (link?.external_project_id) input.externalProjectId = link.external_project_id;

    const existing = await this.db.query(
      `SELECT w.*, c.name AS connector_name FROM external_work_items w JOIN connector_instances c ON c.id = w.connector_id
        WHERE w.organization_id = $1 AND w.connector_id = $2 AND w.finding_id = $3`,
      [organizationId, connector.id, finding.id],
      { tenantId: organizationId }
    );
    if (existing.rows[0]) {
      return { created: false, alreadyLinked: true, workItem: mapWorkItemRow(existing.rows[0]) };
    }

    if (dto.dryRun) {
      // Part 18.4 preview: nothing is sent to the external system.
      return {
        created: false,
        dryRun: true,
        connector: { id: connector.id, name: connector.name, type: connector.connector_type, accessMode: connector.access_mode },
        preview: { ...input, externalProjectId: input.externalProjectId ?? (connector.config as any).defaultProjectId ?? null },
        supportId,
      };
    }

    const adapter = this.connectors.assertWriteAllowed(connector, 'work_item.create', dto.confirm) as WorkItemAdapter;
    const state = await this.connectors.execute(connector, 'work_item.create', (ctx) => adapter.createWorkItem(ctx, input), {
      actorId,
      objectType: 'FINDING',
      objectRef: finding.id,
    });

    const id = uuidv4();
    const res = await this.db.withTenantTransaction(organizationId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO external_work_items (
           id, organization_id, project_id, finding_id, connector_id, external_system, external_tenant, external_project_id,
           external_id, external_key, external_url, external_status, status_category, remediation_state, sync_direction,
           sync_version, payload_sha256, last_synced_at, last_local_modified_at, last_remote_modified_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW(),$18,$19)
         RETURNING *`,
        [
          id,
          organizationId,
          finding.project_id,
          finding.id,
          connector.id,
          connector.connector_type,
          this.externalTenant(connector),
          input.externalProjectId ?? (connector.config as any).defaultProjectId ?? (connector.config as any).projectKey ?? (connector.config as any).project ?? null,
          state.externalId,
          state.key ?? null,
          state.url ?? null,
          state.status,
          state.statusCategory,
          this.remediationFor(state.statusCategory, 'OPEN'),
          link?.sync_direction ?? 'PUSH_ONLY',
          state.version ?? null,
          this.payloadHash(input),
          state.remoteModifiedAt ?? null,
          actorId,
        ]
      );
      await this.upsertTraceability(client, organizationId, finding, connector, state);
      if (this.outbox) {
        await this.outbox.recordEvent(
          organizationId,
          'traceability.task_dispatched',
          'FINDING',
          finding.id,
          { findingId: finding.id, projectId: finding.project_id, connectorId: connector.id, externalSystem: connector.connector_type, externalId: state.externalId, url: state.url },
          client
        );
      }
      return inserted;
    });
    await this.audit.record({
      organizationId,
      action: 'work_item.created',
      resourceType: 'FINDING',
      resourceId: finding.id,
      actorId,
      payload: { connectorId: connector.id, externalSystem: connector.connector_type, externalId: state.externalId, externalKey: state.key },
    });
    return { created: true, workItem: mapWorkItemRow({ ...res.rows[0], connector_name: connector.name }) };
  }

  private externalTenant(connector: ConnectorRow): string | null {
    const c: any = connector.config || {};
    const url = c.apiBaseUrl || c.baseUrl || c.instanceUrl;
    try {
      return url ? new URL(url).host + (c.organization ? `/${c.organization}` : '') : null;
    } catch {
      return null;
    }
  }

  private remediationFor(category: string, current: string): string {
    if (current === 'VERIFIED_RESOLVED') return current;
    if (category === 'DONE') return 'PENDING_VERIFICATION';
    if (category === 'IN_PROGRESS') return 'IN_PROGRESS';
    return 'OPEN';
  }

  /** Keeps the traceability graph (finding → task) in sync with real work items. */
  private async upsertTraceability(client: any, organizationId: string, finding: any, connector: ConnectorRow, state: ExternalWorkItemState) {
    const updated = await client.query(
      `UPDATE traceability_nodes SET remediation_task_id = $4, task_status = $5, external_system = $6, updated_at = NOW()
        WHERE organization_id = $1 AND project_id = $2 AND finding_id = $3 RETURNING id`,
      [organizationId, finding.project_id, finding.id, (state.key || state.externalId).slice(0, 100), state.statusCategory, connector.connector_type]
    );
    if (updated.rows.length) return;
    await client.query(
      `INSERT INTO traceability_nodes (id, organization_id, project_id, process_hierarchy, requirement_id, requirement_title,
         finding_id, remediation_task_id, task_status, release_id, business_criticality, external_system)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        uuidv4(),
        organizationId,
        finding.project_id,
        'Unassigned',
        `FINDING-${String(finding.id).slice(0, 8)}`,
        String(finding.title).slice(0, 500),
        finding.id,
        (state.key || state.externalId).slice(0, 100),
        state.statusCategory,
        String(finding.analysis_target_release || finding.project_target_release || 'n/a').slice(0, 100),
        ['BLOCKER', 'CRITICAL'].includes(String(finding.severity)) ? 'CRITICAL' : 'HIGH',
        connector.connector_type,
      ]
    );
  }

  async list(organizationId: string, filter: { projectId?: string; findingId?: string }) {
    const params: any[] = [organizationId];
    let where = 'w.organization_id = $1';
    if (filter.projectId) {
      params.push(filter.projectId);
      where += ` AND w.project_id = $${params.length}`;
    }
    if (filter.findingId) {
      params.push(filter.findingId);
      where += ` AND w.finding_id = $${params.length}`;
    }
    const res = await this.db.query(
      `SELECT w.*, c.name AS connector_name FROM external_work_items w JOIN connector_instances c ON c.id = w.connector_id
        WHERE ${where} ORDER BY w.created_at DESC LIMIT 500`,
      params,
      { tenantId: organizationId }
    );
    return res.rows.map(mapWorkItemRow);
  }

  private async getRow(organizationId: string, id: string) {
    const res = await this.db.query(
      `SELECT w.*, c.name AS connector_name FROM external_work_items w JOIN connector_instances c ON c.id = w.connector_id
        WHERE w.organization_id = $1 AND w.id = $2`,
      [organizationId, id],
      { tenantId: organizationId }
    );
    if (!res.rows[0]) throw new NotFoundException(`Work item ${id} not found`);
    return res.rows[0];
  }

  /** Is the finding still present in the latest completed analysis of the project? */
  private async stillDetected(organizationId: string, row: any): Promise<boolean | null> {
    if (!row.finding_id) return null;
    const res = await this.db.query(
      `WITH target AS (SELECT fingerprint, project_id FROM findings WHERE organization_id = $1 AND id = $2),
            latest AS (
              SELECT a.id, a.completed_at FROM analyses a, target t
               WHERE a.organization_id = $1 AND a.project_id = t.project_id AND a.status = 'COMPLETED'
               ORDER BY a.completed_at DESC NULLS LAST LIMIT 1)
       SELECT latest.id AS analysis_id, latest.completed_at,
              EXISTS (SELECT 1 FROM findings f, target t WHERE f.organization_id = $1 AND f.analysis_id = latest.id AND f.fingerprint = t.fingerprint) AS present
         FROM latest`,
      [organizationId, row.finding_id],
      { tenantId: organizationId }
    );
    const r = res.rows[0];
    if (!r) return null;
    // Only a run that finished after the task was completed counts as verification.
    if (!row.last_remote_modified_at || new Date(r.completed_at) <= new Date(row.last_remote_modified_at)) return null;
    return Boolean(r.present);
  }

  /** Pull sync: remote status → local state (Part 15.3/15.4). */
  async sync(organizationId: string, actorId: string | null, id: string) {
    const row = await this.getRow(organizationId, id);
    const connector = await this.connectors.getRow(organizationId, row.connector_id);
    const adapter = this.connectors.getAdapter(connector.connector_type) as WorkItemAdapter;
    const state = await this.connectors.execute(
      connector,
      'work_item.sync',
      (ctx) => adapter.getWorkItem(ctx, row.external_id, row.external_project_id ?? undefined),
      { actorId, objectType: 'WORK_ITEM', objectRef: row.external_id }
    );
    let remediation = this.remediationFor(state.statusCategory, row.remediation_state);
    const remoteModifiedAt = state.remoteModifiedAt ?? (state.version !== row.sync_version ? new Date().toISOString() : row.last_remote_modified_at);
    if (remediation === 'PENDING_VERIFICATION') {
      const present = await this.stillDetected(organizationId, { ...row, last_remote_modified_at: remoteModifiedAt });
      if (present === false) remediation = 'VERIFIED_RESOLVED';
    }
    const res = await this.db.query(
      `UPDATE external_work_items
          SET external_status = $3, status_category = $4, remediation_state = $5, sync_version = $6,
              last_synced_at = NOW(), last_remote_modified_at = $7, external_url = COALESCE($8, external_url), updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [organizationId, id, state.status, state.statusCategory, remediation, state.version ?? row.sync_version, remoteModifiedAt, state.url ?? null],
      { tenantId: organizationId }
    );
    if (row.finding_id) {
      await this.db.query(
        `UPDATE traceability_nodes SET task_status = $4, updated_at = NOW()
          WHERE organization_id = $1 AND finding_id = $2 AND remediation_task_id = $3`,
        [organizationId, row.finding_id, (row.external_key || row.external_id).slice(0, 100), remediation === 'VERIFIED_RESOLVED' ? 'VERIFIED' : state.statusCategory],
        { tenantId: organizationId }
      );
    }
    if (remediation !== row.remediation_state) {
      await this.audit.record({
        organizationId,
        action: 'work_item.remediation_state_changed',
        resourceType: 'FINDING',
        resourceId: row.finding_id,
        actorId,
        payload: { workItemId: id, from: row.remediation_state, to: remediation, externalStatus: state.status },
      });
    }
    return mapWorkItemRow({ ...res.rows[0], connector_name: row.connector_name });
  }

  /** Pull-sync every work item of a project (or of the tenant). */
  async syncAll(organizationId: string, actorId: string | null, projectId?: string) {
    const items = await this.list(organizationId, { projectId });
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const it of items) {
      try {
        await this.sync(organizationId, actorId, it.id);
        results.push({ id: it.id, ok: true });
      } catch (err: any) {
        results.push({ id: it.id, ok: false, error: err?.response?.message || err?.message });
      }
    }
    return { total: items.length, synced: results.filter((r) => r.ok).length, results };
  }

  /** Explicit push of title/body/priority, with remote-version conflict detection. */
  async update(organizationId: string, actorId: string | null, id: string, body: unknown) {
    const dto = parseBody(UpdateWorkItemSchema, body);
    if (!dto.title && !dto.body && !dto.priority) throw new BadRequestException('Nothing to update');
    const row = await this.getRow(organizationId, id);
    if (row.conflict_state === 'CONFLICT') {
      throw new BadRequestException('This work item has an unresolved sync conflict; resolve it first');
    }
    const connector = await this.connectors.getRow(organizationId, row.connector_id);
    const adapter = this.connectors.assertWriteAllowed(connector, 'work_item.update', dto.confirm) as WorkItemAdapter;
    const remote = await this.connectors.execute(
      connector,
      'work_item.check_version',
      (ctx) => adapter.getWorkItem(ctx, row.external_id, row.external_project_id ?? undefined),
      { actorId, objectType: 'WORK_ITEM', objectRef: row.external_id }
    );
    if (row.sync_version && remote.version && remote.version !== row.sync_version) {
      const details = {
        detectedAt: new Date().toISOString(),
        storedVersion: row.sync_version,
        remoteVersion: remote.version,
        remoteTitle: remote.title,
        remoteStatus: remote.status,
        pendingLocalChange: { title: dto.title ?? null, body: dto.body ? `${dto.body.slice(0, 200)}…` : null, priority: dto.priority ?? null },
      };
      await this.db.query(
        `UPDATE external_work_items SET conflict_state = 'CONFLICT', conflict_details = $3, last_local_modified_at = NOW(), updated_at = NOW()
          WHERE organization_id = $1 AND id = $2`,
        [organizationId, id, JSON.stringify({ ...details, pendingLocalChangeFull: dto })],
        { tenantId: organizationId }
      );
      await this.connectors.log(connector, 'work_item.update', 'CONFLICT', { objectType: 'WORK_ITEM', objectRef: row.external_id, actorId });
      await this.audit.record({
        organizationId,
        action: 'work_item.sync_conflict',
        resourceType: 'FINDING',
        resourceId: row.finding_id,
        actorId,
        payload: { workItemId: id, storedVersion: row.sync_version, remoteVersion: remote.version },
      });
      return { updated: false, conflict: true, workItem: mapWorkItemRow({ ...(await this.getRow(organizationId, id)) }) };
    }
    const state = await this.connectors.execute(
      connector,
      'work_item.update',
      (ctx) => adapter.updateWorkItem(ctx, row.external_id, dto, row.external_project_id ?? undefined),
      { actorId, objectType: 'WORK_ITEM', objectRef: row.external_id }
    );
    const res = await this.db.query(
      `UPDATE external_work_items SET sync_version = $3, external_status = $4, status_category = $5, last_synced_at = NOW(),
              last_local_modified_at = NOW(), last_remote_modified_at = $6, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [organizationId, id, state.version ?? null, state.status, state.statusCategory, state.remoteModifiedAt ?? null],
      { tenantId: organizationId }
    );
    await this.audit.record({
      organizationId,
      action: 'work_item.updated',
      resourceType: 'FINDING',
      resourceId: row.finding_id,
      actorId,
      payload: { workItemId: id, fields: Object.keys(dto).filter((k) => k !== 'confirm') },
    });
    return { updated: true, conflict: false, workItem: mapWorkItemRow({ ...res.rows[0], connector_name: row.connector_name }) };
  }

  async resolveConflict(organizationId: string, actorId: string | null, id: string, body: unknown) {
    const dto = parseBody(ResolveConflictSchema, body);
    const row = await this.getRow(organizationId, id);
    if (row.conflict_state !== 'CONFLICT') throw new BadRequestException('No open conflict on this work item');
    const connector = await this.connectors.getRow(organizationId, row.connector_id);
    const adapter = this.connectors.getAdapter(connector.connector_type) as WorkItemAdapter;
    let state: ExternalWorkItemState;
    if (dto.resolution === 'OVERWRITE_REMOTE') {
      this.connectors.assertWriteAllowed(connector, 'work_item.update', dto.confirm);
      const pending = row.conflict_details?.pendingLocalChangeFull || {};
      state = await this.connectors.execute(
        connector,
        'work_item.conflict_overwrite',
        (ctx) => adapter.updateWorkItem(ctx, row.external_id, { title: pending.title, body: pending.body, priority: pending.priority }, row.external_project_id ?? undefined),
        { actorId, objectType: 'WORK_ITEM', objectRef: row.external_id }
      );
    } else {
      state = await this.connectors.execute(
        connector,
        'work_item.conflict_accept_remote',
        (ctx) => adapter.getWorkItem(ctx, row.external_id, row.external_project_id ?? undefined),
        { actorId, objectType: 'WORK_ITEM', objectRef: row.external_id }
      );
    }
    const res = await this.db.query(
      `UPDATE external_work_items SET conflict_state = 'RESOLVED', conflict_details = conflict_details || $3::jsonb,
              sync_version = $4, external_status = $5, status_category = $6, last_synced_at = NOW(), updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [organizationId, id, JSON.stringify({ resolution: dto.resolution, resolvedBy: actorId, resolvedAt: new Date().toISOString() }), state.version ?? null, state.status, state.statusCategory],
      { tenantId: organizationId }
    );
    await this.audit.record({
      organizationId,
      action: 'work_item.conflict_resolved',
      resourceType: 'FINDING',
      resourceId: row.finding_id,
      actorId,
      payload: { workItemId: id, resolution: dto.resolution },
    });
    return mapWorkItemRow({ ...res.rows[0], connector_name: row.connector_name });
  }

  async comment(organizationId: string, actorId: string | null, id: string, body: unknown) {
    const dto = parseBody(CommentSchema, body);
    const row = await this.getRow(organizationId, id);
    const connector = await this.connectors.getRow(organizationId, row.connector_id);
    const adapter = this.connectors.assertWriteAllowed(connector, 'work_item.comment', dto.confirm) as WorkItemAdapter;
    await this.connectors.execute(
      connector,
      'work_item.comment',
      (ctx) => adapter.addComment(ctx, row.external_id, dto.text, row.external_project_id ?? undefined),
      { actorId, objectType: 'WORK_ITEM', objectRef: row.external_id }
    );
    await this.audit.record({
      organizationId,
      action: 'work_item.commented',
      resourceType: 'FINDING',
      resourceId: row.finding_id,
      actorId,
      payload: { workItemId: id, length: dto.text.length },
    });
    return { success: true };
  }
}
