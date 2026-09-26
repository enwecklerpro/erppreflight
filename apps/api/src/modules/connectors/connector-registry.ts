import { z } from 'zod';

/**
 * Connector registry (Part 03 §3.11, Part 18.1/18.2/18.5, C §35).
 *
 * Every connector type declares:
 *  - a typed, Zod-validated non-secret configuration schema,
 *  - a typed, Zod-validated credential schema (stored only encrypted),
 *  - the exact permissions/scopes it needs and why (least-privilege wizard),
 *  - every external WRITE action it can perform (write action registry — an
 *    action that is not declared here is refused by the connector service),
 *  - what ERP Preflight can and cannot read through it.
 */

export const CONNECTOR_TYPES = [
  'HTTP_OPENAPI',
  'ODATA',
  'SAP_CLOUD_ALM',
  'JIRA',
  'AZURE_DEVOPS',
  'SERVICENOW',
  'GIT',
  'FILE',
  'LOCAL_AGENT',
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export const WORK_ITEM_CONNECTOR_TYPES: ConnectorType[] = ['SAP_CLOUD_ALM', 'JIRA', 'AZURE_DEVOPS', 'SERVICENOW'];

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), 'Must be an http(s) URL');

const httpsUrl = httpUrl.refine(
  (v) => process.env.NODE_ENV !== 'production' || v.toLowerCase().startsWith('https://'),
  'Must use https in production'
);

const shortText = (max = 200) => z.string().trim().min(1).max(max);

export interface ScopeRequirement {
  scope: string;
  why: string;
  access: 'READ' | 'WRITE';
  optional: boolean;
}

export interface WriteActionDefinition {
  action: string;
  targetObject: string;
  requiredAccessMode: 'READ_WRITE';
  reversible: boolean;
  dryRunSupported: boolean;
  approvalPolicy: 'EXPLICIT_USER_CONFIRMATION';
  riskClass: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ConnectorDefinition {
  type: ConnectorType;
  displayName: string;
  category: 'SAP' | 'WORK_MANAGEMENT' | 'SOURCE' | 'GENERIC' | 'AGENT';
  description: string;
  configSchema: z.ZodTypeAny;
  credentialsSchema: z.ZodTypeAny;
  scopes: ScopeRequirement[];
  writeActions: WriteActionDefinition[];
  canRead: string[];
  cannotAccess: string[];
  supportedEngines: string[];
  workItems: boolean;
  /** Created by the platform (e.g. on local agent enrollment), not via the create API. */
  systemManaged?: boolean;
}

const WORK_ITEM_WRITE_ACTIONS = (target: string): WriteActionDefinition[] => [
  {
    action: 'work_item.create',
    targetObject: target,
    requiredAccessMode: 'READ_WRITE',
    reversible: false,
    dryRunSupported: true,
    approvalPolicy: 'EXPLICIT_USER_CONFIRMATION',
    riskClass: 'LOW',
  },
  {
    action: 'work_item.update',
    targetObject: target,
    requiredAccessMode: 'READ_WRITE',
    reversible: true,
    dryRunSupported: false,
    approvalPolicy: 'EXPLICIT_USER_CONFIRMATION',
    riskClass: 'MEDIUM',
  },
  {
    action: 'work_item.comment',
    targetObject: `${target} comment`,
    requiredAccessMode: 'READ_WRITE',
    reversible: false,
    dryRunSupported: false,
    approvalPolicy: 'EXPLICIT_USER_CONFIRMATION',
    riskClass: 'LOW',
  },
];

export const HttpOpenApiConfigSchema = z
  .object({
    baseUrl: httpsUrl,
    healthPath: z.string().trim().max(500).startsWith('/').default('/'),
    openApiPath: z.string().trim().max(500).startsWith('/').optional(),
    authType: z.enum(['NONE', 'BEARER', 'BASIC', 'API_KEY_HEADER']).default('NONE'),
    apiKeyHeader: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,64}$/)
      .optional(),
  })
  .strict();

export const HttpCredentialsSchema = z
  .object({
    token: z.string().min(1).max(4096).optional(),
    username: z.string().min(1).max(256).optional(),
    password: z.string().min(1).max(1024).optional(),
    apiKey: z.string().min(1).max(4096).optional(),
  })
  .strict();

export const ODataConfigSchema = z
  .object({
    serviceRootUrl: httpsUrl,
    odataVersion: z.enum(['AUTO', 'V2', 'V4']).default('AUTO'),
    sapClient: z
      .string()
      .regex(/^\d{3}$/)
      .optional(),
    authType: z.enum(['NONE', 'BASIC', 'BEARER', 'OAUTH2_CLIENT_CREDENTIALS']).default('BASIC'),
    tokenUrl: httpsUrl.optional(),
  })
  .strict();

