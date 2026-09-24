import {
  EngineType,
  Finding,
  Project,
} from '@erppreflight/schemas';
import { customInstance } from './api/custom-instance';

export interface EngineStatusItem {
  id: string;
  name: string;
  domain: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'STANDBY' | 'OFFLINE';
  rulesCount: number;
  description: string;
  supportedArtifactTypes?: string[];
  version?: string;
}

export const ALL_18_ENGINES: EngineStatusItem[] = [
  { id: 'OPD_GUARD', name: 'OPD Guard', domain: 'Output & Extensibility', status: 'OPERATIONAL', rulesCount: 8, description: 'S/4HANA Output Parameter Determination rules & BRFplus' },
  { id: 'FORM_DOCTOR', name: 'FormDoctor', domain: 'Output & Extensibility', status: 'OPERATIONAL', rulesCount: 12, description: 'SAPscript / Smart Forms to Adobe Forms migration validator' },
  { id: 'CUSTOM_FIELD_FLOW_DOCTOR', name: 'Custom Field Flow Doctor', domain: 'Output & Extensibility', status: 'OPERATIONAL', rulesCount: 10, description: 'Extension field lineage from CDS views through BAPIs to UI' },
  { id: 'EXTENSION_IMPACT_GUARD', name: 'Extension Impact Guard', domain: 'Output & Extensibility', status: 'OPERATIONAL', rulesCount: 14, description: 'Cloud BAdI & key-user extensibility upgrade stability analyzer' },
  { id: 'SPRO2CLOUD', name: 'SPRO2Cloud', domain: 'Migration & Clean Core', status: 'OPERATIONAL', rulesCount: 22, description: 'On-premise IMG/SPRO configuration to Cloud CBC mapping' },
  { id: 'ECC2CLOUD_NAVIGATOR', name: 'ECC2Cloud Navigator', domain: 'Migration & Clean Core', status: 'OPERATIONAL', rulesCount: 30, description: 'Custom code remediation & obsolete transaction migration roadmap' },
  { id: 'SAP_GAP_RADAR', name: 'SAP Gap Radar', domain: 'Migration & Clean Core', status: 'OPERATIONAL', rulesCount: 18, description: 'Fit-to-standard vs custom delta analyzer with Clean Core recommendations' },
  { id: 'CLEAN_CORE_OBJECT_GUARD', name: 'Clean Core Object Guard', domain: 'Migration & Clean Core', status: 'OPERATIONAL', rulesCount: 25, description: 'Tier 1/2/3 extensibility classification & classic modification detector' },
  { id: 'CHANGE_POINTER_COVERAGE_AUDITOR', name: 'Change Pointer Coverage Auditor', domain: 'Integration', status: 'OPERATIONAL', rulesCount: 11, description: 'BD21/BD52 change pointer config & event trigger validation' },
  { id: 'API_CHANGE_GUARD', name: 'API Change Guard', domain: 'Integration', status: 'OPERATIONAL', rulesCount: 16, description: 'OData, SOAP, RFC compatibility & deprecation impact scanner' },
  { id: 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD', name: 'Software Collection Dependency Guard', domain: 'Release & Transport', status: 'OPERATIONAL', rulesCount: 9, description: 'Export software collection cross-reference & release validator' },
  { id: 'TRANSPORT_DEPENDENCY_ANALYZER', name: 'Transport Dependency Analyzer', domain: 'Release & Transport', status: 'OPERATIONAL', rulesCount: 15, description: 'CTS transport sequence & cross-transport dictionary dependency validator' },
  { id: 'SAFE_DECOMMISSION_PREFLIGHT', name: 'Safe Decommission Preflight', domain: 'Operations', status: 'OPERATIONAL', rulesCount: 12, description: 'Unused Z-program, table, and interface retirement preflight' },
  { id: 'FIORI_403_ROOT_CAUSE_DOCTOR', name: 'Fiori 403 Root-Cause Doctor', domain: 'Operations', status: 'OPERATIONAL', rulesCount: 20, description: 'PFCG role, auth objects (S_START, S_SERVICE) & ICF catalog auditor' },
  { id: 'WORKFLOW_STUCK_EXPLAINER', name: 'Workflow Stuck Explainer', domain: 'Operations', status: 'OPERATIONAL', rulesCount: 13, description: 'SWWWIHEAD / SWZAI analysis for blocked work items' },
  { id: 'IAM_COST_OPTIMIZER', name: 'IAM Cost Optimizer', domain: 'Operations', status: 'OPERATIONAL', rulesCount: 8, description: 'Fiori catalog over-licensing & authorization license tier minimizer' },
  { id: 'ACCOUNT_DETERMINATION_PREFLIGHT', name: 'Account Determination Preflight', domain: 'Operations', status: 'OPERATIONAL', rulesCount: 24, description: 'OBYC, VKOA, automatic account determination rule validator' },
  { id: 'SYSTEM_REFRESH_DELTA_GUARD', name: 'System Refresh Delta Guard', domain: 'Operations', status: 'OPERATIONAL', rulesCount: 17, description: 'Post-refresh BDLS, RFC destination, & logical system change validator' },
  { id: 'MFS_BLACKBOX', name: 'MFS BlackBox', domain: 'Warehouse Automation', status: 'OPERATIONAL', rulesCount: 28, description: 'Material Flow System telegram sequence & telegram buffer auditor' },
];

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
