import type { ConnectorAttemptInfo } from '../connector-http';
import type { ConnectorHttp } from '../connector-http';
import type { ConnectorType } from '../connector-registry';

export interface ConnectorContext<C = any, S = any> {
  organizationId: string;
  connectorId: string;
  type: ConnectorType;
  config: C;
  credentials: S;
  http: ConnectorHttp;
  /**
   * Records an outbound request made outside `http` (e.g. the git CLI clone) for usage
   * metering. Optional: absent in unit tests.
   */
  recordOutbound?: (info: ConnectorAttemptInfo) => Promise<void>;
}

/** Result of the capability handshake (Part 18.1). */
export interface CapabilityHandshake {
  product?: string;
  edition?: string;
  release?: string;
  protocol: string;
  availableApis: string[];
  grantedScopes: string[];
  readable: string[];
  notAccessible: string[];
  canWrite: boolean;
  supportedEngines: string[];
  details?: Record<string, unknown>;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  httpStatus?: number;
  latencyMs?: number;
  capabilities?: CapabilityHandshake;
}

export type StatusCategory = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'UNKNOWN';

export interface WorkItemInput {
  title: string;
  /** Plain-text / markdown body built by the finding-to-task workflow (Part 15.8). */
  body: string;
  severity: string;
  labels: string[];
  findingUrl: string;
  externalProjectId?: string;
  assignee?: string;
  dueDate?: string;
}

export interface ExternalWorkItemState {
  externalId: string;
  key?: string;
  url?: string;
  status: string;
  statusCategory: StatusCategory;
  /** Remote concurrency token (etag / rev / modified timestamp). */
  version?: string;
  remoteModifiedAt?: string;
  assignee?: string | null;
  title?: string;
}

export interface WorkItemPatch {
  title?: string;
  body?: string;
  priority?: string;
}

export interface ConnectorAdapter {
  readonly type: ConnectorType;
  testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult>;
}

export interface WorkItemAdapter extends ConnectorAdapter {
  createWorkItem(ctx: ConnectorContext, input: WorkItemInput): Promise<ExternalWorkItemState>;
  getWorkItem(ctx: ConnectorContext, externalId: string, externalProjectId?: string): Promise<ExternalWorkItemState>;
  updateWorkItem(ctx: ConnectorContext, externalId: string, patch: WorkItemPatch, externalProjectId?: string): Promise<ExternalWorkItemState>;
  addComment(ctx: ConnectorContext, externalId: string, text: string, externalProjectId?: string): Promise<void>;
}

export function isWorkItemAdapter(a: ConnectorAdapter): a is WorkItemAdapter {
  return typeof (a as WorkItemAdapter).createWorkItem === 'function';
}

export const SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO'];

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function basicAuth(user: string, secret: string): string {
  return `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;
}
