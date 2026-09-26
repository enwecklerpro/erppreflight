import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FINDING_WRITE_ROLES, type GeneratedTest, type PromoteGeneratedTestRequest } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { FindingLifecycleService, LifecycleActor } from '../findings/lifecycle/finding-lifecycle.service';
import { RegressionLabService } from './regression/regression-lab.service';

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function steps(v: unknown): Array<{ order: number; action: string }> {
  const raw = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === 'object' && typeof (x as any).action === 'string')
    .map((x: any, i: number) => ({ order: Number.isFinite(Number(x.order)) ? Number(x.order) : i + 1, action: String(x.action) }));
}

const SELECT = `SELECT t.id, t.project_id, t.finding_id, t.title, t.test_type, t.steps, t.expected_result, t.status, t.created_at,
       t.generator_version, t.regression_test_case_id, t.promoted_at,
       COALESCE(t.analysis_id, f.analysis_id) AS analysis_id,
       f.severity AS finding_severity, f.rule_id AS finding_rule_id, f.engine AS finding_engine,
       f.source_file_id AS finding_source_file_id, uf.quarantine_status AS source_file_status,
       rc.status AS case_status, rc.last_run_status, rc.last_run_at
  FROM tests t
  LEFT JOIN findings f ON f.id = t.finding_id AND f.organization_id = t.organization_id
  LEFT JOIN uploaded_files uf ON uf.id = f.source_file_id AND uf.organization_id = t.organization_id
  LEFT JOIN regression_test_cases rc ON rc.id = t.regression_test_case_id AND rc.organization_id = t.organization_id`;

export function mapGeneratedTest(r: any): GeneratedTest {
  return {
    id: r.id,
    projectId: r.project_id,
    analysisId: r.analysis_id ?? null,
    findingId: r.finding_id ?? null,
    findingSeverity: r.finding_severity ?? null,
    findingRuleId: r.finding_rule_id ?? null,
    findingEngine: r.finding_engine ?? null,
    title: r.title,
    testType: r.test_type,
    steps: steps(r.steps),
    expectedResult: r.expected_result,
    status: r.status,
    generatorVersion: r.generator_version ?? null,
    createdAt: iso(r.created_at),
    promotion: r.regression_test_case_id
      ? {
          regressionTestCaseId: r.regression_test_case_id,
          promotedAt: iso(r.promoted_at),
          caseStatus: r.case_status ?? null,
          lastRunStatus: r.last_run_status ?? null,
          lastRunAt: iso(r.last_run_at),
        }
      : null,
    promotable: Boolean(r.finding_id && r.finding_source_file_id && r.source_file_status === 'CLEAN'),
  };
}

/**
 * Generated tests ↔ Test Lab (KNOWN_LIMITATIONS P6, section C §18).
 *
 * The analysis GENERATING_TESTS stage writes deterministic regression test *specifications*
 * (table `tests`: steps + expected result, one per evidence-backed BLOCKER/CRITICAL/MAJOR
 * finding). The Test Lab holds *executable* regression cases (`regression_test_cases`: engine,
 * rule, fixture artifact with SHA-256, expected outcome, runs, baseline). Promotion turns a
 * generated test into a Test Lab case (same code path as "finding → regression test"), links
 * both rows (tests.regression_test_case_id ↔ regression_test_cases.generated_test_id, unique:
 * promotion is idempotent) and marks the generated test PROMOTED. Both views show the link.
 */
@Injectable()
export class GeneratedTestsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly regressionLab: RegressionLabService
  ) {}

  async list(tenantId: string, filter: { projectId?: string; analysisId?: string }) {
    const cond: string[] = ['t.organization_id = $1'];
    const params: unknown[] = [tenantId];
    if (filter.projectId) {
      params.push(filter.projectId);
      cond.push(`t.project_id = $${params.length}`);
    }
    if (filter.analysisId) {
      params.push(filter.analysisId);
      cond.push(`(t.analysis_id = $${params.length} OR (t.analysis_id IS NULL AND f.analysis_id = $${params.length}))`);
    }
    const res = await this.db.query(`${SELECT} WHERE ${cond.join(' AND ')} ORDER BY t.created_at DESC, t.id LIMIT 500`, params, { tenantId });
    return { items: (res.rows ?? []).map(mapGeneratedTest) };
  }

  async get(tenantId: string, id: string): Promise<GeneratedTest> {
    const res = await this.db.query(`${SELECT} WHERE t.organization_id = $1 AND t.id = $2`, [tenantId, id], { tenantId });
    if (!res.rows?.[0]) throw new NotFoundException('Generated test not found');
    return mapGeneratedTest(res.rows[0]);
  }

  /** Counts for the analysis detail page. */
  async countForAnalysis(tenantId: string, analysisId: string): Promise<{ total: number; promoted: number }> {
    const res = await this.db.query(
      `SELECT COUNT(*)::int AS total, COUNT(t.regression_test_case_id)::int AS promoted
         FROM tests t LEFT JOIN findings f ON f.id = t.finding_id AND f.organization_id = t.organization_id
        WHERE t.organization_id = $1 AND (t.analysis_id = $2 OR (t.analysis_id IS NULL AND f.analysis_id = $2))`,
      [tenantId, analysisId],
      { tenantId }
    );
    return { total: Number(res.rows?.[0]?.total ?? 0), promoted: Number(res.rows?.[0]?.promoted ?? 0) };
  }

  async promote(tenantId: string, actor: LifecycleActor, id: string, dto: PromoteGeneratedTestRequest) {
    FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Promoting a generated test');
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, finding_id, title, regression_test_case_id FROM tests WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [id, tenantId]
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundException('Generated test not found');
      if (row.regression_test_case_id) {
        return { generatedTestId: id, regressionTestCaseId: row.regression_test_case_id as string, created: false };
      }
      if (!row.finding_id) {
        throw new ConflictException({
          code: 'GENERATED_TEST_NOT_PROMOTABLE',
          message: 'The source finding of this generated test no longer exists; it cannot become an executable regression test.',
        });
      }
      const created = await this.regressionLab.createFromFinding(
        client,
        tenantId,
        actor,
        {
          findingId: row.finding_id,
          expectedOutcome: dto.expectedOutcome ?? 'FINDING_ABSENT',
          title: String(row.title).slice(0, 500),
        },
        id
      );
      await client.query(
        `UPDATE tests SET regression_test_case_id = $3, promoted_at = NOW(), promoted_by = $4, status = 'PROMOTED'
          WHERE id = $1 AND organization_id = $2`,
        [id, tenantId, created.id, actor.id ?? null]
      );
      return { generatedTestId: id, regressionTestCaseId: created.id as string, created: true };
    });
  }
}
