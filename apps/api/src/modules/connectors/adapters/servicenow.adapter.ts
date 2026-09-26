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
 * ServiceNow Table API (C §34):
 *   GET   /api/now/table/{table}?sysparm_limit=1                         access check
 *   POST  /api/now/table/{table}                                          create record
 *   GET   /api/now/table/{table}/{sys_id}?sysparm_display_value=all       status sync
 *   PATCH /api/now/table/{table}/{sys_id}                                 update / work notes
 * Responses are wrapped in `{ "result": ... }`.
 */

export interface ServiceNowConfig {
  instanceUrl: string;
  table: string;
  assignmentGroup?: string;
}
export interface ServiceNowCredentials {
  username?: string;
  password?: string;
  oauthToken?: string;
}

// incident urgency/impact: 1 = High, 2 = Medium, 3 = Low
const URGENCY: Record<string, string> = { BLOCKER: '1', CRITICAL: '1', MAJOR: '2', MEDIUM: '2', MINOR: '3', LOW: '3', INFO: '3' };

/** Maps incident/task `state` (value or display value) to a status category. */
export function serviceNowStateCategory(state: string | undefined, display?: string): StatusCategory {
  const d = String(display || '').toLowerCase();
  if (d) {
    if (/(resolved|closed|complete|cancel)/.test(d)) return 'DONE';
    if (/(progress|hold|work)/.test(d)) return 'IN_PROGRESS';
    if (/(new|open|pending)/.test(d)) return 'OPEN';
  }
  switch (String(state ?? '')) {
    case '1':
      return 'OPEN';
    case '2':
    case '3':
      return 'IN_PROGRESS';
    case '6':
    case '7':
    case '8':
      return 'DONE';
    default:
      return 'UNKNOWN';
  }
}

const field = (v: any): string | undefined => (v && typeof v === 'object' ? v.value : v);
const display = (v: any): string | undefined => (v && typeof v === 'object' ? v.display_value : undefined);

export class ServiceNowAdapter implements WorkItemAdapter {
  readonly type = 'SERVICENOW' as const;

  private headers(ctx: ConnectorContext<ServiceNowConfig, ServiceNowCredentials>) {
    const auth = ctx.credentials.oauthToken
      ? `Bearer ${ctx.credentials.oauthToken}`
      : basicAuth(ctx.credentials.username || '', ctx.credentials.password || '');
    return { Authorization: auth, Accept: 'application/json' };
  }

  private tableUrl(ctx: ConnectorContext<ServiceNowConfig>, suffix = '') {
    return joinUrl(ctx.config.instanceUrl, `/api/now/table/${encodeURIComponent(ctx.config.table)}${suffix}`);
  }

  private toState(ctx: ConnectorContext<ServiceNowConfig>, r: any): ExternalWorkItemState {
    const sysId = String(field(r.sys_id));
    return {
      externalId: sysId,
      key: field(r.number),
      url: joinUrl(ctx.config.instanceUrl, `/nav_to.do?uri=${encodeURIComponent(`${ctx.config.table}.do?sys_id=${sysId}`)}`),
      status: display(r.state) ?? String(field(r.state) ?? 'UNKNOWN'),
      statusCategory: serviceNowStateCategory(field(r.state), display(r.state)),
      version: field(r.sys_mod_count) !== undefined ? String(field(r.sys_mod_count)) : field(r.sys_updated_on),
      remoteModifiedAt: field(r.sys_updated_on),
      assignee: field(r.assigned_to) || null,
      title: field(r.short_description),
    };
  }

  async testConnection(ctx: ConnectorContext<ServiceNowConfig, ServiceNowCredentials>): Promise<ConnectionTestResult> {
    const started = Date.now();
    await ctx.http.json({ url: this.tableUrl(ctx, '?sysparm_limit=1&sysparm_fields=sys_id'), headers: this.headers(ctx) });
    const def = CONNECTOR_DEFINITIONS.SERVICENOW;
    return {
      ok: true,
      message: `Table API reachable; read access to '${ctx.config.table}' confirmed`,
      latencyMs: Date.now() - started,
      capabilities: {
        product: 'ServiceNow',
        protocol: 'Table API (REST)',
        availableApis: [`/api/now/table/${ctx.config.table}`],
        grantedScopes: [`${ctx.config.table}: read`],
        readable: def.canRead,
        notAccessible: def.cannotAccess,
        canWrite: false,
        supportedEngines: [],
      },
    };
  }

  async createWorkItem(ctx: ConnectorContext<ServiceNowConfig, ServiceNowCredentials>, input: WorkItemInput) {
    const urgency = URGENCY[input.severity.toUpperCase()] ?? '2';
    const body: Record<string, unknown> = {
      short_description: input.title.slice(0, 160),
      description: input.body,
      urgency,
      impact: urgency,
      correlation_display: 'ERP Preflight',
      correlation_id: input.findingUrl.slice(-100),
    };
    if (ctx.config.assignmentGroup) body.assignment_group = ctx.config.assignmentGroup;
    const res = await ctx.http.json({
      method: 'POST',
      url: this.tableUrl(ctx, '?sysparm_display_value=all'),
      headers: { ...this.headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!field(res?.result?.sys_id)) throw new Error('ServiceNow did not return a sys_id');
    return this.toState(ctx, res.result);
  }

  async getWorkItem(ctx: ConnectorContext<ServiceNowConfig, ServiceNowCredentials>, externalId: string) {
    const res = await ctx.http.json({
      url: this.tableUrl(ctx, `/${encodeURIComponent(externalId)}?sysparm_display_value=all`),
      headers: this.headers(ctx),
    });
    return this.toState(ctx, res.result);
  }

  async updateWorkItem(ctx: ConnectorContext<ServiceNowConfig, ServiceNowCredentials>, externalId: string, patch: WorkItemPatch) {
    const body: Record<string, unknown> = {};
    if (patch.title) body.short_description = patch.title.slice(0, 160);
    if (patch.body) body.description = patch.body;
    if (patch.priority) {
      const u = URGENCY[patch.priority.toUpperCase()] ?? '2';
      body.urgency = u;
      body.impact = u;
    }
    const res = await ctx.http.json({
      method: 'PATCH',
      url: this.tableUrl(ctx, `/${encodeURIComponent(externalId)}?sysparm_display_value=all`),
      headers: { ...this.headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.toState(ctx, res.result);
  }

  async addComment(ctx: ConnectorContext<ServiceNowConfig, ServiceNowCredentials>, externalId: string, text: string) {
    await ctx.http.request({
      method: 'PATCH',
      url: this.tableUrl(ctx, `/${encodeURIComponent(externalId)}`),
      headers: { ...this.headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_notes: text }),
    });
  }
}