export const ODataCredentialsSchema = z
  .object({
    username: z.string().min(1).max(256).optional(),
    password: z.string().min(1).max(1024).optional(),
    token: z.string().min(1).max(4096).optional(),
    clientId: z.string().min(1).max(512).optional(),
    clientSecret: z.string().min(1).max(2048).optional(),
  })
  .strict();

export const CloudAlmConfigSchema = z
  .object({
    apiBaseUrl: httpsUrl,
    tokenUrl: httpsUrl,
    defaultProjectId: z.string().trim().max(255).optional(),
    taskType: z.enum(['CALMTASK', 'CALMUS', 'CALMREQU']).default('CALMTASK'),
  })
  .strict();

export const CloudAlmCredentialsSchema = z
  .object({
    clientId: z.string().min(1).max(512),
    clientSecret: z.string().min(1).max(2048),
  })
  .strict();

export const JiraConfigSchema = z
  .object({
    baseUrl: httpsUrl,
    projectKey: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Jira project keys are upper-case (e.g. SAPS4)'),
    issueType: shortText(100).default('Task'),
  })
  .strict();

export const JiraCredentialsSchema = z
  .object({
    email: z.string().trim().email().max(320),
    apiToken: z.string().min(1).max(1024),
  })
  .strict();

export const AzureDevOpsConfigSchema = z
  .object({
    baseUrl: httpsUrl.default('https://dev.azure.com'),
    organization: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
    project: shortText(128),
    workItemType: shortText(100).default('Task'),
    areaPath: z.string().trim().max(500).optional(),
  })
  .strict();

export const AzureDevOpsCredentialsSchema = z
  .object({
    personalAccessToken: z.string().min(1).max(1024),
  })
  .strict();

export const ServiceNowConfigSchema = z
  .object({
    instanceUrl: httpsUrl,
    table: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,79}$/)
      .default('incident'),
    assignmentGroup: z.string().trim().max(100).optional(),
  })
  .strict();

export const ServiceNowCredentialsSchema = z
  .object({
    username: z.string().min(1).max(256).optional(),
    password: z.string().min(1).max(1024).optional(),
    oauthToken: z.string().min(1).max(4096).optional(),
  })
  .strict()
  .refine((c) => Boolean(c.oauthToken) || Boolean(c.username && c.password), {
    message: 'Provide either username + password or an OAuth access token',
  });

export const GitConfigSchema = z
  .object({
    repositoryUrl: httpsUrl.refine((v) => v.toLowerCase().startsWith('https://') || process.env.NODE_ENV === 'test', 'Git repositories must use https'),
    branch: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._/-]{1,200}$/)
      .default('main'),
    pathFilter: z
      .string()
      .trim()
      .max(300)
      .regex(/^[A-Za-z0-9._/-]*$/)
      .default(''),
    maxRepoBytes: z.coerce
      .number()
      .int()
      .min(1024 * 1024)
      .max(500 * 1024 * 1024)
      .default(50 * 1024 * 1024),
  })
  .strict();

export const GitCredentialsSchema = z
  .object({
    username: z.string().min(1).max(256).optional(),
    token: z.string().min(1).max(4096).optional(),
  })
  .strict();

export const FileConfigSchema = z
  .object({
    description: z.string().trim().max(1000).optional(),
  })
  .strict();

export const EmptyCredentialsSchema = z.object({}).strict();

export const LocalAgentConfigSchema = z
  .object({
    deviceId: z.string().uuid(),
  })
  .strict();

