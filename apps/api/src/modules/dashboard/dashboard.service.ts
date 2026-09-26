import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EnginesService } from '../engines/engines.service';
import { FindingsService } from '../findings/findings.service';

export interface DashboardSummaryResponse {
  cleanCoreIndex: number | null;
  activeProjects: number;
  totalProjects: number;
  blockersAndCritical: number;
  totalFindings: number;
  severityDistribution: Record<string, number>;
  enginesOperational: string;
  enginesSummary: {
    totalEngines: number;
    operationalCount: number;
    totalRules: number;
    serviceStatus: string;
  };
  recentProjects: Array<{
    id: string;
    name: string;
    slug: string;
    targetRelease: string;
    createdAt: string;
  }>;
  /** Analysis activity windows (spec C §5). */
  analysisActivity: {
    last24h: number;
    last7d: number;
    last30d: number;
    failed7d: number;
  };
  /** Findings first seen in the last 7 days (by fingerprint) — no fabricated "resolved" metric. */
  newFindings7d: number;
  /** Projects with open BLOCKER/CRITICAL findings in their latest completed analysis. */
  projectsAtRisk: Array<{ id: string; name: string; blockers: number; criticals: number; latestAnalysisId: string }>;
  recentAnalyses: Array<{
    id: string;
    projectId: string;
    status: string;
    targetRelease: string;
    findingsCount: number;
    createdAt: string;
    completedAt: string | null;
  }>;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly enginesService: EnginesService,
    private readonly findingsService: FindingsService
  ) {}

  async getSummary(tenantId: string): Promise<DashboardSummaryResponse> {
    const [findingsStats, projectsRes, analysesRes, engineStatus] = await Promise.all([
      this.findingsService.getStats(tenantId),
      this.db.query(
        `SELECT id, name, slug, target_release, created_at
         FROM projects
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [tenantId]
      ),
      this.db.query(
        `SELECT a.id, a.project_id, a.status, a.target_release, a.created_at, a.completed_at,
                (SELECT COUNT(*)::int FROM findings f WHERE f.analysis_id = a.id) as findings_count
         FROM analyses a
         WHERE a.organization_id = $1
         ORDER BY a.created_at DESC
         LIMIT 5`,
        [tenantId]
      ),
      this.enginesService.getEngineStatus(),
    ]);

    const projectCountsRes = await this.db.query(
      `SELECT COUNT(*)::int as total,
              COUNT(CASE WHEN target_release IS NOT NULL THEN 1 END)::int as active
       FROM projects
       WHERE organization_id = $1`,
      [tenantId]
    );

    const [activityRes, newFindingsRes, atRiskRes] = await Promise.all([
      this.db.query(
        `SELECT count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last24h,
                count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last7d,
                count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS last30d,
                count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days' AND status = 'FAILED')::int AS failed7d
           FROM analyses WHERE organization_id = $1`,
        [tenantId]
      ),
      this.db.query(
        `SELECT count(*)::int AS count FROM (
           SELECT fingerprint FROM findings
            WHERE organization_id = $1 AND fingerprint IS NOT NULL
            GROUP BY fingerprint
           HAVING min(created_at) >= NOW() - INTERVAL '7 days') first_seen`,
        [tenantId]
      ),
      this.db.query(
        `WITH latest AS (
           SELECT DISTINCT ON (a.project_id) a.project_id, a.id
             FROM analyses a
            WHERE a.organization_id = $1 AND a.status IN ('COMPLETED', 'PARTIAL') AND a.kind IN ('STANDARD', 'FULL_PREFLIGHT')
            ORDER BY a.project_id, a.created_at DESC)
         SELECT p.id, p.name, l.id AS latest_analysis_id,
                count(*) FILTER (WHERE f.severity = 'BLOCKER')::int AS blockers,
                count(*) FILTER (WHERE f.severity = 'CRITICAL')::int AS criticals
           FROM latest l
           JOIN projects p ON p.id = l.project_id
           JOIN findings f ON f.analysis_id = l.id AND f.severity IN ('BLOCKER', 'CRITICAL')
          GROUP BY p.id, p.name, l.id
          ORDER BY blockers DESC, criticals DESC
          LIMIT 5`,
        [tenantId]
      ),
    ]);

    const totalProjects = projectCountsRes.rows[0]?.total || 0;
    const activeProjects = projectCountsRes.rows[0]?.active || 0;

    const opCount = engineStatus.summary.operationalCount;
    const totEngines = engineStatus.summary.totalEngines;

    return {
      cleanCoreIndex: findingsStats.cleanCoreIndex,
      activeProjects,
      totalProjects,
      blockersAndCritical: findingsStats.blockerAndCriticalCount,
      totalFindings: findingsStats.totalFindings,
      severityDistribution: findingsStats.bySeverity,
      enginesOperational: `${opCount} / ${totEngines}`,
      enginesSummary: engineStatus.summary,
      recentProjects: projectsRes.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        targetRelease: r.target_release,
        createdAt: r.created_at,
      })),
      analysisActivity: {
        last24h: activityRes.rows?.[0]?.last24h ?? 0,
        last7d: activityRes.rows?.[0]?.last7d ?? 0,
        last30d: activityRes.rows?.[0]?.last30d ?? 0,
        failed7d: activityRes.rows?.[0]?.failed7d ?? 0,
      },
      newFindings7d: newFindingsRes.rows?.[0]?.count ?? 0,
      projectsAtRisk: (atRiskRes.rows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        blockers: r.blockers,
        criticals: r.criticals,
        latestAnalysisId: r.latest_analysis_id,
      })),
      recentAnalyses: analysesRes.rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        status: r.status,
        targetRelease: r.target_release,
        findingsCount: r.findings_count || 0,
        createdAt: r.created_at,
        completedAt: r.completed_at,
      })),
    };
  }
}
