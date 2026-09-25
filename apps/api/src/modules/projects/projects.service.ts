import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { v4 as uuidv4 } from 'uuid';
import { createFindingFingerprint } from '@erppreflight/evidence';

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService) {}

  async create(organizationId: string, userId: string, dto: CreateProjectDto) {
    const id = uuidv4();
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);

    const targetRelease = dto.targetRelease || 'S4H_2023';

    const res = await this.db.query(
      `INSERT INTO projects (id, organization_id, name, slug, description, target_release, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, organizationId, dto.name, `${slug}-${Date.now().toString().slice(-4)}`, dto.description || null, targetRelease, userId]
    );

    return res.rows[0];
  }

  async findAll(organizationId: string) {
    const res = await this.db.query(
      `SELECT p.*, COUNT(f.id)::int as total_findings
       FROM projects p
       LEFT JOIN findings f ON f.project_id = p.id
       WHERE p.organization_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [organizationId]
    );
    return res.rows;
  }

  async findOne(organizationId: string, id: string) {
    const res = await this.db.query(
      'SELECT * FROM projects WHERE organization_id = $1 AND id = $2',
      [organizationId, id]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Project with ID '${id}' not found`);
    }
    return res.rows[0];
  }

  async update(organizationId: string, id: string, dto: UpdateProjectDto) {
    await this.findOne(organizationId, id); // Ensure exists

    const res = await this.db.query(
      `UPDATE projects
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           target_release = COALESCE($3, target_release),
           updated_at = NOW()
       WHERE organization_id = $4 AND id = $5
       RETURNING *`,
      [dto.name || null, dto.description || null, dto.targetRelease || null, organizationId, id]
    );
    return res.rows[0];
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    await this.db.query(
      'DELETE FROM projects WHERE organization_id = $1 AND id = $2',
      [organizationId, id]
    );
    return { success: true, deletedId: id };
  }

  async setBaseline(organizationId: string, projectId: string, analysisId: string) {
    await this.findOne(organizationId, projectId);

    const analysisRes = await this.db.query(
      `SELECT * FROM analyses WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [organizationId, projectId, analysisId]
    );
    if (!analysisRes.rows.length) {
      throw new NotFoundException(`Analysis '${analysisId}' not found for this project`);
    }

    const analysis = analysisRes.rows[0];
    if (analysis.status && analysis.status.toUpperCase() !== 'COMPLETED') {
      throw new BadRequestException(
        `Only COMPLETED analysis runs can be marked as the official project baseline. Current status is '${analysis.status}'.`
      );
    }

    await this.db.query(
      `UPDATE analyses SET is_baseline = false WHERE organization_id = $1 AND project_id = $2`,
      [organizationId, projectId]
    );

    await this.db.query(
      `UPDATE analyses SET is_baseline = true WHERE organization_id = $1 AND id = $2`,
      [organizationId, analysisId]
    );

    const res = await this.db.query(
      `UPDATE projects SET baseline_analysis_id = $1, updated_at = NOW() WHERE organization_id = $2 AND id = $3 RETURNING *`,
      [analysisId, organizationId, projectId]
    );

    return {
      success: true,
      projectId,
      baselineAnalysisId: analysisId,
      project: res.rows[0],
    };
  }

  async getDrift(organizationId: string, projectId: string, targetAnalysisId?: string) {
    const project = await this.findOne(organizationId, projectId);
    const baselineAnalysisId = project.baseline_analysis_id;

    if (!baselineAnalysisId) {
      return {
        hasBaseline: false,
        message: 'No active baseline set for this project.',
        baseline: null,
        comparison: null,
        driftSummary: {
          knownBaselineRisks: 0,
          newlyIntroducedRisks: 0,
          resolvedRisks: 0,
          scoreDelta: 0,
        },
        findings: {
          knownBaseline: [],
          newlyIntroduced: [],
          resolved: [],
        },
      };
    }

    const baselineAnalysisRes = await this.db.query(
      `SELECT * FROM analyses WHERE organization_id = $1 AND id = $2`,
      [organizationId, baselineAnalysisId]
    );
    const baselineAnalysis = baselineAnalysisRes.rows[0];

    let comparisonAnalysis: any = null;
    if (targetAnalysisId) {
      const compRes = await this.db.query(
        `SELECT * FROM analyses WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
        [organizationId, projectId, targetAnalysisId]
      );
      comparisonAnalysis = compRes.rows[0];
    } else {
      const latestRes = await this.db.query(
        `SELECT * FROM analyses WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [organizationId, projectId]
      );
      comparisonAnalysis = latestRes.rows[0];
    }

    const baselineFindingsRes = await this.db.query(
      `SELECT * FROM findings WHERE organization_id = $1 AND analysis_id = $2`,
      [organizationId, baselineAnalysisId]
    );
    const baselineFindings = baselineFindingsRes.rows || [];

    if (!comparisonAnalysis) {
      const baselineScore = computeCleanCoreIndex(baselineFindings);
      return {
        hasBaseline: true,
        baseline: {
          id: baselineAnalysis.id,
          name: baselineAnalysis.name || `Baseline Run (${baselineAnalysis.created_at})`,
          createdAt: baselineAnalysis.created_at,
          totalFindings: baselineFindings.length,
          cleanCoreIndex: baselineScore,
          targetRelease: baselineAnalysis.target_release,
        },
        comparison: null,
        message: 'No comparison analysis available yet.',
        driftSummary: {
          knownBaselineRisks: 0,
          newlyIntroducedRisks: 0,
          resolvedRisks: 0,
          scoreDelta: 0,
        },
        findings: {
          knownBaseline: [],
          newlyIntroduced: [],
          resolved: [],
        },
      };
    }

    const comparisonFindingsRes = await this.db.query(
      `SELECT * FROM findings WHERE organization_id = $1 AND analysis_id = $2`,
      [organizationId, comparisonAnalysis.id]
    );
    const comparisonFindings = comparisonFindingsRes.rows || [];

    const baselineBuckets = new Map<string, any[]>();
    for (const f of baselineFindings) {
      const key = getFindingKey(f);
      if (!baselineBuckets.has(key)) {
        baselineBuckets.set(key, []);
      }
      baselineBuckets.get(key)!.push(f);
    }

    const comparisonBuckets = new Map<string, any[]>();
    for (const f of comparisonFindings) {
      const key = getFindingKey(f);
      if (!comparisonBuckets.has(key)) {
        comparisonBuckets.set(key, []);
      }
      comparisonBuckets.get(key)!.push(f);
    }

    const knownBaseline: any[] = [];
    const newlyIntroduced: any[] = [];
    const resolved: any[] = [];

    const allKeys = new Set<string>([...baselineBuckets.keys(), ...comparisonBuckets.keys()]);

    for (const key of allKeys) {
      const baseItems = baselineBuckets.get(key) || [];
      const compItems = comparisonBuckets.get(key) || [];

      const matchedCount = Math.min(baseItems.length, compItems.length);

      for (let i = 0; i < matchedCount; i++) {
        knownBaseline.push({
          ...compItems[i],
          driftClassification: 'KNOWN_BASELINE_RISK',
          baselineFindingId: baseItems[i].id,
        });
      }

      for (let i = matchedCount; i < compItems.length; i++) {
        newlyIntroduced.push({
          ...compItems[i],
          driftClassification: 'NEWLY_INTRODUCED_RISK',
        });
      }

      for (let i = matchedCount; i < baseItems.length; i++) {
        resolved.push({
          ...baseItems[i],
          driftClassification: 'RESOLVED_RISK',
        });
      }
    }

    let baselineScore: number;
    let comparisonScore: number;
    if (baselineAnalysis.clean_core_score !== undefined && comparisonAnalysis.clean_core_score !== undefined) {
      baselineScore = Number(baselineAnalysis.clean_core_score);
      comparisonScore = Number(comparisonAnalysis.clean_core_score);
    } else {
      baselineScore = computeCleanCoreIndex(baselineFindings);
      comparisonScore = computeCleanCoreIndex(comparisonFindings);
    }
    const scoreDelta = Math.round((comparisonScore - baselineScore) * 10) / 10;

    return {
      hasBaseline: true,
      baseline: {
        id: baselineAnalysis.id,
        name: baselineAnalysis.name || `Baseline Run (${baselineAnalysis.created_at})`,
        createdAt: baselineAnalysis.created_at,
        totalFindings: baselineFindings.length,
        cleanCoreIndex: baselineScore,
        targetRelease: baselineAnalysis.target_release,
      },
      comparison: {
        id: comparisonAnalysis.id,
        name: comparisonAnalysis.name || `Comparison Run (${comparisonAnalysis.created_at})`,
        createdAt: comparisonAnalysis.created_at,
        totalFindings: comparisonFindings.length,
        cleanCoreIndex: comparisonScore,
        targetRelease: comparisonAnalysis.target_release,
      },
      driftSummary: {
        knownBaselineRisks: knownBaseline.length,
        newlyIntroducedRisks: newlyIntroduced.length,
        resolvedRisks: resolved.length,
        scoreDelta,
      },
      findings: {
        knownBaseline,
        newlyIntroduced,
        resolved,
      },
    };
  }
}

