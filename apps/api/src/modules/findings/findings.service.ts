import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as crypto from 'node:crypto';

export interface FindFindingsRequest {
  projectId?: string;
  engine?: string;
  severity?: string;
  category?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class FindingsService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(tenantId: string, query: FindFindingsRequest) {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 25));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['organization_id = $1'];
    const params: unknown[] = [tenantId];
    let paramIndex = 2;

    if (query.projectId) {
      conditions.push(`project_id = $${paramIndex++}`);
      params.push(query.projectId);
    }
    if (query.engine) {
      conditions.push(`engine = $${paramIndex++}`);
      params.push(query.engine);
    }
    if (query.severity) {
      conditions.push(`severity = $${paramIndex++}`);
      params.push(query.severity.toUpperCase());
    }
    if (query.category) {
      conditions.push(`category = $${paramIndex++}`);
      params.push(query.category);
    }
    if (query.search) {
      conditions.push(
        `(title ILIKE $${paramIndex} OR description ILIKE $${paramIndex} OR rule_id ILIKE $${paramIndex})`
      );
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Total count query
    const countRes = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM findings WHERE ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    // Items query with pagination
    const itemsRes = await this.db.query(
      `SELECT f.*,
              (SELECT json_agg(e.*) FROM evidence e WHERE e.finding_id = f.id) AS evidence
       FROM findings f
       WHERE ${whereClause}
       ORDER BY
         CASE f.severity
           WHEN 'BLOCKER' THEN 1
           WHEN 'CRITICAL' THEN 2
           WHEN 'MAJOR' THEN 3
           WHEN 'MEDIUM' THEN 4
           WHEN 'MINOR' THEN 5
           ELSE 6
         END,
         f.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset]
    );

    const findings = itemsRes.rows.map((row) => ({
      id: row.id,
      jobId: row.analysis_id,
      analysisId: row.analysis_id,
      projectId: row.project_id,
      organizationId: row.organization_id,
      engineType: row.engine,
      ruleId: row.rule_id,
      severity: row.severity,
      category: row.category,
      title: row.title,
      description: row.description,
      confidence: row.confidence_class,
      confidenceScore: Number(row.confidence_score),
      remediation: row.remediation,
      affectedObjects: row.affected_objects || [],
      technicalDetails: row.technical_details || {},
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      evidence: Array.isArray(row.evidence) ? row.evidence : [],
    }));

    return {
      items: findings,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findById(tenantId: string, findingId: string) {
    const res = await this.db.query(
      `SELECT f.*,
              (SELECT json_agg(e.*) FROM evidence e WHERE e.finding_id = f.id) AS evidence
       FROM findings f
       WHERE f.organization_id = $1 AND f.id = $2`,
      [tenantId, findingId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Finding with ID '${findingId}' not found.`);
    }

    const row = res.rows[0];
    return {
      id: row.id,
      jobId: row.analysis_id,
      analysisId: row.analysis_id,
      projectId: row.project_id,
      organizationId: row.organization_id,
      engineType: row.engine,
      ruleId: row.rule_id,
      severity: row.severity,
      category: row.category,
      title: row.title,
      description: row.description,
      confidence: row.confidence_class,
      confidenceScore: Number(row.confidence_score),
      remediation: row.remediation,
      affectedObjects: row.affected_objects || [],
      technicalDetails: row.technical_details || {},
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      evidence: Array.isArray(row.evidence) ? row.evidence : [],
    };
  }

  async getStats(tenantId: string, projectId?: string) {
    const conditions = ['organization_id = $1'];
    const params: unknown[] = [tenantId];
    if (projectId) {
      conditions.push('project_id = $2');
      params.push(projectId);
    }
    const where = conditions.join(' AND ');

    const [severityRes, engineRes, totalRes] = await Promise.all([
      this.db.query(
        `SELECT severity, COUNT(*)::int AS count FROM findings WHERE ${where} GROUP BY severity`,
        params
      ),
      this.db.query(
        `SELECT engine, COUNT(*)::int AS count FROM findings WHERE ${where} GROUP BY engine`,
        params
      ),
      this.db.query(
        `SELECT COUNT(*)::int AS total FROM findings WHERE ${where}`,
        params
      ),
    ]);

    const bySeverity: Record<string, number> = {
      BLOCKER: 0,
      CRITICAL: 0,
      MAJOR: 0,
      MEDIUM: 0,
      MINOR: 0,
      LOW: 0,
      INFO: 0,
    };
    severityRes.rows.forEach((r) => {
      bySeverity[r.severity] = r.count;
    });

    const byEngine: Record<string, number> = {};
    engineRes.rows.forEach((r) => {
      byEngine[r.engine] = r.count;
    });

    const total = totalRes.rows[0]?.total || 0;
    const blockers = bySeverity.BLOCKER || 0;
    const criticals = bySeverity.CRITICAL || 0;
    const majors = bySeverity.MAJOR || 0;

    // Clean core compliance index calculation
    // Starts at 100%, penalized deterministically by finding severity
    const penalty = Math.min(100, blockers * 15 + criticals * 8 + majors * 3);
    const cleanCoreIndex = total === 0 ? 100 : Math.max(0, Math.round((100 - penalty) * 10) / 10);

    return {
      totalFindings: total,
      cleanCoreIndex,
      bySeverity,
      byEngine,
      blockerAndCriticalCount: blockers + criticals,
    };
  }

  /**
   * Part 15.7 & 15.8: Finding-to-Task Work Item Creation
   */
  async createWorkItem(
    tenantId: string,
    findingId: string,
    userId: string,
    dto: { system?: string; title?: string; process?: string }
  ) {
    const finding = await this.findById(tenantId, findingId);
    const system = (dto.system || 'SAP_CLOUD_ALM').toUpperCase();
    const taskPrefix = system.includes('JIRA')
      ? 'JIRA'
      : system.includes('AZURE')
      ? 'ADO'
      : system.includes('GITHUB')
      ? 'GH'
      : system.includes('SERVICENOW')
      ? 'SNOW'
      : 'CALM';

    const taskId = `${taskPrefix}-TSK-${Math.floor(1000 + Math.random() * 9000)}`;
    const deepLink = `https://erppreflight.com/projects/${finding.projectId}/findings?findingId=${finding.id}`;

    const firstEvidence = finding.evidence?.[0];
    const evidenceSnippet = firstEvidence ? firstEvidence.snippet : 'No snippet captured';

    const workItemPayload = {
      findingId: finding.id,
      title: dto.title || `[${finding.severity}] Remediate ${finding.ruleId}: ${finding.title}`,
      severity: finding.severity,
      conciseReason: finding.description,
      exactEvidence: evidenceSnippet,
      affectedObjects: finding.affectedObjects,
      recommendedRemediation: finding.remediation,
      deepLink,
      targetRelease: 'S4H_2023',
      reproducibilitySupportId: crypto
        .createHash('sha256')
        .update(`${finding.id}:${finding.fingerprint}`)
        .digest('hex')
        .slice(0, 16),
    };

    // Link/Insert into traceability_nodes
    await this.db.query(
      `INSERT INTO traceability_nodes (
        organization_id, project_id, process_hierarchy, requirement_id, requirement_title,
        finding_id, remediation_task_id, task_status, business_criticality, external_system
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8, $9)`,
      [
        tenantId,
        finding.projectId,
        dto.process || 'Core Logistics & ERP',
        `REQ-${taskPrefix}-${Math.floor(100 + Math.random() * 900)}`,
        `Remediate ${finding.ruleId}`,
        finding.id,
        taskId,
        finding.severity === 'BLOCKER' || finding.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        system,
      ]
    );

    return {
      success: true,
      workItemId: taskId,
      externalSystem: system,
      deepLink,
      taskBody: workItemPayload,
    };
  }

  /**
   * Part 14.12, 14.13 & 15.13: Expert Review Mode, Risk Waiver & False-Positive Suppression
   */
  async reviewFinding(
    tenantId: string,
    findingId: string,
    userId: string,
    dto: {
      status: 'OPEN' | 'VERIFIED' | 'ACCEPTED_RISK' | 'SUPPRESSED_FALSE_POSITIVE';
      justification: string;
      suppressScope?: 'FINDING_ONLY' | 'OBJECT_RULE' | 'TENANT_OVERRIDE';
    }
  ) {
    const finding = await this.findById(tenantId, findingId);

    const reviewRecord = {
      status: dto.status,
      justification: dto.justification || 'Reviewed by SAP Solution Architect',
      reviewedBy: userId,
      reviewedAt: new Date().toISOString(),
      suppressScope: dto.suppressScope || 'FINDING_ONLY',
    };

    const updatedTechnicalDetails = {
      ...(finding.technicalDetails || {}),
      review: reviewRecord,
    };

    // Update target finding
    await this.db.query(
      `UPDATE findings
       SET technical_details = $1
       WHERE organization_id = $2 AND id = $3`,
      [JSON.stringify(updatedTechnicalDetails), tenantId, findingId]
    );

    // If scope is OBJECT_RULE or TENANT_OVERRIDE, cascade review to matching findings
    if (
      (dto.suppressScope === 'OBJECT_RULE' || dto.suppressScope === 'TENANT_OVERRIDE') &&
      finding.ruleId
    ) {
      const objName =
        (Array.isArray(finding.affectedObjects) && (finding.affectedObjects[0] as any)?.name) ||
        null;

      if (dto.suppressScope === 'OBJECT_RULE' && objName) {
        await this.db.query(
          `UPDATE findings
           SET technical_details = jsonb_set(COALESCE(technical_details, '{}'::jsonb), '{review}', $1::jsonb)
           WHERE organization_id = $2
             AND rule_id = $3
             AND affected_objects @> $4::jsonb`,
          [
            JSON.stringify(reviewRecord),
            tenantId,
            finding.ruleId,
            JSON.stringify([{ name: objName }]),
          ]
        );
      } else if (dto.suppressScope === 'TENANT_OVERRIDE') {
        await this.db.query(
          `UPDATE findings
           SET technical_details = jsonb_set(COALESCE(technical_details, '{}'::jsonb), '{review}', $1::jsonb)
           WHERE organization_id = $2 AND rule_id = $3`,
          [JSON.stringify(reviewRecord), tenantId, finding.ruleId]
        );
      }
    }

    return await this.findById(tenantId, findingId);
  }
}

