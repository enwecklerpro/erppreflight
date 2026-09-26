import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';

export const TicketCategoryEnum = z.enum(['QUESTION', 'INCORRECT_FINDING', 'BUG', 'BILLING', 'ACCESS']);
export const TicketStatusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED']);

export const CreateTicketSchema = z
  .object({
    subject: z.string().trim().min(5).max(200),
    description: z.string().trim().min(10).max(10_000),
    category: TicketCategoryEnum.default('QUESTION'),
    projectId: z.string().uuid().optional(),
    analysisId: z.string().uuid().optional(),
    findingId: z.string().uuid().optional(),
    correlationId: z
      .string()
      .trim()
      .max(100)
      .regex(/^[A-Za-z0-9_.:-]+$/)
      .optional(),
  })
  .strict();
export type CreateTicketDto = z.infer<typeof CreateTicketSchema>;

export const CreateGrantSchema = z
  .object({
    reason: z.string().trim().min(5).max(1000),
    hours: z.number().int().min(1).max(168),
    ticketId: z.string().uuid().optional(),
  })
  .strict();
export type CreateGrantDto = z.infer<typeof CreateGrantSchema>;

function toTicket(r: any) {
  return {
    id: r.id,
    organizationId: r.organization_id,
    organizationName: r.organization_name ?? undefined,
    createdBy: r.created_by,
    createdByEmail: r.created_by_email ?? null,
    subject: r.subject,
    description: r.description,
    category: r.category,
    status: r.status,
    projectId: r.project_id,
    analysisId: r.analysis_id,
    findingId: r.finding_id,
    correlationId: r.correlation_id,
    diagnostic: r.diagnostic ?? {},
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function toGrant(r: any) {
  const expiresAt = new Date(r.expires_at);
  return {
    id: r.id,
    organizationId: r.organization_id,
    grantedBy: r.granted_by,
    grantedByEmail: r.granted_by_email ?? null,
    reason: r.reason,
    ticketId: r.ticket_id,
    expiresAt: expiresAt.toISOString(),
    revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    active: !r.revoked_at && expiresAt.getTime() > Date.now(),
  };
}

/**
 * Support (spec 10.14, C §62): tenant tickets with sanitized diagnostic context
 * and time-boxed, revocable support-access grants.
 */
@Injectable()
export class SupportService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Sanitized diagnostic snapshot attached to a ticket: ids, statuses, engine
   * types and counts only — never artifact contents or evidence snippets.
   */
  private async diagnostic(orgId: string, dto: CreateTicketDto) {
    const diag: Record<string, unknown> = {};
    if (dto.analysisId) {
      const a = await this.db.query(
        `SELECT id, project_id, status, engine_types, target_release, created_at, completed_at,
                (SELECT count(*)::int FROM findings f WHERE f.analysis_id = a.id) AS findings
           FROM analyses a WHERE a.id = $1 AND a.organization_id = $2`,
        [dto.analysisId, orgId],
        { tenantId: orgId }
      );
      if (!a.rows?.length) throw new NotFoundException('Analysis not found in this organization');
      diag.analysis = a.rows[0];
    }
    if (dto.findingId) {
      const f = await this.db.query(
        `SELECT id, analysis_id, rule_id, severity, confidence_class, engine FROM findings
          WHERE id = $1 AND organization_id = $2`,
        [dto.findingId, orgId],
        { tenantId: orgId }
      );
      if (!f.rows?.length) throw new NotFoundException('Finding not found in this organization');
      diag.finding = f.rows[0];
    }
    if (dto.projectId) {
      const p = await this.db.query(`SELECT id FROM projects WHERE id = $1 AND organization_id = $2`, [dto.projectId, orgId], {
        tenantId: orgId,
      });
      if (!p.rows?.length) throw new NotFoundException('Project not found in this organization');
    }
    return diag;
  }

  async createTicket(orgId: string, userId: string | null, dto: CreateTicketDto) {
    if (dto.category === 'INCORRECT_FINDING' && !dto.findingId) {
      throw new BadRequestException('An incorrect-finding report must reference findingId');
    }
    const diagnostic = await this.diagnostic(orgId, dto);
    const res = await this.db.query(
      `INSERT INTO support_tickets (organization_id, created_by, subject, description, category, project_id,
                                    analysis_id, finding_id, correlation_id, diagnostic)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        orgId,
        userId,
        dto.subject,
        dto.description,
        dto.category,
        dto.projectId ?? null,
        dto.analysisId ?? null,
        dto.findingId ?? null,
        dto.correlationId ?? null,
        JSON.stringify(diagnostic),
      ],
      { tenantId: orgId }
    );
    return toTicket(res.rows[0]);
  }

  async listTickets(orgId: string) {
    const res = await this.db.query(
      `SELECT t.*, u.email AS created_by_email FROM support_tickets t LEFT JOIN users u ON u.id = t.created_by
        WHERE t.organization_id = $1 ORDER BY t.created_at DESC LIMIT 100`,
      [orgId],
      { tenantId: orgId }
    );
    return (res.rows ?? []).map(toTicket);
  }

  /** Platform queue for operators (Super Admin). */
  async listAllTickets(status?: string) {
    const parsed = status ? TicketStatusEnum.safeParse(status) : null;
    if (parsed && !parsed.success) throw new BadRequestException('Unknown ticket status');
    const res = await this.db.query(
      `SELECT t.*, u.email AS created_by_email, o.name AS organization_name
         FROM support_tickets t
         JOIN organizations o ON o.id = t.organization_id
         LEFT JOIN users u ON u.id = t.created_by
        ${parsed ? 'WHERE t.status = $1' : ''}
        ORDER BY t.created_at DESC LIMIT 200`,
      parsed ? [parsed.data] : [],
      { bypassRls: true }
    );
    return (res.rows ?? []).map(toTicket);
  }

  async updateTicketStatus(ticketId: string, status: z.infer<typeof TicketStatusEnum>) {
    const res = await this.db.query(
      `UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [ticketId, status],
      { bypassRls: true }
    );
    if (!res.rows?.length) throw new NotFoundException('Ticket not found');
    return toTicket(res.rows[0]);
  }

  async createGrant(orgId: string, userId: string | null, dto: CreateGrantDto) {
    if (dto.ticketId) {
      const t = await this.db.query(`SELECT 1 FROM support_tickets WHERE id = $1 AND organization_id = $2`, [dto.ticketId, orgId], {
        tenantId: orgId,
      });
      if (!t.rows?.length) throw new NotFoundException('Ticket not found in this organization');
    }
    const res = await this.db.query(
      `INSERT INTO support_access_grants (organization_id, granted_by, reason, ticket_id, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5::int)) RETURNING *`,
      [orgId, userId, dto.reason, dto.ticketId ?? null, dto.hours],
      { tenantId: orgId }
    );
    return toGrant(res.rows[0]);
  }

  async listGrants(orgId: string) {
    const res = await this.db.query(
      `SELECT g.*, u.email AS granted_by_email FROM support_access_grants g LEFT JOIN users u ON u.id = g.granted_by
        WHERE g.organization_id = $1 ORDER BY g.created_at DESC LIMIT 50`,
      [orgId],
      { tenantId: orgId }
    );
    return (res.rows ?? []).map(toGrant);
  }

  async revokeGrant(orgId: string, grantId: string) {
    const res = await this.db.query(
      `UPDATE support_access_grants SET revoked_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL RETURNING *`,
      [grantId, orgId],
      { tenantId: orgId }
    );
    if (!res.rows?.length) throw new NotFoundException('Active grant not found');
    return toGrant(res.rows[0]);
  }

  /** Active, unexpired, unrevoked grant for the support console (platform read). */
  async activeGrant(orgId: string) {
    const res = await this.db.query(
      `SELECT * FROM support_access_grants
        WHERE organization_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
        ORDER BY expires_at DESC LIMIT 1`,
      [orgId],
      { bypassRls: true }
    );
    return res.rows?.[0] ? toGrant(res.rows[0]) : null;
  }
}