export const CONNECTOR_DEFINITIONS: Record<ConnectorType, ConnectorDefinition> = {
  HTTP_OPENAPI: {
    type: 'HTTP_OPENAPI',
    displayName: 'HTTP / OpenAPI',
    category: 'GENERIC',
    description: 'Generic REST API. Reads an OpenAPI document as an API Change Guard baseline.',
    configSchema: HttpOpenApiConfigSchema,
    credentialsSchema: HttpCredentialsSchema,
    scopes: [
      { scope: 'GET <healthPath>', why: 'Connection health check', access: 'READ', optional: false },
      { scope: 'GET <openApiPath>', why: 'Read the OpenAPI contract as a baseline', access: 'READ', optional: true },
    ],
    writeActions: [],
    canRead: ['Health endpoint status', 'OpenAPI document (paths, operations, parameters)'],
    cannotAccess: ['Business data', 'Any non-GET operation'],
    supportedEngines: ['API_CHANGE_GUARD'],
    workItems: false,
  },
  ODATA: {
    type: 'ODATA',
    displayName: 'SAP OData (V2 / V4)',
    category: 'SAP',
    description: 'Reads the service $metadata document (EDMX) of an SAP OData service.',
    configSchema: ODataConfigSchema,
    credentialsSchema: ODataCredentialsSchema,
    scopes: [
      {
        scope: 'GET <serviceRoot>/$metadata',
        why: 'Normalize entity types, properties and navigation for API Change Guard baselines',
        access: 'READ',
        optional: false,
      },
      {
        scope: 'S_SERVICE (display) for the OData service',
        why: 'SAP authorization needed to read $metadata',
        access: 'READ',
        optional: false,
      },
    ],
    writeActions: [],
    canRead: ['Service metadata (EDMX): entity sets, types, keys, properties, navigation, function imports'],
    cannotAccess: ['Entity data (no entity set queries are executed)', 'Any write operation'],
    supportedEngines: ['API_CHANGE_GUARD', 'EXTENSION_IMPACT_GUARD', 'CUSTOM_FIELD_FLOW_DOCTOR'],
    workItems: false,
  },
  SAP_CLOUD_ALM: {
    type: 'SAP_CLOUD_ALM',
    displayName: 'SAP Cloud ALM',
    category: 'WORK_MANAGEMENT',
    description: 'Projects, tasks/requirements and remediation status sync with SAP Cloud ALM (OAuth2 client credentials).',
    configSchema: CloudAlmConfigSchema,
    credentialsSchema: CloudAlmCredentialsSchema,
    scopes: [
      { scope: 'calm-projects: read', why: 'Map ERP Preflight projects to Cloud ALM projects', access: 'READ', optional: false },
      { scope: 'calm-tasks: read', why: 'Sync task status back (pull)', access: 'READ', optional: false },
      { scope: 'calm-tasks: write', why: 'Create remediation tasks and comments from findings', access: 'WRITE', optional: true },
    ],
    writeActions: WORK_ITEM_WRITE_ACTIONS('Cloud ALM task'),
    canRead: ['Cloud ALM projects', 'Tasks created or linked by ERP Preflight (status, assignee, due date)'],
    cannotAccess: ['Tasks not linked to ERP Preflight', 'Test execution personal data', 'Any deletion'],
    supportedEngines: [],
    workItems: true,
  },
  JIRA: {
    type: 'JIRA',
    displayName: 'Jira Cloud',
    category: 'WORK_MANAGEMENT',
    description: 'Creates and syncs Jira issues through the Jira Cloud REST API v3.',
    configSchema: JiraConfigSchema,
    credentialsSchema: JiraCredentialsSchema,
    scopes: [
      { scope: 'read:jira-work', why: 'Read project and issue status', access: 'READ', optional: false },
      { scope: 'read:jira-user', why: 'Verify the API token owner (/myself)', access: 'READ', optional: false },
      { scope: 'write:jira-work', why: 'Create issues and comments from findings', access: 'WRITE', optional: true },
    ],
    writeActions: WORK_ITEM_WRITE_ACTIONS('Jira issue'),
    canRead: ['Configured project metadata', 'Issues created by ERP Preflight'],
    cannotAccess: ['Other projects', 'Issue deletion', 'User administration'],
    supportedEngines: [],
    workItems: true,
  },
  AZURE_DEVOPS: {
    type: 'AZURE_DEVOPS',
    displayName: 'Azure DevOps Boards',
    category: 'WORK_MANAGEMENT',
    description: 'Creates and syncs work items through the Azure DevOps Work Item Tracking REST API 7.1.',
    configSchema: AzureDevOpsConfigSchema,
    credentialsSchema: AzureDevOpsCredentialsSchema,
    scopes: [
      { scope: 'vso.project', why: 'Verify the configured project', access: 'READ', optional: false },
      { scope: 'vso.work', why: 'Read work item state', access: 'READ', optional: false },
      { scope: 'vso.work_write', why: 'Create work items and comments from findings', access: 'WRITE', optional: true },
    ],
    writeActions: WORK_ITEM_WRITE_ACTIONS('Azure DevOps work item'),
    canRead: ['Configured project', 'Work items created by ERP Preflight'],
    cannotAccess: ['Repositories', 'Pipelines', 'Work item deletion'],
    supportedEngines: [],
    workItems: true,
  },
  SERVICENOW: {
    type: 'SERVICENOW',
    displayName: 'ServiceNow',
    category: 'WORK_MANAGEMENT',
    description: 'Creates and syncs records through the ServiceNow Table API.',
    configSchema: ServiceNowConfigSchema,
    credentialsSchema: ServiceNowCredentialsSchema,
    scopes: [
      { scope: '<table>: read (ACL)', why: 'Read record state', access: 'READ', optional: false },
      { scope: '<table>: create/write (ACL)', why: 'Create records and work notes from findings', access: 'WRITE', optional: true },
    ],
    writeActions: WORK_ITEM_WRITE_ACTIONS('ServiceNow record'),
    canRead: ['Records in the configured table created by ERP Preflight'],
    cannotAccess: ['Other tables', 'CMDB', 'Record deletion'],
    supportedEngines: [],
    workItems: true,
  },
  GIT: {
    type: 'GIT',
    displayName: 'Git (abapGit, read-only)',
    category: 'SOURCE',
    description: 'Read-only shallow clone of an abapGit repository over HTTPS for Clean Core ingestion.',
    configSchema: GitConfigSchema,
    credentialsSchema: GitCredentialsSchema,
    scopes: [{ scope: 'repository: read (clone/fetch)', why: 'Read ABAP sources and abapGit metadata', access: 'READ', optional: false }],
    writeActions: [],
    canRead: ['Files of the configured branch (shallow, size-capped)'],
    cannotAccess: ['Push, tags, other branches, history beyond depth 1'],
    supportedEngines: ['CLEAN_CORE_OBJECT_GUARD'],
    workItems: false,
  },
  FILE: {
    type: 'FILE',
    displayName: 'File upload (offline mode)',
    category: 'GENERIC',
    description: 'File-only mode: artifacts are uploaded manually; no network access to customer systems.',
    configSchema: FileConfigSchema,
    credentialsSchema: EmptyCredentialsSchema,
    scopes: [],
    writeActions: [],
    canRead: ['Only files explicitly uploaded by users'],
    cannotAccess: ['Any customer system (no outbound connection)'],
    supportedEngines: ['*'],
    workItems: false,
  },
  LOCAL_AGENT: {
    type: 'LOCAL_AGENT',
    displayName: 'Local agent',
    category: 'AGENT',
    description: 'Outbound-only on-premise agent (device identity, signed jobs, local redaction).',
    configSchema: LocalAgentConfigSchema,
    credentialsSchema: EmptyCredentialsSchema,
    scopes: [{ scope: 'Signed job instructions', why: 'Directory scan / probe jobs executed on-premise', access: 'READ', optional: false }],
    writeActions: [],
    canRead: ['Redacted scan summaries uploaded by the agent', 'Agent heartbeat (version, uptime)'],
    cannotAccess: ['Raw files unless the device egress policy allows it'],
    supportedEngines: ['*'],
    workItems: false,
    systemManaged: true,
  },
};

