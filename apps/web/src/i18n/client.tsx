'use client';

import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  NextIntlClientProvider,
  useLocale as useIntlLocale,
  useTranslations,
  useFormatter,
} from 'next-intl';
import { LOCALE_COOKIE, LOCALE_TAGS, toLocale, type Locale } from './config';
import { I18N_TIME_ZONE, getMessages, type Messages, type MessageKey, type TFunction, type TranslateVars } from './translate';
import { alternatePaths, isLocalizedPublicPath, splitLocale } from '../lib/routing';
import { installZodErrorMap, localizeError, translateMessage } from './validation';

// Zod built-in issues produce dictionary references (see ./validation).
installZodErrorMap();

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

export type RichValues = Record<string, string | number | ((chunks: React.ReactNode) => React.ReactNode)>;

/**
 * Rich-text messages with inline markup, e.g.
 * `'<b>Verify your email.</b> Then <link>continue</link>.'`:
 * `rt('app.x', { b: (c) => <strong>{c}</strong>, link: (c) => <Link href="/">{c}</Link> })`.
 */
export function useRichT(): (key: MessageKey, values?: RichValues) => React.ReactNode {
  const t = useTranslations();
  return useCallback(
    (key: MessageKey, values?: RichValues) =>
      (t.rich as unknown as (k: string, v?: RichValues) => React.ReactNode)(key, values),
    [t]
  );
}

export function useLocale(): Locale {
  return toLocale(useIntlLocale());
}

/** Full typed dictionary for structured content (lists, FAQ entries, …). */
export function useMessages(): Messages {
  return getMessages(useLocale());
}

/**
 * Localized label for an enum/status code from a dictionary group, e.g.
 * `label('app.projects.status', 'ACTIVE')`. Unknown codes are shown verbatim
 * (they are technical identifiers delivered by the API).
 */
export function useLabel(): (group: string, code: string | null | undefined) => string {
  const messages = useMessages();
  return useCallback(
    (group: string, code: string | null | undefined) => {
      if (code === null || code === undefined || code === '') return '—';
      let node: unknown = messages;
      for (const part of group.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
      const value = (node as Record<string, unknown> | undefined)?.[code];
      return typeof value === 'string' ? value : code;
    },
    [messages]
  );
}

/** Locale-aware date/number formatting (raw next-intl formatter). */
export { useFormatter };

/** Resolves `vmsg()` validation references; other strings pass through. */
export function useTranslateMessage(): (message: string | null | undefined) => string {
  const t = useT();
  return useCallback((message) => (message ? translateMessage(message, t) : ''), [t]);
}

/** `const errText = useErrorText(); errText(error)` — localized text for a failed request. */
export function useErrorText(): (error: unknown, fallback?: string) => string {
  const t = useT();
  return useCallback((error, fallback) => localizeError(error, t, fallback), [t]);
}

const subscribeNoop = () => () => undefined;
const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || I18N_TIME_ZONE;
  } catch {
    return I18N_TIME_ZONE;
  }
};
const serverTimeZone = () => I18N_TIME_ZONE;

type DateInput = string | number | Date | null | undefined;
const EMPTY = '—';

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface AppFormat {
  locale: Locale;
  /** e.g. "26 Sept 2026" / "26.09.2026" */
  date: (value: DateInput) => string;
  /** date + time (short) */
  dateTime: (value: DateInput) => string;
  /** time only (short) */
  time: (value: DateInput) => string;
  /** "3 minutes ago" / "vor 3 Minuten" */
  relative: (value: DateInput) => string;
  number: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
  percent: (ratio: number | null | undefined, maximumFractionDigits?: number) => string;
  bytes: (bytes: number | null | undefined) => string;
  currency: (amount: number | null | undefined, currency: string) => string;
}

/**
 * Locale-aware formatting for application pages. Dates use the viewer's time
 * zone in the browser (UTC during SSR/hydration, then re-rendered), numbers the
 * active locale — never a hardcoded `en-US`.
 */
export function useFmt(): AppFormat {
  const locale = useLocale();
  const timeZone = useSyncExternalStore(subscribeNoop, browserTimeZone, serverTimeZone);
  return useMemo(() => {
    const tag = LOCALE_TAGS[locale];
    const dtf = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { timeZone, ...opts });
    const dateF = dtf({ dateStyle: 'medium' });
    const dateTimeF = dtf({ dateStyle: 'medium', timeStyle: 'short' });
    const timeF = dtf({ timeStyle: 'short' });
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
    const number = (value: number | null | undefined, options?: Intl.NumberFormatOptions) =>
      value === null || value === undefined || Number.isNaN(value) ? EMPTY : new Intl.NumberFormat(tag, options).format(value);
    return {
      locale,
      date: (v) => {
        const d = toDate(v);
        return d ? dateF.format(d) : EMPTY;
      },
      dateTime: (v) => {
        const d = toDate(v);
        return d ? dateTimeF.format(d) : EMPTY;
      },
      time: (v) => {
        const d = toDate(v);
        return d ? timeF.format(d) : EMPTY;
      },
      relative: (v) => {
        const d = toDate(v);
        if (!d) return EMPTY;
        const seconds = Math.round((d.getTime() - Date.now()) / 1000);
        const abs = Math.abs(seconds);
        if (abs < 60) return rtf.format(seconds, 'second');
        if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
        if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
        if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day');
        return dateF.format(d);
      },
      number,
      percent: (ratio, maximumFractionDigits = 0) => number(ratio, { style: 'percent', maximumFractionDigits }),
      bytes: (bytes) => {
        if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return EMPTY;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let v = bytes;
        let i = 0;
        while (v >= 1024 && i < units.length - 1) {
          v /= 1024;
          i += 1;
        }
        return `${new Intl.NumberFormat(tag, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`;
      },
      currency: (amount, currency) => number(amount, { style: 'currency', currency }),
    };
  }, [locale, timeZone]);
}

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
