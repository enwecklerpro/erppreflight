import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE } from './config';

/**
 * next-intl routing for the public website (Part 02 §2.7): every public page is
 * locale-prefixed (`/en/...`, `/de/...`). Unprefixed public URLs (e.g. `/`,
 * `/pricing`) are redirected to the visitor's locale (cookie, then
 * Accept-Language, then English). Authenticated app routes stay unprefixed and
 * take the locale from the same cookie (see src/middleware.ts).
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeCookie: { name: LOCALE_COOKIE, maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' },
  // hreflang alternates are emitted per page via metadata (lib/seo.ts).
  alternateLinks: false,
});
