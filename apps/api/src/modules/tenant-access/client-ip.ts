import { normalizeIp } from './cidr';

/**
 * The client address of a request as decided by Express: `req.ip` honours the
 * application's `trust proxy` setting (TRUST_PROXY, apps/api/src/main.ts), so
 * X-Forwarded-For is only used when it was appended by a trusted proxy hop. The
 * raw X-Forwarded-For header is never read here. IPv4-mapped IPv6 peers
 * (`::ffff:192.0.2.1`) are reported as IPv4.
 */
export function clientIpOf(req: any): string | null {
  const fromExpress = typeof req?.ip === 'string' && req.ip ? req.ip : undefined;
  return normalizeIp(fromExpress ?? req?.socket?.remoteAddress ?? null);
}
