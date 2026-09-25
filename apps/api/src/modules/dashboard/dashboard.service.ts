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
