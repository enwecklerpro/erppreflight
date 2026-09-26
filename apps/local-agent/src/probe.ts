import * as http from 'http';
import * as https from 'https';

export interface ProbeResult {
  url: string;
  isReachable: boolean;
  latencyMs?: number;
  statusCode?: number;
  serverHeader?: string;
  isTlsValid?: boolean;
  tlsError?: string;
  sapSid?: string;
  error?: string;
}

/**
 * On-premise SAP NetWeaver / ICM reachability probe executed INSIDE the customer
 * network (that is the purpose of the agent, so private addresses are allowed).
 * Only http(s) is permitted, cloud metadata endpoints are refused, TLS
 * certificates are always validated (an invalid certificate is reported, never
 * bypassed) and redirects are not followed.
 */
export class SapLandscapeProber {
  private static readonly BLOCKED_HOSTS = new Set(['169.254.169.254', '169.254.169.253', 'metadata.google.internal', '100.100.100.200', 'fd00:ec2::254']);

  private static request(url: URL, timeoutMs: number): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(url, { method: 'GET', timeout: timeoutMs, headers: { 'User-Agent': 'ERPPreflight-LocalAgent-Probe/0.2' } }, (res) => {
        res.resume();
        resolve({ status: res.statusCode || 0, headers: res.headers });
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error(`timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })));
      req.on('error', reject);
      req.end();
    });
  }

  static async probe(sapUrl: string, timeoutMs = 5000): Promise<ProbeResult> {
    let url: URL;
    try {
      url = new URL(sapUrl);
    } catch {
      return { url: sapUrl, isReachable: false, error: 'Invalid URL' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { url: sapUrl, isReachable: false, error: 'Only http(s) URLs can be probed' };
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (this.BLOCKED_HOSTS.has(host) || host.endsWith('.metadata.google.internal')) {
      return { url: sapUrl, isReachable: false, error: 'Cloud metadata endpoints are never probed' };
    }

    let lastError = 'Unknown error';
    for (const p of ['/sap/bc/ping', '/sap/public/ping']) {
      const target = new URL(p, url);
      const start = Date.now();
      try {
        const res = await this.request(target, timeoutMs);
        const server = res.headers['server'];
        const sid = res.headers['sap-system'] || res.headers['sap-system-id'];
        return {
          url: sapUrl,
          isReachable: true,
          latencyMs: Date.now() - start,
          statusCode: res.status,
          serverHeader: Array.isArray(server) ? server[0] : server,
          sapSid: Array.isArray(sid) ? sid[0] : sid,
          isTlsValid: target.protocol === 'https:' ? true : undefined,
        };
      } catch (err: any) {
        const code = String(err?.code || '');
        if (code.startsWith('ERR_TLS') || code.includes('CERT') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
          // The host answered TLS but its certificate is not trusted: reachable, TLS invalid.
          return { url: sapUrl, isReachable: true, isTlsValid: false, tlsError: code, latencyMs: Date.now() - start };
        }
        lastError = code || err?.message || lastError;
      }
    }
    return { url: sapUrl, isReachable: false, error: lastError };
  }
}
