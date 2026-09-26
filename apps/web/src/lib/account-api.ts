/**
 * Account lifecycle API client (authentication, 2FA, sessions, invitations,
 * members, organization switching, GDPR). Every response is validated with Zod so
 * contract drift surfaces as a query error instead of rendering `undefined`.
 */
import { z } from 'zod';
import {
  ApiError,
  customInstance,
  downloadApiFile,
  markSignedIn,
  type DownloadedFile,
} from './api/custom-instance';

export const accountKeys = {
  me: ['account', 'me'] as const,
  twoFactor: ['account', 'two-factor'] as const,
  sessions: ['account', 'sessions'] as const,
  organizations: ['account', 'organizations'] as const,
  currentOrganization: ['account', 'organization', 'current'] as const,
  members: ['account', 'members'] as const,
  invitations: ['account', 'invitations'] as const,
  deletionImpact: ['account', 'deletion-impact'] as const,
};

// ------------------------------------------------------------------ schemas

export const SessionUserSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    fullName: z.string().nullable().optional(),
    organizationId: z.string(),
    role: z.string(),
    systemRole: z.string().optional(),
    emailVerified: z.boolean().optional(),
    mfaEnabled: z.boolean().optional(),
  })
  .passthrough();

/**
 * Session-issuing responses. Browsers receive the user and the CSRF token; the
 * session itself is the API's HttpOnly cookie (the API omits `accessToken` for
 * browser requests, and the web app never stores one).
 */
export const SessionResponseSchema = z.object({
  user: SessionUserSchema,
  csrfToken: z.string().optional(),
  mfaEnrollmentRequired: z.boolean().optional(),
  recoveryCodes: z.array(z.string()).optional(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const MfaChallengeSchema = z.object({
  mfaRequired: z.literal(true),
  challengeToken: z.string().min(1),
  expiresIn: z.number(),
});
export type MfaChallenge = z.infer<typeof MfaChallengeSchema>;

export const LoginResponseSchema = z.union([MfaChallengeSchema, SessionResponseSchema]);

export const MeSchema = z.object({
  user: z
    .object({
      id: z.string(),
      email: z.string().optional(),
      fullName: z.string().nullable().optional(),
      organizationId: z.string(),
      role: z.string().optional(),
      systemRole: z.string().optional(),
      emailVerified: z.boolean().optional(),
      emailVerifiedAt: z.string().nullable().optional(),
      mfaEnabled: z.boolean().optional(),
      createdAt: z.string().nullable().optional(),
    })
    .passthrough(),
});
export type Me = z.infer<typeof MeSchema>['user'];

export const TwoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  enabledAt: z.string().nullable(),
  recoveryCodesRemaining: z.number(),
});
export type TwoFactorStatus = z.infer<typeof TwoFactorStatusSchema>;

export const TwoFactorSetupSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string().startsWith('otpauth://'),
  issuer: z.string(),
  account: z.string(),
  expiresInMinutes: z.number(),
});
export type TwoFactorSetup = z.infer<typeof TwoFactorSetupSchema>;

export const SessionItemSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  authMethod: z.string(),
  current: z.boolean(),
});
export type SessionItem = z.infer<typeof SessionItemSchema>;

export const OrganizationSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string().optional(),
    plan_tier: z.string().optional(),
    status: z.string().optional(),
    role: z.string(),
  })
  .passthrough();
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;

export const CurrentOrganizationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string().optional(),
    plan_tier: z.string().optional(),
    require_2fa: z.boolean().optional(),
  })
  .passthrough();
export type CurrentOrganization = z.infer<typeof CurrentOrganizationSchema>;

export const MemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  fullName: z.string().nullable(),
  role: z.string(),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  joinedAt: z.string(),
});
export type Member = z.infer<typeof MemberSchema>;

export const InvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
  expiresAt: z.string(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  revokedAt: z.string().nullable().optional(),
  invitedBy: z.object({ email: z.string(), fullName: z.string().nullable() }).nullable().optional(),
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const InvitationPreviewSchema = z.object({
  organizationName: z.string(),
  email: z.string(),
  role: z.string(),
  invitedBy: z.string().nullable(),
  expiresAt: z.string(),
  accountExists: z.boolean(),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

export const DeletionImpactSchema = z.object({
  soleOwnerOrganizations: z.array(z.object({ id: z.string(), name: z.string(), memberCount: z.number() })),
  memberships: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })),
});
export type DeletionImpact = z.infer<typeof DeletionImpactSchema>;

