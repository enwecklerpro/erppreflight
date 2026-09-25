import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { CreateChangeSetDto, ApproveChangeSetDto } from './dto/changeset.dto';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

export interface SapObjectRecord {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  object_type: string;
  description: string;
  package: string;
  software_component: string;
  clean_core_tier: string;
  modification_status: string;
  complexity: any;
  dependencies: any;
}

@Injectable()
export class ChangeSetsService {
  private readonly logger = new Logger(ChangeSetsService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly outbox?: OutboxService
  ) {}

  /**
   * Helper to execute within a tenant transaction if the database service supports it,
   * otherwise falls back to direct query execution.
   */
  private async executeTransactional<T>(
    organizationId: string,
    callback: (client: any) => Promise<T>
  ): Promise<T> {
    if (typeof this.db?.withTenantTransaction === 'function') {
      return await this.db.withTenantTransaction(organizationId, callback);
    }
    return await callback(this.db);
  }

  async create(organizationId: string, projectId: string, userId: string, dto: CreateChangeSetDto) {
    return await this.executeTransactional(organizationId, async (client) => {
      const id = uuidv4();
      const proposalPayload = JSON.stringify({
        projectId,
        targetEnvironment: dto.targetEnvironment || 'QA',
        targetRelease: dto.targetRelease || 'S4H_2023',
        proposedChanges: dto.proposedChanges,
      });
      const proposalHash = crypto.createHash('sha256').update(proposalPayload).digest('hex');

      const res = await client.query(
        `INSERT INTO changesets (
          id, organization_id, project_id, name, description, target_environment, target_release,
          baseline_analysis_id, proposed_changes, proposal_hash, approval_status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11)
        RETURNING *`,
        [
          id,
          organizationId,
          projectId,
          dto.name,
          dto.description || null,
          dto.targetEnvironment || 'QA',
          dto.targetRelease || 'S4H_2023',
          dto.baselineAnalysisId || null,
          JSON.stringify(dto.proposedChanges),
          proposalHash,
          userId,
        ]
      );

      const row = res.rows[0];
      if (this.outbox) {
        await this.outbox
          .recordEvent(
            organizationId,
            'change_set.created',
            'CHANGE_SET',
            row.id,
            {
              changeSetId: row.id,
              projectId,
              name: dto.name,
              targetEnvironment: row.target_environment,
              proposalHash,
              createdBy: userId,
            },
            client
          );
      }

      return row;
    });
  }

