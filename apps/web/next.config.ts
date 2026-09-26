import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl request configuration (locale + messages per request).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: [
    '@erppreflight/schemas',
    '@erppreflight/evidence',
    '@erppreflight/auth',
    '@erppreflight/tenancy',
  ],
  reactStrictMode: true,
  output: process.env.DOCKER_BUILD ? 'standalone' : undefined,
};

export default withNextIntl(nextConfig);
