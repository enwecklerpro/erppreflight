import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl request configuration (locale + messages per request).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Static security headers for every response. The Content-Security-Policy is
 * per-request (nonce) and set in src/middleware.ts.
 */
const SECURITY_HEADERS = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  ...(isProduction && (process.env.NEXT_PUBLIC_APP_URL || 'https://').startsWith('https://')
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  transpilePackages: [
    '@erppreflight/schemas',
    '@erppreflight/evidence',
    '@erppreflight/auth',
    '@erppreflight/tenancy',
  ],
  reactStrictMode: true,
  poweredByHeader: false,
  output: process.env.DOCKER_BUILD ? 'standalone' : undefined,
  // Monorepo root, so file tracing does not pick a wrong lockfile directory.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default withNextIntl(nextConfig);
