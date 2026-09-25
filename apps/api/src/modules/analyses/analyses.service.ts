import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { EVIDENCE_JSON_AGG_SQL, mapEvidenceList } from '../findings/evidence.mapper';

@Injectable()
export class AnalysesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService
  ) {}

  /** Payload is runtime-validated (Zod, strict) by JobsService.triggerAnalysis. */
  async triggerAnalysis(tenantId: string, userId: string, body: unknown) {
    return this.jobsService.triggerAnalysis(tenantId, userId, body);
  }

  async findAll(tenantId: string, projectId?: string) {
    const conditions = ['organization_id = $1'];
    const params: unknown[] = [tenantId];
    if (projectId) {
      conditions.push('project_id = $2');
      params.push(projectId);
    }
    const where = conditions.join(' AND ');

    const res = await this.db.query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM findings f WHERE f.analysis_id = a.id) AS findings_count
       FROM analyses a
       WHERE ${where}
       ORDER BY a.created_at DESC`,
      params
    );

    return res.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      status: row.status,
      isBaseline: Boolean(row.is_baseline),
      engineTypes: row.engine_types || [],
      targetRelease: row.target_release,
      triggeredBy: row.triggered_by,
      findingsCount: row.findings_count || 0,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  }

  async findById(tenantId: string, analysisId: string) {
    const res = await this.db.query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM findings f WHERE f.analysis_id = a.id) AS findings_count
       FROM analyses a
       WHERE a.organization_id = $1 AND a.id = $2`,
      [tenantId, analysisId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Analysis run '${analysisId}' not found.`);
    }

    const row = res.rows[0];
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      status: row.status,
      isBaseline: Boolean(row.is_baseline),
      engineTypes: row.engine_types || [],
      targetRelease: row.target_release,
      triggeredBy: row.triggered_by,
      findingsCount: row.findings_count || 0,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  async getFindingsForAnalysis(tenantId: string, analysisId: string) {
    // Verify analysis exists for tenant
    await this.findById(tenantId, analysisId);

    const res = await this.db.query(
      `SELECT f.*,
              ${EVIDENCE_JSON_AGG_SQL} AS evidence
       FROM findings f
       WHERE f.organization_id = $1 AND f.analysis_id = $2
       ORDER BY
         CASE f.severity
           WHEN 'BLOCKER' THEN 1
           WHEN 'CRITICAL' THEN 2
           WHEN 'MAJOR' THEN 3
           WHEN 'MEDIUM' THEN 4
           WHEN 'MINOR' THEN 5
           ELSE 6
         END,
         f.created_at DESC`,
      [tenantId, analysisId]
    );

    return res.rows.map((row) => ({
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
      evidence: mapEvidenceList(row.evidence),
    }));
  }
}
