import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @InjectQueue('analysis-queue') private readonly analysisQueue?: Queue
  ) {}

  async getOverview() {
    const [
      tenantsRes,
      usersRes,
      projectsRes,
      analysesRes,
      findingsRes,
      critRes,
    ] = await Promise.all([
      this.db.query('SELECT count(*)::int as count FROM organizations', [], { bypassRls: true }),
      this.db.query('SELECT count(*)::int as count FROM users', [], { bypassRls: true }),
      this.db.query('SELECT count(*)::int as count FROM projects', [], { bypassRls: true }),
      this.db.query('SELECT count(*)::int as count FROM analyses', [], { bypassRls: true }),
      this.db.query('SELECT count(*)::int as count FROM findings', [], { bypassRls: true }),
      this.db.query(
        "SELECT count(*)::int as count FROM findings WHERE severity IN ('CRITICAL', 'BLOCKER')",
        [],
        { bypassRls: true }
      ),
    ]);

    const totalTenants = tenantsRes.rows[0]?.count || 0;
    const totalUsers = usersRes.rows[0]?.count || 0;
    const totalProjects = projectsRes.rows[0]?.count || 0;
    const totalAnalyses = analysesRes.rows[0]?.count || 0;
    const totalFindings = findingsRes.rows[0]?.count || 0;
    const blockersAndCritical = critRes.rows[0]?.count || 0;

    // Check system health
    let dbStatus = 'HEALTHY';
    try {
      await this.db.query('SELECT 1', [], { bypassRls: true });
    } catch {
      dbStatus = 'DEGRADED';
    }

    let queueStatus = 'HEALTHY';
    try {
      if (this.analysisQueue) {
        await this.analysisQueue.getJobCounts();
      }
    } catch {
      queueStatus = 'DEGRADED';
    }

    let pythonStatus = 'ONLINE';
    try {
      const pythonUrl = this.config.get<string>('ANALYSIS_SERVICE_URL', 'http://analysis-python:8000');
      const resp = await fetch(`${pythonUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!resp.ok) pythonStatus = 'DEGRADED';
    } catch {
      pythonStatus = 'OFFLINE';
    }

    const cleanCoreIndex = totalFindings > 0
      ? Math.max(10, Math.round(100 - (blockersAndCritical * 8 + (totalFindings - blockersAndCritical) * 2) / Math.max(1, totalProjects)))
      : 100;

    return {
      totalTenants,
      totalUsers,
      totalProjects,
      totalAnalyses,
      totalFindings,
      blockersAndCritical,
      cleanCoreIndex: Math.min(100, Math.max(0, cleanCoreIndex)),
      systemHealth: {
        database: dbStatus,
        redisQueue: queueStatus,
        pythonEngines: pythonStatus,
        status: dbStatus === 'HEALTHY' && pythonStatus === 'ONLINE' ? 'OPERATIONAL' : 'DEGRADED',
      },
    };
  }

  async getTenants() {
    const res = await this.db.query(
      `SELECT 
         o.id,
         o.name,
         o.slug,
         o.plan_tier as "planTier",
         o.status,
         o.created_at as "createdAt",
         count(DISTINCT m.user_id)::int as "userCount",
         count(DISTINCT p.id)::int as "projectCount",
         count(DISTINCT a.id)::int as "analysisCount"
       FROM organizations o
       LEFT JOIN organization_members m ON m.organization_id = o.id
       LEFT JOIN projects p ON p.organization_id = o.id
       LEFT JOIN analyses a ON a.organization_id = o.id
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [],
      { bypassRls: true }
    );
    return res.rows;
  }

  async getUsers() {
    const res = await this.db.query(
      `SELECT 
         u.id,
         u.email,
         u.full_name as "fullName",
         u.system_role as "systemRole",
         u.status,
         u.created_at as "createdAt",
         COALESCE(
           json_agg(
             json_build_object(
               'organizationId', o.id,
               'organizationName', o.name,
               'role', m.role
             )
           ) FILTER (WHERE o.id IS NOT NULL),
           '[]'::json
         ) as organizations
       FROM users u
       LEFT JOIN organization_members m ON m.user_id = u.id
       LEFT JOIN organizations o ON o.id = m.organization_id
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [],
      { bypassRls: true }
    );
    return res.rows;
  }

  async updateUserRole(userId: string, systemRole: 'USER' | 'ADMIN' | 'SUPER_ADMIN') {
    const res = await this.db.query(
      `UPDATE users 
       SET system_role = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING id, email, full_name as "fullName", system_role as "systemRole", status`,
      [systemRole, userId],
      { bypassRls: true }
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    this.logger.log(`Updated user ${userId} (${res.rows[0].email}) system role to ${systemRole}`);
    return res.rows[0];
  }

  async getEngineTrustCenter() {
    const pythonUrl = this.config.get<string>('ANALYSIS_SERVICE_URL', 'http://analysis-python:8000');
    try {
      const resp = await fetch(`${pythonUrl}/engines/status`, {
        signal: AbortSignal.timeout(4000),
      });
      if (resp.ok) {
        return await resp.json();
      }
    } catch (err: any) {
      this.logger.warn(`Could not fetch live engine diagnostics from Python service: ${err.message}`);
    }

    return {
      engines: [],
      summary: {
        totalEngines: 19,
        operationalCount: 0,
        totalRules: 312,
        serviceStatus: 'OFFLINE',
      },
    };
  }

  async getQueueStats() {
    if (!this.analysisQueue) {
      return {
        queueName: 'analysis-queue',
        status: 'UNAVAILABLE',
        counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
      };
    }

    try {
      const counts = await this.analysisQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused'
      );
      const isPaused = await this.analysisQueue.isPaused();

      return {
        queueName: 'analysis-queue',
        status: isPaused ? 'PAUSED' : 'ACTIVE',
        counts,
      };
    } catch (err: any) {
      this.logger.error(`Error querying queue counts: ${err.message}`);
      return {
        queueName: 'analysis-queue',
        status: 'ERROR',
        counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
      };
    }
  }
}
