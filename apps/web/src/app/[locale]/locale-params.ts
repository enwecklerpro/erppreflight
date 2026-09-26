import { notFound } from 'next/navigation';
import { isLocale, type Locale } from '../../i18n/config';

export type LocaleParams = Promise<{ locale: string }>;

/** Resolves and validates the `[locale]` route param (404 for unknown locales). */
export async function resolveLocale(params: LocaleParams): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}
