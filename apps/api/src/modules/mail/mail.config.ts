import { MailTransportKind } from './mail.types';
import { SmtpConfig, SmtpSecurity } from './smtp.transport';
import { DEFAULT_HTTP_MAIL_URLS, HttpMailConfig, HttpMailProvider } from './http.transport';

export interface ResolvedMailConfig {
  transport: MailTransportKind;
  from: string;
  /** Public web origin used to build links in e-mails (no trailing slash). */
  appPublicUrl: string;
  smtp?: SmtpConfig;
  http?: HttpMailConfig;
  /** Dev mailbox endpoint availability (dev transport only). */
  devOutboxEnabled: boolean;
  /** Shared secret required by the dev mailbox endpoint (mandatory in production). */
  devOutboxToken?: string;
}

type Env = Record<string, unknown>;

const str = (env: Env, key: string): string | undefined => {
  const value = env[key];
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
};

const DEV_FROM = 'ERP Preflight <no-reply@localhost.localdomain>';
const DEV_PUBLIC_URL = 'http://localhost:3000';

function resolvePublicUrl(env: Env, isProduction: boolean, errors: string[]): string {
  const explicit = str(env, 'APP_PUBLIC_URL');
  const corsFirst = str(env, 'CORS_ORIGIN')?.split(',')[0]?.trim();
  const candidate = explicit || corsFirst || (isProduction ? undefined : DEV_PUBLIC_URL);
  if (!candidate) {
    errors.push('APP_PUBLIC_URL (or CORS_ORIGIN) is required when NODE_ENV=production');
    return DEV_PUBLIC_URL;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
    if (isProduction && explicit && url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      errors.push('APP_PUBLIC_URL must use https in production');
    }
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    errors.push('APP_PUBLIC_URL must be an absolute http(s) URL');
    return DEV_PUBLIC_URL;
  }
}

/**
 * Resolves and validates mail configuration from environment variables.
 * Returns the config plus human-readable errors (fatal at boot).
 *
 * Production rules:
 * - MAIL_TRANSPORT must be set explicitly (smtp | http | dev) and MAIL_FROM is required.
 * - MAIL_TRANSPORT=dev is only accepted with MAIL_DEV_OUTBOX_TOKEN (>= 24 chars), for
 *   staging / E2E stacks; the dev mailbox endpoint then requires that token.
 */
export function resolveMailConfig(env: Env): { config: ResolvedMailConfig; errors: string[] } {
  const errors: string[] = [];
  const isProduction = str(env, 'NODE_ENV') === 'production';
  const rawTransport = str(env, 'MAIL_TRANSPORT')?.toLowerCase();

  let transport: MailTransportKind;
  if (!rawTransport) {
    if (isProduction) errors.push('MAIL_TRANSPORT (smtp | http | dev) is required when NODE_ENV=production');
    transport = 'dev';
  } else if (rawTransport === 'smtp' || rawTransport === 'http' || rawTransport === 'dev') {
    transport = rawTransport;
  } else {
    errors.push('MAIL_TRANSPORT must be one of smtp, http, dev');
    transport = 'dev';
  }

  const from = str(env, 'MAIL_FROM') || (isProduction ? '' : DEV_FROM);
  if (!from) errors.push('MAIL_FROM is required when NODE_ENV=production');

  const appPublicUrl = resolvePublicUrl(env, isProduction, errors);
  const config: ResolvedMailConfig = {
    transport,
    from: from || DEV_FROM,
    appPublicUrl,
    devOutboxEnabled: false,
  };

  if (transport === 'smtp') {
    const host = str(env, 'SMTP_HOST');
    const port = Number(str(env, 'SMTP_PORT') || 587);
    const rawSecurity = (str(env, 'SMTP_SECURE') || (port === 465 ? 'tls' : 'starttls')).toLowerCase();
    const security: SmtpSecurity =
      rawSecurity === 'tls' || rawSecurity === 'true' ? 'tls' : rawSecurity === 'none' || rawSecurity === 'false' ? 'none' : 'starttls';
    if (!host) errors.push('SMTP_HOST is required when MAIL_TRANSPORT=smtp');
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('SMTP_PORT must be a valid port');
    if (isProduction && security === 'none' && str(env, 'SMTP_USER')) {
      errors.push('SMTP_SECURE=none cannot be combined with SMTP_USER in production (credentials in clear text)');
    }
    config.smtp = {
      host: host || 'localhost',
      port,
      security,
      user: str(env, 'SMTP_USER'),
      password: str(env, 'SMTP_PASSWORD'),
      rejectUnauthorized: str(env, 'SMTP_TLS_REJECT_UNAUTHORIZED') !== 'false',
      timeoutMs: Number(str(env, 'SMTP_TIMEOUT_MS') || 20000),
      ehloName: str(env, 'SMTP_EHLO_NAME'),
    };
  }

  if (transport === 'http') {
    const providerRaw = (str(env, 'MAIL_HTTP_PROVIDER') || 'resend').toLowerCase();
    const provider: HttpMailProvider = providerRaw === 'postmark' ? 'postmark' : 'resend';
    if (providerRaw !== 'postmark' && providerRaw !== 'resend') {
      errors.push('MAIL_HTTP_PROVIDER must be resend or postmark');
    }
    const apiKey = str(env, 'MAIL_HTTP_API_KEY');
    if (!apiKey) errors.push('MAIL_HTTP_API_KEY is required when MAIL_TRANSPORT=http');
    const url = str(env, 'MAIL_HTTP_URL') || DEFAULT_HTTP_MAIL_URLS[provider];
    if (isProduction && !url.startsWith('https://')) errors.push('MAIL_HTTP_URL must use https in production');
    config.http = { provider, url, apiKey: apiKey || '', timeoutMs: Number(str(env, 'MAIL_HTTP_TIMEOUT_MS') || 15000) };
  }

  if (transport === 'dev') {
    const token = str(env, 'MAIL_DEV_OUTBOX_TOKEN');
    if (isProduction && rawTransport === 'dev' && (!token || token.length < 24)) {
      errors.push(
        'MAIL_TRANSPORT=dev in production requires MAIL_DEV_OUTBOX_TOKEN (>= 24 chars); use smtp or http for real delivery'
      );
    }
    config.devOutboxEnabled = !isProduction || !!(token && token.length >= 24);
    config.devOutboxToken = token;
  }

  return { config, errors };
}
