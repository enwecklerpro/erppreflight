import { z } from 'zod';

/**
 * Account lifecycle contracts shared by the API (server-side enforcement) and
 * the web app (client-side feedback). The API is authoritative.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Small deny-list of passwords that satisfy the character rules but are trivially guessable. */
const COMMON_PASSWORDS = new Set([
  'password1234',
  'password123!',
  'password!234',
  'passw0rd1234',
  'qwerty123456',
  'qwertyuiop12',
  'welcome12345',
  'welcome123!!',
  'letmein12345',
  'administrator1',
  'admin1234567',
  'changeme1234',
  'iloveyou1234',
  '123456789012',
  'p@ssw0rd1234',
  'p@ssword1234',
  'sommer2024!!',
  'winter2024!!',
  'summer2025!!',
  'passwort1234',
]);

/**
 * Returns human-readable policy violations (empty array = acceptable).
 * Rules: 12–128 characters, at least 3 of 4 character classes, not a common
 * password, and must not contain the e-mail local part.
 */
export function passwordPolicyViolations(
  password: string,
  context: { email?: string | null; fullName?: string | null } = {}
): string[] {
  const errors: string[] = [];
  const value = typeof password === 'string' ? password : '';
  if (value.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`);
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters long`);
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (classes < 3) {
    errors.push('Password must contain at least three of: lower-case, upper-case, digit, symbol');
  }
  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    errors.push('Password is too common');
  }
  const local = (context.email || '').split('@')[0]?.toLowerCase() || '';
  if (local.length >= 4 && lower.includes(local)) {
    errors.push('Password must not contain your e-mail address');
  }
  return errors;
}

/** Zod schema applying the password policy (use with superRefine context when e-mail is known). */
export const PasswordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters long`)
  .superRefine((value, ctx) => {
    for (const message of passwordPolicyViolations(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });

/** 6-digit TOTP code or a recovery code (xxxxx-xxxxx). */
export const TotpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

export const RecoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]{5}-?[a-z0-9]{5}$/i, 'Recovery codes look like abcde-12345');

export const InvitableRoleEnum = z.enum([
  'ORGANIZATION_OWNER',
  'SECURITY_ADMIN',
  'LEAD_ARCHITECT',
  'MIGRATION_CONSULTANT',
  'AUDITOR',
  'VIEWER',
]);
export type InvitableRole = z.infer<typeof InvitableRoleEnum>;

/** Machine-readable error codes returned by the API for account-state gating. */
export const ACCOUNT_ERROR_CODES = {
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  MFA_ENROLLMENT_REQUIRED: 'MFA_ENROLLMENT_REQUIRED',
} as const;
