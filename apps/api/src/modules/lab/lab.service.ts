import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import {
  GenerateScenarioDto,
  RunScenarioDto,
  ScenarioDomain,
  ScenarioFailureType,
} from './dto/lab.dto';
import {
  EngineType,
  TargetRelease,
  toWireJobRequest,
  AnalysisJobResponseSchema,
  Finding,
  Severity,
  ConfidenceClass,
} from '@erppreflight/schemas';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

export interface ExpectedFindingDef {
  ruleId: string;
  severity: Severity;
  description: string;
}

export interface SyntheticScenarioResult {
  scenarioId: string;
  projectId?: string;
  domain: ScenarioDomain;
  scenarioName: string;
  failureType: ScenarioFailureType;
  payload: string;
  expectedFindings: ExpectedFindingDef[];
  format: 'xml' | 'csv' | 'json';
  createdAt?: string;
}

export interface LabAssertionItem {
  ruleId: string;
  ruleName: string;
  severity: Severity;
  expected: boolean;
  actual: boolean;
  passed: boolean;
  evidenceSha256: string;
  confidenceClass: ConfidenceClass;
  evidenceSnippet?: string;
  lineNumber?: number;
  message: string;
}

export interface LabRunAssertionResult {
  runId: string;
  scenarioId?: string;
  projectId?: string;
  domain: ScenarioDomain;
  executedAt: string;
  overallStatus: 'PASSED' | 'FAILED' | 'REGRESSION_DETECTED';
  verdict: 'CLEAR' | 'DEFECTS_DETECTED';
  passedCount: number;
  failedCount: number;
  passedAssertions: number;
  failedAssertions: number;
  allPassed: boolean;
  assertionsCount: number;
  executionTimeMs: number;
  rulesEvaluated: number;
  payloadSha256: string;
  assertionLedger: LabAssertionItem[];
  findings: Finding[];
}

