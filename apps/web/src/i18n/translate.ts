import { en, type Messages } from './messages/en';
import { de } from './messages/de';
import type { Locale } from './config';

export type { Messages };

const DICTIONARIES: Record<Locale, Messages> = { en, de };

/** Dot-separated paths of all string leaves, e.g. `'nav.pricing'`. */
type StringLeaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends readonly unknown[]
      ? never
      : T[K] extends Record<string, string>
        ? string extends keyof T[K]
          ? never // open records (e.g. engines) are accessed via `messages`
          : StringLeaves<T[K], `${P}${K}.`>
        : StringLeaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = StringLeaves<Messages>;
export type TranslateVars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: TranslateVars) => string;

export function getMessages(locale: Locale): Messages {
  return DICTIONARIES[locale] ?? en;
}

export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Creates a typed translator. Missing keys (impossible for typed callers) fall
 * back to English and finally to the key itself, so the UI never renders blank.
 */
export function createTranslator(locale: Locale): TFunction {
  const messages = getMessages(locale);
  return (key, vars) => interpolate(lookup(messages, key) ?? lookup(en, key) ?? key, vars);
}

/** Server/shared helper: `const t = getT(locale); t('nav.pricing')`. */
export const getT = createTranslator;
