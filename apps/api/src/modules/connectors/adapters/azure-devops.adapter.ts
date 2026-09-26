import {
  ConnectorContext,
  ConnectionTestResult,
  ExternalWorkItemState,
  StatusCategory,
  WorkItemAdapter,
  WorkItemInput,
  WorkItemPatch,
  basicAuth,
} from './adapter.types';
import { CONNECTOR_DEFINITIONS } from '../connector-registry';

/**
 * Azure DevOps Boards — Work Item Tracking REST API 7.1 (C §34):
 *   GET   {org}/_apis/projects/{project}?api-version=7.1                          project check
 *   POST  {org}/{project}/_apis/wit/workitems/${type}?api-version=7.1             create (JSON Patch)
 *   GET   {org}/{project}/_apis/wit/workitems/{id}?api-version=7.1                status sync
 *   PATCH {org}/{project}/_apis/wit/workitems/{id}?api-version=7.1                update (JSON Patch)
 *   POST  {org}/{project}/_apis/wit/workItems/{id}/comments?api-version=7.1-preview.4
 * Authentication: PAT via HTTP Basic with an empty user name.
 */

export interface AzureDevOpsConfig {
  baseUrl: string;
  organization: string;
  project: string;
  workItemType: string;
  areaPath?: string;
}
export interface AzureDevOpsCredentials {
  personalAccessToken: string;
}

const PRIORITY: Record<string, number> = { BLOCKER: 1, CRITICAL: 1, MAJOR: 2, MEDIUM: 2, MINOR: 3, LOW: 3, INFO: 4 };

