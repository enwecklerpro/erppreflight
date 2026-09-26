import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { ConnectorsService } from '../connectors/connectors.service';
import { WorkItemsService, mapWorkItemRow } from '../connectors/work-items.service';
import { CloudAlmAdapter } from '../connectors/adapters/cloud-alm.adapter';
import { IntegrationAuditService } from '../connectors/integration-audit.service';
import { isWorkItemConnector } from '../connectors/connector-registry';
import { parseBody } from '../connectors/zod-body';

export const ImportRequirementsSchema = z.object({ connectorId: z.string().uuid() }).strict();
export const LinkFindingSchema = z.object({ findingId: z.string().uuid().nullable() }).strict();
export const CreateRemediationTaskSchema = z
  .object({
    findingId: z.string().uuid(),
    connectorId: z.string().uuid().optional(),
    externalSystem: z.enum(['SAP_CLOUD_ALM', 'JIRA', 'AZURE_DEVOPS', 'SERVICENOW']).optional(),
    confirm: z.boolean().default(false),
    dryRun: z.boolean().default(false),
  })
  .strict();

/**
 * Delivery traceability (Part 15.1/15.18, C §33).
 *
 * The matrix is built exclusively from persisted data: requirements imported
 * from SAP Cloud ALM (or created by the finding→task workflow), findings,
 * external work items and generated tests. Nothing is seeded or simulated; an
 * empty project yields an empty matrix.
 */
@Injectable()
export class TraceabilityService {
  private readonly logger = new Logger(TraceabilityService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly connectors: ConnectorsService,
    private readonly workItems: WorkItemsService,
    private readonly audit: IntegrationAuditService
  ) {}

  private async assertProject(organizationId: string, projectId: string) {
    const res = await this.db.query(`SELECT id, target_release FROM projects WHERE organization_id = $1 AND id = $2`, [organizationId, projectId], {
      tenantId: organizationId,
    });
    if (!res.rows[0]) throw new NotFoundException('Project not found');
    return res.rows[0];
  }

  async getMatrix(organizationId: string, projectId: string) {
    await this.assertProject(organizationId, projectId);
    const nodes = await this.db.query(
      `SELECT t.*, f.title AS finding_title, f.severity AS finding_severity, f.rule_id AS finding_rule_id,
              ts.title AS test_title, ts.status AS test_run_status
         FROM traceability_nodes t
         LEFT JOIN findings f ON f.id = t.finding_id AND f.organization_id = t.organization_id
         LEFT JOIN tests ts ON ts.id = t.test_case_id AND ts.organization_id = t.organization_id
        WHERE t.organization_id = $1 AND t.project_id = $2
        ORDER BY t.process_hierarchy, t.requirement_id`,
      [organizationId, projectId],
      { tenantId: organizationId }
    );
    const workItems = await this.workItems.list(organizationId, { projectId });
    const critical = await this.db.query(
      `SELECT f.id FROM findings f
        WHERE f.organization_id = $1 AND f.project_id = $2 AND f.severity IN ('BLOCKER','CRITICAL')
          AND f.analysis_id = (SELECT a.id FROM analyses a WHERE a.organization_id = $1 AND a.project_id = $2
                                AND a.status IN ('COMPLETED','PARTIAL') ORDER BY a.completed_at DESC NULLS LAST LIMIT 1)`,
      [organizationId, projectId],
      { tenantId: organizationId }
    );
    const linkedFindings = new Set(workItems.map((w) => w.findingId).filter(Boolean));
    const rows = nodes.rows.map((r: any) => ({
      id: r.id,
      processHierarchy: r.process_hierarchy,
      requirementId: r.requirement_id,
      requirementTitle: r.requirement_title,
      findingId: r.finding_id,
      findingTitle: r.finding_title,
      findingSeverity: r.finding_severity,
      findingRuleId: r.finding_rule_id,
      remediationTaskId: r.remediation_task_id,
      taskStatus: r.task_status,
      testCaseId: r.test_case_id,
      testTitle: r.test_title,
      testStatus: r.test_run_status ?? r.test_status,
      transportId: r.transport_id,
      releaseId: r.release_id,
      businessCriticality: r.business_criticality,
      externalSystem: r.external_system,
    }));
    const requirements = rows.filter((r) => !r.requirementId.startsWith('FINDING-'));
    const doneItems = workItems.filter((w) => w.remediationState === 'VERIFIED_RESOLVED').length;
    return {
      nodes: rows,
      workItems,
      summary: {
        totalRequirements: requirements.length,
        requirementsWithoutTests: requirements.filter((r) => !r.testCaseId).length,
        requirementsWithFindings: requirements.filter((r) => r.findingId).length,
        criticalFindingsInLatestRun: critical.rows.length,
        criticalFindingsWithoutTasks: critical.rows.filter((f: any) => !linkedFindings.has(f.id)).length,
        workItemsTotal: workItems.length,
        workItemsPendingVerification: workItems.filter((w) => w.remediationState === 'PENDING_VERIFICATION').length,
        workItemsVerifiedResolved: doneItems,
        workItemsInConflict: workItems.filter((w) => w.conflictState === 'CONFLICT').length,
        // null when there is nothing to measure (never a fabricated 100 %)
        remediationVerifiedPercent: workItems.length ? Math.round((doneItems / workItems.length) * 100) : null,
      },
    };
  }

