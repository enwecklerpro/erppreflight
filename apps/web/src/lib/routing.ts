import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from '../i18n/config';

/**
 * Pure routing rules shared by `src/middleware.ts` (edge) and server code.
 * Keep this module free of heavy imports: it runs in the middleware bundle.
 *
 * URL strategy (Part 02 §2.7): every public page is locale-prefixed
 * (`/en/pricing`, `/de/pricing`) and rendered by `app/[locale]/...` via next-intl.
 * Unprefixed public URLs are redirected by next-intl to the visitor's locale.
 * Authenticated application routes stay unprefixed; their locale comes from the
 * `erp_locale` preference cookie.
 */

export const LEGAL_DOCS = ['imprint', 'privacy', 'terms', 'cookies', 'subprocessors', 'dpa'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

/** Localized public pages: exact paths and path prefixes (subtrees). */
export const LOCALIZED_PUBLIC_EXACT = ['/', '/pricing', '/security'] as const;
export const LOCALIZED_PUBLIC_PREFIXES = ['/solutions', '/knowledge', '/legal', '/tools', '/sap', '/docs'] as const;

/**
 * Application routes that require a signed-in user. Requests without a session
 * cookie are redirected to /login (the API still enforces auth on every call;
 * this is a navigation guard, not a security boundary).
 */
export const AUTH_REQUIRED_PREFIXES = [
  '/dashboard',
  '/projects',
  '/analyze',
  '/reports',
  '/inspector',
  '/templates',
  '/artifacts',
  '/landscapes',
  '/agent-gate',
  '/integrations',
  '/settings',
  '/admin',
  '/onboarding',
  '/feedback',
] as const;

/** HTTP-only session cookie set by the API when it shares the site's host. */
export const API_SESSION_COOKIE = 'erppreflight_session';
/** Non-sensitive marker cookie (no credential) set by the web app while a sign-in exists. */
export const AUTH_HINT_COOKIE = 'erp_auth';

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isLocalizedPublicPath(path: string): boolean {
  return (
    (LOCALIZED_PUBLIC_EXACT as readonly string[]).includes(path) ||
    LOCALIZED_PUBLIC_PREFIXES.some((p) => matchesPrefix(path, p))
  );
}

export function requiresAuth(path: string): boolean {
  return AUTH_REQUIRED_PREFIXES.some((p) => matchesPrefix(path, p));
}

/** `/de/pricing` → { locale: 'de', path: '/pricing' }; `/pricing` → { locale: null, path }. */
export function splitLocale(pathname: string): { locale: Locale | null; path: string } {
  const match = pathname.match(/^\/([a-z]{2})(\/.*)?$/);
  if (match && isLocale(match[1])) {
    return { locale: match[1], path: match[2] || '/' };
  }
  return { locale: null, path: pathname };
}

/** Public URL path of a localized page, e.g. ('de', '/pricing') → '/de/pricing', ('en', '/') → '/en'. */
export function localizePath(locale: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}

/** For a (possibly prefixed) public pathname, the equivalent path in every locale. */
export function alternatePaths(pathname: string): Record<Locale, string> {
  const { path } = splitLocale(pathname);
  return Object.fromEntries(LOCALES.map((l) => [l, localizePath(l, path)])) as Record<Locale, string>;
}

export type RouteDecision =
  /** Public (localized) page: handled by the next-intl middleware. */
  | { action: 'intl' }
  | { action: 'redirect'; location: string; status: 307 | 308 }
  | { action: 'next'; locale: Locale };

export interface RouteInput {
  pathname: string;
  search?: string;
  hasCookie: (name: string) => boolean;
  preferredLocale?: string | null;
}

export function resolveRoute({ pathname, search = '', hasCookie, preferredLocale }: RouteInput): RouteDecision {
  const { locale, path } = splitLocale(pathname);

  // Locale-prefixed URLs and unprefixed public pages belong to next-intl
  // (renders /en|de/..., redirects /pricing → /{locale}/pricing).
  if (locale || isLocalizedPublicPath(path)) {
    return { action: 'intl' };
  }

  if (requiresAuth(path) && !hasCookie(API_SESSION_COOKIE) && !hasCookie(AUTH_HINT_COOKIE)) {
    const next = encodeURIComponent(`${path}${search}`);
    return { action: 'redirect', location: `/login?next=${next}`, status: 307 };
  }

  return { action: 'next', locale: isLocale(preferredLocale) ? preferredLocale : DEFAULT_LOCALE };
}
