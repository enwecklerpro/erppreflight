import React from 'react';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import type { Locale } from '../../i18n/config';
import { getMessages, getT } from '../../i18n/translate';
import { localizePath } from '../../lib/routing';
import { SOLUTION_SLUGS } from '../../lib/solutions';
import { CookieSettingsButton } from './cookie-consent';

/** Site-wide footer with legal links and the SAP independence disclaimer (Part 00 §0.8, 02 §2.15). */
export function SiteFooter({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const m = getMessages(locale);
  const lp = (path: string) => localizePath(locale, path);
  const year = new Date().getUTCFullYear();

  return (
    <footer className="border-t border-border bg-card mt-12" aria-labelledby="site-footer-heading">
      <h2 id="site-footer-heading" className="sr-only">
        Footer
      </h2>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="space-y-3">
          <Link href={lp('/')} className="inline-flex items-center gap-2 font-bold text-foreground">
            <span className="bg-primary text-white p-1.5 rounded-md" aria-hidden="true">
              <Layers className="h-4 w-4" />
            </span>
            {t('common.brand')}
          </Link>
          <p className="text-muted-foreground text-xs leading-relaxed">{t('common.tagline')}</p>
        </div>

        <nav aria-label={t('footer.product')} className="space-y-2">
          <p className="font-semibold text-foreground">{t('footer.product')}</p>
          <ul className="space-y-1.5 text-muted-foreground">
            {SOLUTION_SLUGS.map((slug) => (
              <li key={slug}>
                <Link className="hover:text-foreground" href={lp(`/solutions/${slug}`)}>
                  {m.solutions.items[slug].name}
                </Link>
              </li>
            ))}
            <li>
              <Link className="hover:text-foreground" href={lp('/pricing')}>
                {t('nav.pricing')}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label={t('footer.resources')} className="space-y-2">
          <p className="font-semibold text-foreground">{t('footer.resources')}</p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li>
              <Link className="hover:text-foreground" href={lp('/knowledge')}>
                {t('nav.knowledge')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href={lp('/security')}>
                {t('footer.security')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href="/trust">
                {t('footer.trust')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href="/status">
                {t('footer.status')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href="/docs">
                {t('footer.docs')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href="/changelog">
                {t('footer.changelog')}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label={t('footer.legal')} className="space-y-2">
          <p className="font-semibold text-foreground">{t('footer.legal')}</p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li>
              <Link className="hover:text-foreground" href={lp('/legal/imprint')}>
                {t('footer.imprint')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href={lp('/legal/privacy')}>
                {t('footer.privacy')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href={lp('/legal/terms')}>
                {t('footer.terms')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href={lp('/legal/cookies')}>
                {t('footer.cookies')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href={lp('/legal/subprocessors')}>
                {t('footer.subprocessors')}
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href={lp('/legal/dpa')}>
                {t('footer.dpa')}
              </Link>
            </li>
            <li>
              <CookieSettingsButton label={t('footer.cookieSettings')} />
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-2 text-xs text-muted-foreground">
          <p data-testid="sap-disclaimer" className="leading-relaxed">
            {t('footer.disclaimer')}
          </p>
          <p>
            © {year} {t('common.brand')}. {t('footer.rights')}
          </p>
        </div>
      </div>
    </footer>
  );
}