// ------------------------------------------------------------------ helpers

const post = (url: string, body?: unknown, method = 'POST') =>
  customInstance<unknown>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * Records a freshly issued session on the client: navigation marker, active
 * organization and CSRF token. No credential is stored (HttpOnly cookie only).
 */
export function storeSession(session: SessionResponse): void {
  markSignedIn({ organizationId: session.user.organizationId, csrfToken: session.csrfToken ?? null });
}

/** Returns the machine-readable API error code (e.g. EMAIL_NOT_VERIFIED), if any. */
export function apiErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 429) return 'Too many attempts. Please wait a moment and try again.';
    return error.message || fallback;
  }
  if (error instanceof z.ZodError) return 'The server returned an unexpected response.';
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

/** Only same-origin relative paths are accepted as post-login redirects. */
export function safeNextPath(next: string | null | undefined, fallback = '/projects'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

// ------------------------------------------------------------------ auth

export async function login(email: string, password: string) {
  return LoginResponseSchema.parse(await post('/auth/login', { email, password }));
}

export async function completeSecondFactor(challengeToken: string, factor: { code?: string; recoveryCode?: string }) {
  return SessionResponseSchema.parse(await post('/auth/login/2fa', { challengeToken, ...factor }));
}

/** Revokes the server-side session and clears the session cookies (best effort). */
export async function logoutSession(): Promise<void> {
  await customInstance('/auth/logout', { method: 'POST' });
}

// ------------------------------------------------------------------ magic link (spec 10.2)

export const MagicLinkRequestResponseSchema = z.object({
  accepted: z.literal(true),
  message: z.string(),
  expiresInMinutes: z.number(),
});

export const MagicLinkPreviewSchema = z.object({
  valid: z.boolean(),
  email: z.string().optional(),
  expiresAt: z.string().optional(),
});
export type MagicLinkPreview = z.infer<typeof MagicLinkPreviewSchema>;

/** Same response whether or not the account exists (no enumeration). */
export async function requestMagicLink(email: string, next?: string | null) {
  return MagicLinkRequestResponseSchema.parse(
    await post('/auth/magic-link', { email, ...(next && next !== '/projects' ? { next } : {}) })
  );
}

/** Checks a sign-in link without consuming it. */
export async function previewMagicLink(token: string): Promise<MagicLinkPreview> {
  return MagicLinkPreviewSchema.parse(await post('/auth/magic-link/preview', { token }));
}

/** Consumes the link: a session (cookie) or, with 2FA, a challenge for completeSecondFactor. */
export async function verifyMagicLink(token: string) {
  return LoginResponseSchema.parse(await post('/auth/magic-link/verify', { token }));
}

export async function fetchMe(): Promise<Me> {
  return MeSchema.parse(await customInstance('/auth/me')).user;
}

export async function verifyEmail(token: string) {
  return z.object({ verified: z.literal(true), email: z.string() }).parse(await post('/auth/verify-email', { token }));
}

export async function resendVerification() {
  return z.object({ sent: z.literal(true), expiresInHours: z.number() }).parse(await post('/auth/verify-email/resend'));
}

export async function requestPasswordReset(email: string) {
  return z.object({ accepted: z.literal(true), message: z.string() }).parse(await post('/auth/password/forgot', { email }));
}

export async function validateResetToken(token: string) {
  return z
    .object({ valid: z.boolean(), expiresAt: z.string().optional() })
    .parse(await post('/auth/password/reset/validate', { token }));
}

export async function resetPassword(token: string, newPassword: string) {
  return z.object({ reset: z.literal(true) }).parse(await post('/auth/password/reset', { token, newPassword }));
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return SessionResponseSchema.parse(await post('/auth/password/change', { currentPassword, newPassword }));
}

export async function logoutAll() {
  return post('/auth/logout-all');
}

export async function fetchSessions(): Promise<SessionItem[]> {
  return z.array(SessionItemSchema).parse(await customInstance('/auth/sessions'));
}

export async function revokeSession(id: string) {
  return post(`/auth/sessions/${encodeURIComponent(id)}`, undefined, 'DELETE');
}

// ------------------------------------------------------------------ 2FA

export async function fetchTwoFactorStatus(): Promise<TwoFactorStatus> {
  return TwoFactorStatusSchema.parse(await customInstance('/auth/2fa'));
}

export async function beginTwoFactorSetup(password: string): Promise<TwoFactorSetup> {
  return TwoFactorSetupSchema.parse(await post('/auth/2fa/setup', { password }));
}

export async function enableTwoFactor(code: string) {
  return SessionResponseSchema.extend({ recoveryCodes: z.array(z.string()) }).parse(
    await post('/auth/2fa/enable', { code })
  );
}

export async function disableTwoFactor(password: string, factor: { code?: string; recoveryCode?: string }) {
  return SessionResponseSchema.parse(await post('/auth/2fa/disable', { password, ...factor }));
}

export async function regenerateRecoveryCodes(password: string, factor: { code?: string; recoveryCode?: string }) {
  return z.object({ recoveryCodes: z.array(z.string()) }).parse(
    await post('/auth/2fa/recovery-codes', { password, ...factor })
  );
}

// ------------------------------------------------------------------ organizations

export async function fetchMyOrganizations(): Promise<OrganizationSummary[]> {
  return z.array(OrganizationSummarySchema).parse(await customInstance('/organizations'));
}

export async function fetchCurrentOrganizationDetails(): Promise<CurrentOrganization> {
  return CurrentOrganizationSchema.parse(await customInstance('/organizations/current'));
}

export async function setOrganizationRequire2fa(require2fa: boolean) {
  return z
    .object({ require2fa: z.boolean(), membersWithout2fa: z.number() })
    .parse(await post('/organizations/current/security', { require2fa }, 'PATCH'));
}

export async function fetchMembers(): Promise<Member[]> {
  return z.array(MemberSchema).parse(await customInstance('/organizations/members'));
}

export async function updateMemberRole(memberId: string, role: string) {
  return post(`/organizations/members/${encodeURIComponent(memberId)}`, { role }, 'PATCH');
}

export async function removeMember(memberId: string) {
  return post(`/organizations/members/${encodeURIComponent(memberId)}`, undefined, 'DELETE');
}

export async function transferOwnership(memberId: string) {
  return post('/organizations/ownership-transfer', { memberId });
}

export async function leaveOrganization() {
  return post('/organizations/members/leave');
}

export async function fetchInvitations(): Promise<Invitation[]> {
  return z.array(InvitationSchema).parse(await customInstance('/organizations/invitations'));
}

export async function createInvitation(email: string, role: string) {
  return InvitationSchema.partial({ acceptedAt: true, revokedAt: true, invitedBy: true }).parse(
    await post('/organizations/invitations', { email, role })
  );
}

export async function resendInvitation(id: string) {
  return post(`/organizations/invitations/${encodeURIComponent(id)}/resend`);
}

export async function revokeInvitation(id: string) {
  return post(`/organizations/invitations/${encodeURIComponent(id)}`, undefined, 'DELETE');
}

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  return InvitationPreviewSchema.parse(await post('/invitations/preview', { token }));
}