  /** Imports Cloud ALM requirements of the mapped Cloud ALM project into the traceability graph. */
  async importRequirements(organizationId: string, actorId: string | null, projectId: string, body: unknown) {
    const dto = parseBody(ImportRequirementsSchema, body);
    const project = await this.assertProject(organizationId, projectId);
    const connector = await this.connectors.getRow(organizationId, dto.connectorId);
    if (connector.connector_type !== 'SAP_CLOUD_ALM') throw new BadRequestException('Requirements import requires a SAP Cloud ALM connector');
    const link = await this.connectors.getProjectLink(organizationId, connector.id, projectId);
    const externalProjectId = link?.external_project_id || (connector.config as any).defaultProjectId;
    if (!externalProjectId) throw new BadRequestException('Map this project to a Cloud ALM project first');
    if (link && link.sync_direction === 'PUSH_ONLY') {
      throw new BadRequestException('The project mapping is PUSH_ONLY; enable PULL_ONLY or BIDIRECTIONAL to import requirements');
    }
    const requirements = await this.connectors.execute(
      connector,
      'requirements.import',
      (ctx, adapter) => (adapter as CloudAlmAdapter).listRequirements(ctx as any, externalProjectId),
      { actorId, objectType: 'REQUIREMENT', objectRef: externalProjectId }
    );
    let created = 0;
    let updated = 0;
    await this.db.withTenantTransaction(organizationId, async (client) => {
      for (const r of requirements) {
        const reqId = (r.displayId || r.id).slice(0, 100);
        const upd = await client.query(
          `UPDATE traceability_nodes SET requirement_title = $4, process_hierarchy = COALESCE($5, process_hierarchy), updated_at = NOW()
            WHERE organization_id = $1 AND project_id = $2 AND requirement_id = $3 AND external_system = 'SAP_CLOUD_ALM' RETURNING id`,
          [organizationId, projectId, reqId, r.title.slice(0, 500), r.processHierarchy ?? null]
        );
        if (upd.rows.length) {
          updated++;
          continue;
        }
        await client.query(
          `INSERT INTO traceability_nodes (id, organization_id, project_id, process_hierarchy, requirement_id, requirement_title,
             task_status, release_id, business_criticality, external_system)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'HIGH','SAP_CLOUD_ALM')`,
          [uuidv4(), organizationId, projectId, (r.processHierarchy || 'Unassigned').slice(0, 255), reqId, r.title.slice(0, 500), r.status.slice(0, 50), String(project.target_release).slice(0, 100)]
        );
        created++;
      }
    });
    await this.audit.record({
      organizationId,
      action: 'traceability.requirements_imported',
      resourceType: 'PROJECT',
      resourceId: projectId,
      actorId,
      payload: { connectorId: connector.id, externalProjectId, created, updated },
    });
    return { imported: requirements.length, created, updated, externalProjectId };
  }

