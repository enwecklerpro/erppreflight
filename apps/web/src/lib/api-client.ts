import {
  EngineType,
  Finding,
  Project,
} from '@erppreflight/schemas';
import { customInstance } from './api/custom-instance';

export type ProjectListItem = Project;

export interface EngineStatusItem {
  id: string;
  name: string;
  domain: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'STANDBY' | 'OFFLINE' | 'UNKNOWN';
  rulesCount: number;
  description: string;
  supportedArtifactTypes?: string[];
  version?: string;
}

export const CANONICAL_ENGINES: Omit<EngineStatusItem, 'status'>[] = [
  { id: 'OPD_GUARD', name: 'OPD Guard', domain: 'Output & Extensibility', rulesCount: 8, description: 'S/4HANA Output Parameter Determination rules & BRFplus' },
  { id: 'FORM_DOCTOR', name: 'FormDoctor', domain: 'Output & Extensibility', rulesCount: 12, description: 'SAPscript / Smart Forms to Adobe Forms migration validator' },
  { id: 'CUSTOM_FIELD_FLOW_DOCTOR', name: 'Custom Field Flow Doctor', domain: 'Output & Extensibility', rulesCount: 10, description: 'Extension field lineage from CDS views through BAPIs to UI' },
  { id: 'EXTENSION_IMPACT_GUARD', name: 'Extension Impact Guard', domain: 'Output & Extensibility', rulesCount: 14, description: 'Cloud BAdI & key-user extensibility upgrade stability analyzer' },
  { id: 'SPRO2CLOUD', name: 'SPRO2Cloud', domain: 'Migration & Clean Core', rulesCount: 22, description: 'On-premise IMG/SPRO configuration to Cloud CBC mapping' },
  { id: 'ECC2CLOUD_NAVIGATOR', name: 'ECC2Cloud Navigator', domain: 'Migration & Clean Core', rulesCount: 30, description: 'Custom code remediation & obsolete transaction migration roadmap' },
  { id: 'SAP_GAP_RADAR', name: 'SAP Gap Radar', domain: 'Migration & Clean Core', rulesCount: 18, description: 'Fit-to-standard vs custom delta analyzer with Clean Core recommendations' },
  { id: 'CLEAN_CORE_OBJECT_GUARD', name: 'Clean Core Object Guard', domain: 'Migration & Clean Core', rulesCount: 25, description: 'Tier 1/2/3 extensibility classification & classic modification detector' },
  { id: 'CHANGE_POINTER_COVERAGE_AUDITOR', name: 'Change Pointer Coverage Auditor', domain: 'Integration', rulesCount: 11, description: 'BD21/BD52 change pointer config & event trigger validation' },
  { id: 'API_CHANGE_GUARD', name: 'API Change Guard', domain: 'Integration', rulesCount: 16, description: 'OData, SOAP, RFC compatibility & deprecation impact scanner' },
  { id: 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD', name: 'Software Collection Dependency Guard', domain: 'Release & Transport', rulesCount: 9, description: 'Export software collection cross-reference & release validator' },
  { id: 'TRANSPORT_DEPENDENCY_ANALYZER', name: 'Transport Dependency Analyzer', domain: 'Release & Transport', rulesCount: 15, description: 'CTS transport sequence & cross-transport dictionary dependency validator' },
  { id: 'SAFE_DECOMMISSION_PREFLIGHT', name: 'Safe Decommission Preflight', domain: 'Operations', rulesCount: 12, description: 'Unused Z-program, table, and interface retirement preflight' },
  { id: 'FIORI_403_ROOT_CAUSE_DOCTOR', name: 'Fiori 403 Root-Cause Doctor', domain: 'Operations', rulesCount: 20, description: 'PFCG role, auth objects (S_START, S_SERVICE) & ICF catalog auditor' },
  { id: 'WORKFLOW_STUCK_EXPLAINER', name: 'Workflow Stuck Explainer', domain: 'Operations', rulesCount: 13, description: 'SWWWIHEAD / SWZAI analysis for blocked work items' },
  { id: 'IAM_COST_OPTIMIZER', name: 'IAM Cost Optimizer', domain: 'Operations', rulesCount: 8, description: 'Fiori catalog over-licensing & authorization license tier minimizer' },
  { id: 'ACCOUNT_DETERMINATION_PREFLIGHT', name: 'Account Determination Preflight', domain: 'Operations', rulesCount: 24, description: 'OBYC, VKOA, automatic account determination rule validator' },
  { id: 'SYSTEM_REFRESH_DELTA_GUARD', name: 'System Refresh Delta Guard', domain: 'Operations', rulesCount: 17, description: 'Post-refresh BDLS, RFC destination, & logical system change validator' },
  { id: 'MFS_BLACKBOX', name: 'MFS BlackBox', domain: 'Warehouse Automation', rulesCount: 28, description: 'Material Flow System telegram sequence & telegram buffer auditor' },
];

export const ALL_18_ENGINES: EngineStatusItem[] = CANONICAL_ENGINES.map((e) => ({
  ...e,
  status: 'UNKNOWN',
}));

export interface CreateProjectPayload {
  name: string;
  description?: string;
  targetRelease: string;
  environments?: string[];
}

export interface TriggerAnalysisPayload {
  projectId: string;
  engineTypes: string[];
  targetRelease?: string;
  artifactS3Key?: string;
  rawContent?: string;
}

export interface FindingsQueryParams {
  projectId?: string;
  engine?: string;
  severity?: string;
  category?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface DashboardSummaryData {
  cleanCoreIndex: number;
  activeProjects: number;
  totalProjects: number;
  blockersAndCritical: number;
  totalFindings: number;
  severityDistribution: Record<string, number>;
  enginesOperational: string;
  enginesSummary: {
    totalEngines: number;
    operationalCount: number;
    totalRules: number;
    serviceStatus: string;
  };
  recentProjects: Array<{
    id: string;
    name: string;
    slug: string;
    targetRelease: string;
    createdAt: string;
  }>;
  recentAnalyses: Array<{
    id: string;
    projectId: string;
    status: string;
    targetRelease: string;
    findingsCount: number;
    createdAt: string;
    completedAt: string | null;
  }>;
}

// -----------------------------------------------------------------------------
// Real Project Operations
// -----------------------------------------------------------------------------

export async function fetchProjects(): Promise<Project[]> {
  try {
    const data = await customInstance<Project[]>('/projects');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Failed to fetch projects from API:', err);
    return [];
  }
}

export async function fetchProject(id: string): Promise<Project> {
  return customInstance<Project>(`/projects/${id}`);
}

export async function createProject(payload: CreateProjectPayload): Promise<Project> {
  return customInstance<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// -----------------------------------------------------------------------------
// Real Finding Operations
// -----------------------------------------------------------------------------

export async function fetchFindings(params?: FindingsQueryParams): Promise<Finding[]> {
  try {
    const searchParams = new URLSearchParams();
    if (params?.projectId) searchParams.set('projectId', params.projectId);
    if (params?.engine) searchParams.set('engine', params.engine);
    if (params?.severity) searchParams.set('severity', params.severity);
    if (params?.category) searchParams.set('category', params.category);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const qs = searchParams.toString();
    const endpoint = `/findings${qs ? `?${qs}` : ''}`;
    const res = await customInstance<{ items?: Finding[] } | Finding[]>(endpoint);

    if (res && 'items' in res && Array.isArray(res.items)) {
      return res.items;
    }
    if (Array.isArray(res)) {
      return res;
    }
    return [];
  } catch (err) {
    console.error('Failed to fetch findings from API:', err);
    return [];
  }
}

export async function fetchFindingById(id: string): Promise<Finding> {
  return customInstance<Finding>(`/findings/${id}`);
}

export async function fetchFindingsStats(projectId?: string) {
  const qs = projectId ? `?projectId=${projectId}` : '';
  return customInstance<{
    totalFindings: number;
    cleanCoreIndex: number;
    bySeverity: Record<string, number>;
    byEngine: Record<string, number>;
    blockerAndCriticalCount: number;
  }>(`/findings/stats${qs}`);
}

// -----------------------------------------------------------------------------
// Real Analysis Operations
// -----------------------------------------------------------------------------

export async function triggerAnalysis(payload: TriggerAnalysisPayload) {
  return customInstance<{
    analysisId: string;
    status: string;
    findingsCount: number;
    findings: Finding[];
  }>('/analyses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchAnalyses(projectId?: string) {
  const qs = projectId ? `?projectId=${projectId}` : '';
  return customInstance<Array<{
    id: string;
    organizationId: string;
    projectId: string;
    status: string;
    isBaseline?: boolean;
    engineTypes: string[];
    targetRelease: string;
    findingsCount: number;
    createdAt: string;
    completedAt: string | null;
  }>>(`/analyses${qs}`);
}

// -----------------------------------------------------------------------------
// Real Dashboard & Engine Operations
// -----------------------------------------------------------------------------

export async function fetchDashboardSummary(): Promise<DashboardSummaryData> {
  return customInstance<DashboardSummaryData>('/dashboard/summary');
}

export async function fetchEngineStatus(): Promise<{
  summary: {
    totalEngines: number;
    operationalCount: number;
    totalRules: number;
    serviceStatus: string;
  };
  engines: EngineStatusItem[];
}> {
  return customInstance<{
    summary: {
      totalEngines: number;
      operationalCount: number;
      totalRules: number;
      serviceStatus: string;
    };
    engines: EngineStatusItem[];
  }>('/engines/status');
}

// -----------------------------------------------------------------------------
// Super Admin & Global Trust Center Operations
// -----------------------------------------------------------------------------

export interface AdminOverviewData {
  totalTenants: number;
  totalUsers: number;
  totalProjects: number;
  totalAnalyses: number;
  totalFindings: number;
  blockersAndCritical: number;
  cleanCoreIndex: number;
  systemHealth: {
    database: string;
    redisQueue: string;
    pythonEngines: string;
    status: string;
  };
}

export interface AdminTenantItem {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  status: string;
  createdAt: string;
  userCount: number;
  projectCount: number;
  analysisCount: number;
}

export interface AdminUserItem {
  id: string;
  email: string;
  fullName: string | null;
  systemRole: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  status: string;
  createdAt: string;
  organizations: Array<{
    organizationId: string;
    organizationName: string;
    role: string;
  }>;
}

export interface AdminQueueData {
  queueName: string;
  status: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
}

export async function fetchCurrentUser() {
  return customInstance<{
    user: {
      id: string;
      email: string;
      fullName: string;
      organizationId: string;
      role: string;
      systemRole: string;
    };
  }>('/auth/me');
}

export async function fetchAdminOverview(): Promise<AdminOverviewData> {
  return customInstance<AdminOverviewData>('/admin/overview');
}

export async function fetchAdminTenants(): Promise<AdminTenantItem[]> {
  return customInstance<AdminTenantItem[]>('/admin/tenants');
}

export async function fetchAdminUsers(): Promise<AdminUserItem[]> {
  return customInstance<AdminUserItem[]>('/admin/users');
}

export async function updateAdminUserRole(
  userId: string,
  systemRole: 'USER' | 'ADMIN' | 'SUPER_ADMIN'
): Promise<any> {
  return customInstance(`/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemRole }),
  });
}

export async function fetchAdminQueues(): Promise<AdminQueueData> {
  return customInstance<AdminQueueData>('/admin/queues');
}

// Enterprise ChangeSets
export interface ChangeSetItem {
  id: string;
  name: string;
  description: string | null;
  target_environment: string;
  target_release: string;
  approval_status: 'DRAFT' | 'SIMULATED' | 'APPROVED' | 'REJECTED';
  proposal_hash: string;
  simulation_result: {
    simulatedAt: string;
    verdict: 'CLEAR' | 'CONDITIONAL_APPROVAL_REQUIRED' | 'BLOCKED';
    riskDelta: 'INCREASED' | 'DECREASED' | 'NEUTRAL';
    blastRadiusObjects: Array<{ name: string; type: string; impact: string }>;
    newFindings: Array<{ ruleId: string; severity: string; title: string; remediation: string }>;
    resolvedFindings: Array<{ id: string; ruleId: string; title: string }>;
    requiredTests: Array<{ title: string; type: string }>;
  } | null;
  created_at: string;
}

export async function fetchChangeSets(projectId: string): Promise<ChangeSetItem[]> {
  return customInstance<ChangeSetItem[]>(`/projects/${projectId}/changesets`);
}

export async function createChangeSet(projectId: string, payload: any): Promise<ChangeSetItem> {
  return customInstance<ChangeSetItem>(`/projects/${projectId}/changesets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function simulateChangeSet(projectId: string, changesetId: string): Promise<ChangeSetItem> {
  return customInstance<ChangeSetItem>(`/projects/${projectId}/changesets/${changesetId}/simulate`, {
    method: 'POST',
  });
}

export async function approveChangeSet(projectId: string, changesetId: string, reason: string): Promise<any> {
  return customInstance(`/projects/${projectId}/changesets/${changesetId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

// Enterprise Traceability
export interface TraceabilityNodeItem {
  id: string;
  process_hierarchy: string;
  requirement_id: string;
  requirement_title: string;
  finding_id: string | null;
  finding_title?: string;
  finding_severity?: string;
  finding_rule_id?: string;
  remediation_task_id: string | null;
  task_status: string;
  test_case_id: string | null;
  test_status: string;
  defect_id: string | null;
  transport_id: string | null;
  release_id: string;
  business_criticality: string;
  external_system: string;
}

export interface TraceabilityMatrixResponse {
  nodes: TraceabilityNodeItem[];
  summary: {
    totalRequirements: number;
    requirementsWithoutTests: number;
    criticalFindingsWithoutTasks: number;
    transportsWithBlockers: number;
    overallReadinessPercent: number;
  };
}

export async function fetchTraceabilityMatrix(projectId: string): Promise<TraceabilityMatrixResponse> {
  return customInstance<TraceabilityMatrixResponse>(`/projects/${projectId}/traceability`);
}

export async function syncTraceability(projectId: string): Promise<any> {
  return customInstance(`/projects/${projectId}/traceability/sync`, { method: 'POST' });
}

export async function createTraceabilityTask(projectId: string, findingId: string, externalSystem = 'SAP_CLOUD_ALM'): Promise<any> {
  return customInstance(`/projects/${projectId}/traceability/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findingId, externalSystem }),
  });
}

// Demo Project Sandbox
export async function exploreDemoProject(): Promise<{ isNew: boolean; project: { id: string; name: string; slug: string } }> {
  return customInstance('/demo/explore', { method: 'POST' });
}

// Release Compatibility Matrix & Knowledge
export interface ReleaseMatrixEntry {
  engineId: string;
  engineName: string;
  domain: string;
  product: string;
  edition: string;
  targetRelease: string;
  supportedFormats: string[];
  status: 'SUPPORTED_VERIFIED' | 'SUPPORTED_BETA' | 'PARTIAL' | 'FILE_MODE_ONLY';
  verifiedFixtures: number;
}

export async function fetchReleaseMatrix(): Promise<ReleaseMatrixEntry[]> {
  return customInstance<ReleaseMatrixEntry[]>('/knowledge/matrix');
}

// API Keys
export interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  status: string;
  created_at: string;
}

export async function fetchApiKeys(): Promise<ApiKeyItem[]> {
  return customInstance<ApiKeyItem[]>('/api-keys');
}

export async function createApiKey(payload: { name: string; scopes?: string[] }): Promise<any> {
  return customInstance('/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function revokeApiKey(id: string): Promise<any> {
  return customInstance(`/api-keys/${id}`, { method: 'DELETE' });
}

// Webhooks
export interface WebhookItem {
  id: string;
  url: string;
  events: string[];
  status: string;
  failure_count: number;
  last_triggered_at: string | null;
  created_at: string;
}

export async function fetchWebhooks(): Promise<WebhookItem[]> {
  return customInstance<WebhookItem[]>('/webhooks');
}

export async function createWebhook(payload: { url: string; events?: string[] }): Promise<any> {
  return customInstance('/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function removeWebhook(id: string): Promise<any> {
  return customInstance(`/webhooks/${id}`, { method: 'DELETE' });
}

export async function testWebhook(id: string): Promise<any> {
  return customInstance(`/webhooks/${id}/test`, { method: 'POST' });
}

// Landscapes
export interface LandscapeItem {
  id: string;
  system_id: string;
  product: string;
  edition: string;
  release: string;
  environment: string;
  url: string | null;
  business_role: string;
  criticality: string;
  status: string;
}

export async function fetchLandscapes(): Promise<LandscapeItem[]> {
  return customInstance<LandscapeItem[]>('/landscapes');
}

export async function createLandscape(payload: any): Promise<LandscapeItem> {
  return customInstance<LandscapeItem>('/landscapes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function removeLandscape(id: string): Promise<any> {
  return customInstance(`/landscapes/${id}`, { method: 'DELETE' });
}

export async function testLandscapeConnection(id: string): Promise<any> {
  return customInstance<any>(`/landscapes/${id}/test`, { method: 'POST' });
}


// -----------------------------------------------------------------------------
// Enterprise Analysis Templates (Part 14.3)
// -----------------------------------------------------------------------------
export interface AnalysisTemplateItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  targetDomain: string;
  engines: string[];
  requiredInputs: string[];
  optionalInputs: string[];
  standardChecks: string[];
  reportType: string;
  isSystemTemplate: boolean;
  createdAt: string;
}

export async function fetchAnalysisTemplates(): Promise<AnalysisTemplateItem[]> {
  return customInstance<AnalysisTemplateItem[]>('/templates');
}

export async function createAnalysisTemplate(payload: {
  name: string;
  description: string;
  targetDomain: string;
  engines: string[];
  requiredInputs?: string[];
  optionalInputs?: string[];
  standardChecks?: string[];
  reportType?: string;
}): Promise<AnalysisTemplateItem> {
  return customInstance<AnalysisTemplateItem>('/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// -----------------------------------------------------------------------------
// Customer Feedback & Gap Voting (Part 14.50)
// -----------------------------------------------------------------------------
export interface CustomerFeedbackItem {
  id: string;
  organizationId: string;
  projectId?: string;
  findingId?: string;
  feedbackType: 'FEATURE_REQUEST' | 'ACCURACY_DISPUTE' | 'GAP_VOTE';
  title: string;
  description: string;
  status: 'UNDER_REVIEW' | 'PLANNED' | 'IN_PROGRESS' | 'SHIPPED' | 'DECLINED';
  votes: number;
  targetEngine?: string;
  hasVoted?: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchFeedbackItems(): Promise<CustomerFeedbackItem[]> {
  return customInstance<CustomerFeedbackItem[]>('/feedback');
}

export async function createFeedbackItem(payload: {
  title: string;
  description: string;
  feedbackType?: 'FEATURE_REQUEST' | 'ACCURACY_DISPUTE' | 'GAP_VOTE';
  projectId?: string;
  targetEngine?: string;
}): Promise<CustomerFeedbackItem> {
  return customInstance<CustomerFeedbackItem>('/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function voteOnFeedbackItem(id: string): Promise<{ votes: number; hasVoted: boolean }> {
  return customInstance<{ votes: number; hasVoted: boolean }>(`/feedback/${id}/vote`, {
    method: 'POST',
  });
}

// -----------------------------------------------------------------------------
// Product Release Notes & Knowledge Changelogs (Part 14.51 & 14.52)
// -----------------------------------------------------------------------------
export interface ReleaseNoteItem {
  id: string;
  version: string;
  releaseDate: string;
  category: 'PLATFORM' | 'KNOWLEDGE_SNAPSHOT' | 'ENGINE_RULE_BUNDLE';
  title: string;
  summary: string;
  features: string[];
  engineChanges: string[];
  knowledgeUpdates: string[];
  breakingChanges: string[];
}

export async function fetchChangelogs(category?: string): Promise<ReleaseNoteItem[]> {
  const query = category ? `?category=${category}` : '';
  return customInstance<ReleaseNoteItem[]>(`/changelog${query}`);
}

// -----------------------------------------------------------------------------
// Scenario & Regression Test Lab (Part 16.34)
// -----------------------------------------------------------------------------
export interface LabScenarioItem {
  scenarioId: string;
  domain: string;
  scenarioName: string;
  failureType: string;
  payload: string;
  expectedFindings: Array<{ ruleId: string; severity: string; description: string }>;
  format: 'xml' | 'csv' | 'json';
}

export interface LabRunResult {
  runId: string;
  domain: string;
  executedAt: string;
  overallStatus: 'PASSED' | 'FAILED' | 'REGRESSION_DETECTED';
  verdict: 'CLEAR' | 'DEFECTS_DETECTED';
  assertionsCount: number;
  passedAssertions: number;
  failedAssertions: number;
  findings: Array<{
    ruleId: string;
    severity: string;
    title: string;
    evidenceSha256: string;
    confidenceClass: 'VERIFIED' | 'RULE_DERIVED';
    passed: boolean;
  }>;
}

export async function generateLabScenario(payload: {
  domain: string;
  failureType: string;
  scenarioName?: string;
}): Promise<LabScenarioItem> {
  return customInstance<LabScenarioItem>('/lab/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function runLabScenario(payload: {
  domain: string;
  payload: string;
  targetRelease?: string;
}): Promise<LabRunResult> {
  return customInstance<LabRunResult>('/lab/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// -----------------------------------------------------------------------------
// Digital Project Baselines & Configuration Drift Engine (Part 14.10 / Part 16.5)
// -----------------------------------------------------------------------------
export interface ProjectDriftReport {
  hasBaseline: boolean;
  message?: string;
  baseline: {
    id: string;
    name: string;
    createdAt: string;
    totalFindings: number;
    cleanCoreIndex?: number;
    targetRelease?: string;
  } | null;
  comparison: {
    id: string;
    name: string;
    createdAt: string;
    totalFindings: number;
    cleanCoreIndex?: number;
    targetRelease?: string;
  } | null;
  driftSummary: {
    knownBaselineRisks: number;
    newlyIntroducedRisks: number;
    resolvedRisks: number;
    scoreDelta: number;
  };
  findings: {
    knownBaseline: Finding[];
    newlyIntroduced: Finding[];
    resolved: Finding[];
  };
}

export async function setProjectBaseline(projectId: string, analysisId: string): Promise<any> {
  return customInstance(`/projects/${projectId}/baseline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysisId }),
  });
}

export async function fetchProjectDrift(
  projectId: string,
  targetAnalysisId?: string
): Promise<ProjectDriftReport> {
  const qs = targetAnalysisId ? `?targetAnalysisId=${targetAnalysisId}` : '';
  return customInstance<ProjectDriftReport>(`/projects/${projectId}/drift${qs}`);
}

// -----------------------------------------------------------------------------
// Reproducibility Bundle Downloader (Part 14.11)
// -----------------------------------------------------------------------------
export function getReproducibilityBundleUrl(analysisId: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL || 'https://api.erppreflight.com/api/v1';
  return `${base}/analyses/${analysisId}/reproducibility-bundle`;
}

// -----------------------------------------------------------------------------
// SAP Object Catalog & Clean Core Inventory (Part 14.35)
// -----------------------------------------------------------------------------
export interface FetchProjectObjectsApiParams {
  projectId: string;
  search?: string;
  objectType?: string;
  cleanCoreTier?: string;
  package?: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ProjectObjectsApiResponse {
  items: any[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: {
    typeCounts: Record<string, number>;
    tierCounts: Record<string, number>;
    packageCounts: Record<string, number>;
    findingsStatusCounts: {
      withFindings: number;
      clean: number;
    };
  };
}

export async function fetchProjectObjectsApi(
  params: FetchProjectObjectsApiParams
): Promise<ProjectObjectsApiResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.objectType) query.set('objectType', params.objectType);
  if (params.cleanCoreTier) query.set('cleanCoreTier', params.cleanCoreTier);
  if (params.package) query.set('package', params.package);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.sortField) query.set('sortField', params.sortField);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);

  const qs = query.toString() ? `?${query.toString()}` : '';
  return customInstance<ProjectObjectsApiResponse>(
    `/projects/${params.projectId}/objects${qs}`
  );
}

export async function fetchSapObjectById(
  projectId: string,
  objectId: string
): Promise<any> {
  return customInstance<any>(`/projects/${projectId}/objects/${objectId}`);
}

export async function createWorkItemForFinding(
  findingId: string,
  payload: { system?: string; title?: string; process?: string }
): Promise<{ success: boolean; workItemId: string; externalSystem: string; deepLink: string; taskBody: any }> {
  return customInstance<{ success: boolean; workItemId: string; externalSystem: string; deepLink: string; taskBody: any }>(
    `/findings/${findingId}/work-item`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

export async function importAtcArtifact(
  projectId: string,
  payload: { rawContent: string; format?: string; fileName?: string }
): Promise<{
  success: boolean;
  analysisId: string;
  totalParsed: number;
  objectsImported: number;
  findingsCreated: number;
  baselinedCount: number;
  activeFindings: number;
}> {
  return customInstance<any>(`/projects/${projectId}/import/atc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function importReadinessCheckArtifact(
  projectId: string,
  payload: { rawContent: string; fileName?: string }
): Promise<{
  success: boolean;
  analysisId: string;
  sourceSystem: string;
  targetRelease: string;
  simplificationItemsCount: number;
  findingsCreated: number;
  criticalIssuesCount: number;
}> {
  return customInstance<any>(`/projects/${projectId}/import/readiness`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function importFioriUsageArtifact(
  projectId: string,
  payload: { rawContent: string; fileName?: string }
): Promise<{
  success: boolean;
  recordsProcessed: number;
  recommendations: any[];
}> {
  return customInstance<any>(`/projects/${projectId}/import/fiori`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// -----------------------------------------------------------------------------
// Organization & Governance Settings (Part 17.21, 17.22, 20.14)
// -----------------------------------------------------------------------------
export interface OrganizationDetails {
  id: string;
  name: string;
  slug: string;
  plan_tier: string;
  status: string;
  data_policy: {
    deterministicOnly?: boolean;
    requireDualReviewForInferred?: boolean;
    tokenBudgetMonthly?: number;
    aiAuditLoggingEnabled?: boolean;
    allowedModels?: string[];
  } | null;
  created_at: string;
  updated_at: string;
}

export async function fetchCurrentOrganization(): Promise<OrganizationDetails> {
  return customInstance<OrganizationDetails>('/organizations/current');
}

export async function updateCurrentOrganization(payload: {
  name?: string;
  dataPolicy?: Record<string, any>;
}): Promise<OrganizationDetails> {
  return customInstance<OrganizationDetails>('/organizations/current', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// -----------------------------------------------------------------------------
// Enterprise Support Diagnostic Bundle (Part 18.18)
// -----------------------------------------------------------------------------
export async function fetchDiagnosticBundle(projectId: string): Promise<any> {
  return customInstance<any>(`/projects/${projectId}/diagnostic-bundle`);
}

// -----------------------------------------------------------------------------
// Finding Review & Waiver Workflow (Part 14.12, 14.13, 15.13)
// -----------------------------------------------------------------------------
export interface ReviewFindingPayload {
  status: 'OPEN' | 'VERIFIED' | 'ACCEPTED_RISK' | 'SUPPRESSED_FALSE_POSITIVE';
  justification: string;
  suppressScope?: 'FINDING_ONLY' | 'OBJECT_RULE' | 'TENANT_OVERRIDE';
}

export async function reviewFinding(
  findingId: string,
  payload: ReviewFindingPayload
): Promise<any> {
  return customInstance<any>(`/findings/${findingId}/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}






