import type { Metadata } from 'next';

/**
 * Route inventory used by robots.ts, sitemap.ts and the private-route layouts.
 * Keep in sync with the directories under src/app.
 */

/** Publicly reachable, indexable pages (no tenant data). */
export const PUBLIC_INDEXABLE_ROUTES = [
  '/',
  '/docs',
  '/changelog',
  '/matrix',
  '/trust',
  '/procurement',
  '/status',
  '/demo',
] as const;

/** Authenticated application routes and routes without indexable content. */
export const PRIVATE_ROUTE_PREFIXES = [
  '/projects',
  '/inspector',
  '/templates',
  '/artifacts',
  '/landscapes',
  '/agent-gate',
  '/settings',
  '/admin',
  '/onboarding',
  '/feedback',
  '/knowledge',
  '/login',
  '/signup',
  '/api',
] as const;

/** Metadata applied by layouts of private route segments. */
export const PRIVATE_ROUTE_METADATA: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://erppreflight.com').replace(/\/+$/, '');
}
