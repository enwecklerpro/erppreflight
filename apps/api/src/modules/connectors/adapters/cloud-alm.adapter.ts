import {
  ConnectorContext,
  ConnectionTestResult,
  ExternalWorkItemState,
  StatusCategory,
  WorkItemAdapter,
  WorkItemInput,
  WorkItemPatch,
  joinUrl,
} from './adapter.types';
import { getClientCredentialsToken } from './oauth2';
import { CONNECTOR_DEFINITIONS } from '../connector-registry';

/**
 * SAP Cloud ALM connector (Part 15.2, C §33).
 *
 * Authentication: OAuth 2.0 client credentials against the BTP subaccount token
 * endpoint (`https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token`).
 * API surface used (SAP Cloud ALM public APIs, api.sap.com packages
 * "SAP Cloud ALM Projects" and "SAP Cloud ALM Tasks"):
 *   GET    /api/calm-projects/v1/projects                      project mapping / health
 *   GET    /api/calm-tasks/v1/tasks?projectId=&type=CALMREQU     requirements import
 *   POST   /api/calm-tasks/v1/tasks                            create remediation task
 *   GET    /api/calm-tasks/v1/tasks/{id}                       status sync (pull)
 *   PATCH  /api/calm-tasks/v1/tasks/{id}                       explicit update
 *   POST   /api/calm-tasks/v1/tasks/{id}/comments              comment / reference
 * The local contract test double (apps/api/test/doubles/work-item-doubles.ts)
 * implements exactly this surface.
 */

export interface CloudAlmConfig {
  apiBaseUrl: string;
  tokenUrl: string;
  defaultProjectId?: string;
  taskType: 'CALMTASK' | 'CALMUS' | 'CALMREQU';
}

export interface CloudAlmCredentials {
  clientId: string;
  clientSecret: string;
}

export interface CloudAlmProject {
  id: string;
  name: string;
}

export interface CloudAlmRequirement {
  id: string;
  displayId?: string;
  title: string;
  status: string;
  processHierarchy?: string;
}

const PRIORITY: Record<string, number> = {
  BLOCKER: 10,
  CRITICAL: 20,
  MAJOR: 30,
  MEDIUM: 30,
  MINOR: 40,
  LOW: 40,
  INFO: 40,
};

export function cloudAlmStatusCategory(status: string | undefined): StatusCategory {
  const s = String(status || '').toUpperCase();
  if (!s) return 'UNKNOWN';
  if (/(CLSD|CLOSED|DONE|COMPL|RESOLV)/.test(s)) return 'DONE';
  if (/(INPR|IPRG|PROGRESS|BLKD|BLOCK)/.test(s)) return 'IN_PROGRESS';
  if (/(OPEN|NEW)/.test(s)) return 'OPEN';
  return 'UNKNOWN';
}

function asArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.value)) return data.value;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

export class CloudAlmAdapter implements WorkItemAdapter {
  readonly type = 'SAP_CLOUD_ALM' as const;

  private async headers(ctx: ConnectorContext<CloudAlmConfig, CloudAlmCredentials>) {
    const token = await getClientCredentialsToken(
      ctx.http,
      ctx.config.tokenUrl,
      ctx.credentials.clientId,
      ctx.credentials.clientSecret
    );
    return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  }

  private url(ctx: ConnectorContext<CloudAlmConfig>, path: string) {
    return joinUrl(ctx.config.apiBaseUrl, path);
  }

  taskUrl(ctx: ConnectorContext<CloudAlmConfig>, id: string): string {
    return `${ctx.config.apiBaseUrl.replace(/\/+$/, '')}/launchpad#calmtask-display?taskId=${encodeURIComponent(id)}`;
  }

  private toState(ctx: ConnectorContext<CloudAlmConfig>, t: any): ExternalWorkItemState {
    const id = String(t.id ?? t.uuid ?? '');
    return {
      externalId: id,
      key: t.displayId ? String(t.displayId) : undefined,
      url: this.taskUrl(ctx, id),
      status: String(t.status ?? 'UNKNOWN'),
      statusCategory: cloudAlmStatusCategory(t.status),
      version: t.lastChangedDate ?? t.modifiedAt ?? t.changedAt ?? undefined,
      remoteModifiedAt: t.lastChangedDate ?? t.modifiedAt ?? t.changedAt ?? undefined,
      assignee: t.assigneeId ?? null,
      title: t.title,
    };
  }

  async listProjects(ctx: ConnectorContext<CloudAlmConfig, CloudAlmCredentials>): Promise<CloudAlmProject[]> {
    const data = await ctx.http.json({
      url: this.url(ctx, '/api/calm-projects/v1/projects'),
      headers: await this.headers(ctx),
    });
    return asArray(data).map((p) => ({ id: String(p.id), name: String(p.name ?? p.title ?? p.id) }));
  }

