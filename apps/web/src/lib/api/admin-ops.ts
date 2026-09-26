/**
 * Super Admin operations client: feature flags, support ticket queue and the
 * support-console tenant lookup (grant or break-glass reason).
 */
import { z } from 'zod';
import { FeatureFlagSchema, FeatureFlagUpsertSchema, type FeatureFlagUpsert } from '@erppreflight/schemas';
import { customInstance } from './custom-instance';
import { parse, TenantDetailSchema, type TenantDetail } from './commercial';

const FlagListSchema = z.object({ environment: z.string(), flags: z.array(FeatureFlagSchema) });

export async function fetchAdminFeatureFlags() {
  return parse(FlagListSchema, '/admin/feature-flags', await customInstance('/admin/feature-flags'));
}

export async function upsertAdminFeatureFlag(key: string, flag: FeatureFlagUpsert) {
  return parse(
    FeatureFlagSchema,
    '/admin/feature-flags/:key',
    await customInstance(`/admin/feature-flags/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(FeatureFlagUpsertSchema.parse(flag)),
    })
  );
}

export async function deleteAdminFeatureFlag(key: string) {
  return customInstance(`/admin/feature-flags/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export const SupportTicketSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string().optional(),
  createdByEmail: z.string().nullable(),
  subject: z.string(),
  description: z.string(),
  category: z.string(),
  status: z.string(),
  findingId: z.string().nullable(),
  analysisId: z.string().nullable(),
  correlationId: z.string().nullable(),
  createdAt: z.string(),
});
export type SupportTicket = z.infer<typeof SupportTicketSchema>;

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;

export async function fetchAdminTickets(status?: string): Promise<SupportTicket[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return parse(z.array(SupportTicketSchema), '/admin/support/tickets', await customInstance(`/admin/support/tickets${qs}`));
}

export async function updateAdminTicketStatus(id: string, status: string) {
  return customInstance(`/admin/support/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function fetchAdminTenantDetailWithReason(id: string, reason?: string): Promise<TenantDetail> {
  const qs = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  return parse(TenantDetailSchema, '/admin/tenants/:id', await customInstance(`/admin/tenants/${encodeURIComponent(id)}${qs}`));
}
