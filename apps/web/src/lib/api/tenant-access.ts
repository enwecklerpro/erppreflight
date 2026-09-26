/**
 * Tenant access administration client (API module `tenant-access`, migration 021):
 * organization suspension state, IP allowlist, safe impersonation (banner + super
 * admin actions), trial extension and the support ticket conversation. Every
 * response is validated with Zod so contract drift surfaces as a query error.
 */
import { z } from 'zod';
import { customInstance } from './custom-instance';
import { parse } from './commercial';

export const tenantAccessKeys = {
  status: ['tenant-access', 'status'] as const,
  impersonation: ['tenant-access', 'impersonation', 'current'] as const,
  ipAllowlist: ['tenant-access', 'ip-allowlist'] as const,
  adminAccess: (organizationId: string) => ['admin', 'tenant-access', organizationId] as const,
  adminImpersonations: ['admin', 'impersonations'] as const,
  ticketMessages: (ticketId: string) => ['support', 'tickets', ticketId, 'messages'] as const,
  adminTicket: (ticketId: string) => ['admin', 'tickets', ticketId, 'thread'] as const,
};

/** Error codes the API answers for blocked tenant access (see apps/api/.../tenant-access.policy.ts). */
export const TENANT_ACCESS_ERROR_CODES = [
  'TENANT_SUSPENDED',
  'IP_NOT_ALLOWED',
  'IMPERSONATION_READ_ONLY',
  'IMPERSONATION_SECRET_ACCESS_DENIED',
  'IMPERSONATION_EXPIRED',
  'IMPERSONATION_ENDED',
] as const;
export type TenantAccessErrorCode = (typeof TENANT_ACCESS_ERROR_CODES)[number];

export function isTenantAccessErrorCode(code: unknown): code is TenantAccessErrorCode {
  return typeof code === 'string' && (TENANT_ACCESS_ERROR_CODES as readonly string[]).includes(code);
}

// ------------------------------------------------------------------ tenant status

export const TenantAccessStatusSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  status: z.string(),
  suspended: z.boolean(),
  suspendedAt: z.string().nullable(),
  suspensionReason: z.string().nullable(),
  ipAllowlist: z.object({
    enforced: z.boolean(),
    clientIp: z.string().nullable(),
    clientIpAllowed: z.boolean(),
  }),
  impersonating: z.boolean(),
});
export type TenantAccessStatus = z.infer<typeof TenantAccessStatusSchema>;

export async function fetchTenantAccessStatus(): Promise<TenantAccessStatus> {
  return parse(TenantAccessStatusSchema, '/tenant-access/status', await customInstance('/tenant-access/status'));
}

// ------------------------------------------------------------------ impersonation (banner)

export const ImpersonationModeSchema = z.enum(['READ_ONLY', 'READ_WRITE']);

export const ImpersonationSessionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  targetUserId: z.string(),
  targetEmail: z.string(),
  targetFullName: z.string().nullable(),
  memberRole: z.string(),
  impersonatorEmail: z.string(),
  mode: ImpersonationModeSchema,
  reason: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type ImpersonationSession = z.infer<typeof ImpersonationSessionSchema>;

export const CurrentImpersonationSchema = z.object({
  active: z.boolean(),
  session: ImpersonationSessionSchema.optional(),
  ended: z.object({ code: z.string(), returnOrganizationId: z.string().nullable() }).optional(),
  returnTo: z.string().optional(),
  serverTime: z.string(),
});
export type CurrentImpersonation = z.infer<typeof CurrentImpersonationSchema>;

export async function fetchCurrentImpersonation(): Promise<CurrentImpersonation> {
  return parse(CurrentImpersonationSchema, '/impersonation/current', await customInstance('/impersonation/current'));
}

const EndImpersonationSchema = z.object({
  ended: z.boolean(),
  returnTo: z.string(),
  returnOrganizationId: z.string().nullable().optional(),
});

export async function endCurrentImpersonation() {
  return parse(EndImpersonationSchema, '/impersonation/end', await customInstance('/impersonation/end', { method: 'POST' }));
}