  async listRequirements(
    ctx: ConnectorContext<CloudAlmConfig, CloudAlmCredentials>,
    projectId: string
  ): Promise<CloudAlmRequirement[]> {
    const q = new URLSearchParams({ projectId, type: 'CALMREQU' });
    const data = await ctx.http.json({
      url: this.url(ctx, `/api/calm-tasks/v1/tasks?${q.toString()}`),
      headers: await this.headers(ctx),
    });
    return asArray(data).map((r) => ({
      id: String(r.id),
      displayId: r.displayId ? String(r.displayId) : undefined,
      title: String(r.title ?? r.id),
      status: String(r.status ?? 'UNKNOWN'),
      processHierarchy: r.processHierarchyNode?.title ?? r.solutionProcess ?? undefined,
    }));
  }

  async testConnection(ctx: ConnectorContext<CloudAlmConfig, CloudAlmCredentials>): Promise<ConnectionTestResult> {
    const started = Date.now();
    const projects = await this.listProjects(ctx);
    const def = CONNECTOR_DEFINITIONS.SAP_CLOUD_ALM;
    const mapped = ctx.config.defaultProjectId
      ? projects.some((p) => p.id === ctx.config.defaultProjectId)
      : true;
    return {
      ok: mapped,
      message: mapped
        ? `Authenticated via OAuth2; ${projects.length} Cloud ALM project(s) visible`
        : `Authenticated, but default project ${ctx.config.defaultProjectId} is not visible to this client`,
      latencyMs: Date.now() - started,
      capabilities: {
        product: 'SAP Cloud ALM',
        protocol: 'REST/JSON (OAuth2 client credentials)',
        availableApis: ['calm-projects/v1', 'calm-tasks/v1'],
        grantedScopes: ['calm-projects: read', 'calm-tasks: read'],
        readable: def.canRead,
        notAccessible: def.cannotAccess,
        canWrite: false,
        supportedEngines: [],
        details: { visibleProjects: projects.slice(0, 50) },
      },
    };
  }

  async createWorkItem(
    ctx: ConnectorContext<CloudAlmConfig, CloudAlmCredentials>,
    input: WorkItemInput
  ): Promise<ExternalWorkItemState> {
    const projectId = input.externalProjectId || ctx.config.defaultProjectId;
    if (!projectId) {
      throw new Error('No Cloud ALM project mapped: set a project mapping or the connector default project');
    }
    const body: Record<string, unknown> = {
      projectId,
      title: input.title.slice(0, 255),
      type: ctx.config.taskType || 'CALMTASK',
      description: input.body,
      priorityId: PRIORITY[input.severity.toUpperCase()] ?? 30,
      tags: input.labels,
    };
    if (input.assignee) body.assigneeId = input.assignee;
    if (input.dueDate) body.dueDate = input.dueDate;
    const created = await ctx.http.json({
      method: 'POST',
      url: this.url(ctx, '/api/calm-tasks/v1/tasks'),
      headers: { ...(await this.headers(ctx)), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!created?.id) {
      throw new Error('Cloud ALM did not return a task id');
    }
    // Reference back to ERP Preflight (best effort; the task already exists).
    await ctx.http
      .request({
        method: 'POST',
        url: this.url(ctx, `/api/calm-tasks/v1/tasks/${encodeURIComponent(created.id)}/comments`),
        headers: { ...(await this.headers(ctx)), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `ERP Preflight finding: ${input.findingUrl}` }),
      })
      .catch(() => undefined);
    return this.toState(ctx, created);
  }

  async getWorkItem(ctx: ConnectorContext<CloudAlmConfig, CloudAlmCredentials>, externalId: string) {
    const t = await ctx.http.json({
      url: this.url(ctx, `/api/calm-tasks/v1/tasks/${encodeURIComponent(externalId)}`),
      headers: await this.headers(ctx),
    });
    return this.toState(ctx, t);
  }

  async updateWorkItem(ctx: ConnectorContext<CloudAlmConfig, CloudAlmCredentials>, externalId: string, patch: WorkItemPatch) {
    const body: Record<string, unknown> = {};
    if (patch.title) body.title = patch.title.slice(0, 255);
    if (patch.body) body.description = patch.body;
    if (patch.priority) body.priorityId = PRIORITY[patch.priority.toUpperCase()] ?? 30;
    const t = await ctx.http.json({
      method: 'PATCH',
      url: this.url(ctx, `/api/calm-tasks/v1/tasks/${encodeURIComponent(externalId)}`),
      headers: { ...(await this.headers(ctx)), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.toState(ctx, t);
  }

  async addComment(ctx: ConnectorContext<CloudAlmConfig, CloudAlmCredentials>, externalId: string, text: string) {
    await ctx.http.request({
      method: 'POST',
      url: this.url(ctx, `/api/calm-tasks/v1/tasks/${encodeURIComponent(externalId)}/comments`),
      headers: { ...(await this.headers(ctx)), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
  }
}
