import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { SupportMailService, TicketMailFacts } from './support-mail.service';
import { TicketStatusEnum } from './support.service';

export const TicketReplySchema = z
  .object({
    body: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const AdminTicketReplySchema = z
  .object({
    body: z.string().trim().min(1).max(10_000),
    /** Optional status change in the same step (e.g. WAITING_ON_CUSTOMER). */
    status: TicketStatusEnum.optional(),
  })
  .strict();

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorRole: 'CUSTOMER' | 'SUPPORT';
  authorEmail: string | null;
  body: string;
  createdAt: string;
}

function toMessage(r: any): TicketMessage {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    authorRole: r.author_role,
    authorEmail: r.author_email ?? null,
    body: r.body,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Accept-Language / erp_locale → ticket language for requester e-mails. */
export function resolveTicketLocale(explicit: unknown, req: any): 'en' | 'de' {
  if (explicit === 'de' || explicit === 'en') return explicit;
  const cookie = typeof req?.headers?.cookie === 'string' ? /(?:^|;\s*)erp_locale=(en|de)\b/.exec(req.headers.cookie)?.[1] : undefined;
  if (cookie === 'de' || cookie === 'en') return cookie;
  const accept = String(req?.headers?.['accept-language'] ?? '').trim().toLowerCase();
  return accept.startsWith('de') ? 'de' : 'en';
}

/**
 * Ticket conversation (migration 021 support_ticket_messages) and the e-mails for
 * created / replied / status changed. Tenant-side access is scoped by RLS
 * (tenantId); operator access (Super Admin) reads across tenants.
 */
@Injectable()
export class SupportThreadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly mails: SupportMailService
  ) {}

  /** Ticket facts for e-mails (platform read; ids come from verified routes). */
  async facts(ticketId: string): Promise<(TicketMailFacts & { organizationId: string; status: string }) | null> {
    const res = await this.db.query(
      `SELECT t.id, t.organization_id, t.subject, t.description, t.category, t.status, t.locale,
              o.name AS organization_name, u.email AS requester_email
         FROM support_tickets t
         JOIN organizations o ON o.id = t.organization_id
         LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1`,
      [ticketId],
      { bypassRls: true }
    );
    const r = res.rows?.[0];
    if (!r) return null;
    return {
      id: r.id,
      organizationId: r.organization_id,
      subject: r.subject,
      description: r.description,
      category: r.category,
      status: r.status,
      locale: r.locale ?? 'en',
      organizationName: r.organization_name,
      requesterEmail: r.requester_email ?? null,
    };
  }

  async notifyCreated(ticketId: string) {
    const f = await this.facts(ticketId);
    return f ? this.mails.ticketCreated(f) : { requester: false, inbox: false };
  }

  private async requireTenantTicket(orgId: string, ticketId: string): Promise<void> {
    const t = await this.db.query(`SELECT 1 FROM support_tickets WHERE id = $1 AND organization_id = $2`, [ticketId, orgId], {
      tenantId: orgId,
    });
    if (!t.rows?.length) throw new NotFoundException('Ticket not found in this organization');
  }

  async listMessages(orgId: string, ticketId: string): Promise<TicketMessage[]> {
    await this.requireTenantTicket(orgId, ticketId);
    const res = await this.db.query(
      `SELECT m.*, u.email AS author_email FROM support_ticket_messages m LEFT JOIN users u ON u.id = m.author_id
        WHERE m.ticket_id = $1 AND m.organization_id = $2 ORDER BY m.created_at ASC, m.id ASC`,
      [ticketId, orgId],
      { tenantId: orgId }
    );
    return (res.rows ?? []).map(toMessage);
  }

  /** Customer reply (any member of the ticket's organization). */
  async customerReply(orgId: string, ticketId: string, author: { id: string | null; email: string | null }, body: string) {
    await this.requireTenantTicket(orgId, ticketId);
    const res = await this.db.query(
      `INSERT INTO support_ticket_messages (organization_id, ticket_id, author_id, author_role, body)
       VALUES ($1, $2, $3, 'CUSTOMER', $4) RETURNING *`,
      [orgId, ticketId, author.id, body],
      { tenantId: orgId }
    );
    // A customer answer re-opens a ticket that waited for the customer.
    await this.db.query(
      `UPDATE support_tickets SET status = CASE WHEN status IN ('WAITING_ON_CUSTOMER', 'RESOLVED') THEN 'OPEN' ELSE status END,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [ticketId, orgId],
      { tenantId: orgId }
    );
    const message = toMessage({ ...res.rows[0], author_email: author.email });
    const f = await this.facts(ticketId);
    const emailed = f ? this.mails.ticketReplied(f, { authorRole: 'CUSTOMER', authorEmail: author.email, body }) : null;
    return { message, emailed };
  }

  // ------------------------------------------------------------------ operator side

  async adminTicket(ticketId: string) {
    const f = await this.facts(ticketId);
    if (!f) throw new NotFoundException('Ticket not found');
    const res = await this.db.query(
      `SELECT m.*, u.email AS author_email FROM support_ticket_messages m LEFT JOIN users u ON u.id = m.author_id
        WHERE m.ticket_id = $1 ORDER BY m.created_at ASC, m.id ASC`,
      [ticketId],
      { bypassRls: true }
    );
    return {
      ticket: {
        id: f.id,
        organizationId: f.organizationId,
        organizationName: f.organizationName,
        subject: f.subject,
        description: f.description,
        category: f.category,
        status: f.status,
        locale: f.locale,
        requesterEmail: f.requesterEmail,
      },
      messages: (res.rows ?? []).map(toMessage),
    };
  }

  /** Operator reply, optionally with a status change; e-mails requester and inbox. */
  async supportReply(
    ticketId: string,
    author: { id: string | null; email: string | null },
    body: string,
    status?: z.infer<typeof TicketStatusEnum>
  ) {
    const f = await this.facts(ticketId);
    if (!f) throw new NotFoundException('Ticket not found');
    const res = await this.db.query(
      `INSERT INTO support_ticket_messages (organization_id, ticket_id, author_id, author_role, body)
       VALUES ($1, $2, $3, 'SUPPORT', $4) RETURNING *`,
      [f.organizationId, ticketId, author.id, body],
      { tenantId: f.organizationId }
    );
    const message = toMessage({ ...res.rows[0], author_email: author.email });
    const emailed = this.mails.ticketReplied(f, { authorRole: 'SUPPORT', authorEmail: author.email, body });
    let statusChange: { from: string; to: string } | null = null;
    if (status && status !== f.status) {
      statusChange = await this.applyStatus(f.organizationId, ticketId, f.status, status);
      this.mails.statusChanged(f, statusChange, author.email);
    } else {
      await this.db.query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [ticketId], { tenantId: f.organizationId });
    }
    return { organizationId: f.organizationId, message, statusChange, emailed };
  }

  private async applyStatus(orgId: string, ticketId: string, from: string, to: string) {
    await this.db.query(`UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1`, [ticketId, to], {
      tenantId: orgId,
    });
    return { from, to };
  }

  /** Status change by an operator; e-mails requester and inbox when the status really changed. */
  async changeStatus(ticketId: string, status: z.infer<typeof TicketStatusEnum>, actor: { id: string | null; email: string | null }) {
    const f = await this.facts(ticketId);
    if (!f) throw new NotFoundException('Ticket not found');
    if (f.status === status) {
      return { organizationId: f.organizationId, ticketId, status, changed: false, emailed: { requester: false, inbox: false } };
    }
    const change = await this.applyStatus(f.organizationId, ticketId, f.status, status);
    const emailed = this.mails.statusChanged(f, change, actor.email);
    return { organizationId: f.organizationId, ticketId, status, previousStatus: change.from, changed: true, emailed };
  }
}
