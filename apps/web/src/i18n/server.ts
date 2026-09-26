import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isLocale, type Locale } from './config';

/**
 * Locale of the current request for server components outside the `[locale]`
 * segment (root layout, not-found, app pages). Resolution order:
 * 1. header set by middleware (URL prefix for public pages, cookie for app pages);
 * 2. the `erp_locale` preference cookie;
 * 3. English.
 * Pages under `app/[locale]` should use their `params.locale` instead.
 */
export async function getRequestLocale(): Promise<Locale> {
  const h = await headers();
  const fromHeader = h.get(LOCALE_HEADER);
  if (isLocale(fromHeader)) return fromHeader;
  const c = await cookies();
  const fromCookie = c.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return DEFAULT_LOCALE;
}