export function azureStateCategory(state: string | undefined): StatusCategory {
  const s = String(state || '').toLowerCase();
  if (!s) return 'UNKNOWN';
  if (['done', 'closed', 'resolved', 'completed', 'removed'].includes(s)) return 'DONE';
  if (['active', 'committed', 'in progress', 'doing'].includes(s)) return 'IN_PROGRESS';
  if (['new', 'to do', 'proposed', 'approved'].includes(s)) return 'OPEN';
  return 'UNKNOWN';
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class AzureDevOpsAdapter implements WorkItemAdapter {
  readonly type = 'AZURE_DEVOPS' as const;

  private orgUrl(ctx: ConnectorContext<AzureDevOpsConfig>) {
    return `${ctx.config.baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(ctx.config.organization)}`;
  }

  private projectUrl(ctx: ConnectorContext<AzureDevOpsConfig>, project?: string) {
    return `${this.orgUrl(ctx)}/${encodeURIComponent(project || ctx.config.project)}`;
  }

  private headers(ctx: ConnectorContext<AzureDevOpsConfig, AzureDevOpsCredentials>) {
    return { Authorization: basicAuth('', ctx.credentials.personalAccessToken), Accept: 'application/json' };
  }

  private toState(ctx: ConnectorContext<AzureDevOpsConfig>, wi: any, project?: string): ExternalWorkItemState {
    const id = String(wi.id);
    return {
      externalId: id,
      key: `#${id}`,
      url: wi._links?.html?.href ?? `${this.projectUrl(ctx, project)}/_workitems/edit/${id}`,
      status: wi.fields?.['System.State'] ?? 'UNKNOWN',
      statusCategory: azureStateCategory(wi.fields?.['System.State']),
      version: wi.rev !== undefined ? String(wi.rev) : undefined,
      remoteModifiedAt: wi.fields?.['System.ChangedDate'],
      assignee: wi.fields?.['System.AssignedTo']?.uniqueName ?? null,
      title: wi.fields?.['System.Title'],
    };
  }

  async testConnection(ctx: ConnectorContext<AzureDevOpsConfig, AzureDevOpsCredentials>): Promise<ConnectionTestResult> {
    const started = Date.now();
    const project = await ctx.http.json({
      url: `${this.orgUrl(ctx)}/_apis/projects/${encodeURIComponent(ctx.config.project)}?api-version=7.1`,
      headers: this.headers(ctx),
    });
    const def = CONNECTOR_DEFINITIONS.AZURE_DEVOPS;
    return {
      ok: true,
      message: `PAT accepted; project ${project?.name ?? ctx.config.project} (${project?.state ?? 'unknown state'}) is accessible`,
      latencyMs: Date.now() - started,
      capabilities: {
        product: 'Azure DevOps Boards',
        protocol: 'Work Item Tracking REST 7.1',
        availableApis: ['_apis/wit/workitems', '_apis/projects'],
        grantedScopes: ['vso.project', 'vso.work'],
        readable: def.canRead,
        notAccessible: def.cannotAccess,
        canWrite: false,
        supportedEngines: [],
        details: { projectId: project?.id, projectName: project?.name },
      },
    };
  }

  async createWorkItem(ctx: ConnectorContext<AzureDevOpsConfig, AzureDevOpsCredentials>, input: WorkItemInput) {
    const project = input.externalProjectId || ctx.config.project;
    const html = `<div>${escapeHtml(input.body).replace(/\n/g, '<br/>')}</div>`;
    const ops: Array<Record<string, unknown>> = [
      { op: 'add', path: '/fields/System.Title', value: input.title.slice(0, 255) },
      { op: 'add', path: '/fields/System.Description', value: html },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: PRIORITY[input.severity.toUpperCase()] ?? 2 },
      { op: 'add', path: '/fields/System.Tags', value: input.labels.join('; ') },
      {
        op: 'add',
        path: '/relations/-',
        value: { rel: 'Hyperlink', url: input.findingUrl, attributes: { comment: 'ERP Preflight finding' } },
      },
    ];
    if (ctx.config.areaPath) ops.push({ op: 'add', path: '/fields/System.AreaPath', value: ctx.config.areaPath });
    if (input.dueDate) ops.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.DueDate', value: input.dueDate });
    const wi = await ctx.http.json({
      method: 'POST',
      url: `${this.projectUrl(ctx, project)}/_apis/wit/workitems/$${encodeURIComponent(ctx.config.workItemType || 'Task')}?api-version=7.1`,
      headers: { ...this.headers(ctx), 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify(ops),
    });
    if (!wi?.id) throw new Error('Azure DevOps did not return a work item id');
    return this.toState(ctx, wi, project);
  }

  async getWorkItem(ctx: ConnectorContext<AzureDevOpsConfig, AzureDevOpsCredentials>, externalId: string, externalProjectId?: string) {
    const wi = await ctx.http.json({
      url: `${this.projectUrl(ctx, externalProjectId)}/_apis/wit/workitems/${encodeURIComponent(externalId)}?api-version=7.1`,
      headers: this.headers(ctx),
    });
    return this.toState(ctx, wi, externalProjectId);
  }

  async updateWorkItem(
    ctx: ConnectorContext<AzureDevOpsConfig, AzureDevOpsCredentials>,
    externalId: string,
    patch: WorkItemPatch,
    externalProjectId?: string
  ) {
    const ops: Array<Record<string, unknown>> = [];
    if (patch.title) ops.push({ op: 'replace', path: '/fields/System.Title', value: patch.title.slice(0, 255) });
    if (patch.body) ops.push({ op: 'replace', path: '/fields/System.Description', value: `<div>${escapeHtml(patch.body)}</div>` });
    if (patch.priority)
      ops.push({ op: 'replace', path: '/fields/Microsoft.VSTS.Common.Priority', value: PRIORITY[patch.priority.toUpperCase()] ?? 2 });
    const wi = await ctx.http.json({
      method: 'PATCH',
      url: `${this.projectUrl(ctx, externalProjectId)}/_apis/wit/workitems/${encodeURIComponent(externalId)}?api-version=7.1`,
      headers: { ...this.headers(ctx), 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify(ops),
    });
    return this.toState(ctx, wi, externalProjectId);
  }

  async addComment(
    ctx: ConnectorContext<AzureDevOpsConfig, AzureDevOpsCredentials>,
    externalId: string,
    text: string,
    externalProjectId?: string
  ) {
    await ctx.http.request({
      method: 'POST',
      url: `${this.projectUrl(ctx, externalProjectId)}/_apis/wit/workItems/${encodeURIComponent(externalId)}/comments?api-version=7.1-preview.4`,
      headers: { ...this.headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: escapeHtml(text) }),
    });
  }
}