// ------------------------------------------------------------------ IP allowlist (organization settings)

export const IP_ALLOWLIST_MAX_ENTRIES = 50;

export const IpAllowlistEntrySchema = z.object({
  id: z.string(),
  cidr: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  createdByEmail: z.string().nullable(),
});

export const IpAllowlistViewSchema = z.object({
  entries: z.array(IpAllowlistEntrySchema),
  enforced: z.boolean(),
  maxEntries: z.number(),
  clientIp: z.string().nullable(),
  clientIpAllowed: z.boolean(),
  featureAvailable: z.boolean(),
});
export type IpAllowlistView = z.infer<typeof IpAllowlistViewSchema>;

export async function fetchIpAllowlist(): Promise<IpAllowlistView> {
  return parse(IpAllowlistViewSchema, '/organizations/current/ip-allowlist', await customInstance('/organizations/current/ip-allowlist'));
}

export interface IpAllowlistInput {
  entries: Array<{ cidr: string; label?: string }>;
  confirmLockout?: boolean;
}

export async function saveIpAllowlist(input: IpAllowlistInput): Promise<IpAllowlistView> {
  return parse(
    IpAllowlistViewSchema.passthrough(),
    'PUT /organizations/current/ip-allowlist',
    await customInstance('/organizations/current/ip-allowlist', { method: 'PUT', body: JSON.stringify(input) })
  );
}

export async function clearIpAllowlist(): Promise<{ removed: number }> {
  return parse(
    z.object({ removed: z.number() }),
    'DELETE /organizations/current/ip-allowlist',
    await customInstance('/organizations/current/ip-allowlist', { method: 'DELETE' })
  );
}

// ------------------------------------------------------------------ super admin

export const ImpersonationViewSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  impersonatorId: z.string().nullable(),
  impersonatorEmail: z.string(),
  targetUserId: z.string().nullable(),
  targetEmail: z.string(),
  reason: z.string(),
  mode: ImpersonationModeSchema,
  status: z.enum(['ACTIVE', 'ENDED', 'EXPIRED']),
  createdAt: z.string(),
  expiresAt: z.string(),
  endedAt: z.string().nullable(),
  endReason: z.string().nullable(),
  requestCount: z.number(),
  lastRequestAt: z.string().nullable(),
});
export type ImpersonationView = z.infer<typeof ImpersonationViewSchema>;

export const TenantAccessOverviewSchema = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    suspendedAt: z.string().nullable(),
    suspensionReason: z.string().nullable(),
    planTier: z.string().nullable(),
    subscriptionStatus: z.string().nullable(),
  }),
  trial: z.object({
    tier: z.string().nullable(),
    startedAt: z.string().nullable(),
    endsAt: z.string().nullable(),
    originalEndsAt: z.string().nullable(),
    extendedDays: z.number(),
    maxEndsAt: z.string().nullable(),
    active: z.boolean(),
    effectiveTier: z.string().nullable(),
    extendable: z.boolean(),
  }),
  ipAllowlist: z.array(z.object({ cidr: z.string(), label: z.string().nullable(), createdAt: z.string().nullable() })),
  members: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      fullName: z.string().nullable(),
      status: z.string(),
      systemRole: z.string().nullable(),
      role: z.string(),
      impersonable: z.boolean(),
    })
  ),
  impersonations: z.array(ImpersonationViewSchema),
});
export type TenantAccessOverview = z.infer<typeof TenantAccessOverviewSchema>;

export async function fetchTenantAccessOverview(organizationId: string): Promise<TenantAccessOverview> {
  const path = `/admin/tenants/${encodeURIComponent(organizationId)}/access`;
  return parse(TenantAccessOverviewSchema, '/admin/tenants/:id/access', await customInstance(path));
}

const post = (path: string, body: unknown) => customInstance(path, { method: 'POST', body: JSON.stringify(body) });

export async function suspendTenant(organizationId: string, reason: string) {
  return parse(
    z.object({ status: z.string(), ownersNotified: z.number() }).passthrough(),
    '/admin/tenants/:id/suspend',
    await post(`/admin/tenants/${encodeURIComponent(organizationId)}/suspend`, { reason })
  );
}

