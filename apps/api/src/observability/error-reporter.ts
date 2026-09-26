import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import * as os from 'node:os';
import { TenancyContext } from '@erppreflight/tenancy';
import { getRequestContext } from './request-context';
import { scrubSecrets, getRootLogger } from './logger';

/**
 * Error reporting adapter (Part 21.26, C §57).
 *
 * `ErrorReporter` is the interface the application uses. The production
 * implementation is Sentry, enabled only when SENTRY_DSN is set; it speaks the
 * documented Sentry envelope protocol (POST /api/<project>/envelope/ with
 * X-Sentry-Auth) directly, so no SDK (and no second tracing stack) is loaded.
 * Without SENTRY_DSN the no-op reporter is used. Reports never contain request
 * bodies, headers or secrets (messages and stacks are scrubbed), only
 * requestId / tenantId / route correlation tags.
 */

export interface ErrorContext {
  requestId?: string;
  tenantId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  tags?: Record<string, string>;
}

export interface ErrorReporter {
  readonly name: string;
  readonly enabled: boolean;
  captureException(error: unknown, context?: ErrorContext): Promise<string | null>;
  flush(): Promise<void>;
}

export class NoopErrorReporter implements ErrorReporter {
  readonly name = 'noop';
  readonly enabled = false;
  async captureException(): Promise<string | null> {
    return null;
  }
  async flush(): Promise<void> {}
}

export interface ParsedDsn {
  protocol: 'http:' | 'https:';
  publicKey: string;
  host: string;
  pathPrefix: string;
  projectId: string;
  envelopeUrl: string;
}

export function parseSentryDsn(dsn: string): ParsedDsn {
  const u = new URL(dsn);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('SENTRY_DSN must be http(s)');
  if (!u.username) throw new Error('SENTRY_DSN has no public key');
  const segments = u.pathname.split('/').filter(Boolean);
  const projectId = segments.pop();
  if (!projectId || !/^\d+$/.test(projectId)) throw new Error('SENTRY_DSN has no numeric project id');
  const pathPrefix = segments.length ? `/${segments.join('/')}` : '';
  return {
    protocol: u.protocol as 'http:' | 'https:',
    publicKey: decodeURIComponent(u.username),
    host: u.host,
    pathPrefix,
    projectId,
    envelopeUrl: `${u.protocol}//${u.host}${pathPrefix}/api/${projectId}/envelope/`,
  };
}

function parseStack(stack: string | undefined) {
  if (!stack) return [];
  const frames = stack
    .split('\n')
    .slice(1)
    .map((line) => {
      const m = line.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
      if (!m) return null;
      return {
        function: m[1] || '<anonymous>',
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
        in_app: !m[2].includes('node_modules') && !m[2].startsWith('node:'),
      };
    })
    .filter(Boolean);
  return frames.reverse(); // Sentry expects oldest → newest
}

export class SentryErrorReporter implements ErrorReporter {
  readonly name = 'sentry';
  readonly enabled = true;
  private readonly dsn: ParsedDsn;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly rawDsn: string,
    private readonly options: { environment?: string; release?: string; timeoutMs?: number } = {}
  ) {
    this.dsn = parseSentryDsn(rawDsn);
  }

  buildEvent(error: unknown, context: ErrorContext = {}) {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error exception');
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const req = getRequestContext();
    const tags: Record<string, string> = { ...(context.tags || {}) };
    const requestId = context.requestId ?? req?.requestId;
    const tenantId = context.tenantId ?? TenancyContext.get()?.tenantId;
    if (requestId) tags.requestId = requestId;
    if (tenantId) tags.tenantId = tenantId;
    if (context.statusCode) tags.statusCode = String(context.statusCode);
    return {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'node',
      level: 'error',
      logger: 'erppreflight-api',
      server_name: os.hostname(),
      environment: this.options.environment || process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: this.options.release || process.env.SENTRY_RELEASE || undefined,
      exception: {
        values: [
          {
            type: err.name || 'Error',
            value: scrubSecrets(String(err.message || '')).slice(0, 2000),
            stacktrace: { frames: parseStack(err.stack ? scrubSecrets(err.stack) : undefined) },
          },
        ],
      },
      tags,
      ...(context.method || context.path || req?.path
        ? { request: { method: context.method ?? req?.method, url: (context.path ?? req?.path ?? '').split('?')[0] } }
        : {}),
    };
  }

  private send(body: string): Promise<void> {
    return new Promise((resolve) => {
      const url = new URL(this.dsn.envelopeUrl);
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(
        url,
        {
          method: 'POST',
          timeout: this.options.timeoutMs ?? 5000,
          headers: {
            'Content-Type': 'application/x-sentry-envelope',
            'Content-Length': Buffer.byteLength(body),
            'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=erppreflight-api/1.0, sentry_key=${this.dsn.publicKey}`,
          },
        },
        (res) => {
          res.resume();
          if ((res.statusCode || 0) >= 300) {
            getRootLogger().warn({ statusCode: res.statusCode }, 'Sentry rejected an error report');
          }
          res.on('end', () => resolve());
        }
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => {
        getRootLogger().warn({ err: e.message }, 'Could not deliver error report to Sentry');
        resolve();
      });
      req.end(body);
    });
  }

  async captureException(error: unknown, context?: ErrorContext): Promise<string | null> {
    const event = this.buildEvent(error, context);
    const envelope =
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: this.rawDsn }) +
      '\n' +
      JSON.stringify({ type: 'event', content_type: 'application/json' }) +
      '\n' +
      JSON.stringify(event) +
      '\n';
    const p = this.send(envelope);
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
    await p;
    return event.event_id;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}

let reporter: ErrorReporter | null = null;

export function createErrorReporter(env: NodeJS.ProcessEnv = process.env): ErrorReporter {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return new NoopErrorReporter();
  try {
    return new SentryErrorReporter(dsn, { environment: env.SENTRY_ENVIRONMENT, release: env.SENTRY_RELEASE });
  } catch (err: any) {
    getRootLogger().error({ err: err.message }, 'SENTRY_DSN is invalid; error reporting disabled');
    return new NoopErrorReporter();
  }
}

export function getErrorReporter(): ErrorReporter {
  if (!reporter) reporter = createErrorReporter();
  return reporter;
}

export function setErrorReporterForTests(r: ErrorReporter | null) {
  reporter = r;
}