export function computeCleanCoreIndex(findings: any[]): number {
  if (!findings || findings.length === 0) return 100;

  let blockers = 0;
  let criticals = 0;
  let majors = 0;

  for (const f of findings) {
    const sev = (f.severity || '').toUpperCase();
    if (sev === 'BLOCKER') blockers++;
    else if (sev === 'CRITICAL') criticals++;
    else if (sev === 'MAJOR') majors++;
  }

  const penalty = Math.min(100, blockers * 15 + criticals * 8 + majors * 3);
  return Math.max(0, Math.round((100 - penalty) * 10) / 10);
}

function getFindingKey(f: any): string {
  if (f.fingerprint && typeof f.fingerprint === 'string' && f.fingerprint.trim().length > 0) {
    return f.fingerprint.trim();
  }
  const ruleId = f.rule_id || f.ruleId || 'UNKNOWN_RULE';
  const objName =
    (Array.isArray(f.affected_objects) && f.affected_objects[0]?.name) ||
    (Array.isArray(f.affectedObjects) && f.affectedObjects[0]?.name) ||
    (typeof f.affected_objects?.[0] === 'string' ? f.affected_objects[0] : null) ||
    (typeof f.affectedObjects?.[0] === 'string' ? f.affectedObjects[0] : null) ||
    'GLOBAL';
  const artifactPath =
    (Array.isArray(f.evidence) && (f.evidence[0]?.artifact_path || f.evidence[0]?.artifactPath)) ||
    f.artifact_path ||
    f.artifactPath ||
    'UNKNOWN_SOURCE';

  return createFindingFingerprint(ruleId, objName, artifactPath);
}
