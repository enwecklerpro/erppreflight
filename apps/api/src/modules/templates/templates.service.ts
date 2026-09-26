import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateTemplateDto } from './dto/template.dto';
import { v4 as uuidv4 } from 'uuid';
import type { ApiLocale } from '../../common/i18n/request-locale';
import { localizeTemplate } from './templates.i18n';

export interface AnalysisTemplate {
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

export const SYSTEM_TEMPLATES: Omit<AnalysisTemplate, 'createdAt'>[] = [
  {
    id: 'tpl-po-email-output',
    name: 'Purchase Order Email Output Check',
    slug: 'purchase-order-email-output',
    description: 'Preflight verification for automated PO notification emails, OPD determination rules, and output recipient routing.',
    targetDomain: 'Output & Extensibility',
    engines: ['OPD_GUARD', 'FORM_DOCTOR'],
    requiredInputs: ['OPD Rule Matrix XML', 'Form Template XML / XDP'],
    optionalInputs: ['Custom Field Definitions JSON', 'Email Output Channel Config'],
    standardChecks: ['Recipient Determination Rule Integrity', 'Channel Fallback Validity', 'Form Binding Missing Elements'],
    reportType: 'ASSESSMENT_REPORT',
    isSystemTemplate: true,
  },
  {
    id: 'tpl-billing-form-field',
    name: 'Billing Form Field & Flow Check',
    slug: 'billing-form-field-flow',
    description: 'Validates key-user custom field propagation from SAP standard billing documents into Adobe Document Services (ADS) layouts.',
    targetDomain: 'Output & Extensibility',
    engines: ['FORM_DOCTOR', 'CUSTOM_FIELD_FLOW_DOCTOR'],
    requiredInputs: ['Invoice Form Template XML', 'Custom Field Mapping JSON'],
    optionalInputs: ['CDS View Extensibility Definitions'],
    standardChecks: ['YY1_ Field Flow Traversal', 'ADS Schema Binding Verification', 'Font/Layout Truncation Risk'],
    reportType: 'TECHNICAL_AUDIT',
    isSystemTemplate: true,
  },
  {
    id: 'tpl-ecc2cloud-assessment',
    name: 'ECC → Public Cloud Migration Assessment',
    slug: 'ecc-to-public-cloud-assessment',
    description: 'End-to-end migration feasibility analysis from ECC 6.0 EHP8 to S/4HANA Cloud Public Edition, checking SPRO configs and fit-to-standard gaps.',
    targetDomain: 'Migration & Clean Core',
    engines: ['ECC2CLOUD_NAVIGATOR', 'SPRO2CLOUD', 'SAP_GAP_RADAR'],
    requiredInputs: ['ECC SPRO / IMG Configuration CSV', 'Legacy Custom Code Inventory (abapGit)'],
    optionalInputs: ['ST03 Usage Logs CSV', 'SAP Readiness Check XML'],
    standardChecks: ['SPRO to CBC/SSCUI Direct Mapping', 'Legacy Z-Transaction Successor Identification', 'Clean Core Extensibility Tiering'],
    reportType: 'EXECUTIVE_READINESS',
    isSystemTemplate: true,
  },
  {
    id: 'tpl-clean-core-abap-scan',
    name: 'Clean Core ABAP Code Scan',
    slug: 'clean-core-abap-scan',
    description: 'Audits custom ABAP code against SAP Clean Core Tier 1 (Cloud Extensibility), Tier 2 (Released APIs), and Tier 3 (Legacy Modifications).',
    targetDomain: 'Migration & Clean Core',
    engines: ['CLEAN_CORE_OBJECT_GUARD', 'EXTENSION_IMPACT_GUARD'],
    requiredInputs: ['ABAP Source Code Repository (.zip / abapGit)'],
    optionalInputs: ['ATC Results XML', 'BAdI Implementation Definitions'],
    standardChecks: ['Direct Standard DB Mutation Detection', 'Unreleased SAP Internal API Usage', 'BAdI Cloud Readiness'],
    reportType: 'TECHNICAL_AUDIT',
    isSystemTemplate: true,
  },
  {
    id: 'tpl-api-upgrade-guard',
    name: 'API Upgrade & Breaking Change Check',
    slug: 'api-upgrade-breaking-change',
    description: 'Compares OData and SOAP service definitions against newer S/4HANA release versions to detect breaking schema changes.',
    targetDomain: 'Integration',
    engines: ['API_CHANGE_GUARD'],
    requiredInputs: ['Baseline API Specification (EDMX / WSDL / OpenAPI)', 'Target Release API Specification'],
    optionalInputs: ['Integration Flow Definitions (iFlow JSON)'],
    standardChecks: ['Deprecated Entity & Field Removal', 'Mandatory Request Parameter Additions', 'Type Incompatibility Warnings'],
    reportType: 'TECHNICAL_AUDIT',
    isSystemTemplate: true,
  },
  {
    id: 'tpl-matmas-change-pointer',
    name: 'MATMAS Change Pointer Coverage',
    slug: 'matmas-change-pointer-coverage',
    description: 'Verifies BD21 / BD52 change pointer trigger coverage for material master replication across external E-Commerce and MES platforms.',
    targetDomain: 'Integration',
    engines: ['CHANGE_POINTER_COVERAGE_AUDITOR'],
    requiredInputs: ['TBD52 Field Configuration CSV', 'TBD62 Message Type Mapping CSV'],
    optionalInputs: ['IDoc Segment Definition XML'],
    standardChecks: ['Active Field Event Trigger Validation', 'Message Type Filter Completeness', 'Replication Latency Risk'],
    reportType: 'ASSESSMENT_REPORT',
    isSystemTemplate: true,
  },
  {
    id: 'tpl-transport-release-preflight',
    name: 'Transport Release Preflight',
    slug: 'transport-release-preflight',
    description: 'Verifies cross-transport dependencies, import sequence integrity, and software collection bundle consistency before QA/PROD import.',
    targetDomain: 'Release & Transport',
    engines: ['TRANSPORT_DEPENDENCY_ANALYZER', 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD'],
    requiredInputs: ['Transport Request Object List (E071/E071K CSV)', 'Software Collection Export XML'],
    optionalInputs: ['Target Landscape System Registry'],
    standardChecks: ['Missing Prerequisite Transports', 'Table Structure / Code Sequencing Mismatch', 'Cross-Collection Circular Dependency'],
    reportType: 'EXECUTIVE_READINESS',
    isSystemTemplate: true,
  },
  {
    id: 'tpl-safe-decommission-preflight',
    name: 'User & Object Decommission Preflight',
    slug: 'user-object-decommission-preflight',
    description: 'Pre-flight check before deleting unused custom objects, RFC destinations, or locking technical users in production.',
    targetDomain: 'Operations',
    engines: ['SAFE_DECOMMISSION_PREFLIGHT', 'IAM_COST_OPTIMIZER'],
    requiredInputs: ['Decommission Candidate Object List CSV', 'PFCG Role & Usage Log CSV'],
    optionalInputs: ['Background Job Variant Configuration (TBTCO)'],
    standardChecks: ['Active Background Job Reference Check', 'RFC Destination Dependency Scan', 'Authorization Catalog Orphan Risk'],
    reportType: 'ASSESSMENT_REPORT',
    isSystemTemplate: true,
  },
  {
    id: 'tpl-mfs-incident-investigation',
    name: 'MFS Incident Root-Cause Investigation',
    slug: 'mfs-incident-investigation',
    description: 'Analyzes high-speed PLC telegram logs from SAP EWM Material Flow System (MFS) to pinpoint the exact first causal divergence in warehouse stalls.',
    targetDomain: 'Warehouse Automation',
    engines: ['MFS_BLACKBOX'],
    requiredInputs: ['MFS Telegram Log Buffer (CSV / TXT / LOG)'],
    optionalInputs: ['Conveyor / Stacker Crane Topology JSON'],
    standardChecks: ['Telegram Ack Timeout & Retry Storm Detection', 'Topology Location Jump Anomaly', 'Sequence Inversion Analysis'],
    reportType: 'TECHNICAL_AUDIT',
    isSystemTemplate: true,
  },
];

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(private readonly db: DatabaseService) {}

  async listTemplates(organizationId: string, locale: ApiLocale = 'en'): Promise<AnalysisTemplate[]> {
    return (await this.loadTemplates(organizationId)).map((t) => localizeTemplate(t, locale));
  }

  private async loadTemplates(organizationId: string): Promise<AnalysisTemplate[]> {
    try {
      const res = await this.db.query(
        `SELECT * FROM analysis_templates
         WHERE is_system_template = true OR organization_id = $1
         ORDER BY is_system_template DESC, name ASC`,
        [organizationId]
      );
      if (res.rows && res.rows.length > 0) {
        const stored: AnalysisTemplate[] = res.rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          description: r.description,
          targetDomain: r.target_domain,
          engines: Array.isArray(r.engines) ? r.engines : JSON.parse(r.engines || '[]'),
          requiredInputs: Array.isArray(r.required_inputs) ? r.required_inputs : JSON.parse(r.required_inputs || '[]'),
          optionalInputs: Array.isArray(r.optional_inputs) ? r.optional_inputs : JSON.parse(r.optional_inputs || '[]'),
          standardChecks: Array.isArray(r.standard_checks) ? r.standard_checks : JSON.parse(r.standard_checks || '[]'),
          reportType: r.report_type,
          isSystemTemplate: r.is_system_template,
          createdAt: r.created_at,
        }));
        // System templates are code constants (not seeded); keep them next to custom templates.
        const missingSystem = SYSTEM_TEMPLATES.filter((s) => !stored.some((t) => t.id === s.id || t.slug === s.slug)).map((t) => ({
          ...t,
          createdAt: new Date().toISOString(),
        }));
        return [...missingSystem, ...stored];
      }
    } catch {
      // If table query fails, fallback to hardcoded SYSTEM_TEMPLATES
    }

    return SYSTEM_TEMPLATES.map((t) => ({
      ...t,
      createdAt: new Date().toISOString(),
    }));
  }

  async getTemplateById(id: string, organizationId: string, locale: ApiLocale = 'en'): Promise<AnalysisTemplate> {
    const templates = await this.listTemplates(organizationId, locale);
    const found = templates.find((t) => t.id === id || t.slug === id);
    if (!found) {
      throw new NotFoundException(`Template '${id}' not found`);
    }
    return found;
  }

  async createCustomTemplate(
    organizationId: string,
    dto: CreateTemplateDto
  ): Promise<AnalysisTemplate> {
    const id = uuidv4();
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    try {
      await this.db.query(
        `INSERT INTO analysis_templates (
          id, organization_id, name, slug, description, target_domain,
          engines, required_inputs, optional_inputs, standard_checks, report_type, is_system_template
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
        [
          id,
          organizationId,
          dto.name,
          slug,
          dto.description,
          dto.targetDomain,
          JSON.stringify(dto.engines),
          JSON.stringify(dto.requiredInputs || []),
          JSON.stringify(dto.optionalInputs || []),
          JSON.stringify(dto.standardChecks || []),
          dto.reportType || 'FULL_ASSESSMENT',
        ]
      );
    } catch (err: any) {
      this.logger.warn(`Could not persist custom template to database: ${err.message}`);
    }

    return {
      id,
      name: dto.name,
      slug,
      description: dto.description,
      targetDomain: dto.targetDomain,
      engines: dto.engines,
      requiredInputs: dto.requiredInputs || [],
      optionalInputs: dto.optionalInputs || [],
      standardChecks: dto.standardChecks || [],
      reportType: dto.reportType || 'FULL_ASSESSMENT',
      isSystemTemplate: false,
      createdAt: new Date().toISOString(),
    };
  }
}
