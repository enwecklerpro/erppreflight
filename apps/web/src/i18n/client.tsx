'use client';

import React, { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  NextIntlClientProvider,
  useLocale as useIntlLocale,
  useTranslations,
  useFormatter,
} from 'next-intl';
import { LOCALE_COOKIE, toLocale, type Locale } from './config';
import { I18N_TIME_ZONE, getMessages, type Messages, type MessageKey, type TFunction, type TranslateVars } from './translate';
import { alternatePaths, isLocalizedPublicPath, splitLocale } from '../lib/routing';

/** Provided once in the root layout with the locale resolved on the server. */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={getMessages(locale)} timeZone={I18N_TIME_ZONE}>
      {children}
    </NextIntlClientProvider>
  );
}

/** `const t = useT(); t('nav.pricing')` — typed wrapper around next-intl's useTranslations. */
export function useT(): TFunction {
  const t = useTranslations() as unknown as (key: string, vars?: TranslateVars) => string;
  return useCallback((key: MessageKey, vars?: TranslateVars) => t(key, vars), [t]);
}

export function useLocale(): Locale {
  return toLocale(useIntlLocale());
}

/** Full typed dictionary for structured content (lists, FAQ entries, …). */
export function useMessages(): Messages {
  return getMessages(useLocale());
}

/** Locale-aware date/number formatting. */
export { useFormatter };

export function writeLocaleCookie(locale: Locale): void {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // cookies disabled — the URL prefix still carries the locale on public pages
  }
}

/**
 * Switches the language: stores the preference cookie, then loads the localized
 * URL on public pages (full navigation so <html lang> and providers re-render) or
 * re-renders app pages with the new locale.
 */
export function useSetLocale(): (locale: Locale) => void {
  const router = useRouter();
  const pathname = usePathname() || '/';
  return useCallback(
    (locale: Locale) => {
      writeLocaleCookie(locale);
      const { locale: current, path } = splitLocale(pathname);
      if (current || isLocalizedPublicPath(path)) {
        window.location.assign(`${alternatePaths(pathname)[locale]}${window.location.search}`);
      } else {
        router.refresh();
      }
    },
    [router, pathname]
  );
}
