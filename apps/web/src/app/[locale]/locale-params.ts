import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '../../i18n/config';

export type LocaleParams = Promise<{ locale: string }>;

/**
 * Resolves and validates the `[locale]` route param (404 for unknown locales)
 * and registers it with next-intl for this request.
 */
export async function resolveLocale(params: LocaleParams): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return locale;
}