export async function acceptInvitation(token: string) {
  return SessionResponseSchema.parse(await post('/invitations/accept', { token }));
}

export async function acceptInvitationWithNewAccount(token: string, password: string, fullName?: string) {
  return SessionResponseSchema.parse(await post('/invitations/accept-new', { token, password, fullName }));
}

// ------------------------------------------------------------------ GDPR

export function downloadAccountExport(): Promise<DownloadedFile> {
  return downloadApiFile('/account/export', 'erppreflight-account-export.json');
}

export function downloadOrganizationExport(): Promise<DownloadedFile> {
  return downloadApiFile('/organizations/current/export', 'erppreflight-organization-export.zip');
}

export async function fetchDeletionImpact(): Promise<DeletionImpact> {
  return DeletionImpactSchema.parse(await customInstance('/account/deletion-impact'));
}

export async function deleteAccount(input: {
  password: string;
  code?: string;
  recoveryCode?: string;
  confirmation: string;
  confirmOrganizationDeletion: string[];
}) {
  return z
    .object({ deleted: z.literal(true), organizationsDeleted: z.array(z.object({ organizationName: z.string() }).passthrough()) })
    .parse(await post('/account', input, 'DELETE'));
}

export const ROLE_LABELS: Record<string, string> = {
  ORGANIZATION_OWNER: 'Owner',
  SECURITY_ADMIN: 'Security admin',
  LEAD_ARCHITECT: 'Lead architect',
  MIGRATION_CONSULTANT: 'Migration consultant',
  AUDITOR: 'Auditor',
  VIEWER: 'Viewer',
};
