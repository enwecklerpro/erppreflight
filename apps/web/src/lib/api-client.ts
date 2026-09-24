import {
  EngineType,
  Finding,
  Project,
  Severity,
  ConfidenceClass,
} from '@erppreflight/schemas';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export interface EngineStatusItem {
  id: EngineType;
  name: string;
  domain: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'STANDBY';
  rulesCount: number;
  description: string;
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

export const MOCK_PROJECTS: Project[] = [
  {
    id: '1a91cf25-87a4-4a41-b0db-6e69001b9201',
    organizationId: 'f0000000-0000-0000-0000-000000000001',
    name: 'S/4HANA 2023 Enterprise Migration Preflight',
    slug: 's4hana-2023-migration',
    description: 'Comprehensive clean core assessment and deprecation preflight before Cloud Private Edition migration.',
    targetRelease: 'S4H_2023',
    environments: ['DEV', 'TEST', 'QA', 'PROD'],
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2b91cf25-87a4-4a41-b0db-6e69001b9202',
    organizationId: 'f0000000-0000-0000-0000-000000000001',
    name: 'Clean Core BAdI & Extensibility Governance',
    slug: 'clean-core-extensibility',
    description: 'Tier 1 / Tier 2 audit for custom Z-code and obsolete RFC interfaces.',
    targetRelease: 'S4HC_2408',
    environments: ['DEV', 'TEST'],
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const MOCK_FINDINGS: Finding[] = [
  {
    id: 'f1111111-1111-1111-1111-111111111111',
    ruleId: 'OPD_DETERMINATION_STEP_MISSING',
    engineType: 'OPD_GUARD',
    severity: 'BLOCKER',
    category: 'OUTPUT_CONTROL',
    title: 'Output Determination table missing required channel row',
    description: 'BRFplus output parameter decision table for BILLING_DOCUMENT lacks default EMAIL dispatch entry in target release S/4HANA 2023.',
    confidence: 'VERIFIED',
    confidenceScore: 1.0,
    remediation: 'Execute transaction OPD and define an active fallback EMAIL determination rule row for application BILLING_DOCUMENT.',
    affectedObjects: [
      { name: 'APOC_OR_BILLING_DOC', type: 'DECISION_TABLE', tier: 'TIER_1_CLOUD' }
    ],
    evidence: [
      {
        artifactPath: 'exports/brfplus/billing_opd_rules.xml',
        lineNumber: 142,
        columnNumber: 8,
        snippet: '<rule step="01" app="BILLING_DOCUMENT" status="INCOMPLETE_CHANNELS"/>',
        sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        provenance: 'VERIFIED',
        sourceType: 'XML_DOM',
        trustScore: 1.0,
      }
    ],
    technicalDetails: { decisionTable: 'APOC_OR_BILLING_DOC', missingStep: 'OUTPUT_CHANNELS' },
    fingerprint: '3a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b',
  },
  {
    id: 'f2222222-2222-2222-2222-222222222222',
    ruleId: 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION',
    engineType: 'CLEAN_CORE_OBJECT_GUARD',
    severity: 'CRITICAL',
    category: 'CLEAN_CORE_VIOLATION',
    title: 'Direct database UPDATE to standard table ACDOCA detected in custom report',
    description: 'Custom ABAP report ZGL_POSTING performs direct SQL UPDATE on ACDOCA bypassing the standard journal entry posting API.',
    confidence: 'RULE_DERIVED',
    confidenceScore: 0.85,
    remediation: 'Refactor direct table mutation to use released SAP Cloud BAPI / RAP BO `I_JournalEntryTP`.',
    affectedObjects: [
      { name: 'ZGL_POSTING', type: 'ABAP_PROGRAM', tier: 'TIER_3_CLASSIC' }
    ],
    evidence: [
      {
        artifactPath: 'src/abap/zgl_posting.prog.abap',
        lineNumber: 87,
        snippet: 'UPDATE acdoca SET bstat = \'C\' WHERE rldnr = \'0L\' AND belnr = lv_belnr.',
        sha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
        provenance: 'RULE_DERIVED',
        sourceType: 'AST',
        trustScore: 0.85,
      }
    ],
    technicalDetails: { targetTable: 'ACDOCA', recommendedApi: 'I_JournalEntryTP' },
    fingerprint: '4b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c',
  },
  {
    id: 'f3333333-3333-3333-3333-333333333333',
    ruleId: 'FORM_DOCTOR_OBSOLETE_SMARTFORM',
    engineType: 'FORM_DOCTOR',
    severity: 'MAJOR',
    category: 'FORM_COMPATIBILITY',
    title: 'Smart Form ZINVOICE_V2 uses obsolete non-Unicode script elements',
    description: 'Smart Form uses character conversions and direct page layouts that are deprecated in S/4HANA Adobe Document Services (ADS).',
    confidence: 'VERIFIED',
    confidenceScore: 1.0,
    remediation: 'Migrate Smart Form layout to Adobe LiveCycle Designer XDP format using the FormDoctor automated conversion pipeline.',
    affectedObjects: [
      { name: 'ZINVOICE_V2', type: 'FORM', tier: 'TIER_2_DEVELOPER' }
    ],
    evidence: [
      {
        artifactPath: 'forms/smartforms/zinvoice_v2.xml',
        lineNumber: 204,
        snippet: '<formElement type="SMARTFORM_LEGACY_CODEPAGE" codepage="1100"/>',
        sha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
        provenance: 'VERIFIED',
        sourceType: 'XML_DOM',
        trustScore: 1.0,
      }
    ],
    technicalDetails: { formType: 'SMARTFORM', recommendedTarget: 'ADOBE_XDP' },
    fingerprint: '5c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d',
  },
];

export async function fetchProjects(): Promise<Project[]> {
  try {
    const res = await fetch(`${API_BASE}/projects`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) && data.length > 0 ? data : MOCK_PROJECTS;
    }
  } catch {
    // Graceful offline fallback
  }
  return MOCK_PROJECTS;
}

export async function fetchFindings(): Promise<Finding[]> {
  return MOCK_FINDINGS;
}