export function getConnectorDefinition(type: string): ConnectorDefinition | undefined {
  return (CONNECTOR_DEFINITIONS as Record<string, ConnectorDefinition>)[type];
}

export function isWorkItemConnector(type: string): boolean {
  return WORK_ITEM_CONNECTOR_TYPES.includes(type as ConnectorType);
}

/** Registry entry without the Zod objects (safe to serialize to clients). */
export function describeConnectorType(def: ConnectorDefinition) {
  return {
    type: def.type,
    displayName: def.displayName,
    category: def.category,
    description: def.description,
    scopes: def.scopes,
    writeActions: def.writeActions,
    canRead: def.canRead,
    cannotAccess: def.cannotAccess,
    supportedEngines: def.supportedEngines,
    workItems: def.workItems,
    systemManaged: Boolean(def.systemManaged),
    configFields: describeSchemaFields(def.configSchema),
    credentialFields: describeSchemaFields(def.credentialsSchema),
  };
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s: any = schema;
  while (s && (s instanceof z.ZodEffects || s instanceof z.ZodOptional || s instanceof z.ZodDefault)) {
    s = s instanceof z.ZodEffects ? s.innerType() : s._def.innerType;
  }
  return s;
}

/** Field list (name, type, required, enum options, default) for building forms. */
export function describeSchemaFields(schema: z.ZodTypeAny) {
  const obj = unwrap(schema);
  if (!(obj instanceof z.ZodObject)) return [];
  const shape = obj.shape as Record<string, z.ZodTypeAny>;
  return Object.entries(shape).map(([name, field]) => {
    let s: any = field;
    let required = true;
    let defaultValue: unknown = undefined;
    while (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodEffects) {
      if (s instanceof z.ZodOptional) required = false;
      if (s instanceof z.ZodDefault) {
        required = false;
        defaultValue = s._def.defaultValue();
      }
      s = s instanceof z.ZodEffects ? s.innerType() : s._def.innerType;
    }
    const kind = s instanceof z.ZodEnum ? 'enum' : s instanceof z.ZodNumber ? 'number' : 'string';
    return {
      name,
      kind,
      required,
      defaultValue,
      options: s instanceof z.ZodEnum ? (s.options as string[]) : undefined,
    };
  });
}
