/**
 * Typed client for the enterprise integration APIs (connectors, work items,
 * webhooks, local agents, SSO/SCIM, partner mode). Responses that drive UI
 * decisions are validated with Zod at runtime.
 */
import { z } from 'zod';
import { customInstance } from './custom-instance';

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------
export const ConnectorHealthSchema = z.object({
  status: z.enum(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY']),
  lastCheckedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number(),
  circuitState: z.enum(['CLOSED', 'OPEN', 'HALF_OPEN']),
  circuitOpenedAt: z.string().nullable(),
});

export const ConnectorSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  name: z.string(),
  config: z.record(z.unknown()),
  accessMode: z.enum(['READ_ONLY', 'READ_WRITE']),
  status: z.enum(['ACTIVE', 'DISABLED']),
  hasCredentials: z.boolean(),
  credentialsKeyId: z.string().nullable(),
  credentialsRotationDue: z.boolean(),
  health: ConnectorHealthSchema,
  capabilities: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Connector = z.infer<typeof ConnectorSchema>;

export interface FieldSpec {
  name: string;
  kind: 'string' | 'number' | 'enum';
  required: boolean;
  defaultValue?: unknown;
  options?: string[];
}

export interface ConnectorTypeSpec {
  type: string;
  displayName: string;
  category: string;
  description: string;
  scopes: Array<{ scope: string; why: string; access: 'READ' | 'WRITE'; optional: boolean }>;
  writeActions: Array<{ action: string; targetObject: string; riskClass: string; reversible: boolean; dryRunSupported: boolean }>;
  canRead: string[];
  cannotAccess: string[];
  supportedEngines: string[];
  workItems: boolean;
  systemManaged: boolean;
  configFields: FieldSpec[];
  credentialFields: FieldSpec[];
}

export const fetchConnectorTypes = () => customInstance<ConnectorTypeSpec[]>('/connectors/types');
export const fetchConnectors = async () => z.array(ConnectorSchema).parse(await customInstance<unknown>('/connectors'));
export const createConnector = (body: { type: string; name: string; config: Record<string, unknown>; credentials?: Record<string, unknown>; accessMode: string }) =>
  customInstance<Connector>('/connectors', json('POST', body));
export const updateConnector = (id: string, body: Record<string, unknown>) =>
  customInstance<{ connector: Connector; permissionDiff: any }>(`/connectors/${id}`, json('PATCH', body));
export const deleteConnector = (id: string) => customInstance<{ success: boolean }>(`/connectors/${id}`, { method: 'DELETE' });
export interface ConnectionTest {
  ok: boolean;
  message: string;
  latencyMs?: number;
  capabilities?: { readable?: string[]; notAccessible?: string[]; protocol?: string; product?: string; canWrite?: boolean; grantedScopes?: string[] };
  connector: Connector;
}
export const testConnector = (id: string) => customInstance<ConnectionTest>(`/connectors/${id}/test`, { method: 'POST' });
export interface SyncLogEntry {
  id: string;
  operation: string;
  objectType: string | null;
  objectRef: string | null;
  outcome: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'CONFLICT' | 'BLOCKED';
  httpStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}
export const fetchSyncLog = (id: string) => customInstance<SyncLogEntry[]>(`/connectors/${id}/sync-log?limit=25`);
export const fetchMetadataSnapshot = (id: string) => customInstance<any>(`/connectors/${id}/metadata`, { method: 'POST' });
export const gitSnapshot = (id: string) => customInstance<any>(`/connectors/${id}/git/snapshot`, { method: 'POST' });

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------
export const WorkItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  findingId: z.string().uuid().nullable(),
  connectorId: z.string().uuid(),
  connectorName: z.string().optional(),
  externalSystem: z.string(),
  externalId: z.string(),
  externalKey: z.string().nullable(),
  externalUrl: z.string().nullable(),
  externalStatus: z.string().nullable(),
  statusCategory: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'UNKNOWN']),
  remediationState: z.enum(['OPEN', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'VERIFIED_RESOLVED']),
  conflictState: z.enum(['NONE', 'CONFLICT', 'RESOLVED']),
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const fetchWorkItems = async (params: { projectId?: string; findingId?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][]).toString();
  return z.array(WorkItemSchema).parse(await customInstance<unknown>(`/connectors/work-items${qs ? `?${qs}` : ''}`));
};
export interface WorkItemPreview {
  dryRun: true;
  connector: { id: string; name: string; type: string; accessMode: string };
  preview: { title: string; body: string; severity: string; externalProjectId: string | null };
}
export const previewWorkItem = (findingId: string, connectorId: string) =>
  customInstance<WorkItemPreview | { alreadyLinked: true; workItem: WorkItem }>('/connectors/work-items', json('POST', { findingId, connectorId, dryRun: true }));
