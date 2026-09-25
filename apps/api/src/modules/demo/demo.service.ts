import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Provisions or retrieves the canonical synthetic Demo Sandbox project with all 7 failure scenarios.
   */
  async provisionDemoProject(organizationId: string, userId: string) {
    // 1. Check if demo project already exists for this tenant
    const existing = await this.db.query(
      `SELECT * FROM projects WHERE organization_id = $1 AND slug LIKE 'demo-sandbox%' LIMIT 1`,
      [organizationId]
    );

    if (existing.rows?.length) {
      return {
        isNew: false,
        project: existing.rows[0],
      };
    }

    // 2. Create Demo Project
    const projectId = uuidv4();
    const projectName = 'SAP S/4HANA 2023 Enterprise Demo Sandbox';
    const slug = `demo-sandbox-${Date.now().toString().slice(-4)}`;

    const projectRes = await this.db.query(
      `INSERT INTO projects (id, organization_id, name, slug, description, target_release, created_by)
       VALUES ($1, $2, $3, $4, $5, 'S4H_2023', $6)
       RETURNING *`,
      [
        projectId,
        organizationId,
        projectName,
        slug,
        'Enterprise synthetic sandbox demonstrating all 7 preflight failure scenarios (OPD, FormDoctor, Clean Core, SPRO2Cloud, API Guard, Transport Analyzer, MFS BlackBox).',
        userId,
      ]
    );
    const project = projectRes.rows[0];

    // 3. Create Demo Analysis Record
    const analysisId = uuidv4();
    await this.db.query(
      `INSERT INTO analyses (id, organization_id, project_id, status, target_release, completed_at, triggered_by)
       VALUES ($1, $2, $3, 'COMPLETED', 'S4H_2023', NOW(), $4)`,
      [analysisId, organizationId, projectId, userId]
    );

    // 4. Seed the 7 Canonical Failure Scenarios (Part 14.2)
    const demoFindings = [
      // 1. OPD Missing Email
      {
        engine: 'OPD_GUARD',
        rule_id: 'OPD_DETERMINATION_STEP_MISSING',
        severity: 'CRITICAL',
        category: 'Output & Extensibility',
        title: 'Output Determination Step Missing: EMAIL channel unmapped for Billing Document Type F2',
        description: 'BRFplus decision table rule evaluation returned no matching recipient or dispatch channel for sales org 1010 under Billing Document Type F2.',
        remediation: 'In transaction OPD, navigate to Output Parameter Determination -> Billing Document -> Email Recipient. Add condition row mapping Sales Org 1010 to default billing clerk.',
        confidence_class: 'VERIFIED',
        confidence_score: 1.0,
        artifact: 'billing_opd_rules_2023.xml',
        line: 42,
        col: 10,
        snippet: '<DecisionTableRow id="ROW_42"><Condition>SALES_ORG=1010</Condition><Channel>NONE</Channel></DecisionTableRow>',
      },
      // 2. FormDoctor Binding Mismatch
      {
        engine: 'FORM_DOCTOR',
        rule_id: 'FORM_FIELD_BINDING_MISMATCH',
        severity: 'MAJOR',
        category: 'Output & Extensibility',
        title: 'Adobe Form Binding Broken: Customer VAT ID Field Missing in Invoice XDP Context',
        description: 'Template SD_INVOICE_FORM references data node $.Invoice.Header.CustomerTaxId, but schema provider binding is decoupled in S/4HANA 2023 interface.',
        remediation: 'Update Form Interface SD_INVOICE_INTERFACE context mapping to bind field TAX_NUM directly from KNA1 / BUT000 BP tax structure.',
        confidence_class: 'VERIFIED',
        confidence_score: 0.95,
        artifact: 'SD_INVOICE_FORM.xdp',
        line: 184,
        col: 14,
        snippet: '<field name="CustomerTaxId" access="readOnly"><bind match="dataRef" ref="$.Invoice.Header.CustomerTaxId"/></field>',
      },
      // 3. Clean Core Tier 3 Direct DB Mutation
      {
        engine: 'CLEAN_CORE_OBJECT_GUARD',
        rule_id: 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION',
        severity: 'BLOCKER',
        category: 'Migration & Clean Core',
        title: 'Clean Core Violation: Direct SQL INSERT/UPDATE into standard financial table BKPF',
        description: 'Custom report Z_POST_JOURNAL_ENTRIES executes direct Open SQL mutation on standard SAP table BKPF, violating Tier 1/2 Clean Core cloud extensibility rules.',
        remediation: 'Refactor custom mutation to utilize released BAPI BAPI_ACC_DOCUMENT_POST or RAP Business Object I_JournalEntryTP.',
        confidence_class: 'VERIFIED',
        confidence_score: 1.0,
        artifact: 'z_post_journal_entries.prog.abap',
        line: 88,
        col: 5,
        snippet: 'UPDATE bkpf SET bktxt = lv_text WHERE bukrs = p_bukrs AND belnr = p_belnr AND gjahr = p_gjahr.',
      },
      // 4. SPRO2Cloud IMG Gap
      {
        engine: 'SPRO2CLOUD',
        rule_id: 'SPRO_CONFIGURATION_GAP_DETECTED',
        severity: 'CRITICAL',
        category: 'Migration & Clean Core',
        title: 'SPRO Gap: Custom Company Code Validation T001G unsupported in SAP Central Business Configuration',
        description: 'Legacy customizing table T001G (Company code global parameters) has no 1:1 successor in S/4HANA Cloud CBC configuration activity catalog.',
        remediation: 'Utilize SAP Extensibility SSCUI 100135 (Define Settings for Accounting Principles) and BAdI FI_DOCUMENT_VALIDATION in Cloud BAdI studio.',
        confidence_class: 'RULE_DERIVED',
        confidence_score: 0.85,
        artifact: 'spro_img_export_ecc.csv',
        line: 312,
        col: 1,
        snippet: 'T001G,BUKRS,1010,XBILK,X,VALIDATION_RULE_FI_01',
      },
      // 5. API Breaking Change
      {
        engine: 'API_CHANGE_GUARD',
        rule_id: 'API_BREAKING_FIELD_REMOVAL',
        severity: 'CRITICAL',
        category: 'Integration',
        title: 'API Breaking Change: Deprecated field TaxJurisdictionCode removed in OData v4 Contract',
        description: 'Consumer payload for API_BUSINESS_PARTNER relies on v2 field TaxJurisdictionCode, which is completely removed in target S/4HANA 2023 v4 service definition.',
        remediation: 'Migrate outbound payload to structured TaxJurisdictionGroup object according to SAP Note 3129841.',
        confidence_class: 'VERIFIED',
        confidence_score: 1.0,
        artifact: 'api_business_partner_v4.edmx',
        line: 1205,
        col: 8,
        snippet: '<Property Name="TaxJurisdictionCode" Type="Edm.String" Nullable="true" sap:deprecated="true"/>',
      },
      // 6. Transport Dependency
      {
        engine: 'TRANSPORT_DEPENDENCY_ANALYZER',
        rule_id: 'CTS_TRANSPORT_DEPENDENCY_MISSING',
        severity: 'BLOCKER',
        category: 'Release & Transport',
        title: 'Transport Sequence Dependency Violation: TRK900102 requires unreleased prerequisite TRK900099',
        description: 'Transport TRK900102 contains program Z_RECON_REPORT referencing database table ZTB_HOLDINGS created in unreleased transport TRK900099.',
        remediation: 'Import transport TRK900099 into target QA environment prior to importing TRK900102, or merge transport requests in SE09.',
        confidence_class: 'VERIFIED',
        confidence_score: 1.0,
        artifact: 'cts_transport_buffer_log.txt',
        line: 56,
        col: 1,
        snippet: 'TRK900102: Object R3TR PROG Z_RECON_REPORT references missing active dictionary object TABL ZTB_HOLDINGS (TRK900099)',
      },
      // 7. MFS Telegram First-Divergence Collision
      {
        engine: 'MFS_BLACKBOX',
        rule_id: 'MFS_TELEGRAM_COLLISION_FIRST_DIVERGENCE',
        severity: 'MAJOR',
        category: 'Warehouse Automation',
        title: 'MFS Sequence Desynchronization: Telegram collision on PLC loop PLC_CONV_01 at 14:02:18 UTC',
        description: 'Telegram handshake WT_MOVE telegram #4088 received confirmation before sequence #4087 completed, triggering conveyor diverter lock.',
        remediation: 'Inspect PLC acknowledge timeout parameter in SAP EWM MFS customizing for communication point CP_DIV_01.',
        confidence_class: 'VERIFIED',
        confidence_score: 1.0,
        artifact: 'ewm_mfs_telegram_trace.log',
        line: 1402,
        col: 1,
        snippet: '2026-09-24 14:02:18.412 [MFS_IN] RECV SEQ=4088 TYPE=ACK CP=CP_DIV_01 (EXPECTED SEQ=4087 PENDING)',
      },
    ];

    for (const f of demoFindings) {
      const findingId = uuidv4();
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${f.engine}:${f.rule_id}:${f.title}`)
        .digest('hex');

      await this.db.query(
        `INSERT INTO findings (
          id, organization_id, project_id, analysis_id, engine, rule_id, severity, category,
          title, description, remediation, confidence_class, confidence_score, fingerprint
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          findingId,
          organizationId,
          projectId,
          analysisId,
          f.engine,
          f.rule_id,
          f.severity,
          f.category,
          f.title,
          f.description,
          f.remediation,
          f.confidence_class,
          f.confidence_score,
          fingerprint,
        ]
      );

      // Seed cryptographic evidence
      const sha256 = crypto.createHash('sha256').update(f.snippet).digest('hex');
      await this.db.query(
        `INSERT INTO evidence (
          organization_id, finding_id, artifact_path, line_number, column_number, snippet, sha256, provenance, trust_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'VERIFIED', 1.0)`,
        [
          organizationId,
          findingId,
          f.artifact,
          f.line,
          f.col,
          f.snippet,
          sha256,
        ]
      );
    }

    return {
      isNew: true,
      project,
    };
  }
}
