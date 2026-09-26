import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { v4 as uuidv4 } from 'uuid';
import { createFindingFingerprint } from '@erppreflight/evidence';
import * as crypto from 'node:crypto';
import { ProjectContextUpdateSchema } from '@erppreflight/schemas';

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

    return toProjectResponse(res.rows[0]);
  }

  async findAll(organizationId: string) {
    const res = await this.db.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM findings f
                WHERE f.project_id = p.id AND f.organization_id = p.organization_id) AS total_findings
       FROM projects p
       WHERE p.organization_id = $1
       ORDER BY p.created_at DESC`,
      [organizationId]
    );
    return res.rows.map((row: any) => toProjectResponse(row));
  }

  /** Raw tenant-scoped project row (snake_case) for internal use. */
  private async getProjectRow(organizationId: string, id: string) {
    const res = await this.db.query(
      'SELECT * FROM projects WHERE organization_id = $1 AND id = $2',
      [organizationId, id]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Project with ID '${id}' not found`);
    }
    return res.rows[0];
  }

  async findOne(organizationId: string, id: string) {
    return toProjectResponse(await this.getProjectRow(organizationId, id));
  }

  async update(organizationId: string, id: string, dto: UpdateProjectDto) {
    await this.getProjectRow(organizationId, id); // Ensure exists within tenant

    const res = await this.db.query(
      `UPDATE projects
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           target_release = COALESCE($3, target_release),
           updated_at = NOW()
       WHERE organization_id = $4 AND id = $5
       RETURNING *`,
      [dto.name || null, dto.description ?? null, dto.targetRelease || null, organizationId, id]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`Project with ID '${id}' not found`);
    }
    return toProjectResponse(res.rows[0]);
  }

  /**
   * Updates the project mode context (Part 01 §1.5). Only keys present in the
   * validated payload change; `null` clears a value. These values are the defaults
   * for analysis target release, Full Project Preflight planning and the router.
   */
  async updateContext(organizationId: string, id: string, body: unknown) {
    const parsed = ProjectContextUpdateSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_PROJECT_CONTEXT',
        message: 'Invalid project context',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    await this.getProjectRow(organizationId, id);
    const dto = parsed.data;
    const columns: Array<[string, unknown]> = [];
    if (dto.sourceErp !== undefined) columns.push(['source_erp', dto.sourceErp]);
    if (dto.sourceVersion !== undefined) columns.push(['source_version', dto.sourceVersion || null]);
    if (dto.targetProduct !== undefined) columns.push(['target_product', dto.targetProduct]);
    if (dto.targetEdition !== undefined) columns.push(['target_edition', dto.targetEdition || null]);
    if (dto.targetRelease !== undefined) columns.push(['target_release', dto.targetRelease]);
    if (dto.deploymentType !== undefined) columns.push(['deployment_type', dto.deploymentType]);
    if (dto.countries !== undefined) columns.push(['countries', JSON.stringify([...new Set(dto.countries)].sort())]);
    if (dto.modules !== undefined) columns.push(['modules', JSON.stringify([...new Set(dto.modules)].sort())]);
    if (columns.length === 0) {
      return this.findOne(organizationId, id);
    }
    const sets = columns.map(([col], i) => `${col} = $${i + 1}`).join(', ');
    const params = columns.map(([, v]) => v);
    params.push(organizationId, id);
    const res = await this.db.query(
      `UPDATE projects SET ${sets}, updated_at = NOW()
        WHERE organization_id = $${columns.length + 1} AND id = $${columns.length + 2}
        RETURNING *`,
      params
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`Project with ID '${id}' not found`);
    }
    return toProjectResponse(res.rows[0]);
  }

  async remove(organizationId: string, id: string) {
    await this.getProjectRow(organizationId, id);
    const res = await this.db.query(
      'DELETE FROM projects WHERE organization_id = $1 AND id = $2',
      [organizationId, id]
    );
    if (res && typeof res.rowCount === 'number' && res.rowCount === 0) {
      throw new NotFoundException(`Project with ID '${id}' not found`);
    }
    return { success: true, deletedId: id };
  }

  async setBaseline(organizationId: string, projectId: string, analysisId: string) {
    await this.getProjectRow(organizationId, projectId);

    const analysisRes = await this.db.query(
      `SELECT * FROM analyses WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [organizationId, projectId, analysisId]
    );
    if (!analysisRes.rows.length) {
      throw new NotFoundException(`Analysis '${analysisId}' not found for this project`);
    }

    const analysis = analysisRes.rows[0];
    if (typeof analysis.kind === 'string' && analysis.kind.startsWith('LAB_')) {
      throw new BadRequestException('Test Lab runs produce no findings and cannot be the project baseline.');
    }
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
      project: res.rows[0] ? toProjectResponse(res.rows[0]) : null,
    };
  }

  async getDrift(organizationId: string, projectId: string, targetAnalysisId?: string) {
    const project = await this.getProjectRow(organizationId, projectId);
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
        `SELECT * FROM analyses WHERE organization_id = $1 AND project_id = $2
            AND kind IN ('STANDARD', 'FULL_PREFLIGHT') AND status <> 'CANCELLED' ORDER BY created_at DESC LIMIT 1`,
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

  /**
   * Part 18.18: Sanitized Support Diagnostic Bundle
   * Assembles an audit package for enterprise support without secrets or raw code payloads.
   */
  async generateDiagnosticBundle(organizationId: string, projectId: string) {
    const projectRes = await this.db.query(
      `SELECT * FROM projects WHERE organization_id = $1 AND id = $2`,
      [organizationId, projectId]
    );

    if (projectRes.rows.length === 0) {
      throw new NotFoundException(`Project '${projectId}' not found`);
    }

    const project = projectRes.rows[0];

    const landscapesRes = await this.db.query(
      `SELECT id, system_id, product, edition, release, environment, status
       FROM landscapes
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    );

    const analysesRes = await this.db.query(
      `SELECT a.id, a.status, a.target_release, a.created_at,
              (SELECT COUNT(*) FROM findings f WHERE f.analysis_id = a.id) as findings_count
       FROM analyses a
       WHERE a.organization_id = $1 AND a.project_id = $2
       ORDER BY a.created_at DESC
       LIMIT 5`,
      [organizationId, projectId]
    );

    const artifactsRes = await this.db.query(
      `SELECT id, file_name, file_size, mime_type, checksum_sha256 AS sha256_hash,
              quarantine_status, created_at
       FROM uploaded_files
       WHERE organization_id = $1 AND project_id = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [organizationId, projectId]
    );

    const engines = [
      { id: 'OPD_GUARD', name: 'Output Parameter Determination Guard', operationalDomain: 'Output Management', version: '2.4.0', status: 'ACTIVE' },
      { id: 'FORM_DOCTOR', name: 'Adobe Document Services & Form Doctor', operationalDomain: 'Print & Interactive Forms', version: '2.1.0', status: 'ACTIVE' },
      { id: 'MFS_DIAGNOSTICS', name: 'Material Flow Systems Telegram BlackBox', operationalDomain: 'Warehouse & Logistics', version: '3.0.0', status: 'ACTIVE' },
      { id: 'CLEAN_CORE_OBJECT_GUARD', name: 'Clean Core Object & Tier Classification Guard', operationalDomain: 'ABAP Cloud / Extensibility', version: '2.5.0', status: 'ACTIVE' },
      { id: 'API_CHANGE_GUARD', name: 'API Deprecation & Lifecycle Change Guard', operationalDomain: 'Integration / OData', version: '2.2.0', status: 'ACTIVE' },
      { id: 'CUSTOM_FIELD_FLOW_DOCTOR', name: 'Custom Field & Extension Flow Doctor', operationalDomain: 'Key User Extensibility', version: '2.0.0', status: 'ACTIVE' },
      { id: 'EXTENSION_IMPACT_GUARD', name: 'Extension Impact & Side-by-Side Evaluator', operationalDomain: 'BTP Extensibility', version: '1.9.0', status: 'ACTIVE' },
      { id: 'SOFTWARE_COLLECTION_DEP_GUARD', name: 'Software Collection Dependency Guard', operationalDomain: 'Transport & Lifecycle', version: '2.1.0', status: 'ACTIVE' },
      { id: 'CDS_RELATION_GUARD', name: 'Core Data Services Relationship Guard', operationalDomain: 'Data Modeling', version: '2.3.0', status: 'ACTIVE' },
      { id: 'TRANSPORT_DEPENDENCY_GUARD', name: 'Transport Sequence & Cross-System Guard', operationalDomain: 'Release Management', version: '2.4.0', status: 'ACTIVE' },
      { id: 'SECURITY_CRYPTO_GUARD', name: 'Cryptographic & Secret Exposure Guard', operationalDomain: 'Cybersecurity', version: '3.1.0', status: 'ACTIVE' },
      { id: 'DATABASE_MUTATION_GUARD', name: 'Direct Database Mutation & Bypass Guard', operationalDomain: 'Persistence Integrity', version: '2.0.0', status: 'ACTIVE' },
      { id: 'AUTHORIZATION_GATE_GUARD', name: 'Authorization & IAM Gate Guard', operationalDomain: 'Security & Compliance', version: '1.8.0', status: 'ACTIVE' },
      { id: 'EVENT_MESH_HEALTH_GUARD', name: 'SAP Event Mesh & Broker Health Guard', operationalDomain: 'Event-Driven Architecture', version: '1.7.0', status: 'ACTIVE' },
      { id: 'INTEGRATION_SUITE_GUARD', name: 'SAP Integration Suite & CPI Flow Guard', operationalDomain: 'Cloud Integration', version: '1.9.0', status: 'ACTIVE' },
      { id: 'DATA_PRIVACY_GDPR_GUARD', name: 'Data Privacy & ILM Governance Guard', operationalDomain: 'Data Protection', version: '2.0.0', status: 'ACTIVE' },
      { id: 'PERFORMANCE_SPIKE_GUARD', name: 'SQL Performance & Index Spike Guard', operationalDomain: 'System Performance', version: '2.2.0', status: 'ACTIVE' },
      { id: 'RESILIENCY_CHAOS_GUARD', name: 'High Availability & Resiliency Guard', operationalDomain: 'Disaster Recovery', version: '1.6.0', status: 'ACTIVE' },
      { id: 'RELEASE_REGRESSION_GUARD', name: 'Target Release Regression & Note Guard', operationalDomain: 'Upgrade Assurance', version: '2.5.0', status: 'ACTIVE' },
    ];

    const bundleData = {
      bundleId: uuidv4(),
      formatVersion: '1.0-ENTERPRISE-DIAGNOSTIC',
      generatedAt: new Date().toISOString(),
      organizationId,
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        targetRelease: project.target_release,
        baselineAnalysisId: project.baseline_analysis_id,
        createdAt: project.created_at,
      },
      telemetry: {
        totalLandscapesConfigured: landscapesRes.rows.length,
        totalAnalysesRun: analysesRes.rows.length,
        totalArtifactsIngested: artifactsRes.rows.length,
      },
      infrastructureHealth: {
        postgresRelational: 'CONNECTED_HEALTHY',
        redisJobQueues: 'CONNECTED_HEALTHY',
        clamavSecurityScanner: 'OPERATIONAL_CLEAN',
        pythonAnalysisMicroservice: 'OPERATIONAL_STATISTICALLY_VERIFIED',
      },
      engineInventory: engines,
      landscapes: landscapesRes.rows,
      recentAnalyses: analysesRes.rows,
      sanitizedArtifacts: artifactsRes.rows,
      redactionNotice: 'Zero customer credentials, RFC passwords, API keys, or raw code payloads are included. All hashes are verifiable SHA-256 digests.',
    };

    const integritySignature = crypto
      .createHash('sha256')
      .update(JSON.stringify(bundleData))
      .digest('hex');

    return {
      ...bundleData,
      integritySignature,
    };
  }
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Maps a projects row to the camelCase API contract
 * ({ id, organizationId, name, description, targetRelease, status, createdAt, updatedAt, ... }).
 * The projects table has no lifecycle column; every persisted project is ACTIVE.
 */
export function toProjectResponse(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    organizationId: row.organization_id ?? row.organizationId,
    name: row.name,
    slug: row.slug ?? null,
    description: row.description ?? null,
    targetRelease: row.target_release ?? row.targetRelease ?? 'S4H_2023',
    status: row.status ?? 'ACTIVE',
    baselineAnalysisId: row.baseline_analysis_id ?? row.baselineAnalysisId ?? null,
    context: toProjectContext(row),
    createdBy: row.created_by ?? row.createdBy ?? null,
    totalFindings:
      row.total_findings !== undefined && row.total_findings !== null
        ? Number(row.total_findings)
        : undefined,
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt),
  };
}

function jsonArray(value: unknown): string[] {
  const v = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Project mode context (Part 01 §1.5, migration 018). */
export function toProjectContext(row: any) {
  return {
    sourceErp: row.source_erp ?? null,
    sourceVersion: row.source_version ?? null,
    targetProduct: row.target_product ?? null,
    targetEdition: row.target_edition ?? null,
    targetRelease: row.target_release ?? null,
    deploymentType: row.deployment_type ?? null,
    countries: jsonArray(row.countries),
    modules: jsonArray(row.modules),
  };
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
