'use client';

import React from 'react';
import { Languages } from 'lucide-react';
import { LOCALES, LOCALE_LABELS, type Locale } from '../../i18n/config';
import { useLocale, useSetLocale, useT } from '../../i18n/client';

/**
 * Compact EN/DE switcher. On public pages it navigates to the alternate URL
 * (/pricing ↔ /de/pricing); on app pages it stores the preference cookie and
 * re-renders the current route.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useT();

  return (
    <div role="group" aria-label={t('nav.language')} className="inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5">
      <Languages className="h-3.5 w-3.5 mx-1 text-muted-foreground" aria-hidden="true" />
      {LOCALES.map((l: Locale) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={active}
            aria-label={t('nav.switchTo', { language: LOCALE_LABELS[l] })}
            data-testid={`lang-${l}`}
            onClick={() => {
              if (!active) setLocale(l);
            }}
            className={`px-1.5 py-0.5 rounded-md text-[11px] font-bold uppercase transition-colors ${
              active ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
