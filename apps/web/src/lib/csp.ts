/**
 * Content-Security-Policy for HTML documents (set per request by middleware).
 *
 * Scripts: a per-request nonce ('strict-dynamic' lets Next's nonce'd bootstrap load
 * its chunks). Next.js applies the nonce to its own inline scripts when it finds it
 * in the request's CSP header. JSON-LD blocks are data, not script, and are not
 * subject to script-src.
 * Styles: 'unsafe-inline' is required for React `style` attributes (virtualised
 * tables, graph canvas); no external style or font origins are used.
 * Must stay edge-safe (used by middleware).
 */
export function apiOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function buildContentSecurityPolicy(options: {
  nonce: string;
  apiUrl?: string;
  dev?: boolean;
  /** Only when the site itself is served over https. */
  upgradeInsecureRequests?: boolean;
}): string {
  const api = apiOrigin(options.apiUrl);
  const connect = ["'self'", api].filter(Boolean).join(' ');
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src ${connect}${options.dev ? ' ws: wss:' : ''}`,
    `worker-src 'self' blob:`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ];
  if (options.upgradeInsecureRequests) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
