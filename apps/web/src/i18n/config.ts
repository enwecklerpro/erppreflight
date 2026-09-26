/**
 * Locale configuration shared by middleware, server components and client components.
 * Must stay free of React / Next server imports so the edge middleware can use it.
 */
export const LOCALES = ['en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Cookie holding the user's UI language preference (app routes). */
export const LOCALE_COOKIE = 'erp_locale';
/** Request header set by middleware with the locale resolved for the request. */
export const LOCALE_HEADER = 'x-erp-locale';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
};

/** BCP-47 tags used for Intl formatting and Open Graph locales. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en-US',
  de: 'de-DE',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
