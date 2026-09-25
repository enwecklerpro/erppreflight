import { promises as dnsPromises, LookupAddress } from 'node:dns';
import * as net from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';

/**
 * SSRF-hardened outbound HTTP for tenant-supplied URLs (webhooks, landscape probes).
 *
 * - Only http/https, no embedded credentials.
 * - Hostnames: rejects single-label names (e.g. docker service names), `localhost`,
 *   internal suffixes (.local, .internal, .localhost, ...) and cloud metadata names.
 * - Every resolved address (dns.lookup, all records) must be public: loopback,
 *   RFC 1918, CGNAT, link-local, ULA, multicast, reserved, 0.0.0.0/::, NAT64,
 *   6to4/Teredo and IPv4-mapped/compatible IPv6 ranges are rejected.
 * - The check is enforced again inside the socket `lookup` hook of the actual
 *   request, so DNS rebinding between validation and connect cannot bypass it.
 * - Redirects are never followed (3xx is returned to the caller as-is).
 * - Errors surfaced to API callers are generic (details only in server logs).
 */

export class UnsafeOutboundUrlError extends Error {
  constructor(
    /** Internal reason (for logs only). */
    readonly reason: string
  ) {
    super('Target URL is not allowed by outbound network policy');
    this.name = 'UnsafeOutboundUrlError';
  }
}

export interface OutboundPolicy {
  /**
   * Allow RFC 1918 / CGNAT / IPv6 ULA destinations and single-label / internal
   * hostnames (self-hosted deployments reaching on-premise SAP). Loopback,
   * link-local, metadata endpoints and this stack's own service names stay blocked.
   */
  allowPrivateNetworks?: boolean;
}

const ALWAYS_BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const;

const PRIVATE_V4 = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
] as const;

const ALWAYS_BLOCKED_V6 = [
  ['::', 96], // unspecified, loopback and IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds IPv4)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
] as const;

const PRIVATE_V6 = [['fc00::', 7]] as const; // unique local addresses

// Separate lists per family: Node's BlockList matches IPv4 addresses against
// IPv4-mapped IPv6 subnets, so a combined list would block every IPv4 address.
function buildBlockList(
  entries: ReadonlyArray<readonly [string, number]>,
  type: 'ipv4' | 'ipv6'
): net.BlockList {
  const list = new net.BlockList();
  for (const [addr, prefix] of entries) list.addSubnet(addr, prefix, type);
  return list;
}

const alwaysBlockedV4 = buildBlockList(ALWAYS_BLOCKED_V4, 'ipv4');
const alwaysBlockedV6 = buildBlockList(ALWAYS_BLOCKED_V6, 'ipv6');
const privateV4 = buildBlockList(PRIVATE_V4, 'ipv4');
const privateV6 = buildBlockList(PRIVATE_V6, 'ipv6');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'instance-data.ec2.internal',
  // this stack's own docker service names / aliases
  'postgres',
  'redis',
  'minio',
  'clamav',
  'api',
  'web',
  'analysis-python',
]);

const INTERNAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.corp',
  '.private',
];

/** Returns a reason string if the IP address is not an allowed destination. */
export function checkIpAddress(address: string, policy: OutboundPolicy = {}): string | null {
  const family = net.isIP(address);
  if (family === 0) {
    return `not an IP address: ${address}`;
  }
  const blocked = family === 4 ? alwaysBlockedV4 : alwaysBlockedV6;
  const privateList = family === 4 ? privateV4 : privateV6;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (address === '255.255.255.255' || blocked.check(address, type)) {
    return `reserved/loopback/link-local address ${address}`;
  }
  if (!policy.allowPrivateNetworks && privateList.check(address, type)) {
    return `private network address ${address}`;
  }
  return null;
}

function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host.endsWith('.')) {
    host = host.slice(0, -1);
  }
  return host;
}

/** Synchronous URL/hostname checks (no DNS). Throws UnsafeOutboundUrlError. */
export function assertOutboundUrlSyntax(rawUrl: string, policy: OutboundPolicy = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeOutboundUrlError('malformed URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeOutboundUrlError(`protocol ${url.protocol} not allowed`);
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError('credentials in URL not allowed');
  }

  const host = normalizeHostname(url.hostname);
  if (!host) {
    throw new UnsafeOutboundUrlError('empty hostname');
  }

  if (net.isIP(host)) {
    const reason = checkIpAddress(host, policy);
    if (reason) throw new UnsafeOutboundUrlError(reason);
    return url;
  }

  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.startsWith('erppreflight-') ||
    host.endsWith('.metadata.google.internal') ||
    host.endsWith('.localhost')
  ) {
    throw new UnsafeOutboundUrlError(`blocked hostname ${host}`);
  }

  if (!policy.allowPrivateNetworks) {
    if (!host.includes('.')) {
      throw new UnsafeOutboundUrlError(`single-label hostname ${host}`);
    }
    if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      throw new UnsafeOutboundUrlError(`internal hostname ${host}`);
    }
  }
  return url;
}

