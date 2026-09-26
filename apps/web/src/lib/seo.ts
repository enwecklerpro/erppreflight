import type { Metadata } from 'next';
import { DEFAULT_LOCALE, LOCALES, LOCALE_TAGS, type Locale } from '../i18n/config';
import { LEGAL_DOCS, localizePath } from './routing';
import { SOLUTION_SLUGS } from './solutions';
import { TOOL_SLUGS } from './tools';
import { DOC_SLUGS } from './docs/pages';

/**
 * Route inventory used by robots.ts, sitemap.ts, middleware and the private-route
 * layouts. This is the single list of public vs. private routes — keep it in sync
 * with the directories under src/app (enforced by __tests__/seo-routes.test.ts).
 */

/**
 * Localized public pages rendered by app/[locale]. Served at the root for English
 * and under /de for German (see lib/routing.ts). Knowledge articles are added
 * dynamically from the API by sitemap.ts.
 */
export const LOCALIZED_PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/pricing',
  '/security',
  '/solutions',
  ...SOLUTION_SLUGS.map((s) => `/solutions/${s}`),
  '/knowledge',
  ...LEGAL_DOCS.map((d) => `/legal/${d}`),
  // Free tools (Part 01 §1.11) and product documentation (C §46).
  '/tools',
  ...TOOL_SLUGS.map((s) => `/tools/${s}`),
  '/docs',
  ...DOC_SLUGS.map((s) => `/docs/${s}`),
];

/** Top-level directories under app/ that host the localized public pages. */
export const LOCALIZED_PUBLIC_SEGMENTS = ['/[locale]'] as const;

/** Publicly reachable, indexable, English-only pages (no tenant data). */
export const PUBLIC_INDEXABLE_ROUTES = [
  '/changelog',
  '/matrix',
  '/trust',
  '/procurement',
  '/status',
  '/demo',
] as const;

/**
 * Sitemap index and child sitemaps (route handlers, Part 02 §2.9): split by
 * content type — pages, knowledge articles, SAP object pages (paginated).
 */
export const SITEMAP_ROUTE_SEGMENTS = ['/sitemap.xml', '/sitemaps'] as const;

/** Authenticated application routes and routes without indexable content. */
export const PRIVATE_ROUTE_PREFIXES = [
  '/dashboard',
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
  '/knowledge-graph',
  '/notifications',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/accept-invite',
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

/** Absolute URL of a localized public page. */
export function localizedUrl(locale: Locale, path: string): string {
  const p = localizePath(locale, path);
  return `${getAppBaseUrl()}${p === '/' ? '' : p}`;
}

/** hreflang map (incl. x-default → English) for the locales a page exists in. */
export function hreflangAlternates(path: string, available: readonly Locale[] = LOCALES): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const l of available) languages[l] = localizedUrl(l, path);
  if (available.includes(DEFAULT_LOCALE)) languages['x-default'] = localizedUrl(DEFAULT_LOCALE, path);
  return languages;
}

export interface PublicMetadataInput {
  locale: Locale;
  /** Unprefixed path, e.g. '/pricing'. */
  path: string;
  title: string;
  description: string;
  type?: 'website' | 'article';
  availableLocales?: readonly Locale[];
  noindex?: boolean;
  publishedTime?: string | null;
  modifiedTime?: string | null;
}

/** Canonical, hreflang, Open Graph and Twitter metadata for public pages. */
export function publicPageMetadata(input: PublicMetadataInput): Metadata {
  const available = input.availableLocales ?? LOCALES;
  const url = localizedUrl(input.locale, input.path);
  const ogLocale = LOCALE_TAGS[input.locale].replace('-', '_');
  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: url,
      languages: hreflangAlternates(input.path, available),
    },
    openGraph: {
      title: input.title,
      description: input.description,
      url,
      siteName: 'ERP Preflight',
      locale: ogLocale,
      alternateLocale: available.filter((l) => l !== input.locale).map((l) => LOCALE_TAGS[l].replace('-', '_')),
      type: input.type ?? 'website',
      ...(input.type === 'article'
        ? {
            publishedTime: input.publishedTime ?? undefined,
            modifiedTime: input.modifiedTime ?? undefined,
          }
        : {}),
    },
    twitter: {
      card: 'summary',
      title: input.title,
      description: input.description,
    },
    robots: input.noindex ? { index: false, follow: true } : { index: true, follow: true },
  };
}
