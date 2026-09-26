/**
 * What an impersonation session may do (spec 10.8 "cannot access decrypted secrets
 * unnecessarily", C §24 "permission, reason, banner, audit, expiry"). Pure rules,
 * evaluated by ImpersonationMiddleware on every request BEFORE any guard or
 * handler runs, independent of the impersonated member's role.
 */

export const IMPERSONATION_READ_ONLY = 'IMPERSONATION_READ_ONLY';
export const IMPERSONATION_SECRET_ACCESS_DENIED = 'IMPERSONATION_SECRET_ACCESS_DENIED';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(String(method || 'GET').toUpperCase());
}

/** Session control that must keep working while impersonating (and after expiry). */
export function isImpersonationControlPath(path: string, method: string): boolean {
  const m = String(method).toUpperCase();
  return (
    (m === 'GET' && path === '/impersonation/current') ||
    (m === 'POST' && path === '/impersonation/end') ||
    (m === 'POST' && path === '/auth/logout')
  );
}

/**
 * Resources an impersonator can never reach, whatever the method or mode:
 * credentials and sessions of the impersonated person, API keys, identity-provider
 * and SCIM configuration, webhook signing secrets and delivery payloads, agent
 * enrollment/signing material, personal-data exports, billing mutations,
 * support-access self-granting, tenant security settings and platform admin.
 */
const ALWAYS_DENIED: RegExp[] = [
  /^\/auth(\/|$)/, // password, 2FA, sessions, sign-out-everywhere, org switch (GET /auth/me and /auth/csrf excepted below)
  /^\/account(\/|$)/, // GDPR export / account deletion of the impersonated person
  /^\/api-keys(\/|$)/,
  /^\/sso\/admin(\/|$)/, // IdP client secrets, SCIM tokens
  /^\/webhooks\/[^/]+\/rotate-secret$/,
  /^\/webhooks\/[^/]+\/deliveries\/[^/]+\/payload$/,
  /^\/agents\/(enrollment-tokens|signing-key)(\/|$)/,
  /^\/organizations\/current\/(security|export)(\/|$)/,
  /^\/organizations\/ownership-transfer$/,
  /^\/admin(\/|$)/,
  /^\/dev(\/|$)/,
  // Defence in depth for resources added later.
  /(^|\/)(secret|secrets|credentials?|reveal|password|recovery-codes|2fa|totp|signing-key)(\/|$)/i,
];

const ALWAYS_ALLOWED_READS: RegExp[] = [/^\/auth\/me$/, /^\/auth\/csrf$/];

/** Resources that are read-only for impersonators even in read-write mode. */
const WRITE_DENIED: RegExp[] = [
  /^\/billing(\/|$)/, // checkout, portal, cancellation, plan changes
  /^\/support\/access-grants(\/|$)/, // no self-granting of support access
  /^\/organizations\/current(\/ip-allowlist)?$/, // organization settings, deletion, allowlist
  /^\/organizations\/current\/ip-allowlist(\/|$)/,
  /^\/organizations\/(members|invitations)(\/|$)/, // membership and roles
  /^\/partners(\/|$)/, // delegated-access grants
  /^\/connectors(\/|$)/, // connector credentials
  /^\/landscapes(\/|$)/, // system credentials
  /^\/webhooks(\/|$)/,
];

export type ImpersonationDecision =
  | { allowed: true }
  | { allowed: false; code: typeof IMPERSONATION_READ_ONLY | typeof IMPERSONATION_SECRET_ACCESS_DENIED; message: string };

export function decideImpersonationRequest(method: string, path: string, readOnly: boolean): ImpersonationDecision {
  const m = String(method || 'GET').toUpperCase();
  if (isImpersonationControlPath(path, m)) return { allowed: true };
  const allowedRead = SAFE_METHODS.has(m) && ALWAYS_ALLOWED_READS.some((re) => re.test(path));
  if (!allowedRead && ALWAYS_DENIED.some((re) => re.test(path))) {
    return {
      allowed: false,
      code: IMPERSONATION_SECRET_ACCESS_DENIED,
      message: 'Impersonation sessions cannot access credentials, secrets, personal account data or platform administration.',
    };
  }
  if (SAFE_METHODS.has(m)) return { allowed: true };
  if (readOnly) {
    return {
      allowed: false,
      code: IMPERSONATION_READ_ONLY,
      message: 'This impersonation session is read-only. End it to make changes with your own account.',
    };
  }
  if (WRITE_DENIED.some((re) => re.test(path))) {
    return {
      allowed: false,
      code: IMPERSONATION_SECRET_ACCESS_DENIED,
      message: 'Billing, security, membership and credential settings cannot be changed while impersonating.',
    };
  }
  return { allowed: true };
}
