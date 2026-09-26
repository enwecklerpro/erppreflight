import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EVIDENCE_JSON_AGG_SQL, mapEvidenceList } from './evidence.mapper';
import { OutboxService } from '../outbox/outbox.service';
import { TraceabilityService } from '../traceability/traceability.service';

export interface FindFindingsRequest {
  projectId?: string;
  engine?: string;
  severity?: string;
  category?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  /** Lifecycle status filter (comma-separated list allowed). */
  status?: string;
  /** 'me' | 'unassigned' | <user uuid> */
  assignee?: string;
  /** 'overdue' | 'due_soon' | 'no_due_date' */
  due?: string;
  /** Only the latest detection per lifecycle (hides superseded rows of earlier analyses). */
  latest?: boolean;
  /** Caller id, needed for assignee=me. */
  currentUserId?: string;
}

const LIFECYCLE_STATUSES = new Set([
  'OPEN',
  'ACKNOWLEDGED',
  'ACCEPTED_RISK',
  'FALSE_POSITIVE',
  'RESOLVED',
  'REGRESSION_TEST_CREATED',
  'SUPPRESSED',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSED_STATUSES_SQL = `('RESOLVED', 'FALSE_POSITIVE', 'ACCEPTED_RISK', 'SUPPRESSED')`;

/** Finding row joined with its lifecycle (and the lifecycle assignee). */
const FINDING_SELECT = `SELECT f.*,
       l.status AS lc_status, l.status_reason AS lc_status_reason, l.status_changed_at AS lc_status_changed_at,
       l.assignee_id AS lc_assignee_id, l.due_date AS lc_due_date, l.first_detected_at AS lc_first_detected_at,
       l.last_evaluated_at AS lc_last_evaluated_at, l.last_detected_at AS lc_last_detected_at,
       l.detection_count AS lc_detection_count, l.revision AS lc_revision, l.latest_finding_id AS lc_latest_finding_id,
       l.suppression_mode AS lc_suppression_mode, l.suppressed_until AS lc_suppressed_until,
       l.suppressed_release AS lc_suppressed_release,
       au.email AS lc_assignee_email, au.full_name AS lc_assignee_name,
       ks.seq AS knowledge_snapshot_seq`;
const FINDING_FROM = `FROM findings f
  LEFT JOIN finding_lifecycles l ON l.id = f.lifecycle_id
  LEFT JOIN users au ON au.id = l.assignee_id
  LEFT JOIN knowledge_snapshots ks ON ks.id = f.knowledge_snapshot_id`;

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function dateOnly(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

@Injectable()
export class FindingsService {
  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly traceability?: TraceabilityService
  ) {}

  async findAll(tenantId: string, query: FindFindingsRequest) {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 25));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['f.organization_id = $1'];
    const params: unknown[] = [tenantId];
    let paramIndex = 2;

    if (query.projectId) {
      conditions.push(`f.project_id = $${paramIndex++}`);
      params.push(query.projectId);
    }
    if (query.engine) {
      conditions.push(`f.engine = $${paramIndex++}`);
      params.push(query.engine);
    }
    if (query.severity) {
      conditions.push(`f.severity = $${paramIndex++}`);
      params.push(query.severity.toUpperCase());
    }
    if (query.category) {
      conditions.push(`f.category = $${paramIndex++}`);
      params.push(query.category);
    }
    if (query.search) {
      conditions.push(
        `(f.title ILIKE $${paramIndex} OR f.description ILIKE $${paramIndex} OR f.rule_id ILIKE $${paramIndex})`
      );
      params.push(`%${query.search}%`);
      paramIndex++;
    }
    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => LIFECYCLE_STATUSES.has(s));
      if (statuses.length === 0) {
        throw new BadRequestException(`Unknown finding status filter '${query.status}'`);
      }
      conditions.push(`COALESCE(l.status, 'OPEN') = ANY($${paramIndex++}::text[])`);
      params.push(statuses);
    }
    if (query.assignee) {
      if (query.assignee === 'unassigned') {
        conditions.push('l.assignee_id IS NULL');
      } else {
        const who = query.assignee === 'me' ? query.currentUserId : query.assignee;
        if (!who || !UUID_RE.test(who)) {
          throw new BadRequestException(`Invalid assignee filter '${query.assignee}'`);
        }
        conditions.push(`l.assignee_id = $${paramIndex++}`);
        params.push(who);
      }
    }
    if (query.due) {
      if (query.due === 'overdue') {
        conditions.push(`l.due_date < CURRENT_DATE AND l.status NOT IN ${CLOSED_STATUSES_SQL}`);
      } else if (query.due === 'due_soon') {
        conditions.push(
          `l.due_date >= CURRENT_DATE AND l.due_date <= CURRENT_DATE + 7 AND l.status NOT IN ${CLOSED_STATUSES_SQL}`
        );
      } else if (query.due === 'no_due_date') {
        conditions.push('l.due_date IS NULL');
      } else {
        throw new BadRequestException(`Unknown due filter '${query.due}'`);
      }
    }
    if (query.latest) {
      conditions.push('(l.id IS NULL OR l.latest_finding_id = f.id)');
    }

    const whereClause = conditions.join(' AND ');

    // Total count query
    const countRes = await this.db.query(
      `SELECT COUNT(*)::int AS total ${FINDING_FROM} WHERE ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    // Items query with pagination
    const itemsRes = await this.db.query(
      `${FINDING_SELECT},
              ${EVIDENCE_JSON_AGG_SQL} AS evidence
       ${FINDING_FROM}
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
         f.created_at DESC,
         f.id ASC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset]
    );

    return {
      items: itemsRes.rows.map((row) => this.mapFindingRow(row)),
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
      `${FINDING_SELECT},
              ${EVIDENCE_JSON_AGG_SQL} AS evidence
       ${FINDING_FROM}
       WHERE f.organization_id = $1 AND f.id = $2`,
      [tenantId, findingId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Finding with ID '${findingId}' not found.`);
    }

    return this.mapFindingRow(res.rows[0]);
  }

  private mapFindingRow(row: any) {
    if (!row) {
      throw new NotFoundException('Finding not found');
    }
    const hasLifecycle = Boolean(row.lifecycle_id && row.lc_status);
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
      evidence: mapEvidenceList(row.evidence),
      // Part 04 §4.10 reproducibility fields
      engineVersion: row.engine_version ?? null,
      ruleVersion: row.rule_version ?? null,
      knowledgeSnapshotId: row.knowledge_snapshot_id ?? null,
      knowledgeSnapshotSeq: row.knowledge_snapshot_seq != null ? Number(row.knowledge_snapshot_seq) : null,
      targetRelease: row.target_release ?? null,
      sourceFileId: row.source_file_id ?? null,
      sourceFileName: row.source_file_name ?? null,
      aiModelVersion: row.ai_model_version ?? null,
      // Part 01 §1.7 lifecycle summary (findings without a lifecycle yet are OPEN)
      lifecycle: {
        id: hasLifecycle ? row.lifecycle_id : null,
        status: hasLifecycle ? row.lc_status : 'OPEN',
        statusReason: hasLifecycle ? row.lc_status_reason ?? null : null,
        statusChangedAt: hasLifecycle ? iso(row.lc_status_changed_at) : null,
        assignee: row.lc_assignee_id
          ? { id: row.lc_assignee_id, email: row.lc_assignee_email ?? null, fullName: row.lc_assignee_name ?? null }
          : null,
        dueDate: hasLifecycle ? dateOnly(row.lc_due_date) : null,
        firstDetectedAt: hasLifecycle ? iso(row.lc_first_detected_at) : iso(row.created_at),
        lastEvaluatedAt: hasLifecycle ? iso(row.lc_last_evaluated_at) : iso(row.created_at),
        lastDetectedAt: hasLifecycle ? iso(row.lc_last_detected_at) : iso(row.created_at),
        detectionCount: hasLifecycle ? Number(row.lc_detection_count ?? 1) : 1,
        revision: hasLifecycle ? Number(row.lc_revision ?? 1) : 0,
        isLatestDetection: hasLifecycle ? row.lc_latest_finding_id === row.id : true,
        suppression: row.lc_suppression_mode
          ? {
              mode: row.lc_suppression_mode,
              until: iso(row.lc_suppressed_until),
              release: row.lc_suppressed_release ?? null,
            }
          : null,
      },
    };
  }

  /** Evidence items of one finding (Section C §17 "evidence"). */
  async getEvidence(tenantId: string, findingId: string) {
    const finding = await this.findById(tenantId, findingId);
    return { findingId: finding.id, evidence: finding.evidence };
  }

  /**
   * Other current findings of the same project that touch the same SAP objects
   * (Section C §17 "related objects").
   */
  async getRelated(tenantId: string, findingId: string) {
    const finding = await this.findById(tenantId, findingId);
    const names = (finding.affectedObjects as any[])
      .map((o) => (typeof o === 'string' ? o : o?.name))
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (names.length === 0) return { findingId, objects: [], related: [] };
    const res = await this.db.query(
      `SELECT f.id, f.rule_id, f.title, f.severity, f.engine, COALESCE(l.status, 'OPEN') AS status, f.affected_objects
         FROM findings f
         LEFT JOIN finding_lifecycles l ON l.id = f.lifecycle_id
        WHERE f.organization_id = $1 AND f.project_id = $2 AND f.id <> $3
          AND (l.id IS NULL OR l.latest_finding_id = f.id)
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(f.affected_objects) o
             WHERE COALESCE(o->>'name', o #>> '{}') = ANY($4::text[])
          )
        ORDER BY f.created_at DESC
        LIMIT 50`,
      [tenantId, finding.projectId, finding.id, names]
    );
    return {
      findingId,
      objects: names,
      related: res.rows.map((r: any) => ({
        id: r.id,
        ruleId: r.rule_id,
        title: r.title,
        severity: r.severity,
        engineType: r.engine,
        status: r.status,
        affectedObjects: r.affected_objects ?? [],
      })),
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

    const [severityRes, engineRes, totalRes, analysedRes] = await Promise.all([
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
      this.db.query(
        `SELECT COUNT(*)::int AS total FROM analyses WHERE ${where} AND status IN ('COMPLETED', 'PARTIAL')`,
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
    // No completed analysis means there is nothing to score: report null instead of a 100% "pass".
    const analysedRuns = analysedRes.rows[0]?.total || 0;
    const cleanCoreIndex =
      analysedRuns === 0 ? null : total === 0 ? 100 : Math.max(0, Math.round((100 - penalty) * 10) / 10);

    // Lifecycle status of the current detections (latest finding per lifecycle).
    const byStatus: Record<string, number> = {};
    const statusRes = await this.db.query(
      `SELECT COALESCE(l.status, 'OPEN') AS status, COUNT(*)::int AS count
         FROM findings f LEFT JOIN finding_lifecycles l ON l.id = f.lifecycle_id
        WHERE ${where.replace(/organization_id/g, 'f.organization_id').replace(/project_id/g, 'f.project_id')}
          AND (l.id IS NULL OR l.latest_finding_id = f.id)
        GROUP BY 1`,
      params
    );
    (statusRes?.rows ?? []).forEach((r: any) => {
      byStatus[r.status] = r.count;
    });

    return {
      totalFindings: total,
      cleanCoreIndex,
      bySeverity,
      byEngine,
      byStatus,
      blockerAndCriticalCount: blockers + criticals,
    };
  }

  /**
   * Part 15.7 & 15.8: Finding-to-Task Work Item Creation.
   * Delegates to the connector framework (TraceabilityService → WorkItemsService):
   * the work item is created in the selected, configured connector or the call
   * reports NOT_CONFIGURED. No task ids are ever simulated.
   */
  async createWorkItem(
    tenantId: string,
    findingId: string,
    userId: string,
    dto: { connectorId?: string; system?: string; confirm?: boolean; dryRun?: boolean }
  ) {
    const finding = await this.findById(tenantId, findingId);
    const system = dto.system ? dto.system.toUpperCase() : undefined;

    if (this.traceability) {
      return await this.traceability.createRemediationTask(
        tenantId,
        finding.projectId,
        {
          findingId: finding.id,
          ...(dto.connectorId ? { connectorId: dto.connectorId } : {}),
          ...(system ? { externalSystem: system } : {}),
          confirm: dto.confirm === true,
          dryRun: dto.dryRun === true,
        },
        userId
      );
    }

    return {
      success: false,
      status: 'NOT_CONFIGURED',
      error: 'The work item connector framework is not available in this deployment.',
      findingId: finding.id,
    };
  }
}