export const createWorkItem = (findingId: string, connectorId: string) =>
  customInstance<{ created: boolean; alreadyLinked?: boolean; workItem: WorkItem }>('/connectors/work-items', json('POST', { findingId, connectorId, confirm: true }));
export const syncWorkItem = (id: string) => customInstance<WorkItem>(`/connectors/work-items/${id}/sync`, { method: 'POST' });
export const resolveWorkItemConflict = (id: string, resolution: 'ACCEPT_REMOTE' | 'OVERWRITE_REMOTE') =>
  customInstance<WorkItem>(`/connectors/work-items/${id}/resolve-conflict`, json('POST', { resolution, confirm: resolution === 'OVERWRITE_REMOTE' }));

// ---------------------------------------------------------------------------
// Traceability (Part 15.1 / 15.18)
// ---------------------------------------------------------------------------
export interface TraceabilityNode {
  id: string;
  processHierarchy: string;
  requirementId: string;
  requirementTitle: string;
  findingId: string | null;
  findingTitle: string | null;
  findingSeverity: string | null;
  findingRuleId: string | null;
  remediationTaskId: string | null;
  taskStatus: string;
  testCaseId: string | null;
  testTitle: string | null;
  testStatus: string | null;
  transportId: string | null;
  releaseId: string;
  businessCriticality: string;
  externalSystem: string;
}
export interface TraceabilityMatrix {
  nodes: TraceabilityNode[];
  workItems: WorkItem[];
  summary: {
    totalRequirements: number;
    requirementsWithoutTests: number;
    requirementsWithFindings: number;
    criticalFindingsInLatestRun: number;
    criticalFindingsWithoutTasks: number;
    workItemsTotal: number;
    workItemsPendingVerification: number;
    workItemsVerifiedResolved: number;
    workItemsInConflict: number;
    remediationVerifiedPercent: number | null;
  };
}
export const fetchTraceability = (projectId: string) => customInstance<TraceabilityMatrix>(`/projects/${projectId}/traceability`);
export const importRequirements = (projectId: string, connectorId: string) =>
  customInstance<{ imported: number; created: number; updated: number; externalProjectId: string }>(
    `/projects/${projectId}/traceability/requirements/import`,
    json('POST', { connectorId })
  );
export const linkProjectToCloudAlm = (connectorId: string, projectId: string, externalProjectId: string) =>
  customInstance<unknown>(`/connectors/${connectorId}/project-links`, json('POST', { projectId, externalProjectId, syncDirection: 'BIDIRECTIONAL' }));
export const fetchCloudAlmProjects = (connectorId: string) => customInstance<Array<{ id: string; name: string }>>(`/connectors/${connectorId}/cloud-alm/projects`);
export const fetchProjectLinks = (connectorId: string) =>
  customInstance<Array<{ id: string; projectId: string; projectName: string; externalProjectId: string; syncDirection: string }>>(`/connectors/${connectorId}/project-links`);

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  status: string;
  failure_count: number;
  last_triggered_at: string | null;
  delivered: number;
  failed: number;
}
export interface WebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DEAD';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  replayOf: string | null;
  createdAt: string;
  deliveredAt: string | null;
}
export const fetchWebhooksWithStats = () => customInstance<WebhookRow[]>('/webhooks');
export const fetchWebhookEvents = () => customInstance<Array<{ type: string; description: string; payloadFields: string[] }>>('/webhooks/events');
export const fetchDeliveries = (webhookId: string) => customInstance<WebhookDelivery[]>(`/webhooks/${webhookId}/deliveries?limit=50`);
export const replayDelivery = (webhookId: string, deliveryId: string) =>
  customInstance<{ status: string; httpStatus?: number; error?: string }>(`/webhooks/${webhookId}/deliveries/${deliveryId}/replay`, { method: 'POST' });
export const rotateWebhookSecret = (webhookId: string) => customInstance<{ id: string; secret: string }>(`/webhooks/${webhookId}/rotate-secret`, { method: 'POST' });
export const setWebhookStatus = (webhookId: string, status: 'ACTIVE' | 'DISABLED') =>
  customInstance<{ id: string; status: string }>(`/webhooks/${webhookId}`, json('PATCH', { status }));

