import { createTranslator as createIntlTranslator, createFormatter } from 'next-intl';
import { en, type Messages } from './messages/en';
import { de } from './messages/de';
import type { Locale } from './config';

export type { Messages };

/** Time zone used for all formatting so server and client output match. */
export const I18N_TIME_ZONE = 'UTC';

const DICTIONARIES: Record<Locale, Messages> = { en, de };

/** Dot-separated paths of all string leaves, e.g. `'nav.pricing'`. */
type StringLeaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends readonly unknown[]
      ? never
      : T[K] extends Record<string, string>
        ? string extends keyof T[K]
          ? never // open records (e.g. engines) are read via getMessages()
          : StringLeaves<T[K], `${P}${K}.`>
        : StringLeaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = StringLeaves<Messages>;
export type TranslateVars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: TranslateVars) => string;

/** Typed dictionary for structured content (lists, FAQ entries, records). */
export function getMessages(locale: Locale): Messages {
  return DICTIONARIES[locale] ?? en;
}

/**
 * Typed translator backed by next-intl (ICU message syntax, e.g. `{count}`).
 * Usable in server components, route handlers, metadata and tests:
 * `const t = getT(locale); t('nav.pricing')`.
 * Missing messages fall back to English, then to the key, so the UI never renders blank.
 */
export function getT(locale: Locale): TFunction {
  const t = createIntlTranslator({
    locale,
    messages: getMessages(locale),
    timeZone: I18N_TIME_ZONE,
    onError: () => undefined,
    getMessageFallback: ({ key, namespace }) => {
      const full = namespace ? `${namespace}.${key}` : key;
      const fallback = createIntlTranslator({ locale: 'en', messages: en, timeZone: I18N_TIME_ZONE, onError: () => undefined });
      try {
        return (fallback as unknown as (k: string) => string)(full);
      } catch {
        return full;
      }
    },
  }) as unknown as (key: string, vars?: TranslateVars) => string;
  return (key, vars) => t(key, vars);
}

export const createTranslator = getT;

/** Locale-aware date/number formatting (next-intl formatter). */
export function getFormat(locale: Locale) {
  return createFormatter({ locale, timeZone: I18N_TIME_ZONE });
}
