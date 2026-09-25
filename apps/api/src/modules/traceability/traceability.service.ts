import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateTraceabilityNodeDto, CreateRemediationTaskDto } from './dto/traceability.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TraceabilityService {
  private readonly logger = new Logger(TraceabilityService.name);

  constructor(private readonly db: DatabaseService) {}

  async getMatrix(organizationId: string, projectId: string) {
    // 1. Fetch existing nodes
    let res = await this.db.query(
      `SELECT t.*, f.title as finding_title, f.severity as finding_severity, f.rule_id as finding_rule_id
       FROM traceability_nodes t
       LEFT JOIN findings f ON t.finding_id = f.id
       WHERE t.organization_id = $1 AND t.project_id = $2
       ORDER BY t.created_at ASC`,
      [organizationId, projectId]
    );

    // If empty, auto-seed default traceability based on project findings
    if (!res.rows?.length) {
      await this.syncFromFindings(organizationId, projectId);
      res = await this.db.query(
        `SELECT t.*, f.title as finding_title, f.severity as finding_severity, f.rule_id as finding_rule_id
         FROM traceability_nodes t
         LEFT JOIN findings f ON t.finding_id = f.id
         WHERE t.organization_id = $1 AND t.project_id = $2
         ORDER BY t.created_at ASC`,
        [organizationId, projectId]
      );
    }

    const rows = res.rows || [];

    // Compute Gap Metrics (Part 15.18)
    const requirementsWithoutTests = rows.filter((r: any) => !r.test_case_id).length;
    const criticalFindingsWithoutTasks = rows.filter(
      (r: any) => (r.finding_severity === 'CRITICAL' || r.finding_severity === 'BLOCKER') && !r.remediation_task_id
    ).length;
    const transportsWithBlockers = rows.filter(
      (r: any) => r.finding_severity === 'BLOCKER' && r.transport_id
    ).length;

    const totalNodes = rows.length;
    const closedTasks = rows.filter((r: any) => r.task_status === 'COMPLETED' || r.task_status === 'VERIFIED').length;
    const readinessPercent = totalNodes > 0 ? Math.round((closedTasks / totalNodes) * 100) : 100;

    return {
      nodes: rows,
      summary: {
        totalRequirements: totalNodes,
        requirementsWithoutTests,
        criticalFindingsWithoutTasks,
        transportsWithBlockers,
        overallReadinessPercent: readinessPercent,
      },
    };
  }

  async syncFromFindings(organizationId: string, projectId: string) {
    const findingsRes = await this.db.query(
      `SELECT * FROM findings WHERE project_id = $1 AND organization_id = $2 ORDER BY severity ASC LIMIT 10`,
      [projectId, organizationId]
    );
    const findings = findingsRes.rows || [];

    const defaultProcesses = [
      { proc: 'Order-to-Cash (O2C)', reqId: 'REQ-O2C-01', title: 'Automated Billing Invoice Dispatch via Email' },
      { proc: 'Procure-to-Pay (P2P)', reqId: 'REQ-P2P-04', title: 'Purchase Order Approval Form Layout Compliance' },
      { proc: 'Record-to-Report (R2R)', reqId: 'REQ-R2R-09', title: 'Clean Core General Ledger Account Determination' },
      { proc: 'Warehouse & Logistics', reqId: 'REQ-EWM-02', title: 'MFS Telegram Buffer Sequence Resiliency' },
      { proc: 'Master Data Governance', reqId: 'REQ-MDG-07', title: 'MATMAS Change Pointer Event Propagation' },
    ];

    for (let i = 0; i < defaultProcesses.length; i++) {
      const p = defaultProcesses[i];
      const matchingFinding = findings[i % findings.length];
      const nodeId = uuidv4();
      const transportId = `TRK900${200 + i}`;

      await this.db.query(
        `INSERT INTO traceability_nodes (
          id, organization_id, project_id, process_hierarchy, requirement_id, requirement_title,
          finding_id, remediation_task_id, task_status, transport_id, release_id, business_criticality, external_system
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'REL_2026_01', $11, 'SAP_CLOUD_ALM')
        ON CONFLICT DO NOTHING`,
        [
          nodeId,
          organizationId,
          projectId,
          p.proc,
          p.reqId,
          p.title,
          matchingFinding ? matchingFinding.id : null,
          matchingFinding ? `CALM-TSK-${1000 + i}` : null,
          matchingFinding ? 'OPEN' : 'COMPLETED',
          transportId,
          i === 0 ? 'CRITICAL' : 'HIGH',
        ]
      );
    }

    return { success: true };
  }

  async createRemediationTask(organizationId: string, projectId: string, dto: CreateRemediationTaskDto) {
    const findingRes = await this.db.query(
      `SELECT * FROM findings WHERE id = $1 AND organization_id = $2 AND project_id = $3`,
      [dto.findingId, organizationId, projectId]
    );
    if (!findingRes.rows?.length) {
      throw new NotFoundException(`Finding with ID '${dto.findingId}' not found`);
    }
    const finding = findingRes.rows[0];

    // Fetch evidence
    const evidenceRes = await this.db.query(
      `SELECT * FROM evidence WHERE finding_id = $1 AND organization_id = $2 LIMIT 1`,
      [dto.findingId, organizationId]
    );
    const evidence = evidenceRes.rows?.[0];

    const system = dto.externalSystem || 'SAP_CLOUD_ALM';
    const taskId = `${system === 'SAP_CLOUD_ALM' ? 'CALM-TSK' : system === 'JIRA' ? 'JIRA-ERP' : 'ADO-TASK'}-${Date.now().toString().slice(-5)}`;

    // Update or insert into traceability_nodes
    await this.db.query(
      `UPDATE traceability_nodes
       SET remediation_task_id = $1,
           task_status = 'IN_PROGRESS',
           updated_at = NOW()
       WHERE organization_id = $2 AND project_id = $3 AND finding_id = $4`,
      [taskId, organizationId, projectId, dto.findingId]
    );

    return {
      taskId,
      externalSystem: system,
      findingId: finding.id,
      title: `[Remediation] ${finding.rule_id}: ${finding.title}`,
      severity: finding.severity,
      deepLink: `https://erppreflight.com/projects/${projectId}/findings?id=${finding.id}`,
      remediationSummary: finding.remediation || 'Follow Clean Core guidance to refactor target object.',
      evidenceArtifact: evidence?.artifact_path || 'unknown_artifact',
      evidenceSha256: evidence?.sha256 || 'none',
      status: 'SYNCHRONIZED',
    };
  }
}
