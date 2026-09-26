/** Tenant-side support client: tickets (incl. incorrect-finding reports) and support-access grants. */
import { z } from 'zod';
import { customInstance } from './custom-instance';
import { parse } from './commercial';
import { SupportTicketSchema, type SupportTicket } from './admin-ops';

export const TICKET_CATEGORIES = ['QUESTION', 'INCORRECT_FINDING', 'BUG', 'BILLING', 'ACCESS'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const SupportGrantSchema = z.object({
  id: z.string(),
  reason: z.string(),
  grantedByEmail: z.string().nullable(),
  ticketId: z.string().nullable(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  active: z.boolean(),
});
export type SupportGrant = z.infer<typeof SupportGrantSchema>;

export async function fetchMyTickets(): Promise<SupportTicket[]> {
  return parse(z.array(SupportTicketSchema), '/support/tickets', await customInstance('/support/tickets'));
}

export async function createTicket(input: {
  subject: string;
  description: string;
  category: TicketCategory;
  findingId?: string;
  analysisId?: string;
  correlationId?: string;
  locale?: 'en' | 'de';
}): Promise<SupportTicket> {
  return parse(SupportTicketSchema, '/support/tickets', await customInstance('/support/tickets', { method: 'POST', body: JSON.stringify(input) }));
}

export async function fetchGrants(): Promise<SupportGrant[]> {
  return parse(z.array(SupportGrantSchema), '/support/access-grants', await customInstance('/support/access-grants'));
}

export async function createGrant(input: { reason: string; hours: number; ticketId?: string }): Promise<SupportGrant> {
  return parse(
    SupportGrantSchema,
    '/support/access-grants',
    await customInstance('/support/access-grants', { method: 'POST', body: JSON.stringify(input) })
  );
}

export async function revokeGrant(id: string): Promise<SupportGrant> {
  return parse(
    SupportGrantSchema,
    '/support/access-grants/:id/revoke',
    await customInstance(`/support/access-grants/${encodeURIComponent(id)}/revoke`, { method: 'POST' })
  );
}
