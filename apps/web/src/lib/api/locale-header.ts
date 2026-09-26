import { LOCALE_COOKIE, isLocale } from '../../i18n/config';

/**
 * Sends the active UI language to the API (`Accept-Language`, a CORS-safelisted header) so
 * server-authored content — system templates, changelog entries — comes back in that language.
 * Browser only: the root layout renders `<html lang>` with the resolved locale; the locale
 * cookie is the fallback. An explicit Accept-Language set by the caller is left untouched.
 */
export function currentUiLocale(): string | null {
  if (typeof document === 'undefined') return null;
  const lang = document.documentElement?.lang;
  if (isLocale(lang)) return lang;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`));
  return match && isLocale(match[1]) ? match[1] : null;
}

export function applyLocaleHeader(headers: Headers): void {
  if (headers.has('Accept-Language')) return;
  const locale = currentUiLocale();
  if (locale) headers.set('Accept-Language', locale);
}