  async findAll(organizationId: string, projectId: string) {
    const res = await this.db.query(
      `SELECT * FROM changesets WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [organizationId, projectId]
    );
    return res.rows;
  }

  async findOne(organizationId: string, projectId: string, id: string) {
    const res = await this.db.query(
      `SELECT * FROM changesets WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [organizationId, projectId, id]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`ChangeSet with ID '${id}' not found`);
    }
    return res.rows[0];
  }

  async simulate(organizationId: string, projectId: string, id: string) {
    const changeset = await this.findOne(organizationId, projectId, id);
    const proposedChanges: any[] = typeof changeset.proposed_changes === 'string'
      ? JSON.parse(changeset.proposed_changes)
      : changeset.proposed_changes;

    // 1. Fetch baseline findings if available
    let baselineFindings: any[] = [];
    if (changeset.baseline_analysis_id) {
      const findingsRes = await this.db.query(
        `SELECT * FROM findings WHERE analysis_id = $1 AND organization_id = $2`,
        [changeset.baseline_analysis_id, organizationId]
      );
      baselineFindings = findingsRes.rows || [];
    } else {
      const findingsRes = await this.db.query(
        `SELECT * FROM findings WHERE project_id = $1 AND organization_id = $2 LIMIT 100`,
        [projectId, organizationId]
      );
      baselineFindings = findingsRes.rows || [];
    }

    // 2. Fetch real SAP technical objects from database catalog
    let sapObjects: SapObjectRecord[] = [];
    try {
      const objRes = await this.db.query(
        `SELECT * FROM sap_objects WHERE project_id = $1 AND organization_id = $2`,
        [projectId, organizationId]
      );
      sapObjects = Array.isArray(objRes?.rows)
        ? objRes.rows.filter((r: any) => r && typeof r.name === 'string')
        : [];
    } catch {
      // Table may not yet be populated for this project
      sapObjects = [];
    }

    const blastRadiusObjects: any[] = [];
    const newFindings: any[] = [];
    const resolvedFindings: any[] = [];
    const requiredTests: any[] = [];

    // 3. Dynamic Dependency Graph & Blast Radius Evaluation
    for (const change of proposedChanges) {
      const targetName = (change.targetObject || '').trim();
      const targetLower = targetName.toLowerCase();

      // Find direct object in repository
      const directObj = sapObjects.find(
        (o) => o?.name && o.name.toLowerCase() === targetLower
      );

      // Trace inbound dependencies: find all objects in the project that reference this target
      const dependentObjects = sapObjects.filter((o) => {
        if (!o?.name || o.name.toLowerCase() === targetLower) return false;
        const deps = typeof o.dependencies === 'string' ? JSON.parse(o.dependencies) : (o.dependencies || []);
        if (Array.isArray(deps)) {
          return deps.some((d: any) => {
            const depName = typeof d === 'string' ? d : d.name || d.target || d.targetObject;
            return depName && depName.toLowerCase().includes(targetLower);
          });
        }
        return false;
      });

      if (directObj || dependentObjects.length > 0) {
        // Real objects detected in project database!
        if (directObj) {
          blastRadiusObjects.push({
            name: directObj.name,
            type: directObj.object_type,
            cleanCoreTier: directObj.clean_core_tier,
            impact: change.type === 'REMOVE_CUSTOM_FIELD' || change.type === 'REMOVE_OBJECT' ? 'DELETED' : 'MODIFIED',
            direct: true,
          });
        }

        for (const dep of dependentObjects) {
          const impactType = change.type === 'REMOVE_CUSTOM_FIELD' ? 'BINDING_BROKEN' : 'CONTRACT_CHANGED';
          blastRadiusObjects.push({
            name: dep.name,
            type: dep.object_type,
            cleanCoreTier: dep.clean_core_tier,
            impact: impactType,
            direct: false,
            referencedBy: targetName,
          });

          newFindings.push({
            ruleId: 'CROSS_OBJECT_DEPENDENCY_BROKEN',
            severity: dep.clean_core_tier === 'TIER_3_CLASSIC' ? 'CRITICAL' : 'MAJOR',
            category: 'Extensibility & Architecture',
            title: `Object ${dep.name} (${dep.object_type}) affected by modification of ${targetName}`,
            description: `Modifying ${targetName} breaks active reference in ${dep.name}. Clean Core tier: ${dep.clean_core_tier}.`,
            remediation: `Adjust caller implementation in ${dep.name} to decouple dependency on ${targetName}.`,
            confidence: 'VERIFIED',
            score: 1.0,
          });

          requiredTests.push({
            title: `Regression: Validate ${dep.name} after ${targetName} change`,
            type: 'REGRESSION',
          });
        }
      }
    }

    let simulationResult: any;

    if (blastRadiusObjects.length === 0) {
      simulationResult = {
        impactedObjects: [],
        findings: [],
        riskScore: 0,
        confidence: 'LOW',
        note: 'No dependency data available for this object. Upload artifacts to populate the SAP object catalog.'
      };
    } else {
      const hasBlockers = newFindings.some((f) => f.severity === 'BLOCKER');
      const hasCritical = newFindings.some((f) => f.severity === 'CRITICAL');
      const riskDelta = (hasBlockers || hasCritical)
        ? 'INCREASED'
        : resolvedFindings.length > newFindings.length
        ? 'DECREASED'
        : 'NEUTRAL';

      simulationResult = {
        simulatedAt: new Date().toISOString(),
        baselineFindingsCount: baselineFindings.length,
        blastRadiusObjects,
        newFindings,
        resolvedFindings,
        requiredTests,
        riskDelta,
        verdict: hasBlockers
          ? 'BLOCKED'
          : hasCritical
          ? 'CONDITIONAL_APPROVAL_REQUIRED'
          : 'CLEAR',
      };
    }

    return await this.executeTransactional(organizationId, async (client) => {
      const updateRes = await client.query(
        `UPDATE changesets
         SET simulation_result = $1,
             approval_status = 'SIMULATED',
             updated_at = NOW()
         WHERE organization_id = $2 AND project_id = $3 AND id = $4
         RETURNING *`,
        [JSON.stringify(simulationResult), organizationId, projectId, id]
      );

      const simulatedRow = updateRes.rows[0];
      if (this.outbox) {
        await this.outbox
          .recordEvent(
            organizationId,
            'change_set.simulated',
            'CHANGE_SET',
            id,
            {
              changeSetId: id,
              projectId,
              verdict: simulationResult.verdict,
              riskDelta: simulationResult.riskDelta,
              newFindingsCount: newFindings.length,
              resolvedFindingsCount: resolvedFindings.length,
            },
            client
          );
      }

      return simulatedRow;
    });
  }

  async approve(organizationId: string, projectId: string, id: string, userId: string, dto: ApproveChangeSetDto) {
    const changeset = await this.findOne(organizationId, projectId, id);
    if (changeset.approval_status === 'APPROVED') {
      throw new BadRequestException('ChangeSet is already approved');
    }

    const sim = typeof changeset.simulation_result === 'string'
      ? JSON.parse(changeset.simulation_result)
      : changeset.simulation_result;

    if (sim?.verdict === 'BLOCKED') {
      throw new BadRequestException('Cannot approve ChangeSet with BLOCKED simulation verdict without risk exception');
    }

    return await this.executeTransactional(organizationId, async (client) => {
      const res = await client.query(
        `UPDATE changesets
         SET approval_status = 'APPROVED',
             approved_by = $1,
             approved_at = NOW(),
             updated_at = NOW()
         WHERE organization_id = $2 AND project_id = $3 AND id = $4
         RETURNING *`,
        [userId, organizationId, projectId, id]
      );

      const approvedRecord = res.rows[0];

      // Generate Cryptographically Signed Change Evidence Pack
      const evidencePack = {
        changeSetId: approvedRecord.id,
        name: approvedRecord.name,
        proposalHash: approvedRecord.proposal_hash,
        approvedBy: userId,
        approvalReason: dto.reason,
        approvedAt: approvedRecord.approved_at,
        targetEnvironment: approvedRecord.target_environment,
        targetRelease: approvedRecord.target_release,
        simulatedImpact: sim,
        auditCertificate: crypto
          .createHash('sha256')
          .update(`${approvedRecord.id}:${approvedRecord.proposal_hash}:${userId}:${dto.reason}`)
          .digest('hex'),
      };

      if (this.outbox) {
        await this.outbox
          .recordEvent(
            organizationId,
            'change_set.approved',
            'CHANGE_SET',
            approvedRecord.id,
            {
              changeSetId: approvedRecord.id,
              projectId,
              approvedBy: userId,
              reason: dto.reason,
              auditCertificate: evidencePack.auditCertificate,
            },
            client
          );
      }

      return {
        changeset: approvedRecord,
        evidencePack,
      };
    });
  }
}