export async function unsuspendTenant(organizationId: string, reason: string) {
  return parse(
    z.object({ status: z.string(), ownersNotified: z.number() }).passthrough(),
    '/admin/tenants/:id/unsuspend',
    await post(`/admin/tenants/${encodeURIComponent(organizationId)}/unsuspend`, { reason })
  );
}

export async function extendTenantTrial(organizationId: string, days: number, reason: string) {
  return parse(
    z.object({ trialEndsAt: z.string().nullable(), trialExtendedDays: z.number(), ownersNotified: z.number() }).passthrough(),
    '/admin/tenants/:id/trial-extension',
    await post(`/admin/tenants/${encodeURIComponent(organizationId)}/trial-extension`, { days, reason })
  );
}

export async function breakGlassClearIpAllowlist(organizationId: string, reason: string) {
  return parse(
    z.object({ removed: z.number() }).passthrough(),
    '/admin/tenants/:id/ip-allowlist/clear',
    await post(`/admin/tenants/${encodeURIComponent(organizationId)}/ip-allowlist/clear`, { reason })
  );
}

export async function startImpersonation(input: {
  organizationId: string;
  userId: string;
  reason: string;
  durationMinutes: number;
  mode: 'READ_ONLY' | 'READ_WRITE';
}) {
  return parse(
    z.object({ impersonation: ImpersonationViewSchema, session: ImpersonationSessionSchema, returnTo: z.string() }),
    '/admin/impersonations',
    await post('/admin/impersonations', input)
  );
}

export async function fetchAdminImpersonations(activeOnly = false): Promise<ImpersonationView[]> {
  return parse(
    z.array(ImpersonationViewSchema),
    '/admin/impersonations',
    await customInstance(`/admin/impersonations${activeOnly ? '?active=true' : ''}`)
  );
}

export async function endAdminImpersonation(id: string): Promise<ImpersonationView> {
  return parse(ImpersonationViewSchema, '/admin/impersonations/:id/end', await post(`/admin/impersonations/${encodeURIComponent(id)}/end`, {}));
}

// ------------------------------------------------------------------ support ticket conversation

export const TicketMessageSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  authorRole: z.enum(['CUSTOMER', 'SUPPORT']),
  authorEmail: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});
export type TicketMessage = z.infer<typeof TicketMessageSchema>;

export async function fetchTicketMessages(ticketId: string): Promise<TicketMessage[]> {
  return parse(
    z.array(TicketMessageSchema),
    '/support/tickets/:id/messages',
    await customInstance(`/support/tickets/${encodeURIComponent(ticketId)}/messages`)
  );
}

export async function replyToTicket(ticketId: string, body: string) {
  return parse(
    z.object({ message: TicketMessageSchema }).passthrough(),
    'POST /support/tickets/:id/messages',
    await post(`/support/tickets/${encodeURIComponent(ticketId)}/messages`, { body })
  );
}

export const AdminTicketThreadSchema = z.object({
  ticket: z.object({
    id: z.string(),
    organizationId: z.string(),
    organizationName: z.string(),
    subject: z.string(),
    description: z.string(),
    category: z.string(),
    status: z.string(),
    locale: z.string(),
    requesterEmail: z.string().nullable(),
  }),
  messages: z.array(TicketMessageSchema),
});
export type AdminTicketThread = z.infer<typeof AdminTicketThreadSchema>;

export async function fetchAdminTicketThread(ticketId: string): Promise<AdminTicketThread> {
  return parse(AdminTicketThreadSchema, '/admin/support/tickets/:id', await customInstance(`/admin/support/tickets/${encodeURIComponent(ticketId)}`));
}

export async function adminReplyToTicket(ticketId: string, body: string, status?: string) {
  return parse(
    z.object({ message: TicketMessageSchema }).passthrough(),
    'POST /admin/support/tickets/:id/messages',
    await post(`/admin/support/tickets/${encodeURIComponent(ticketId)}/messages`, status ? { body, status } : { body })
  );
}
