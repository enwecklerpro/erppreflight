/**
 * Pure access decisions for tenant-scoped requests (spec 10.2 IP allowlists,
 * 10.7 suspension). Evaluated by TenancyMiddleware after the caller's membership
 * in the tenant has been verified; unit-tested without HTTP.
 */

/** Path of an API request without the `/api/v1` prefix and query string. */
export function apiPath(originalUrl: string | undefined | null): string {
  const path = String(originalUrl ?? '').split('?')[0].split('#')[0];
  const stripped = path.replace(/^\/api\/v1(?=\/|$)/, '');
  const clean = stripped.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Routes a member of a SUSPENDED organization may still call: authentication and
 * account self-service (sign-in state, sign-out, password/2FA, GDPR account export
 * and deletion), invitations, the organization list used by the switcher, the
 * tenant status used by the web app's suspended screen, impersonation control and
 * support tickets (members must be able to contact support about the suspension).
 */
export function isSuspensionExemptPath(path: string, method: string): boolean {
  const m = method.toUpperCase();
  if (under(path, '/auth') || under(path, '/account') || under(path, '/invitations')) return true;
  if (under(path, '/tenant-access') || under(path, '/impersonation')) return true;
  if (under(path, '/support/tickets')) return true;
  return m === 'GET' && path === '/organizations';
}

/**
 * Routes reachable from an address outside the organization's allowlist: only
 * authentication (so the user can sign out or switch organization), the tenant
 * status (explains the block) and impersonation control. Everything that reads or
 * changes organization data is blocked.
 */
export function isIpAllowlistExemptPath(path: string, method: string): boolean {
  const m = method.toUpperCase();
  if (under(path, '/auth') || under(path, '/tenant-access') || under(path, '/impersonation')) return true;
  return m === 'GET' && path === '/organizations';
}

export interface TenantAccessState {
  /** organizations.status */
  status: string | null | undefined;
  /** Number of allowlist entries (0 = allowlist not enforced). */
  allowlistCount: number;
  /** The request's client address lies inside an allowlist entry. */
  ipAllowed: boolean;
}

export interface TenantAccessRequest {
  path: string;
  method: string;
  /** users.system_role of the principal acting in the tenant. */
  systemRole?: string | null;
  /** Request authenticated by an impersonation session (read-only operator access). */
  impersonating?: boolean;
  clientIp: string | null;
}

export type TenantAccessDenial = { code: 'TENANT_SUSPENDED' | 'IP_NOT_ALLOWED'; message: string };

/**
 * - SUSPENDED organization → 403 TENANT_SUSPENDED for tenant routes. Platform
 *   operators (SUPER_ADMIN, impersonation sessions) are exempt: suspension is an
 *   operator decision and they need to inspect the tenant.
 * - Non-empty allowlist and the client address outside it → 403 IP_NOT_ALLOWED.
 *   Nobody is exempt (it is the customer's control); platform routes under /admin
 *   never pass through tenant resolution and stay reachable for operators.
 */
export function decideTenantAccess(state: TenantAccessState, req: TenantAccessRequest): TenantAccessDenial | null {
  const operator = req.systemRole === 'SUPER_ADMIN' || !!req.impersonating;
  if (state.status === 'SUSPENDED' && !operator && !isSuspensionExemptPath(req.path, req.method)) {
    return {
      code: 'TENANT_SUSPENDED',
      message:
        'This organization has been suspended. You can still sign in, export your personal data and contact support.',
    };
  }
  if (state.allowlistCount > 0 && !state.ipAllowed && !isIpAllowlistExemptPath(req.path, req.method)) {
    return {
      code: 'IP_NOT_ALLOWED',
      message: `Access from ${req.clientIp ?? 'this network'} is not allowed by this organization's IP allowlist.`,
    };
  }
  return null;
}
