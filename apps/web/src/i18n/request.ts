import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isLocale, type Locale } from './config';
import { I18N_TIME_ZONE, getMessages } from './translate';

/**
 * next-intl request configuration.
 * - Public pages (`app/[locale]`): the locale comes from the URL segment.
 * - App pages (unprefixed): the locale set by middleware from the `erp_locale`
 *   preference cookie, falling back to the cookie itself and then English.
 */
async function fallbackLocale(): Promise<Locale> {
  const h = await headers();
  const fromHeader = h.get(LOCALE_HEADER);
  if (isLocale(fromHeader)) return fromHeader;
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = isLocale(requested) ? requested : await fallbackLocale();
  return {
    locale,
    messages: getMessages(locale),
    timeZone: I18N_TIME_ZONE,
  };
});
