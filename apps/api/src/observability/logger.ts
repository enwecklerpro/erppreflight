import { LoggerService, LogLevel } from '@nestjs/common';
import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';
import { TenancyContext } from '@erppreflight/tenancy';
import { getRequestContext } from './request-context';

/**
 * Structured JSON logging with Pino (Part 21.24, C §57).
 *
 * Every line carries service, env, level, time, and — when inside a request —
 * requestId, traceId (W3C / OpenTelemetry), tenantId and the Nest context.
 * Secrets are removed twice:
 *  1. `redact` censors well-known secret-bearing keys anywhere in the payload;
 *  2. string messages are scrubbed for credential patterns (Bearer tokens,
 *     ERP Preflight API keys / device / SCIM / enrollment tokens, webhook secrets,
 *     JWTs, basic-auth URLs, password=… pairs).
 */

export const REDACT_PATHS = [
  'password',
  'passwordHash',
  'password_hash',
  'secret',
  'clientSecret',
  'client_secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'apiToken',
  'personalAccessToken',
  'authorization',
  'cookie',
  'credentials',
  'deviceCredential',
  'enrollmentToken',
  '*.password',
  '*.secret',
  '*.clientSecret',
  '*.client_secret',
  '*.token',
  '*.accessToken',
  '*.apiKey',
  '*.apiToken',
  '*.personalAccessToken',
  '*.authorization',
  '*.cookie',
  '*.credentials',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
];

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/Basic\s+[A-Za-z0-9+/=]{8,}/gi, 'Basic [REDACTED]'],
  [/Device\s+erppf_dev_[A-Za-z0-9_-]+/gi, 'Device [REDACTED]'],
  [/erppf_(live|dev|enroll|scim)_[A-Za-z0-9_-]{8,}/g, 'erppf_$1_[REDACTED]'],
  [/whsec_[A-Za-z0-9]{8,}/g, 'whsec_[REDACTED]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]'],
  [/(https?:\/\/)[^\s:@/]+:[^\s@/]+@/gi, '$1[REDACTED]@'],
  [/((?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1[REDACTED]'],
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

function traceFields(): Record<string, string> {
  try {
    // Loaded lazily: @opentelemetry/api is a no-op unless the SDK is started.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const api = require('@opentelemetry/api');
    const span = api.trace.getActiveSpan?.();
    const sc = span?.spanContext?.();
    if (sc && sc.traceId && sc.traceId !== '00000000000000000000000000000000') {
      return { traceId: sc.traceId, spanId: sc.spanId };
    }
  } catch {
    /* tracing not installed */
  }
  return {};
}

export function buildPinoOptions(env: NodeJS.ProcessEnv = process.env): LoggerOptions {
  return {
    level: env.LOG_LEVEL || (env.NODE_ENV === 'production' ? 'info' : 'debug'),
    base: { service: env.OTEL_SERVICE_NAME || 'erppreflight-api', env: env.NODE_ENV || 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
      log: (obj) => {
        for (const k of Object.keys(obj)) {
          const v = (obj as any)[k];
          if (typeof v === 'string') (obj as any)[k] = scrubSecrets(v);
        }
        return obj;
      },
    },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === 'string' ? scrubSecrets(a) : a)) as Parameters<typeof method>;
        return method.apply(this, scrubbed);
      },
    },
    mixin() {
      const req = getRequestContext();
      const tenantId = TenancyContext.get()?.tenantId;
      return {
        ...(req ? { requestId: req.requestId } : {}),
        ...(req?.traceId ? { traceId: req.traceId } : {}),
        ...traceFields(),
        ...(tenantId ? { tenantId } : {}),
      };
    },
  };
}

let rootLogger: PinoLogger | null = null;

export function getRootLogger(): PinoLogger {
  if (!rootLogger) rootLogger = pino(buildPinoOptions());
  return rootLogger;
}

/** For tests: use a custom destination. */
export function setRootLoggerForTests(logger: PinoLogger | null) {
  rootLogger = logger;
}

/** Nest LoggerService backed by Pino (app.useLogger). */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: PinoLogger = getRootLogger()) {}

  private write(level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal', message: any, optional: any[]) {
    const context = typeof optional[optional.length - 1] === 'string' ? optional[optional.length - 1] : undefined;
    const stack = level === 'error' && typeof optional[0] === 'string' && optional.length > 1 ? optional[0] : undefined;
    if (message instanceof Error) {
      this.logger[level]({ context, err: message }, message.message);
      return;
    }
    if (message && typeof message === 'object') {
      this.logger[level]({ context, ...message });
      return;
    }
    const text = String(message);
    // Structured payloads logged as JSON strings (e.g. access logs) are merged as fields.
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        this.logger[level]({ context, ...JSON.parse(text) });
        return;
      } catch {
        /* plain text */
      }
    }
    this.logger[level]({ context, ...(stack ? { stack: scrubSecrets(stack) } : {}) }, text);
  }

  log(message: any, ...optional: any[]) {
    this.write('info', message, optional);
  }
  error(message: any, ...optional: any[]) {
    this.write('error', message, optional);
  }
  warn(message: any, ...optional: any[]) {
    this.write('warn', message, optional);
  }
  debug(message: any, ...optional: any[]) {
    this.write('debug', message, optional);
  }
  verbose(message: any, ...optional: any[]) {
    this.write('trace', message, optional);
  }
  fatal(message: any, ...optional: any[]) {
    this.write('fatal', message, optional);
  }
  setLogLevels(levels: LogLevel[]) {
    const order: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];
    const lowest = order.find((l) => levels.includes(l));
    const map: Record<string, string> = { verbose: 'trace', debug: 'debug', log: 'info', warn: 'warn', error: 'error', fatal: 'fatal' };
    if (lowest) this.logger.level = map[lowest];
  }
}