  async linkFinding(organizationId: string, actorId: string | null, projectId: string, nodeId: string, body: unknown) {
    const dto = parseBody(LinkFindingSchema, body);
    if (dto.findingId) {
      const f = await this.db.query(`SELECT id FROM findings WHERE organization_id = $1 AND project_id = $2 AND id = $3`, [organizationId, projectId, dto.findingId], {
        tenantId: organizationId,
      });
      if (!f.rows[0]) throw new NotFoundException('Finding not found in this project');
    }
    const res = await this.db.query(
      `UPDATE traceability_nodes SET finding_id = $4, updated_at = NOW() WHERE organization_id = $1 AND project_id = $2 AND id = $3 RETURNING id`,
      [organizationId, projectId, nodeId, dto.findingId],
      { tenantId: organizationId }
    );
    if (!res.rows[0]) throw new NotFoundException('Traceability node not found');
    await this.audit.record({
      organizationId,
      action: 'traceability.finding_linked',
      resourceType: 'PROJECT',
      resourceId: projectId,
      actorId,
      payload: { nodeId, findingId: dto.findingId },
    });
    return { success: true };
  }

  /**
   * Finding → remediation task through a configured connector. Used by the
   * findings module (`POST /findings/:id/work-item`) and the traceability route.
   * Without a configured work item connector this returns NOT_CONFIGURED — never
   * a fabricated task id.
   */
  async createRemediationTask(organizationId: string, projectId: string, body: unknown, actorId: string | null = null) {
    const dto = parseBody(CreateRemediationTaskSchema, body);
    let connectorId = dto.connectorId;
    if (!connectorId) {
      const all = (await this.connectors.list(organizationId)).filter(
        (c) => isWorkItemConnector(c.type) && c.status === 'ACTIVE' && (!dto.externalSystem || c.type === dto.externalSystem)
      );
      if (all.length === 0) {
        return {
          success: false,
          status: 'NOT_CONFIGURED',
          error: `No active ${dto.externalSystem ?? 'work item'} connector is configured for this organization. Configure one under Integrations.`,
        };
      }
      if (all.length > 1) {
        return {
          success: false,
          status: 'CONNECTOR_SELECTION_REQUIRED',
          error: 'Several work item connectors are configured; select one explicitly (connectorId).',
          connectors: all.map((c) => ({ id: c.id, name: c.name, type: c.type })),
        };
      }
      connectorId = all[0].id;
    }
    const f = await this.db.query(`SELECT project_id FROM findings WHERE organization_id = $1 AND id = $2`, [organizationId, dto.findingId], {
      tenantId: organizationId,
    });
    if (!f.rows[0] || f.rows[0].project_id !== projectId) throw new NotFoundException('Finding not found in this project');
    const result: any = await this.workItems.createForFinding(organizationId, actorId, {
      findingId: dto.findingId,
      connectorId,
      confirm: dto.confirm,
      dryRun: dto.dryRun,
    });
    if (result.dryRun) return { success: true, ...result };
    const wi = result.workItem;
    return {
      success: true,
      status: result.alreadyLinked ? 'ALREADY_LINKED' : 'CREATED',
      workItem: wi,
      workItemId: wi.externalKey || wi.externalId,
      externalSystem: wi.externalSystem,
      deepLink: wi.externalUrl,
    };
  }

  async listWorkItemsForFinding(organizationId: string, findingId: string) {
    const res = await this.db.query(
      `SELECT w.*, c.name AS connector_name FROM external_work_items w JOIN connector_instances c ON c.id = w.connector_id
        WHERE w.organization_id = $1 AND w.finding_id = $2`,
      [organizationId, findingId],
      { tenantId: organizationId }
    );
    return res.rows.map(mapWorkItemRow);
  }
}
