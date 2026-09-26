import { isIP } from 'node:net';

/**
 * CIDR / IP helpers for organization IP allowlists (spec 10.2). Pure and
 * dependency-free so the lockout check in the API and the containment test in
 * PostgreSQL (`cidr >>= inet`, migration 021) can be unit-tested against each other.
 *
 * - IPv4 and IPv6, with IPv4-mapped IPv6 addresses (`::ffff:192.0.2.1`) treated as
 *   the IPv4 address (Node reports IPv4 peers on dual-stack sockets that way).
 * - A bare address is a host entry (/32 or /128).
 * - Entries with host bits set (`10.0.0.5/24`) and /0 entries are rejected with a
 *   message naming the intended network.
 */

export type IpFamily = 4 | 6;

export interface ParsedCidr {
  /** Canonical text, e.g. `203.0.113.0/24`, `2001:db8::/32`. */
  cidr: string;
  family: IpFamily;
  prefix: number;
  network: bigint;
}

export class CidrError extends Error {
  constructor(
    message: string,
    public readonly input: string
  ) {
    super(message);
    this.name = 'CidrError';
  }
}

const IPV4_BITS = 32;
const IPV6_BITS = 128;

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function ipv6ToBigInt(ip: string): bigint | null {
  let text = ip.toLowerCase();
  if (text.includes('.')) {
    const idx = text.lastIndexOf(':');
    const v4 = ipv4ToBigInt(text.slice(idx + 1));
    if (v4 === null) return null;
    text = `${text.slice(0, idx + 1)}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

function bigIntToIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => ((value >> shift) & 0xffn).toString()).join('.');
}

/** RFC 5952 text form (lower case, longest zero run of >= 2 groups compressed). */
function bigIntToIpv6(value: bigint): string {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(':');
  const left = hex.slice(0, bestStart).join(':');
  const right = hex.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
}

const MAPPED_PREFIX = 0xffffn << 32n;

/** Address family and numeric value; IPv4-mapped IPv6 collapses to IPv4. */
function toAddress(ip: string): { family: IpFamily; value: bigint } | null {
  const kind = isIP(ip);
  if (kind === 4) {
    const value = ipv4ToBigInt(ip);
    return value === null ? null : { family: 4, value };
  }
  if (kind === 6) {
    const value = ipv6ToBigInt(ip);
    if (value === null) return null;
    if (value >> 32n === 0xffffn) return { family: 4, value: value & 0xffffffffn };
    return { family: 6, value };
  }
  return null;
}

function maskFor(family: IpFamily, prefix: number): bigint {
  const bits = BigInt(family === 4 ? IPV4_BITS : IPV6_BITS);
  const all = (1n << bits) - 1n;
  return prefix === 0 ? 0n : (all << (bits - BigInt(prefix))) & all;
}

function formatAddress(family: IpFamily, value: bigint): string {
  return family === 4 ? bigIntToIpv4(value) : bigIntToIpv6(value);
}

/**
 * Canonical client address for policy decisions: brackets and zone ids removed,
 * IPv4-mapped IPv6 returned as IPv4. Null when the input is not an IP address.
 */
export function normalizeIp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const addr = toAddress(text);
  return addr ? formatAddress(addr.family, addr.value) : null;
}

/** Parses one allowlist entry. Throws CidrError with a user-facing message. */
export function parseCidr(input: string): ParsedCidr {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > 64) throw new CidrError('Enter an IPv4 or IPv6 address or CIDR range', raw);
  if (raw.includes('%')) throw new CidrError('Zone identifiers are not allowed in allowlist entries', raw);
  const slash = raw.indexOf('/');
  const ipText = slash === -1 ? raw : raw.slice(0, slash);
  const prefixText = slash === -1 ? null : raw.slice(slash + 1);
  const kind = isIP(ipText);
  if (!kind) throw new CidrError(`"${raw}" is not a valid IPv4 or IPv6 address`, raw);
  if (prefixText !== null && !/^\d{1,3}$/.test(prefixText)) {
    throw new CidrError(`"${raw}" has an invalid prefix length`, raw);
  }
  const value6or4 = kind === 4 ? ipv4ToBigInt(ipText) : ipv6ToBigInt(ipText);
  if (value6or4 === null) throw new CidrError(`"${raw}" is not a valid IPv4 or IPv6 address`, raw);

  let family: IpFamily = kind === 4 ? 4 : 6;
  let value = value6or4;
  let prefix = prefixText === null ? (family === 4 ? IPV4_BITS : IPV6_BITS) : Number(prefixText);
  const maxBits = family === 4 ? IPV4_BITS : IPV6_BITS;
  if (prefix > maxBits) throw new CidrError(`"${raw}": the prefix length must be at most ${maxBits}`, raw);

  // IPv4-mapped IPv6 range (::ffff:a.b.c.d/96..128) → the equivalent IPv4 range.
  if (family === 6 && value >> 32n === 0xffffn && prefix >= 96) {
    family = 4;
    value = value & 0xffffffffn;
    prefix -= 96;
  }
  if (prefix === 0) {
    throw new CidrError(`"${raw}" would allow every address; remove the allowlist instead`, raw);
  }
  const mask = maskFor(family, prefix);
  const network = value & mask;
  if (network !== value) {
    throw new CidrError(
      `"${raw}" has host bits set; use the network address ${formatAddress(family, network)}/${prefix}`,
      raw
    );
  }
  return { cidr: `${formatAddress(family, network)}/${prefix}`, family, prefix, network };
}

/** True when `ip` lies inside `entry`. Non-IP input is never contained. */
export function cidrContains(entry: ParsedCidr, ip: string | null | undefined): boolean {
  if (!ip) return false;
  const addr = toAddress(normalizeIp(ip) ?? '');
  if (!addr || addr.family !== entry.family) return false;
  return (addr.value & maskFor(entry.family, entry.prefix)) === entry.network;
}

/** True when any entry contains `ip` (an empty list contains nothing). */
export function anyCidrContains(entries: readonly ParsedCidr[], ip: string | null | undefined): boolean {
  return entries.some((e) => cidrContains(e, ip));
}

// Exported for tests only.
export const __internal = { ipv4ToBigInt, ipv6ToBigInt, bigIntToIpv6, MAPPED_PREFIX };
