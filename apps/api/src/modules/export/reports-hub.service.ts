import { BadRequestException, Injectable } from '@nestjs/common';
import { ReportListQuerySchema, type ReportListResponse } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';

/**
 * Reports hub (Part 01 §1.9): every generated report of the tenant across
 * projects, newest first, with filters. Rows come only from the tenant-scoped
 * `reports` table (RLS + explicit organization_id predicate); downloads keep using
 * GET /reports/:id/file.
 */
@Injectable()
export class ReportsHubService {
  constructor(private readonly db: DatabaseService) {}

  async list(tenantId: string, rawQuery: unknown): Promise<ReportListResponse> {
    const parsed = ReportListQuerySchema.safeParse(rawQuery ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REPORT_QUERY',
        message: parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; '),
      });
    }
    const q = parsed.data;
    const where: string[] = ['r.organization_id = $1'];
    const params: unknown[] = [tenantId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.projectId) add('r.project_id = ?', q.projectId);
    if (q.reportType) add('r.report_type = ?', q.reportType.toUpperCase());
    if (q.format) add('r.format = ?', q.format.toUpperCase());
    if (q.from) add('r.created_at >= ?::date', q.from);
    if (q.to) add(`r.created_at < (?::date + INTERVAL '1 day')`, q.to);
    const whereSql = where.join(' AND ');

    const countRes = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM reports r WHERE ${whereSql}`,
      params,
      { tenantId }
    );
    const total = Number(countRes.rows?.[0]?.total ?? 0);
    const offset = (q.page - 1) * q.pageSize;
    const rows = await this.db.query(
      `SELECT r.id, r.project_id, p.name AS project_name, r.analysis_id, a.kind AS analysis_kind,
              r.format, r.report_type, r.file_name, r.file_size, r.checksum_sha256, r.created_at, r.created_by
         FROM reports r
         JOIN projects p ON p.id = r.project_id AND p.organization_id = r.organization_id
         JOIN analyses a ON a.id = r.analysis_id AND a.organization_id = r.organization_id
        WHERE ${whereSql}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${q.pageSize} OFFSET ${offset}`,
      params,
      { tenantId }
    );
    return {
      items: (rows.rows ?? []).map((r: any) => ({
        id: r.id,
        projectId: r.project_id,
        projectName: r.project_name,
        analysisId: r.analysis_id,
        analysisKind: r.analysis_kind ?? 'STANDARD',
        format: r.format,
        reportType: r.report_type ?? 'TECHNICAL',
        fileName: r.file_name,
        fileSize: Number(r.file_size),
        checksumSha256: r.checksum_sha256,
        createdAt: new Date(r.created_at).toISOString(),
        createdBy: r.created_by ?? null,
      })),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
    };
  }
}
