'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cookie } from 'lucide-react';
import { useLocale, useT } from '../../i18n/client';
import { localizePath } from '../../lib/routing';

/**
 * Cookie consent (Part 02 §2.14). Only necessary cookies are used today and no
 * tracking vendor is integrated; the stored choice gates any future optional
 * analytics via `hasAnalyticsConsent()`.
 */
export const CONSENT_COOKIE = 'erp_consent';
export const CONSENT_CHANGE_EVENT = 'erppreflight:consent-change';
export const OPEN_COOKIE_SETTINGS_EVENT = 'erppreflight:open-cookie-settings';

export type ConsentChoice = 'necessary' | 'analytics';

export function readConsent(cookieString: string = typeof document === 'undefined' ? '' : document.cookie): ConsentChoice | null {
  const match = cookieString.match(/(?:^|;\s*)erp_consent=([^;]+)/);
  const value = match ? decodeURIComponent(match[1]) : null;
  return value === 'necessary' || value === 'analytics' ? value : null;
}

/** True only after the user explicitly allowed optional analytics. */
export function hasAnalyticsConsent(): boolean {
  return readConsent() === 'analytics';
}

export function storeConsent(choice: ConsentChoice): void {
  try {
    document.cookie = `${CONSENT_COOKIE}=${choice}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // cookies blocked: the banner will simply show again next time
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: { choice } }));
}

export function CookieSettingsButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="hover:text-foreground underline-offset-2 hover:underline text-left"
      onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT))}
    >
      {label}
    </button>
  );
}

export function CookieConsentBanner() {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (readConsent() === null) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
  }, []);

  if (!open) return null;

  const choose = (choice: ConsentChoice) => {
    storeConsent(choice);
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-body"
      data-testid="cookie-consent"
      className="fixed inset-x-0 bottom-0 z-50 p-4 sm:p-6"
      onKeyDown={(e) => {
        if (e.key === 'Escape') choose('necessary');
      }}
    >
      <div className="max-w-3xl mx-auto bg-card border border-border rounded-xl shadow-lg p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
        <Cookie className="h-6 w-6 text-primary shrink-0 hidden sm:block" aria-hidden="true" />
        <div className="flex-1 text-sm">
          <p id="cookie-consent-title" className="font-semibold text-foreground">
            {t('cookieConsent.title')}
          </p>
          <p id="cookie-consent-body" className="text-muted-foreground text-xs mt-1 leading-relaxed">
            {t('cookieConsent.body')}{' '}
            <Link href={localizePath(locale, '/legal/cookies')} className="underline text-foreground">
              {t('cookieConsent.policy')}
            </Link>
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            type="button"
            onClick={() => choose('necessary')}
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-border text-foreground hover:bg-muted"
          >
            {t('cookieConsent.necessaryOnly')}
          </button>
          <button
            type="button"
            onClick={() => choose('analytics')}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-blue-600"
          >
            {t('cookieConsent.acceptAll')}
          </button>
        </div>
      </div>
    </div>
  );
}
