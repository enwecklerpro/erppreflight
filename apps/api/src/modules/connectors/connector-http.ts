import {
  OutboundPolicy,
  OutboundFetchResponse,
  OutboundResponseTooLargeError,
  UnsafeOutboundUrlError,
  safeOutboundFetch,
} from '../../common/security/outbound-request';

/**
 * Outbound HTTP for connectors: every call goes through the SSRF-hardened,
 * DNS-pinned client (common/security/outbound-request.ts), with
 *  - a per-connector token-bucket rate limiter (shared across API instances through
 *    Redis when wired by ConnectorsService; in-memory TokenBucketLimiter otherwise),
 *  - an optional per-attempt hook (usage metering of outbound requests),
 *  - bounded retries with exponential backoff + jitter for idempotent requests
 *    (network errors, 429, 502/503/504; Retry-After honoured, capped),
 *  - bounded response size and timeouts.
 */

export class ConnectorHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bodySnippet: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'ConnectorHttpError';
  }
}

export class ConnectorRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Connector rate limit exceeded; retry in ${retryAfterMs}ms`);
    this.name = 'ConnectorRateLimitedError';
  }
}

export interface ConnectorRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Retry on transient failures. Defaults to true for GET/HEAD/PUT, false otherwise. */
  retry?: boolean;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Expected success statuses (default: 2xx). */
  okStatuses?: number[];
}

export interface ConnectorHttp {
  request(req: ConnectorRequest): Promise<OutboundFetchResponse>;
  json<T = any>(req: ConnectorRequest): Promise<T>;
}

/** Outbound policy for connector targets (private networks only with an explicit operator opt-in). */
export function connectorOutboundPolicy(env: NodeJS.ProcessEnv = process.env): OutboundPolicy {
  return {
    allowPrivateNetworks: env.CONNECTOR_ALLOW_PRIVATE_NETWORKS === 'true',
    allowLoopbackInTests: env.CONNECTOR_ALLOW_LOOPBACK_IN_TESTS === 'true',
  };
}

// ---------------------------------------------------------------------------
// Token bucket rate limiter (per connector instance)
// ---------------------------------------------------------------------------
export interface ConnectorLimiter {
  /** Takes one token or returns the wait time (ms) until one is available. */
  take(key: string): { allowed: boolean; retryAfterMs: number } | Promise<{ allowed: boolean; retryAfterMs: number }>;
}

/** Outcome of one outbound attempt that reached the network (for metering). */
export interface ConnectorAttemptInfo {
  connectorKey: string;
  method: string;
  /** Host only — paths / query strings may carry identifiers and are never recorded. */
  host: string;
  attempt: number;
  status: number | null;
  error: string | null;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Per-process token bucket (tests, and fallback when no shared limiter is wired). */
export class TokenBucketLimiter implements ConnectorLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Takes one token or returns the wait time (ms) until one is available. */
  take(key: string): { allowed: boolean; retryAfterMs: number } {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: t };
    const elapsed = Math.max(0, t - b.updatedAt) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
    b.updatedAt = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      return { allowed: true, retryAfterMs: 0 };
    }
    this.buckets.set(key, b);
    return { allowed: false, retryAfterMs: Math.ceil(((1 - b.tokens) / this.refillPerSecond) * 1000) };
  }
}

export function connectorRateSettings(env: NodeJS.ProcessEnv = process.env): { burst: number; perSecond: number } {
  const burst = Number(env.CONNECTOR_RATE_LIMIT_BURST || 20);
  const perSecond = Number(env.CONNECTOR_RATE_LIMIT_PER_SECOND || 5);
  return {
    burst: Number.isFinite(burst) && burst > 0 ? burst : 20,
    perSecond: Number.isFinite(perSecond) && perSecond > 0 ? perSecond : 5,
  };
}

const RATE = connectorRateSettings();
export const sharedConnectorLimiter = new TokenBucketLimiter(RATE.burst, RATE.perSecond);

/** Minimal view of RateLimiterService.takeToken (keeps this module free of Nest DI). */
export interface SharedTokenBucket {
  takeToken(namespace: string, id: string, capacity: number, refillPerSecond: number): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

/** Token bucket per connector instance shared by every API process (Redis). */
export function distributedConnectorLimiter(
  shared: SharedTokenBucket,
  settings: { burst: number; perSecond: number } = connectorRateSettings()
): ConnectorLimiter {
  return { take: (key: string) => shared.takeToken('connector-http', key, settings.burst, settings.perSecond) };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.slice(0, 200);
  } catch {
    return 'invalid-url';
  }
}

// ---------------------------------------------------------------------------
// Retry / backoff
// ---------------------------------------------------------------------------
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 5000;

export function computeBackoffMs(attempt: number, retryAfterHeader?: string | string[] | null, random = Math.random): number {
  const header = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_BACKOFF_MS, seconds * 1000);
    }
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.min(MAX_BACKOFF_MS, Math.max(0, date - Date.now()));
    }
  }
  const base = 250 * 2 ** (attempt - 1);
  return Math.min(MAX_BACKOFF_MS, base + Math.floor(random() * 100));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientNetworkError(err: any): boolean {
  if (err instanceof UnsafeOutboundUrlError || err instanceof OutboundResponseTooLargeError) return false;
  const code = err?.code as string | undefined;
  return (
    err?.name === 'AbortError' ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code || '')
  );
}

export function snippet(text: string, max = 300): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function createConnectorHttp(
  connectorKey: string,
  options: {
    policy?: OutboundPolicy;
    limiter?: ConnectorLimiter;
    fetchImpl?: typeof safeOutboundFetch;
    sleepImpl?: (ms: number) => Promise<void>;
    /** Called once per attempt that reached the network (metering); failures are ignored. */
    onAttempt?: (info: ConnectorAttemptInfo) => void | Promise<void>;
  } = {}
): ConnectorHttp {
  const policy = options.policy ?? connectorOutboundPolicy();
  const limiter = options.limiter ?? sharedConnectorLimiter;
  const doFetch = options.fetchImpl ?? safeOutboundFetch;
  const doSleep = options.sleepImpl ?? sleep;
  const report = async (info: ConnectorAttemptInfo) => {
    if (!options.onAttempt) return;
    try {
      await options.onAttempt(info);
    } catch {
      /* metering must never fail a connector call */
    }
  };

  async function request(req: ConnectorRequest): Promise<OutboundFetchResponse> {
    const method = req.method ?? 'GET';
    const retry = req.retry ?? (method === 'GET' || method === 'HEAD' || method === 'PUT');
    const attempts = retry ? MAX_ATTEMPTS : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const slot = await limiter.take(connectorKey);
      if (!slot.allowed) {
        throw new ConnectorRateLimitedError(slot.retryAfterMs);
      }
      const base = { connectorKey, method, host: hostOf(req.url), attempt };
      let res: OutboundFetchResponse;
      try {
        res = await doFetch(req.url, {
          method,
          headers: { 'User-Agent': 'ERPPreflight-Connector/1.0', ...(req.headers || {}) },
          body: req.body,
          timeoutMs: req.timeoutMs ?? 15_000,
          maxResponseBytes: req.maxResponseBytes ?? 5 * 1024 * 1024,
          policy,
        });
      } catch (err: any) {
        // Blocked by the SSRF policy = no request left this process: not metered.
        if (!(err instanceof UnsafeOutboundUrlError)) {
          await report({ ...base, status: null, error: String(err?.code || err?.name || 'error').slice(0, 60) });
        }
        if (isTransientNetworkError(err) && attempt < attempts) {
          lastError = err;
          await doSleep(computeBackoffMs(attempt));
          continue;
        }
        throw err;
      }
      await report({ ...base, status: res.status, error: null });
      const ok = req.okStatuses ? req.okStatuses.includes(res.status) : res.status >= 200 && res.status < 300;
      if (ok) return res;
      const retryable = RETRYABLE_STATUSES.has(res.status);
      const err = new ConnectorHttpError(`Remote system returned HTTP ${res.status}`, res.status, snippet(res.text()), retryable);
      if (retryable && attempt < attempts) {
        lastError = err;
        await doSleep(computeBackoffMs(attempt, res.headers['retry-after'] as string | undefined));
        continue;
      }
      throw err;
    }
    throw lastError;
  }

  return {
    request,
    async json<T = any>(req: ConnectorRequest): Promise<T> {
      const res = await request({
        ...req,
        headers: { Accept: 'application/json', ...(req.headers || {}) },
      });
      if (res.status === 204 || res.body.length === 0) return {} as T;
      try {
        return res.json<T>();
      } catch {
        throw new ConnectorHttpError('Remote system returned a non-JSON response', res.status, snippet(res.text()), false);
      }
    },
  };
}

/** Maps any connector error to a short, secret-free message for logs/UI. */
export function describeConnectorError(err: any): { message: string; httpStatus?: number } {
  if (err instanceof ConnectorHttpError) {
    const hint =
      err.status === 401
        ? 'authentication failed (check credentials)'
        : err.status === 403
          ? 'permission denied (check scopes/roles)'
          : err.status === 404
            ? 'resource not found (check URL / project)'
            : err.status === 429
              ? 'remote rate limit reached'
              : `HTTP ${err.status}`;
    return { message: `Remote system error: ${hint}${err.bodySnippet ? ` — ${snippet(err.bodySnippet, 160)}` : ''}`, httpStatus: err.status };
  }
  if (err instanceof UnsafeOutboundUrlError) {
    return { message: 'Target URL is blocked by the outbound network policy (SSRF protection)' };
  }
  if (err instanceof ConnectorRateLimitedError) {
    return { message: err.message };
  }
  if (err instanceof OutboundResponseTooLargeError) {
    return { message: `Remote response exceeded the ${err.limit} byte limit` };
  }
  if (err?.name === 'AbortError') {
    return { message: 'Remote system timed out' };
  }
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' || err?.code === 'EHOSTUNREACH') {
    return { message: 'Remote system unreachable' };
  }
  if (err?.code && String(err.code).startsWith('ERR_TLS') || /certificate/i.test(err?.message || '')) {
    return { message: 'TLS handshake failed (certificate not trusted)' };
  }
  return { message: snippet(String(err?.message || 'Connector call failed'), 200) };
}