@Injectable()
export class LabService {
  private readonly logger = new Logger(LabService.name);
  private readonly analysisUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly config?: ConfigService,
  ) {
    this.analysisUrl =
      this.config?.get<string>('ANALYSIS_SERVICE_URL') ||
      process.env.ANALYSIS_SERVICE_URL ||
      'http://localhost:8000';
  }

  /**
   * Generates a realistic synthetic test fixture matching authoritative
   * Python preflight engine expectations for the selected domain and failure mode.
   * If tenantId and projectId are provided, automatically triggers background persistence.
   */
  generateScenario(
    dto: GenerateScenarioDto,
    tenantId?: string,
    projectId?: string,
  ): SyntheticScenarioResult {
    const scenarioId = uuidv4();
    let payload = '';
    let format: 'xml' | 'csv' | 'json' = 'xml';
    let expectedFindings: ExpectedFindingDef[] = [];
    const name =
      dto.scenarioName ||
      `${dto.domain} - ${dto.failureType.replace(/_/g, ' ')}`;

    switch (dto.domain) {
      case ScenarioDomain.OPD:
        format = 'xml';
        if (dto.failureType === ScenarioFailureType.OPD_MISSING_RECIPIENT) {
          expectedFindings = [
            {
              ruleId: 'OPD_DETERMINATION_STEP_MISSING',
              severity: 'CRITICAL',
              description:
                'Email Recipient determination failed: Customer 100045 has no matching recipient rule in table Email Recipient',
            },
          ];
          payload = `<?xml version="1.0" encoding="utf-8"?>
<OutputParameterDetermination>
  <Scenario>
    <BillingType>F2</BillingType>
    <SalesOrganization>1000</SalesOrganization>
    <CustomerNumber>100045</CustomerNumber>
  </Scenario>
  <DecisionTables>
    <Table name="Output Type">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BILLING_DOCUMENT</RESULT>
      </Row>
    </Table>
    <Table name="Receiver">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BP_100045</RESULT>
      </Row>
    </Table>
    <Table name="Channel">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>EMAIL</RESULT>
      </Row>
    </Table>
    <Table name="Printer">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>LP01</RESULT>
      </Row>
    </Table>
    <Table name="Email Recipient">
      <Row>
        <COND_CustomerNumber>999999</COND_CustomerNumber>
        <RESULT>fallback@enterprise.internal</RESULT>
      </Row>
    </Table>
    <Table name="Email Sender">
      <Row>
        <COND_SalesOrganization>1000</COND_SalesOrganization>
        <RESULT>billing@acme.corp</RESULT>
      </Row>
    </Table>
    <Table name="Form Template">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>INVOICE_PDF_DEFAULT</RESULT>
      </Row>
    </Table>
    <Table name="Output Relevance">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>TRUE</RESULT>
      </Row>
    </Table>
  </DecisionTables>
</OutputParameterDetermination>`;
        } else if (dto.failureType === ScenarioFailureType.OPD_INVALID_CHANNEL) {
          expectedFindings = [
            {
              ruleId: 'OPD_CHANNEL_INACTIVE',
              severity: 'CRITICAL',
              description:
                "Inactive or unsupported output channel 'FAX' in Channel decision table",
            },
          ];
          payload = `<?xml version="1.0" encoding="utf-8"?>
<OutputParameterDetermination>
  <Scenario>
    <BillingType>F2</BillingType>
    <SalesOrganization>1000</SalesOrganization>
    <CustomerNumber>100045</CustomerNumber>
  </Scenario>
  <DecisionTables>
    <Table name="Output Type">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BILLING_DOCUMENT</RESULT>
      </Row>
    </Table>
    <Table name="Receiver">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BP_100045</RESULT>
      </Row>
    </Table>
    <Table name="Channel">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>FAX</RESULT>
      </Row>
    </Table>
    <Table name="Printer">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>LP01</RESULT>
      </Row>
    </Table>
    <Table name="Email Recipient">
      <Row>
        <COND_CustomerNumber>100045</COND_CustomerNumber>
        <RESULT>billing@customer45.com</RESULT>
      </Row>
    </Table>
    <Table name="Email Sender">
      <Row>
        <COND_SalesOrganization>1000</COND_SalesOrganization>
        <RESULT>billing@acme.corp</RESULT>
      </Row>
    </Table>
    <Table name="Form Template">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>INVOICE_PDF_DEFAULT</RESULT>
      </Row>
    </Table>
    <Table name="Output Relevance">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>TRUE</RESULT>
      </Row>
    </Table>
  </DecisionTables>
</OutputParameterDetermination>`;
        } else if (dto.failureType === ScenarioFailureType.OPD_SHADOWED_RULE) {
          expectedFindings = [
            {
              ruleId: 'OPD_UNREACHABLE_RULE',
              severity: 'MINOR',
              description:
                "Shadowed Rule in Channel Table: Earlier wildcard row subsumes condition 'F2'",
            },
          ];
          payload = `<?xml version="1.0" encoding="utf-8"?>
<OutputParameterDetermination>
  <Scenario>
    <BillingType>F2</BillingType>
    <SalesOrganization>1000</SalesOrganization>
    <CustomerNumber>100045</CustomerNumber>
  </Scenario>
  <DecisionTables>
    <Table name="Output Type">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BILLING_DOCUMENT</RESULT>
      </Row>
    </Table>
    <Table name="Receiver">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BP_100045</RESULT>
      </Row>
    </Table>
    <Table name="Channel">
      <Row>
        <COND_BillingType>*</COND_BillingType>
        <RESULT>PRINT</RESULT>
      </Row>
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>EMAIL</RESULT>
      </Row>
    </Table>
    <Table name="Printer">
      <Row>
        <COND_BillingType>*</COND_BillingType>
        <RESULT>LP01</RESULT>
      </Row>
    </Table>
    <Table name="Email Recipient">
      <Row>
        <COND_CustomerNumber>100045</COND_CustomerNumber>
        <RESULT>billing@customer45.com</RESULT>
      </Row>
    </Table>
    <Table name="Email Sender">
      <Row>
        <COND_SalesOrganization>1000</COND_SalesOrganization>
        <RESULT>billing@acme.corp</RESULT>
      </Row>
    </Table>
    <Table name="Form Template">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>INVOICE_PDF_DEFAULT</RESULT>
      </Row>
    </Table>
    <Table name="Output Relevance">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>TRUE</RESULT>
      </Row>
    </Table>
  </DecisionTables>
</OutputParameterDetermination>`;
        } else {
          // CLEAN_PASS
          expectedFindings = [];
          payload = `<?xml version="1.0" encoding="utf-8"?>
<OutputParameterDetermination>
  <Scenario>
    <BillingType>F2</BillingType>
    <SalesOrganization>1000</SalesOrganization>
    <CustomerNumber>100045</CustomerNumber>
  </Scenario>
  <DecisionTables>
    <Table name="Output Type">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BILLING_DOCUMENT</RESULT>
      </Row>
    </Table>
    <Table name="Receiver">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BP_100045</RESULT>
      </Row>
    </Table>
    <Table name="Channel">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>EMAIL</RESULT>
      </Row>
    </Table>
    <Table name="Printer">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>LP01</RESULT>
      </Row>
    </Table>
    <Table name="Email Recipient">
      <Row>
        <COND_CustomerNumber>100045</COND_CustomerNumber>
        <RESULT>billing@customer45.com</RESULT>
      </Row>
    </Table>
    <Table name="Email Sender">
      <Row>
        <COND_SalesOrganization>1000</COND_SalesOrganization>
        <RESULT>billing@acme.corp</RESULT>
      </Row>
    </Table>
    <Table name="Form Template">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>INVOICE_PDF_DEFAULT</RESULT>
      </Row>
    </Table>
    <Table name="Output Relevance">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>TRUE</RESULT>
      </Row>
    </Table>
  </DecisionTables>
</OutputParameterDetermination>`;
        }
        break;

      case ScenarioDomain.FORM:
        format = 'json';
        if (dto.failureType === ScenarioFailureType.FORM_MISSING_BINDING) {
          expectedFindings = [
            {
              ruleId: 'FORM_FIELD_MISSING_IN_XML',
              severity: 'CRITICAL',
              description:
                "Field 'PromoCode' references '$.Header.YY1_PROMOTIONAL_CODE' which does not exist in runtime XML data",
            },
          ];
          payload = JSON.stringify(
            {
              xdp_content: `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template>
    <subform name="InvoiceForm" dataRef="$.Invoice">
      <field name="InvoiceNum"><bind match="dataRef" ref="$.Header.InvoiceID"/></field>
      <field name="SupplierTax"><bind match="dataRef" ref="$.Header.Supplier.TaxNumber"/></field>
      <field name="PromoCode"><bind match="dataRef" ref="$.Header.YY1_PROMOTIONAL_CODE"/></field>
    </subform>
  </template>
</xdp:xdp>`,
              xml_content: `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <Header>
    <InvoiceID>90001234</InvoiceID>
    <Supplier><ID>100045</ID><TaxNumber>DE123456789</TaxNumber></Supplier>
    <TotalAmount Currency="EUR">14250.00</TotalAmount>
  </Header>
</Invoice>`,
            },
            null,
            2,
          );
        } else if (dto.failureType === ScenarioFailureType.FORM_BINDING_MISMATCH) {
          expectedFindings = [
            {
              ruleId: 'FORM_FIELD_MISSING_IN_XML',
              severity: 'CRITICAL',
              description:
                "Bound path '$.Header.PostingDate' not found in XML structure",
            },
          ];
          payload = JSON.stringify(
            {
              xdp_content: `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template>
    <subform name="InvoiceForm" dataRef="$.Invoice">
      <field name="InvoiceNum"><bind match="dataRef" ref="$.Header.InvoiceID"/></field>
      <field name="PostingDate"><bind match="dataRef" ref="$.Header.PostingDate"/></field>
    </subform>
  </template>
</xdp:xdp>`,
              xml_content: `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <Header>
    <InvoiceID>90001234</InvoiceID>
    <DocumentDate>2026-09-25</DocumentDate>
  </Header>
</Invoice>`,
            },
            null,
            2,
          );
        } else if (dto.failureType === ScenarioFailureType.FORM_TRUNCATION_RISK) {
          expectedFindings = [
            {
              ruleId: 'FORM_XDP_PARSE_ERROR',
              severity: 'BLOCKER',
              description: 'Adobe Form XDP template failed XML validation',
            },
          ];
          payload = JSON.stringify(
            {
              xdp_content: `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template>
    <subform name="BrokenForm" dataRef="$.Invoice">
      <field name="UnclosedTag"><bind match="dataRef" ref="$.Header.InvoiceID"/>
    <!-- Intentionally broken XDP syntax for regression testing -->
  </template>
</xdp:xdp>`,
              xml_content: `<?xml version="1.0" encoding="UTF-8"?><Invoice><Header><InvoiceID>1</InvoiceID></Header></Invoice>`,
            },
            null,
            2,
          );
        } else {
          // CLEAN_PASS
          expectedFindings = [];
          payload = JSON.stringify(
            {
              xdp_content: `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template>
    <subform name="InvoiceForm" dataRef="$.Invoice">
      <field name="InvoiceNum"><bind match="dataRef" ref="$.Header.InvoiceID"/></field>
      <field name="SupplierTax"><bind match="dataRef" ref="$.Header.Supplier.TaxNumber"/></field>
      <field name="TotalAmount"><bind match="dataRef" ref="$.Header.TotalAmount"/></field>
    </subform>
  </template>
</xdp:xdp>`,
              xml_content: `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <Header>
    <InvoiceID>90001234</InvoiceID>
    <Supplier><ID>100045</ID><TaxNumber>DE123456789</TaxNumber></Supplier>
    <TotalAmount Currency="EUR">14250.00</TotalAmount>
  </Header>
</Invoice>`,
            },
            null,
            2,
          );
        }
        break;

      case ScenarioDomain.MFS:
        format = 'json';
        if (dto.failureType === ScenarioFailureType.MFS_LOCATION_JUMP) {
          expectedFindings = [
            {
              ruleId: 'MFS_IMPOSSIBLE_TOPOLOGY_JUMP',
              severity: 'CRITICAL',
              description:
                'Impossible conveyor topology jump: HU_8811 jumped from CP01 to CP05 without conveyor path',
            },
          ];
          payload = JSON.stringify(
            {
              conveyor_edges: [
                ['CP01', 'CP02'],
                ['CP02', 'CP03'],
                ['CP03', 'CP04'],
              ],
              telegrams: [
                {
                  timestamp: '2026-09-25T03:14:10.000Z',
                  time_sec: 10.0,
                  type: 'MOVE',
                  hu_id: 'HU_8811',
                  cp: 'CP01',
                  seq_no: 201,
                  sender_plc: 'PLC01',
                  receiver_plc: 'EWM',
                  status: 'OK',
                },
                {
                  timestamp: '2026-09-25T03:14:10.200Z',
                  time_sec: 10.2,
                  type: 'ACK',
                  hu_id: 'HU_8811',
                  cp: 'CP01',
                  seq_no: 201,
                  sender_plc: 'EWM',
                  receiver_plc: 'PLC01',
                  status: 'OK',
                },
                {
                  timestamp: '2026-09-25T03:14:12.500Z',
                  time_sec: 12.5,
                  type: 'MOVE',
                  hu_id: 'HU_8811',
                  cp: 'CP05',
                  seq_no: 202,
                  sender_plc: 'PLC01',
                  receiver_plc: 'EWM',
                  status: 'OK',
                },
              ],
            },
            null,
            2,
          );
        } else if (dto.failureType === ScenarioFailureType.MFS_ACK_TIMEOUT) {
          expectedFindings = [
            {
              ruleId: 'MFS_MISSING_ACK_TIMEOUT',
              severity: 'CRITICAL',
              description:
                'Telegram seq_no 301 missing ACK response within timeout threshold',
            },
          ];
          payload = JSON.stringify(
            {
              conveyor_edges: [
                ['CP01', 'CP02'],
                ['CP02', 'CP03'],
              ],
              telegrams: [
                {
                  timestamp: '2026-09-25T03:15:00.000Z',
                  time_sec: 1.0,
                  type: 'MOVE',
                  hu_id: 'HU_9901',
                  cp: 'CP01',
                  seq_no: 301,
                  sender_plc: 'PLC01',
                  receiver_plc: 'EWM',
                  status: 'OK',
                },
                {
                  timestamp: '2026-09-25T03:15:02.000Z',
                  time_sec: 2.0,
                  type: 'MOVE',
                  hu_id: 'HU_9901',
                  cp: 'CP01',
                  seq_no: 301,
                  sender_plc: 'PLC01',
                  receiver_plc: 'EWM',
                  status: 'OK',
                },
                {
                  timestamp: '2026-09-25T03:15:03.000Z',
                  time_sec: 3.0,
                  type: 'MOVE',
                  hu_id: 'HU_9901',
                  cp: 'CP01',
                  seq_no: 301,
                  sender_plc: 'PLC01',
                  receiver_plc: 'EWM',
                  status: 'OK',
                },
              ],
            },
            null,
            2,
          );
        } else {
          // CLEAN_PASS
          expectedFindings = [];
          payload = JSON.stringify(
            {
              conveyor_edges: [
                ['CP01', 'CP02'],
                ['CP02', 'CP03'],
                ['CP03', 'CP04'],
                ['CP04', 'CP05'],
              ],
              telegrams: [
                {
                  timestamp: '2026-09-25T03:14:00.000Z',
                  time_sec: 1.0,
                  type: 'MOVE',
                  hu_id: 'HU_1001',
                  cp: 'CP01',
                  seq_no: 100,
                  sender_plc: 'PLC01',
                  receiver_plc: 'EWM',
                  status: 'OK',
                },
                {
                  timestamp: '2026-09-25T03:14:00.200Z',
                  time_sec: 1.2,
                  type: 'ACK',
                  hu_id: 'HU_1001',
                  cp: 'CP01',
                  seq_no: 100,
                  sender_plc: 'EWM',
                  receiver_plc: 'PLC01',
                  status: 'OK',
                },
                {
                  timestamp: '2026-09-25T03:14:02.000Z',
                  time_sec: 3.0,
                  type: 'MOVE',
                  hu_id: 'HU_1001',
                  cp: 'CP02',
                  seq_no: 101,
                  sender_plc: 'PLC01',
                  receiver_plc: 'EWM',
                  status: 'OK',
                },
                {
                  timestamp: '2026-09-25T03:14:02.150Z',
                  time_sec: 3.15,
                  type: 'ACK',
                  hu_id: 'HU_1001',
                  cp: 'CP02',
                  seq_no: 101,
                  sender_plc: 'EWM',
                  receiver_plc: 'PLC01',
                  status: 'OK',
                },
              ],
            },
            null,
            2,
          );
        }
        break;

      case ScenarioDomain.CHANGE_POINTER:
        format = 'json';
        if (
          dto.failureType === ScenarioFailureType.CP_MISSING_FIELD_TRIGGER
        ) {
          expectedFindings = [
            {
              ruleId: 'CP_CRITICAL_FIELD_MISSING',
              severity: 'MAJOR',
              description:
                'Critical field MARA-BRGEW omitted from BD52 change pointer trigger definition',
            },
          ];
          payload = JSON.stringify(
            {
              message_type: 'MATMAS',
              target_message_type: 'MATMAS',
              change_document_object: 'MATERIAL',
              bd61_active: true,
              bd50_msg_types: ['MATMAS'],
              bd52_fields: [
                ['MARA', 'MATKL'],
                ['MARA', 'MEINS'],
              ],
              expected_fields: [
                ['MARA', 'MATKL'],
                ['MARA', 'MEINS'],
                ['MARA', 'BRGEW'],
              ],
            },
            null,
            2,
          );
        } else if (dto.failureType === ScenarioFailureType.CP_GLOBAL_DISABLED) {
          expectedFindings = [
            {
              ruleId: 'CP_GLOBAL_DISABLED',
              severity: 'BLOCKER',
              description:
                'Global change pointers inactive in BD61 configuration',
            },
          ];
          payload = JSON.stringify(
            {
              message_type: 'MATMAS',
              target_message_type: 'MATMAS',
              change_document_object: 'MATERIAL',
              bd61_active: false,
              bd50_msg_types: ['MATMAS'],
              bd52_fields: [['MARA', 'MATKL']],
              expected_fields: [['MARA', 'MATKL']],
            },
            null,
            2,
          );
        } else {
          // CLEAN_PASS
          expectedFindings = [];
          payload = JSON.stringify(
            {
              message_type: 'MATMAS',
              target_message_type: 'MATMAS',
              change_document_object: 'MATERIAL',
              bd61_active: true,
              bd50_msg_types: ['MATMAS'],
              bd52_fields: [
                ['MARA', 'MATKL'],
                ['MARA', 'GROES'],
                ['MARA', 'MEINS'],
              ],
              expected_fields: [
                ['MARA', 'MATKL'],
                ['MARA', 'GROES'],
                ['MARA', 'MEINS'],
              ],
            },
            null,
            2,
          );
        }
        break;

      default:
        throw new BadRequestException(`Unsupported scenario domain: ${dto.domain}`);
    }

    const result: SyntheticScenarioResult = {
      scenarioId,
      projectId,
      domain: dto.domain,
      scenarioName: name,
      failureType: dto.failureType,
      payload,
      expectedFindings,
      format,
      createdAt: new Date().toISOString(),
    };

    // Auto-persist in background when tenant and project context exist
    if (tenantId && projectId) {
      this.persistScenario(result, tenantId, projectId).catch((err: any) => {
        this.logger.warn(`Failed to persist synthetic scenario: ${err.message}`);
      });
    }

    return result;
  }

  /**
   * Persists a generated synthetic scenario record to PostgreSQL synthetic_scenarios table.
   */
  async persistScenario(
    scenario: SyntheticScenarioResult,
    tenantId: string,
    projectId: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO synthetic_scenarios (
        id, organization_id, project_id, domain, scenario_name,
        failure_type, payload, expected_findings, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        scenario_name = EXCLUDED.scenario_name,
        payload = EXCLUDED.payload,
        expected_findings = EXCLUDED.expected_findings,
        updated_at = NOW()`,
      [
        scenario.scenarioId,
        tenantId,
        projectId,
        scenario.domain,
        scenario.scenarioName,
        scenario.failureType,
        scenario.payload,
        JSON.stringify(scenario.expectedFindings),
      ],
      { tenantId }
    );
    this.logger.log(
      `Persisted synthetic scenario ${scenario.scenarioId} for project ${projectId}`
    );
  }

  /**
   * Dispatches live execution to the authoritative Python preflight analysis microservice,
   * completely eliminating mock facades. Compares actual findings against expected findings
   * to construct an audit-grade regression assertion ledger with cryptographic evidence.
   */
  async runScenario(
    dto: RunScenarioDto,
    tenantId?: string,
    projectId?: string,
  ): Promise<LabRunAssertionResult> {
    const runId = uuidv4();
    const executedAt = new Date().toISOString();
    const payloadHash = crypto
      .createHash('sha256')
      .update(dto.payload)
      .digest('hex');

    const effectiveTenantId =
      tenantId || '00000000-0000-0000-0000-000000000000';
    const effectiveProjectId =
      projectId || dto.projectId || '00000000-0000-0000-0000-000000000000';
    const targetRelease = (dto.targetRelease || 'S4H_2023') as TargetRelease;

    // 1. Map domain to authoritative EngineType & ArtifactType
    const { engineType, artifactType, configuration, rawContent } =
      this.resolveEngineDispatch(dto);

    this.logger.log(
      `Executing Test Lab live run ${runId} for domain ${dto.domain} across engine ${engineType}`
    );

    // 2. Prepare standardized Wire Request
    const wireRequest = toWireJobRequest({
      jobId: runId,
      tenantId: effectiveTenantId,
      projectId: effectiveProjectId,
      engineType,
      targetRelease,
      artifactType,
      configuration,
      rawContent,
    });

    let rawPythonResponse: any;
    try {
      const response = await fetch(`${this.analysisUrl}/api/v1/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Tenant-Id': effectiveTenantId,
        },
        body: JSON.stringify(wireRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Analysis service error [HTTP ${response.status}]: ${errorText}`
        );
        throw new ServiceUnavailableException(
          `Preflight analysis engine returned HTTP ${response.status}: ${errorText}`
        );
      }

      rawPythonResponse = await response.json();
    } catch (err: any) {
      if (err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.logger.error(
        `Failed to reach analysis microservice at ${this.analysisUrl}: ${err.message}`
      );
      throw new ServiceUnavailableException(
        `Preflight analysis microservice is unreachable at ${this.analysisUrl}. Please ensure services/analysis-python is active. Details: ${err.message}`
      );
    }

    // 3. Validate response schema
    const validated = AnalysisJobResponseSchema.parse(rawPythonResponse);
    const actualFindings: Finding[] = (validated.findings as Finding[]) || [];

    // 4. Resolve Expected Findings
    const expectedList: ExpectedFindingDef[] =
      dto.expectedFindings && dto.expectedFindings.length > 0
        ? (dto.expectedFindings as ExpectedFindingDef[])
        : [];

    // 5. Build Pass/Fail Regression Assertion Ledger
    const ledger = this.buildAssertionLedger(
      expectedList,
      actualFindings,
      payloadHash,
    );

    const runResult: LabRunAssertionResult = {
      runId,
      scenarioId: dto.scenarioId,
      projectId: effectiveProjectId,
      domain: dto.domain,
      executedAt,
      overallStatus: ledger.overallStatus,
      verdict: ledger.verdict,
      passedCount: ledger.passedCount,
      failedCount: ledger.failedCount,
      passedAssertions: ledger.passedCount,
      failedAssertions: ledger.failedCount,
      allPassed: ledger.allPassed,
      assertionsCount: ledger.assertionsCount,
      executionTimeMs: validated.metrics?.executionTimeMs || 0,
      rulesEvaluated: validated.metrics?.rulesEvaluated || 0,
      payloadSha256: payloadHash,
      assertionLedger: ledger.assertionLedger,
      findings: actualFindings,
    };

    // 6. Update last_run_result in DB if scenarioId is known
    if (dto.scenarioId && tenantId) {
      try {
        await this.db.query(
          `UPDATE synthetic_scenarios
           SET last_run_result = $1, updated_at = NOW()
           WHERE id = $2 AND organization_id = $3`,
          [JSON.stringify(runResult), dto.scenarioId, tenantId],
          { tenantId }
        );
      } catch (err: any) {
        this.logger.warn(
          `Could not update last_run_result for scenario ${dto.scenarioId}: ${err.message}`
        );
      }
    }

    return runResult;
  }

  /**
   * Retrieves saved synthetic scenarios for a project workspace.
   */
  async getScenarios(
    tenantId?: string,
    projectId?: string,
  ): Promise<SyntheticScenarioResult[]> {
    if (!tenantId) return [];

    try {
      const res = await this.db.query(
        `SELECT
          id as "scenarioId",
          project_id as "projectId",
          domain,
          scenario_name as "scenarioName",
          failure_type as "failureType",
          payload,
          expected_findings as "expectedFindings",
          created_at as "createdAt"
         FROM synthetic_scenarios
         WHERE organization_id = $1 AND ($2::uuid IS NULL OR project_id = $2)
         ORDER BY created_at DESC`,
        [tenantId, projectId || null],
        { tenantId }
      );

      return res.rows.map((row) => ({
        scenarioId: row.scenarioId,
        projectId: row.projectId,
        domain: row.domain as ScenarioDomain,
        scenarioName: row.scenarioName,
        failureType: row.failureType as ScenarioFailureType,
        payload: row.payload,
        expectedFindings: Array.isArray(row.expectedFindings)
          ? row.expectedFindings
          : typeof row.expectedFindings === 'string'
            ? JSON.parse(row.expectedFindings)
            : [],
        format:
          row.domain === ScenarioDomain.OPD
            ? 'xml'
            : row.domain === ScenarioDomain.FORM
              ? 'json'
              : 'json',
        createdAt: row.createdAt?.toISOString?.() || row.createdAt,
      }));
    } catch (err: any) {
      this.logger.warn(`Failed to fetch scenarios from DB: ${err.message}`);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: Dispatch Normalization per Domain
  // ---------------------------------------------------------------------------
  private resolveEngineDispatch(dto: RunScenarioDto): {
    engineType: EngineType;
    artifactType: 'XML' | 'JSON' | 'CSV' | 'XDP';
    configuration: Record<string, any>;
    rawContent: string;
  } {
    const config = { ...(dto.configuration || {}) };
    let engineType: EngineType;
    let artifactType: 'XML' | 'JSON' | 'CSV' | 'XDP' = 'JSON';
    let rawContent = dto.payload;

    switch (dto.domain) {
      case ScenarioDomain.OPD:
        engineType = 'OPD_GUARD';
        artifactType = 'XML';
        break;

      case ScenarioDomain.FORM:
        engineType = 'FORM_DOCTOR';
        artifactType = 'JSON';
        try {
          const parsed = JSON.parse(dto.payload);
          if (parsed.xdp_content) config.xdp_content = parsed.xdp_content;
          if (parsed.xml_content) config.xml_content = parsed.xml_content;
        } catch {
          // If raw XDP template text was passed directly
          if (dto.payload.includes('<xdp:xdp')) {
            config.xdp_content = dto.payload;
            artifactType = 'XDP';
          }
        }
        break;

      case ScenarioDomain.MFS:
        engineType = 'MFS_BLACKBOX';
        artifactType = 'JSON';
        break;

      case ScenarioDomain.CHANGE_POINTER:
        engineType = 'CHANGE_POINTER_COVERAGE_AUDITOR';
        artifactType = 'JSON';
        break;

      default:
        throw new BadRequestException(`Unknown scenario domain: ${dto.domain}`);
    }

    return { engineType, artifactType, configuration: config, rawContent };
  }

  // ---------------------------------------------------------------------------
  // Helper: Strict Pass/Fail Regression Assertion Ledger Builder
  // ---------------------------------------------------------------------------
  private buildAssertionLedger(
    expectedFindings: ExpectedFindingDef[],
    actualFindings: Finding[],
    payloadHash: string,
  ): {
    assertionLedger: LabAssertionItem[];
    passedCount: number;
    failedCount: number;
    allPassed: boolean;
    assertionsCount: number;
    overallStatus: 'PASSED' | 'FAILED' | 'REGRESSION_DETECTED';
    verdict: 'CLEAR' | 'DEFECTS_DETECTED';
  } {
    const ledger: LabAssertionItem[] = [];
    const matchedActualIds = new Set<string>();

    // 1. Scenario was expected to be a Clean Pass (0 defects expected)
    if (expectedFindings.length === 0) {
      if (actualFindings.length === 0) {
        ledger.push({
          ruleId: 'CLEAN_PASS',
          ruleName: 'Baseline Clean Scenario Evaluation',
          severity: 'INFO',
          expected: true,
          actual: true,
          passed: true,
          evidenceSha256: payloadHash,
          confidenceClass: 'VERIFIED',
          message:
            'All deterministic preflight rules passed cleanly without defect triggers.',
        });
      } else {
        for (const f of actualFindings) {
          ledger.push({
            ruleId: f.ruleId,
            ruleName: f.title || f.ruleId,
            severity: f.severity,
            expected: false,
            actual: true,
            passed: false,
            evidenceSha256: f.evidence?.[0]?.sha256 || payloadHash,
            confidenceClass: (f.confidence as ConfidenceClass) || 'VERIFIED',
            evidenceSnippet: f.evidence?.[0]?.snippet ?? undefined,
            lineNumber: f.evidence?.[0]?.lineNumber ?? undefined,
            message: `False positive / Unexpected defect: ${f.title || f.ruleId}`,
          });
        }
      }
    } else {
      // 2. Scenario has expected defect rules to verify
      for (const exp of expectedFindings) {
        const match = actualFindings.find((f) => f.ruleId === exp.ruleId);
        if (match) {
          matchedActualIds.add(match.id || match.ruleId);
          ledger.push({
            ruleId: exp.ruleId,
            ruleName: match.title || exp.ruleId,
            severity: exp.severity || match.severity,
            expected: true,
            actual: true,
            passed: true,
            evidenceSha256: match.evidence?.[0]?.sha256 || payloadHash,
            confidenceClass: (match.confidence as ConfidenceClass) || 'VERIFIED',
            evidenceSnippet: match.evidence?.[0]?.snippet ?? undefined,
            lineNumber: match.evidence?.[0]?.lineNumber ?? undefined,
            message: `Defect verified: Preflight engine correctly triggered rule ${exp.ruleId}`,
          });
        } else {
          ledger.push({
            ruleId: exp.ruleId,
            ruleName: exp.description || exp.ruleId,
            severity: exp.severity || 'CRITICAL',
            expected: true,
            actual: false,
            passed: false,
            evidenceSha256: payloadHash,
            confidenceClass: 'VERIFIED',
            message: `Regression / Defect Missed: Expected defect ${exp.ruleId} was NOT triggered by preflight analysis!`,
          });
        }
      }

      // Check for any unpredicted findings that appeared alongside expected ones
      for (const f of actualFindings) {
        if (!matchedActualIds.has(f.id || f.ruleId)) {
          ledger.push({
            ruleId: f.ruleId,
            ruleName: f.title || f.ruleId,
            severity: f.severity,
            expected: false,
            actual: true,
            passed: false,
            evidenceSha256: f.evidence?.[0]?.sha256 || payloadHash,
            confidenceClass: (f.confidence as ConfidenceClass) || 'VERIFIED',
            evidenceSnippet: f.evidence?.[0]?.snippet ?? undefined,
            lineNumber: f.evidence?.[0]?.lineNumber ?? undefined,
            message: `Unexpected finding: Rule ${f.ruleId} triggered unexpectedly.`,
          });
        }
      }
    }

    const passedCount = ledger.filter((a) => a.passed).length;
    const failedCount = ledger.filter((a) => !a.passed).length;
    const allPassed = failedCount === 0;

    let overallStatus: 'PASSED' | 'FAILED' | 'REGRESSION_DETECTED';
    if (allPassed) {
      overallStatus = 'PASSED';
    } else if (
      ledger.some((a) => a.expected && !a.actual) ||
      ledger.some((a) => !a.expected && a.actual)
    ) {
      overallStatus = 'REGRESSION_DETECTED';
    } else {
      overallStatus = 'FAILED';
    }

    const verdict: 'CLEAR' | 'DEFECTS_DETECTED' =
      actualFindings.length === 0 ? 'CLEAR' : 'DEFECTS_DETECTED';

    return {
      assertionLedger: ledger,
      passedCount,
      failedCount,
      allPassed,
      assertionsCount: ledger.length,
      overallStatus,
      verdict,
    };
  }
}
