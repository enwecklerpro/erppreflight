import { ConnectorAdapter, ConnectorContext, ConnectionTestResult } from './adapter.types';
import { CloudAlmAdapter } from './cloud-alm.adapter';
import { JiraAdapter } from './jira.adapter';
import { AzureDevOpsAdapter } from './azure-devops.adapter';
import { ServiceNowAdapter } from './servicenow.adapter';
import { HttpOpenApiAdapter, ODataAdapter } from './metadata.adapters';
import { GitAdapter } from './git.adapter';
import { CONNECTOR_DEFINITIONS, ConnectorType } from '../connector-registry';

/** File-only mode: there is no remote system, so there is nothing to probe. */
class FileAdapter implements ConnectorAdapter {
  readonly type = 'FILE' as const;
  async testConnection(): Promise<ConnectionTestResult> {
    const def = CONNECTOR_DEFINITIONS.FILE;
    return {
      ok: true,
      message: 'File-only mode: no outbound connection is made; artifacts are uploaded manually',
      capabilities: {
        protocol: 'manual upload',
        availableApis: [],
        grantedScopes: [],
        readable: def.canRead,
        notAccessible: def.cannotAccess,
        canWrite: false,
        supportedEngines: def.supportedEngines,
      },
    };
  }
}

/**
 * Local agents connect outbound to the API; health is driven by heartbeats
 * (see AgentDevicesService), so a connection test reports the heartbeat state.
 */
class LocalAgentAdapter implements ConnectorAdapter {
  readonly type = 'LOCAL_AGENT' as const;
  constructor(private readonly heartbeatLookup: (ctx: ConnectorContext) => Promise<{ lastSeenAt: Date | null; status: string } | null>) {}
  async testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult> {
    const def = CONNECTOR_DEFINITIONS.LOCAL_AGENT;
    const hb = await this.heartbeatLookup(ctx);
    const staleMs = Number(process.env.AGENT_HEARTBEAT_STALE_MS || 5 * 60_000);
    const fresh = Boolean(hb?.lastSeenAt && Date.now() - hb.lastSeenAt.getTime() < staleMs && hb.status === 'ACTIVE');
    return {
      ok: fresh,
      message: !hb
        ? 'Device not found'
        : hb.status !== 'ACTIVE'
          ? `Device is ${hb.status}`
          : hb.lastSeenAt
            ? `Last heartbeat ${Math.round((Date.now() - hb.lastSeenAt.getTime()) / 1000)}s ago`
            : 'No heartbeat received yet',
      capabilities: {
        protocol: 'outbound HTTPS polling (signed jobs)',
        availableApis: [],
        grantedScopes: [],
        readable: def.canRead,
        notAccessible: def.cannotAccess,
        canWrite: false,
        supportedEngines: def.supportedEngines,
      },
    };
  }
}

export function createAdapterRegistry(
  heartbeatLookup: (ctx: ConnectorContext) => Promise<{ lastSeenAt: Date | null; status: string } | null>
): Record<ConnectorType, ConnectorAdapter> {
  return {
    HTTP_OPENAPI: new HttpOpenApiAdapter(),
    ODATA: new ODataAdapter(),
    SAP_CLOUD_ALM: new CloudAlmAdapter(),
    JIRA: new JiraAdapter(),
    AZURE_DEVOPS: new AzureDevOpsAdapter(),
    SERVICENOW: new ServiceNowAdapter(),
    GIT: new GitAdapter(),
    FILE: new FileAdapter(),
    LOCAL_AGENT: new LocalAgentAdapter(heartbeatLookup),
  };
}

export * from './adapter.types';
export { CloudAlmAdapter } from './cloud-alm.adapter';
export { JiraAdapter } from './jira.adapter';
export { AzureDevOpsAdapter } from './azure-devops.adapter';
export { ServiceNowAdapter } from './servicenow.adapter';
export { HttpOpenApiAdapter, ODataAdapter } from './metadata.adapters';
export { GitAdapter } from './git.adapter';
