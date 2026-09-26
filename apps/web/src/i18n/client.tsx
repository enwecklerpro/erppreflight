'use client';

import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LOCALE_COOKIE, type Locale } from './config';
import { createTranslator, getMessages, type Messages, type TFunction } from './translate';
import { alternatePaths, isLocalizedPublicPath, splitLocale } from '../lib/routing';

interface I18nContextValue {
  locale: Locale;
  t: TFunction;
  messages: Messages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Provided once in the root layout with the locale resolved on the server. */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: createTranslator(locale), messages: getMessages(locale) }),
    [locale]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Outside the provider (isolated component tests): English.
    return { locale: 'en', t: createTranslator('en'), messages: getMessages('en') };
  }
  return ctx;
}

/** `const t = useT(); t('nav.pricing')` */
export function useT(): TFunction {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

/** Full dictionary for structured content (lists, FAQ entries, …). */
export function useMessages(): Messages {
  return useI18n().messages;
}

export function writeLocaleCookie(locale: Locale): void {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // cookies disabled — the URL prefix still carries the locale on public pages
  }
}

/**
 * Switches the language: stores the preference cookie, then navigates to the
 * localized URL on public pages or re-renders app pages with the new locale.
 */
export function useSetLocale(): (locale: Locale) => void {
  const router = useRouter();
  const pathname = usePathname() || '/';
  return useCallback(
    (locale: Locale) => {
      writeLocaleCookie(locale);
      const { path } = splitLocale(pathname);
      if (isLocalizedPublicPath(path)) {
        // Full navigation: the root layout (<html lang>, providers) must re-render
        // for the other locale, which a soft navigation would not do.
        window.location.assign(`${alternatePaths(pathname)[locale]}${window.location.search}`);
      } else {
        router.refresh();
      }
    },
    [router, pathname]
  );
}
