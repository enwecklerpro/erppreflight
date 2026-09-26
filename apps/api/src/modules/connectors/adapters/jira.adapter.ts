import {
  ConnectorContext,
  ConnectionTestResult,
  ExternalWorkItemState,
  StatusCategory,
  WorkItemAdapter,
  WorkItemInput,
  WorkItemPatch,
  basicAuth,
  joinUrl,
} from './adapter.types';
import { CONNECTOR_DEFINITIONS } from '../connector-registry';

/**
 * Jira Cloud REST API v3 (C §34):
 *   GET  /rest/api/3/myself                         credential check
 *   GET  /rest/api/3/project/{key}                  project check
 *   POST /rest/api/3/issue                          create (ADF description)
 *   GET  /rest/api/3/issue/{key}?fields=...         status sync
 *   PUT  /rest/api/3/issue/{key}                    update (204)
 *   POST /rest/api/3/issue/{key}/comment            comment (ADF)
 *   POST /rest/api/3/issue/{key}/remotelink         link back to ERP Preflight
 */

export interface JiraConfig {
  baseUrl: string;
  projectKey: string;
  issueType: string;
}
export interface JiraCredentials {
  email: string;
  apiToken: string;
}

const PRIORITY: Record<string, string> = {
  BLOCKER: 'Highest',
  CRITICAL: 'High',
  MAJOR: 'Medium',
  MEDIUM: 'Medium',
  MINOR: 'Low',
  LOW: 'Low',
  INFO: 'Lowest',
};

export function jiraStatusCategory(key: string | undefined): StatusCategory {
  switch (key) {
    case 'new':
      return 'OPEN';
    case 'indeterminate':
      return 'IN_PROGRESS';
    case 'done':
      return 'DONE';
    default:
      return 'UNKNOWN';
  }
}

/** Plain text → Atlassian Document Format (one paragraph per line). */
export function toAdf(text: string) {
  const paragraphs = text
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => line !== '' || (idx > 0 && arr[idx - 1] !== ''));
  return {
    version: 1,
    type: 'doc',
    content: paragraphs.map((line) =>
      line === '' ? { type: 'paragraph', content: [] } : { type: 'paragraph', content: [{ type: 'text', text: line }] }
    ),
  };
}

export class JiraAdapter implements WorkItemAdapter {
  readonly type = 'JIRA' as const;

  private headers(ctx: ConnectorContext<JiraConfig, JiraCredentials>) {
    return {
      Authorization: basicAuth(ctx.credentials.email, ctx.credentials.apiToken),
      Accept: 'application/json',
    };
  }

  private toState(ctx: ConnectorContext<JiraConfig>, issue: any): ExternalWorkItemState {
    const key = String(issue.key);
    return {
      externalId: String(issue.id ?? key),
      key,
      url: joinUrl(ctx.config.baseUrl, `/browse/${key}`),
      status: issue.fields?.status?.name ?? 'UNKNOWN',
      statusCategory: jiraStatusCategory(issue.fields?.status?.statusCategory?.key),
      version: issue.fields?.updated,
      remoteModifiedAt: issue.fields?.updated,
      assignee: issue.fields?.assignee?.accountId ?? null,
      title: issue.fields?.summary,
    };
  }

  async testConnection(ctx: ConnectorContext<JiraConfig, JiraCredentials>): Promise<ConnectionTestResult> {
    const started = Date.now();
    const me = await ctx.http.json({ url: joinUrl(ctx.config.baseUrl, '/rest/api/3/myself'), headers: this.headers(ctx) });
    const project = await ctx.http.json({
      url: joinUrl(ctx.config.baseUrl, `/rest/api/3/project/${encodeURIComponent(ctx.config.projectKey)}`),
      headers: this.headers(ctx),
    });
    const def = CONNECTOR_DEFINITIONS.JIRA;
    return {
      ok: true,
      message: `Authenticated as ${me?.displayName ?? me?.emailAddress ?? 'API user'}; project ${project?.key} (${project?.name}) is accessible`,
      latencyMs: Date.now() - started,
      capabilities: {
        product: 'Jira Cloud',
        protocol: 'REST API v3',
        availableApis: ['/rest/api/3/issue', '/rest/api/3/project'],
        grantedScopes: ['read:jira-work', 'read:jira-user'],
        readable: def.canRead,
        notAccessible: def.cannotAccess,
        canWrite: false,
        supportedEngines: [],
        details: { projectKey: project?.key, projectName: project?.name },
      },
    };
  }

  async createWorkItem(ctx: ConnectorContext<JiraConfig, JiraCredentials>, input: WorkItemInput) {
    const projectKey = input.externalProjectId || ctx.config.projectKey;
    const created = await ctx.http.json({
      method: 'POST',
      url: joinUrl(ctx.config.baseUrl, '/rest/api/3/issue'),
      headers: { ...this.headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: input.title.slice(0, 255),
          issuetype: { name: ctx.config.issueType || 'Task' },
          priority: { name: PRIORITY[input.severity.toUpperCase()] ?? 'Medium' },
          labels: input.labels.map((l) => l.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 255)),
          description: toAdf(input.body),
          ...(input.dueDate ? { duedate: input.dueDate } : {}),
        },
      }),
    });
    if (!created?.key) throw new Error('Jira did not return an issue key');
    await ctx.http
      .request({
        method: 'POST',
        url: joinUrl(ctx.config.baseUrl, `/rest/api/3/issue/${encodeURIComponent(created.key)}/remotelink`),
        headers: { ...this.headers(ctx), 'Content-Type': 'application/json' },
        body: JSON.stringify({ object: { url: input.findingUrl, title: 'ERP Preflight finding' } }),
      })
      .catch(() => undefined);
    return this.getWorkItem(ctx, created.key);
  }

  async getWorkItem(ctx: ConnectorContext<JiraConfig, JiraCredentials>, externalId: string) {
    const issue = await ctx.http.json({
      url: joinUrl(
        ctx.config.baseUrl,
        `/rest/api/3/issue/${encodeURIComponent(externalId)}?fields=status,updated,assignee,summary`
      ),
      headers: this.headers(ctx),
    });
    return this.toState(ctx, issue);
  }

  async updateWorkItem(ctx: ConnectorContext<JiraConfig, JiraCredentials>, externalId: string, patch: WorkItemPatch) {
    const fields: Record<string, unknown> = {};
    if (patch.title) fields.summary = patch.title.slice(0, 255);
    if (patch.body) fields.description = toAdf(patch.body);
    if (patch.priority) fields.priority = { name: PRIORITY[patch.priority.toUpperCase()] ?? 'Medium' };
    await ctx.http.request({
      method: 'PUT',
      url: joinUrl(ctx.config.baseUrl, `/rest/api/3/issue/${encodeURIComponent(externalId)}`),
      headers: { ...this.headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    return this.getWorkItem(ctx, externalId);
  }

  async addComment(ctx: ConnectorContext<JiraConfig, JiraCredentials>, externalId: string, text: string) {
    await ctx.http.request({
      method: 'POST',
      url: joinUrl(ctx.config.baseUrl, `/rest/api/3/issue/${encodeURIComponent(externalId)}/comment`),
      headers: { ...this.headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: toAdf(text) }),
    });
  }
}
