import { z } from 'zod';
import type { MessageKey, TFunction, TranslateVars } from './translate';
import { apiErrorCodes } from './messages/app/en/apiErrorCodes';

/**
 * Localized validation messages (spec C §42).
 *
 * Zod schemas are locale-independent (they are module constants shared by
 * server and client), so they carry *message references* instead of English
 * text: `vmsg('app.validation.emailInvalid')` encodes a dictionary key plus
 * optional ICU variables into the issue message. The form layer
 * (`FormField`, `FormSummaryErrors`, …) resolves the reference with the active
 * locale via `translateMessage`. Plain strings (e.g. API error messages) pass
 * through unchanged.
 *
 * `zodKeyErrorMap` provides the same for Zod's built-in issues (a `.max(200)`
 * without a custom message), so no English default text reaches the UI.
 */
const PREFIX = 'i18n:';

export function vmsg(key: MessageKey, vars?: TranslateVars): string {
  if (!vars) return `${PREFIX}${key}`;
  const qs = new URLSearchParams(Object.entries(vars).map(([k, v]) => [k, String(v)])).toString();
  return `${PREFIX}${key}?${qs}`;
}

export function isMessageRef(message: unknown): boolean {
  return typeof message === 'string' && message.startsWith(PREFIX);
}

/**
 * English messages produced outside the web app (shared `@erppreflight/schemas`
 * validators and the API, which answers in English) mapped to dictionary keys.
 */
const KNOWN_MESSAGES: Array<[RegExp, MessageKey, (m: RegExpMatchArray) => TranslateVars]> = [
  [/^Password must be at least (\d+) characters long$/, 'app.validation.passwordMinLength', (m) => ({ min: Number(m[1]) })],
  [/^Password must be at most (\d+) characters long$/, 'app.validation.passwordMaxLength', (m) => ({ max: Number(m[1]) })],
  [/^Password must contain at least three of/, 'app.validation.passwordClasses', () => ({})],
  [/^Password is too common$/, 'app.validation.passwordCommon', () => ({})],
  [/^Password must not contain your e-?mail address$/i, 'app.validation.passwordContainsEmail', () => ({})],
  [/^Enter the 6-digit code from your authenticator app$/, 'app.validation.totpCode', () => ({})],
  [/^Recovery codes look like abcde-12345$/, 'app.validation.recoveryCodeFormat', () => ({})],
  [/^Invalid email or password$/, 'app.apiErrors.invalidCredentials', () => ({})],
  [/^Account is not active$/, 'app.apiErrors.accountInactive', () => ({})],
  [/^Invalid authentication code$/, 'app.apiErrors.invalidCode', () => ({})],
  [/^This invitation is invalid, expired/, 'app.apiErrors.inviteInvalid', () => ({})],
  [/^This reset link is (invalid|no longer valid)/, 'app.apiErrors.resetLinkInvalid', () => ({})],
  [/^This verification link is (invalid|no longer valid)/, 'app.apiErrors.verifyLinkInvalid', () => ({})],
  [/^User with this email already exists$/, 'app.apiErrors.userExists', () => ({})],
  [/^(Session|Organization membership) has been revoked/, 'app.apiErrors.sessionRevoked', () => ({})],
  [/^The sign-in challenge (expired|is no longer valid)/, 'app.apiErrors.challengeExpired', () => ({})],
  [/^Password is incorrect$/, 'app.apiErrors.passwordIncorrect', () => ({})],
  [/^The new password must differ/, 'app.apiErrors.newPasswordSame', () => ({})],
  [/^The last owner cannot be removed/, 'app.apiErrors.lastOwnerRemove', () => ({})],
  [/^The last owner cannot be demoted/, 'app.apiErrors.lastOwnerDemote', () => ({})],
  [/^This person is already a member/, 'app.apiErrors.memberExists', () => ({})],
  [/^The confirmation does not match the organization name$/, 'app.apiErrors.orgNameMismatch', () => ({})],
  [/^Two-factor authentication is already enabled$/, 'app.apiErrors.twoFactorAlreadyEnabled', () => ({})],
  [/^Two-factor authentication is not enabled$/, 'app.apiErrors.twoFactorNotEnabled', () => ({})],
  [/^No pending setup or the setup expired/, 'app.apiErrors.setupExpired', () => ({})],
];