// ---------------------------------------------------------------------------
// Local agents
// ---------------------------------------------------------------------------
export interface AgentDevice {
  id: string;
  name: string;
  hostname: string | null;
  status: 'ACTIVE' | 'REVOKED';
  agentVersion: string | null;
  platform: string | null;
  updateChannel: string;
  egressPolicy: { redactSecrets: boolean; uploadRawFiles: boolean };
  publicKeyFingerprint: string;
  connectorId: string | null;
  lastSeenAt: string | null;
  enrolledAt: string;
  revokedAt: string | null;
}
export interface AgentJob {
  id: string;
  type: 'SCAN_DIRECTORY' | 'PROBE_URL';
  payload: Record<string, unknown>;
  status: string;
  result: any;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
export const fetchDevices = () => customInstance<AgentDevice[]>('/agents/devices');
export const issueEnrollmentToken = (label: string, ttlMinutes: number) =>
  customInstance<{ id: string; enrollmentToken: string; expiresAt: string }>('/agents/enrollment-tokens', json('POST', { label, ttlMinutes }));
export const revokeDevice = (id: string) => customInstance<AgentDevice>(`/agents/devices/${id}/revoke`, { method: 'POST' });
export const updateDevicePolicy = (id: string, uploadRawFiles: boolean) =>
  customInstance<AgentDevice>(`/agents/devices/${id}`, json('PATCH', { egressPolicy: { redactSecrets: true, uploadRawFiles } }));
export const fetchDeviceJobs = (id: string) => customInstance<AgentJob[]>(`/agents/devices/${id}/jobs`);
export const createDeviceJob = (id: string, body: { type: 'SCAN_DIRECTORY'; payload: { directory: string; projectId?: string } } | { type: 'PROBE_URL'; payload: { url: string } }) =>
  customInstance<{ id: string; status: string }>(`/agents/devices/${id}/jobs`, json('POST', body));

// ---------------------------------------------------------------------------
// Enterprise identity
// ---------------------------------------------------------------------------
export interface SsoConfig {
  provider: null | {
    issuer: string;
    clientId: string;
    hasClientSecret: boolean;
    scopes: string;
    jitProvisioning: boolean;
    defaultRole: string;
    enforceSso: boolean;
    status: string;
    discovery: { issuer: string; authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string } | null;
  };
  redirectUri: string;
}
export interface SsoDomain {
  id: string;
  domain: string;
  status: 'PENDING' | 'VERIFIED' | 'FAILED';
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  dnsRecord: { type: 'TXT'; name: string; value: string };
}
export const fetchSsoConfig = () => customInstance<SsoConfig>('/sso/admin/config');
export const saveSsoConfig = (body: Record<string, unknown>) => customInstance<SsoConfig>('/sso/admin/config', json('PUT', body));
export const fetchSsoDomains = () => customInstance<SsoDomain[]>('/sso/admin/domains');
export const addSsoDomain = (domain: string) => customInstance<SsoDomain>('/sso/admin/domains', json('POST', { domain }));
export const verifySsoDomain = (id: string) => customInstance<SsoDomain & { verified: boolean; lookupError: string | null }>(`/sso/admin/domains/${id}/verify`, { method: 'POST' });
export const removeSsoDomain = (id: string) => customInstance<{ success: boolean }>(`/sso/admin/domains/${id}`, { method: 'DELETE' });
export const fetchScimTokens = () => customInstance<Array<{ id: string; name: string; prefix: string; status: string; last_used_at: string | null; created_at: string }>>('/sso/admin/scim-tokens');
export const createScimToken = (name: string) => customInstance<{ id: string; token: string; prefix: string }>('/sso/admin/scim-tokens', json('POST', { name }));
export const revokeScimToken = (id: string) => customInstance<{ success: boolean }>(`/sso/admin/scim-tokens/${id}`, { method: 'DELETE' });
export const discoverSso = (email: string) =>
  customInstance<{ ssoAvailable: boolean; organizationName?: string; loginUrl?: string }>(`/sso/discover?email=${encodeURIComponent(email)}`);

// ---------------------------------------------------------------------------
// Partner mode
// ---------------------------------------------------------------------------
export interface PartnerGrant {
  id: string;
  customerOrganizationId: string;
  customerOrganizationName: string;
  partnerOrganizationId: string;
  partnerOrganizationName: string;
  accessRole: 'VIEWER' | 'ANALYST' | 'PROJECT_ADMIN';
  effectiveTenantRole: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  reason: string;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
}
export const fetchGrantsGiven = () => customInstance<PartnerGrant[]>('/partners/grants');
export const fetchPartnerClients = () => customInstance<PartnerGrant[]>('/partners/clients');
export const createGrant = (body: { partnerOrganizationSlug: string; accessRole: string; expiresInDays: number; reason: string }) =>
  customInstance<PartnerGrant>('/partners/grants', json('POST', body));
export const fetchCurrentOrganization = () =>
  customInstance<{ id: string; name: string; slug: string; plan_tier: string }>('/organizations/current');
export const revokeGrant = (id: string) => customInstance<{ success: boolean }>(`/partners/grants/${id}/revoke`, { method: 'POST' });
