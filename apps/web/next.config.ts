import type { NextConfig } from 'next';

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

export default nextConfig;
