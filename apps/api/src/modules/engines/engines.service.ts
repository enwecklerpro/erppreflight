import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EngineStatusItem {
  id: string;
  name: string;
  domain: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'STANDBY' | 'OFFLINE';
  rulesCount: number;
  description: string;
  supportedArtifactTypes: string[];
  version: string;
  /** Finding codes declared by the engine (empty while the analysis service is unreachable). */
  ruleCodes: string[];
}

interface CatalogEntry {
  engine_type?: string;
  version?: string;
  rule_count?: number;
  rule_codes?: string[];
  supported_artifact_types?: string[];
  health?: { status?: string };
}

// Static identity only. Rule counts, versions and supported formats come from the analysis service's
// engine catalog (GET /api/v1/engines), which derives them from each engine's declared rule registry.
const CANONICAL_ENGINES: Omit<EngineStatusItem, 'status' | 'version' | 'rulesCount' | 'ruleCodes'>[] = [
  { id: 'OPD_GUARD', name: 'OPD Guard', domain: 'Output & Extensibility', description: 'S/4HANA Output Parameter Determination rules & BRFplus', supportedArtifactTypes: ['XML', 'JSON', 'BRFPLUS'] },
  { id: 'FORM_DOCTOR', name: 'FormDoctor', domain: 'Output & Extensibility', description: 'SAPscript / Smart Forms to Adobe Forms migration validator', supportedArtifactTypes: ['XML', 'XDP', 'SAP_FORM'] },
  { id: 'CUSTOM_FIELD_FLOW_DOCTOR', name: 'Custom Field Flow Doctor', domain: 'Output & Extensibility', description: 'Extension field lineage from CDS views through BAPIs to UI', supportedArtifactTypes: ['JSON', 'XML', 'ABAP'] },
  { id: 'EXTENSION_IMPACT_GUARD', name: 'Extension Impact Guard', domain: 'Output & Extensibility', description: 'Cloud BAdI & key-user extensibility upgrade stability analyzer', supportedArtifactTypes: ['JSON', 'XML', 'ABAP'] },
  { id: 'SPRO2CLOUD', name: 'SPRO2Cloud', domain: 'Migration & Clean Core', description: 'On-premise IMG/SPRO configuration to Cloud CBC mapping', supportedArtifactTypes: ['CSV', 'JSON', 'XML'] },
  { id: 'ECC2CLOUD_NAVIGATOR', name: 'ECC2Cloud Navigator', domain: 'Migration & Clean Core', description: 'Custom code remediation & obsolete transaction migration roadmap', supportedArtifactTypes: ['ABAP', 'CSV', 'JSON'] },
  { id: 'SAP_GAP_RADAR', name: 'SAP Gap Radar', domain: 'Migration & Clean Core', description: 'Fit-to-standard vs custom delta analyzer with Clean Core recommendations', supportedArtifactTypes: ['JSON', 'XML', 'CSV'] },
  { id: 'CLEAN_CORE_OBJECT_GUARD', name: 'Clean Core Object Guard', domain: 'Migration & Clean Core', description: 'Tier 1/2/3 extensibility classification & classic modification detector', supportedArtifactTypes: ['ABAP', 'ZIP', 'JSON'] },
  { id: 'CHANGE_POINTER_COVERAGE_AUDITOR', name: 'Change Pointer Coverage Auditor', domain: 'Integration', description: 'BD21/BD52 change pointer config & event trigger validation', supportedArtifactTypes: ['JSON', 'XML', 'CSV'] },
  { id: 'API_CHANGE_GUARD', name: 'API Change Guard', domain: 'Integration', description: 'OData, SOAP, RFC compatibility & deprecation impact scanner', supportedArtifactTypes: ['EDMX', 'WSDL', 'YAML', 'JSON'] },
  { id: 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD', name: 'Software Collection Dependency Guard', domain: 'Release & Transport', description: 'Export software collection cross-reference & release validator', supportedArtifactTypes: ['XML', 'JSON'] },
  { id: 'TRANSPORT_DEPENDENCY_ANALYZER', name: 'Transport Dependency Analyzer', domain: 'Release & Transport', description: 'CTS transport sequence & cross-transport dictionary dependency validator', supportedArtifactTypes: ['CSV', 'JSON', 'TXT'] },
  { id: 'SAFE_DECOMMISSION_PREFLIGHT', name: 'Safe Decommission Preflight', domain: 'Operations', description: 'Unused Z-program, table, and interface retirement preflight', supportedArtifactTypes: ['ABAP', 'CSV', 'JSON'] },
  { id: 'FIORI_403_ROOT_CAUSE_DOCTOR', name: 'Fiori 403 Root-Cause Doctor', domain: 'Operations', description: 'PFCG role, auth objects (S_START, S_SERVICE) & ICF catalog auditor', supportedArtifactTypes: ['CSV', 'JSON', 'XML'] },
  { id: 'WORKFLOW_STUCK_EXPLAINER', name: 'Workflow Stuck Explainer', domain: 'Operations', description: 'SWWWIHEAD / SWZAI analysis for blocked work items', supportedArtifactTypes: ['CSV', 'JSON', 'TXT'] },
  { id: 'IAM_COST_OPTIMIZER', name: 'IAM Cost Optimizer', domain: 'Operations', description: 'Fiori catalog over-licensing & authorization license tier minimizer', supportedArtifactTypes: ['CSV', 'JSON'] },
  { id: 'ACCOUNT_DETERMINATION_PREFLIGHT', name: 'Account Determination Preflight', domain: 'Operations', description: 'OBYC, VKOA, automatic account determination rule validator', supportedArtifactTypes: ['CSV', 'JSON', 'XML'] },
  { id: 'SYSTEM_REFRESH_DELTA_GUARD', name: 'System Refresh Delta Guard', domain: 'Operations', description: 'Post-refresh BDLS, RFC destination, & logical system change validator', supportedArtifactTypes: ['CSV', 'JSON', 'TXT'] },
  { id: 'MFS_BLACKBOX', name: 'MFS BlackBox', domain: 'Warehouse Automation', description: 'Material Flow System telegram sequence & telegram buffer auditor', supportedArtifactTypes: ['CSV', 'TXT', 'JSON', 'LOG'] },
];

@Injectable()
export class EnginesService {
  private readonly logger = new Logger(EnginesService.name);
  private readonly analysisUrl: string;

  constructor(private readonly config: ConfigService) {
    this.analysisUrl =
      this.config.get<string>('ANALYSIS_SERVICE_URL') ||
      'http://localhost:8000';
  }

  async getEngineStatus(): Promise<{
    summary: {
      totalEngines: number;
      operationalCount: number;
      totalRules: number;
      serviceStatus: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    };
    engines: EngineStatusItem[];
  }> {
    let serviceOnline = false;
    const catalog = new Map<string, CatalogEntry>();

    try {
      const res = await fetch(`${this.analysisUrl}/health/readiness`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const body = (await res.json()) as { status?: string; engines_registered?: number };
        serviceOnline = body.status === 'ready' || (body.engines_registered ?? 0) >= 18;
      }
    } catch {
      serviceOnline = false;
    }

    if (serviceOnline) {
      try {
        const enginesRes = await fetch(`${this.analysisUrl}/api/v1/engines`, {
          signal: AbortSignal.timeout(3000),
        });
        if (enginesRes.ok) {
          const list = (await enginesRes.json()) as CatalogEntry[];
          list.forEach((e) => {
            if (e.engine_type) catalog.set(e.engine_type, e);
          });
        }
      } catch {
        // Fall back to general serviceOnline status
      }
    }

    let operationalCount = 0;
    let totalRules = 0;

    const engines: EngineStatusItem[] = CANONICAL_ENGINES.map((eng) => {
      const entry = catalog.get(eng.id);
      const rulesCount = entry?.rule_count ?? 0;
      totalRules += rulesCount;
      const healthy = entry?.health?.status === undefined || entry.health.status === 'OPERATIONAL';
      const status: EngineStatusItem['status'] = entry && serviceOnline && healthy
        ? 'OPERATIONAL'
        : serviceOnline
        ? 'DEGRADED'
        : 'STANDBY';

      if (status === 'OPERATIONAL') operationalCount++;

      return {
        ...eng,
        supportedArtifactTypes: entry?.supported_artifact_types ?? eng.supportedArtifactTypes,
        rulesCount,
        ruleCodes: entry?.rule_codes ?? [],
        status,
        version: entry?.version ?? 'unknown',
      };
    });

    return {
      summary: {
        totalEngines: CANONICAL_ENGINES.length,
        operationalCount,
        totalRules,
        serviceStatus: serviceOnline ? (operationalCount === CANONICAL_ENGINES.length ? 'ONLINE' : 'DEGRADED') : 'OFFLINE',
      },
      engines,
    };
  }
}
