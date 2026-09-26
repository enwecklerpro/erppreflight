/**
 * Stable, machine-readable error codes for the API error envelope.
 *
 * Every error response carries `code` (additive to the existing envelope: `statusCode`,
 * `message`, `details`, … are unchanged). Resolution order:
 *   1. an explicit `code` thrown with the exception (e.g. PLAN_LIMIT_EXCEEDED, SSO_REQUIRED);
 *   2. a known server message mapped to a specific code (catalog below);
 *   3. a generic code derived from the HTTP status (NOT_FOUND, VALIDATION_FAILED, …).
 *
 * Clients translate by code (web: `app.apiErrorCodes.<CODE>` EN/DE) and fall back to the
 * English `message` for anything unmapped. Codes are part of the public API contract:
 * never rename one, only add.
 */

export const GENERIC_ERROR_CODES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
} as const;

/** Codes for well-known server messages (matched on the English message, anchored). */
export const MESSAGE_ERROR_CODES: ReadonlyArray<readonly [RegExp, string]> = [
  // Authentication & session
  [/^Invalid email or password$/, 'INVALID_CREDENTIALS'],
  [/^Account is not active$/, 'ACCOUNT_INACTIVE'],
  [/^Invalid authentication code$/, 'INVALID_2FA_CODE'],
  [/^Too many invalid codes/, 'TOO_MANY_2FA_ATTEMPTS'],
  [/^(Session|Organization membership) has been revoked/, 'SESSION_REVOKED'],
  [/^The sign-in challenge (expired|is no longer valid)/, 'SIGN_IN_CHALLENGE_EXPIRED'],
  [/^Invalid sign-in challenge$/, 'SIGN_IN_CHALLENGE_EXPIRED'],
  [/^Authentication required$/, 'UNAUTHENTICATED'],
  [/^Invalid token payload$/, 'UNAUTHENTICATED'],
  [/^Invalid or expired API Key$/, 'API_KEY_INVALID'],
  [/^API key scopes do not permit this operation$/, 'API_KEY_SCOPE_DENIED'],
  [/^API keys cannot be used for this operation/, 'API_KEY_NOT_ALLOWED'],
  [/^API key authentication is not available on this route$/, 'API_KEY_NOT_ALLOWED'],
  [/^Password is incorrect$/, 'PASSWORD_INCORRECT'],
  [/^The new password must differ/, 'PASSWORD_UNCHANGED'],
  [/^User with this email already exists$/, 'USER_EXISTS'],
  [/^This invitation is invalid, expired/, 'INVITATION_INVALID'],
  [/^Invitation not found or already accepted$/, 'INVITATION_INVALID'],
  [/^This reset link is (invalid|no longer valid)/, 'RESET_LINK_INVALID'],
  [/^This verification link is (invalid|no longer valid)/, 'VERIFY_LINK_INVALID'],
  [/^Two-factor authentication is already enabled$/, 'TWO_FACTOR_ALREADY_ENABLED'],
  [/^Two-factor authentication is not enabled$/, 'TWO_FACTOR_NOT_ENABLED'],
  [/^No pending setup or the setup expired/, 'TWO_FACTOR_SETUP_EXPIRED'],
  [/^Enrollment token is invalid, expired or already used$/, 'ENROLLMENT_TOKEN_INVALID'],
  [/^(Invalid SSO state|SSO state expired|SSO state is not bound to this browser session)$/, 'SSO_STATE_INVALID'],
  [/^SSO is not configured for this organization$/, 'SSO_NOT_CONFIGURED'],
  [/^No SSO configuration for this e-mail domain$/, 'SSO_NOT_CONFIGURED'],
  // Tenancy & roles
  [/^Access denied: (You are not an active member|API Key not authorized)/, 'TENANT_ACCESS_DENIED'],
  [/^User is not a member of this organization$/, 'TENANT_ACCESS_DENIED'],
  [/^You are not a member of this organization$/, 'TENANT_ACCESS_DENIED'],
  [/^A verified tenant context is required/, 'TENANT_CONTEXT_REQUIRED'],
  [/^organizationId must be a UUID$/, 'TENANT_CONTEXT_REQUIRED'],
  [/^Super Admin privilege required$/, 'SUPER_ADMIN_REQUIRED'],
  [/^Only (organization owners|an organization owner) can/, 'OWNER_REQUIRED'],
  [/^The last owner cannot be removed/, 'LAST_OWNER_REMOVE'],
  [/^The last owner cannot be demoted/, 'LAST_OWNER_DEMOTE'],
  [/^This person is already a member/, 'MEMBER_EXISTS'],
  [/^You are already a member of this organization$/, 'MEMBER_EXISTS'],
  [/^The confirmation does not match the organization name$/, 'ORG_NAME_MISMATCH'],
  [/^(Tenant )?[Rr]eport branding requires the Professional plan/, 'PLAN_FEATURE_REQUIRED'],
  // Resources
  [/^Project not found( in this organization)?$/, 'PROJECT_NOT_FOUND'],
  [/^Finding not found( in this (project|organization))?$/, 'FINDING_NOT_FOUND'],
  [/^Analysis not found( in this organization)?$/, 'ANALYSIS_NOT_FOUND'],
  [/^Organization not found$/, 'ORGANIZATION_NOT_FOUND'],
  [/^Member not found$/, 'MEMBER_NOT_FOUND'],
  [/^Workspace not found$/, 'WORKSPACE_NOT_FOUND'],
  [/^Connector is disabled$/, 'CONNECTOR_DISABLED'],
  [/^This domain is already verified by another organization$/, 'DOMAIN_TAKEN'],
  // Service availability
  [/^The engine catalog is temporarily unavailable$/, 'ENGINE_CATALOG_UNAVAILABLE'],
  [/^The XML checker (is temporarily unavailable|returned an unexpected result)/, 'TOOL_UNAVAILABLE'],
  [/^Ingestion pipeline unavailable$/, 'INGESTION_UNAVAILABLE'],
  [/^The (verification|invitation) e-mail could not be sent/, 'MAIL_DELIVERY_FAILED'],
  [/^The knowledge graph has no published snapshot yet/, 'KNOWLEDGE_SNAPSHOT_MISSING'],
  [/^ThrottlerException/, 'RATE_LIMITED'],
];

function firstMessage(message: unknown): string {
  if (Array.isArray(message)) return typeof message[0] === 'string' ? message[0] : '';
  return typeof message === 'string' ? message : '';
}

/** Code for an error response without an explicit code. */
export function deriveErrorCode(status: number, message: unknown): string {
  if (status === 400 && Array.isArray(message) && message.length > 0) return 'VALIDATION_FAILED';
  const text = firstMessage(message);
  if (text) {
    for (const [pattern, code] of MESSAGE_ERROR_CODES) {
      if (pattern.test(text)) return code;
    }
  }
  const generic = (GENERIC_ERROR_CODES as Record<number, string>)[status];
  if (generic) return generic;
  if (status >= 500) return 'INTERNAL_ERROR';
  return status >= 400 ? 'BAD_REQUEST' : 'UNKNOWN_ERROR';
}
