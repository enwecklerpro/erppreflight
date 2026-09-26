import * as crypto from 'crypto';
import type { AgentIdentity } from './identity';

/**
 * Outbound-only, signed client for the ERP Preflight device API.
 * Every request carries `Authorization: Device <credential>` plus an Ed25519
 * signature over METHOD\nPATH\nTIMESTAMP\nSHA256(body) made with the device key.
 */

export function signingString(method: string, pathWithQuery: string, timestamp: string, body: string): string {
  const bodyHash = crypto.createHash('sha256').update(body || '').digest('hex');
  return `${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}\n${bodyHash}`;
}

export class DeviceApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DeviceApiError';
  }
}

export class DeviceApiClient {
  constructor(
    private readonly identity: AgentIdentity,
    private readonly timeoutMs = 20_000
  ) {}

  async request<T = any>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
    const url = new URL(`${this.identity.apiUrl}${path}`);
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const signature = crypto
      .sign(null, Buffer.from(signingString(method, url.pathname + url.search, timestamp, body)), crypto.createPrivateKey(this.identity.privateKeyPem))
      .toString('base64');
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Device ${this.identity.deviceCredential}`,
        'X-Agent-Timestamp': timestamp,
        'X-Agent-Signature': signature,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body || undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = Array.isArray(j.message) ? j.message.join('; ') : j.message || text;
      } catch {
        /* plain */
      }
      throw new DeviceApiError(`HTTP ${res.status}: ${String(msg).slice(0, 300)}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** Unauthenticated liveness check of the API (used by `status`). */
export class ErpPreflightClient {
  private readonly baseUrl: string;

  constructor(config: { apiUrl: string; timeoutMs?: number }) {
    this.baseUrl = new URL(config.apiUrl).origin;
    this.timeoutMs = config.timeoutMs || 15000;
  }

  private readonly timeoutMs: number;

  async ping(): Promise<{ healthy: boolean; status: number; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health/liveness`, { signal: AbortSignal.timeout(this.timeoutMs) });
      return { healthy: res.ok, status: res.status, message: res.ok ? 'OK' : `HTTP ${res.status}` };
    } catch (err: any) {
      return { healthy: false, status: 0, message: err?.cause?.code || err.message || 'Connection refused' };
    }
  }
}
