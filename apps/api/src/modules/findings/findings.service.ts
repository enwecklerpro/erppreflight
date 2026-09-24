import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

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
}