/** Resolves a `vmsg()` reference with the given translator; other strings are returned as-is. */
export function translateMessage(message: string, t: TFunction): string {
  if (!isMessageRef(message)) {
    for (const [re, key, vars] of KNOWN_MESSAGES) {
      const m = message.match(re);
      if (m) return t(key, vars(m));
    }
    return message;
  }
  const body = message.slice(PREFIX.length);
  const q = body.indexOf('?');
  const key = (q === -1 ? body : body.slice(0, q)) as MessageKey;
  const vars: TranslateVars = {};
  if (q !== -1) {
    for (const [k, v] of new URLSearchParams(body.slice(q + 1))) {
      vars[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    }
  }
  return t(key, vars);
}

interface ErrorLike {
  name?: string;
  message?: string;
  statusCode?: number;
  code?: unknown;
}

export type ApiErrorCode = keyof typeof apiErrorCodes.codes;

/** Codes derived from the HTTP status alone: the server message is more specific than the code. */
const GENERIC_API_ERROR_CODES = new Set<string>([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'PAYMENT_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'REQUEST_TIMEOUT',
  'CONFLICT',
  'GONE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE_ENTITY',
  'INTERNAL_ERROR',
  'BAD_GATEWAY',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
  'UNKNOWN_ERROR',
]);

export function isKnownApiErrorCode(code: unknown): code is ApiErrorCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(apiErrorCodes.codes, code);
}

/**
 * Localized, user-facing text for an error thrown by an API call (spec C §42).
 *
 * 1. A specific machine code from the API envelope (`code`, e.g. PROJECT_NOT_FOUND) → dictionary text.
 * 2. Rate limits, transport failures and malformed responses → dictionary text.
 * 3. Known English server messages → dictionary text.
 * 4. Otherwise the server's message; for generic codes (NOT_FOUND, VALIDATION_FAILED, …) the
 *    localized summary is prepended in languages other than English (`app.apiErrorCodes.withDetail`).
 */
export function localizeError(error: unknown, t: TFunction, fallback?: string): string {
  const generic = fallback ?? t('app.validation.genericError');
  if (!error) return generic;
  const e = error as ErrorLike;
  if (e.name === 'ZodError') return t('app.validation.unexpectedResponse');
  const code = isKnownApiErrorCode(e.code) ? e.code : null;
  if (code && !GENERIC_API_ERROR_CODES.has(code)) return t(`app.apiErrorCodes.codes.${code}`);
  if (e.statusCode === 429) return t('app.validation.tooManyAttempts');
  if (e.name === 'TypeError' && /fetch|network|load failed/i.test(e.message ?? '')) return t('app.validation.networkError');
  if (typeof e.message === 'string' && e.message) {
    if (/^API request failed with HTTP \d+$/.test(e.message)) {
      if (e.statusCode === 401) return t('app.validation.sessionExpired');
      if (e.statusCode === 403) return t('app.validation.forbidden');
      if (e.statusCode === 404) return t('app.validation.notFound');
      if (e.statusCode === 402) return t('app.validation.planLimit');
      return code ? t(`app.apiErrorCodes.codes.${code}`) : generic;
    }
    const mapped = translateMessage(e.message, t);
    if (mapped !== e.message || !code || t('app.apiErrorCodes.appendSummary') !== 'yes') return mapped;
    return t('app.apiErrorCodes.withDetail', { summary: t(`app.apiErrorCodes.codes.${code}`), message: e.message });
  }
  return code ? t(`app.apiErrorCodes.codes.${code}`) : generic;
}

/** Zod 3 error map emitting message references for built-in issues. */
export const zodKeyErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: vmsg('app.validation.required') };
      }
      return { message: vmsg('app.validation.invalidValue') };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return {
          message:
            Number(issue.minimum) <= 1
              ? vmsg('app.validation.required')
              : vmsg('app.validation.minChars', { min: Number(issue.minimum) }),
        };
      }
      if (issue.type === 'array') return { message: vmsg('app.validation.minItems', { min: Number(issue.minimum) }) };
      return { message: vmsg('app.validation.minNumber', { min: Number(issue.minimum) }) };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: vmsg('app.validation.maxChars', { max: Number(issue.maximum) }) };
      if (issue.type === 'array') return { message: vmsg('app.validation.maxItems', { max: Number(issue.maximum) }) };
      return { message: vmsg('app.validation.maxNumber', { max: Number(issue.maximum) }) };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: vmsg('app.validation.emailInvalid') };
      if (issue.validation === 'url') return { message: vmsg('app.validation.urlInvalid') };
      if (issue.validation === 'uuid') return { message: vmsg('app.validation.uuidInvalid') };
      return { message: vmsg('app.validation.formatInvalid') };
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
      return { message: vmsg('app.validation.invalidOption') };
    case z.ZodIssueCode.not_multiple_of:
    case z.ZodIssueCode.invalid_date:
      return { message: vmsg('app.validation.invalidValue') };
    default:
      return { message: ctx.defaultError };
  }
};

let installed = false;
/** Installs the key-emitting error map once per JS realm (idempotent). */
export function installZodErrorMap(): void {
  if (installed) return;
  installed = true;
  z.setErrorMap(zodKeyErrorMap);
}
