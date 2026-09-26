import { getLocale } from 'next-intl/server';
import { toLocale, type Locale } from './config';

/**
 * Locale of the current request for server components outside `app/[locale]`
 * (root layout, not-found, app pages). Resolved by next-intl: URL segment on
 * public pages, preference cookie on app pages (see i18n/request.ts).
 * Pages under `app/[locale]` should use their `params.locale` instead.
 */
export async function getRequestLocale(): Promise<Locale> {
  return toLocale(await getLocale());
}