type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

let lookupImpl: LookupFn = (hostname) =>
  dnsPromises.lookup(hostname, { all: true, verbatim: true });

/** Test hook: replace DNS resolution. Returns a restore function. */
export function __setDnsLookupForTests(fn: LookupFn): () => void {
  const previous = lookupImpl;
  lookupImpl = fn;
  return () => {
    lookupImpl = previous;
  };
}

async function resolveAndCheck(host: string, policy: OutboundPolicy): Promise<LookupAddress[]> {
  let addresses: LookupAddress[];
  try {
    addresses = await lookupImpl(host);
  } catch (err: any) {
    throw new UnsafeOutboundUrlError(`DNS resolution failed for ${host}: ${err?.code || err?.message}`);
  }
  if (!addresses || addresses.length === 0) {
    throw new UnsafeOutboundUrlError(`no DNS records for ${host}`);
  }
  for (const entry of addresses) {
    const reason = checkIpAddress(entry.address, policy);
    if (reason) {
      throw new UnsafeOutboundUrlError(`${host} resolves to ${reason}`);
    }
  }
  return addresses;
}

/** Full validation including DNS resolution of every A/AAAA record. */
export async function validateOutboundUrl(rawUrl: string, policy: OutboundPolicy = {}): Promise<URL> {
  const url = assertOutboundUrlSyntax(rawUrl, policy);
  const host = normalizeHostname(url.hostname);
  if (!net.isIP(host)) {
    await resolveAndCheck(host, policy);
  }
  return url;
}

export interface OutboundRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  policy?: OutboundPolicy;
}

export interface OutboundResponse {
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
}

type RequestImpl = (url: URL, options: OutboundRequestOptions) => Promise<OutboundResponse>;

function pinnedLookup(policy: OutboundPolicy): net.LookupFunction {
  return ((hostname: string, options: any, callback: any) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options ? options : {};
    resolveAndCheck(normalizeHostname(hostname), policy)
      .then((addresses) => {
        const wanted = opts.family === 4 || opts.family === 6 ? opts.family : 0;
        const filtered = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
        if (filtered.length === 0) {
          const err: NodeJS.ErrnoException = new Error(`no usable address for ${hostname}`);
          err.code = 'ENOTFOUND';
          return cb(err);
        }
        if (opts.all) {
          return cb(null, filtered);
        }
        return cb(null, filtered[0].address, filtered[0].family);
      })
      .catch((err) => cb(err));
  }) as net.LookupFunction;
}

const defaultRequestImpl: RequestImpl = (url, options) =>
  new Promise<OutboundResponse>((resolve, reject) => {
    const policy = options.policy || {};
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: options.method || 'GET',
        headers: options.headers,
        lookup: pinnedLookup(policy),
        timeout: options.timeoutMs ?? 10_000,
      },
      (res) => {
        // Body is not needed by callers; drain a bounded amount and close.
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > 64 * 1024) res.destroy();
        });
        res.on('error', () => undefined);
        resolve({
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: res.headers,
        });
        res.resume();
      }
    );
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Request timed out'), { name: 'AbortError' }));
    });
    req.on('error', (err) => reject(err));
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });

let requestImpl: RequestImpl = defaultRequestImpl;

/** Test hook: replace the transport. Returns a restore function. */
export function __setOutboundTransportForTests(fn: RequestImpl): () => void {
  const previous = requestImpl;
  requestImpl = fn;
  return () => {
    requestImpl = previous;
  };
}

/**
 * Performs an SSRF-checked HTTP request. Throws UnsafeOutboundUrlError when the
 * destination is not allowed; network errors propagate unchanged. Redirects are
 * not followed.
 */
export async function safeOutboundRequest(
  rawUrl: string,
  options: OutboundRequestOptions = {}
): Promise<OutboundResponse> {
  const policy = options.policy || {};
  const url = await validateOutboundUrl(rawUrl, policy);
  return requestImpl(url, { ...options, policy });
}
