import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '../components/navbar';
import { QueryProvider } from '../lib/query/query-provider';
import { CommandPalette } from '../components/command-palette';
import { I18nProvider } from '../i18n/client';
import { getRequestLocale } from '../i18n/server';
import { getT } from '../i18n/translate';
import { SiteFooter } from '../components/public/site-footer';
import { CookieConsentBanner } from '../components/public/cookie-consent';
import { getAppBaseUrl } from '../lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(getAppBaseUrl()),
  title: 'ERP Preflight — Enterprise SAP Preflight & Clean Core SaaS',
  description:
    'Production-grade multi-tenant SaaS platform for automated SAP preflight analysis, clean core auditing, migration verification, and release intelligence.',
  applicationName: 'ERP Preflight',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved by middleware: URL prefix on public pages, preference cookie elsewhere.
  const locale = await getRequestLocale();
  const t = getT(locale);

  return (
    <html lang={locale}>
      <body className="antialiased min-h-screen flex flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-primary focus:text-white"
        >
          {t('common.skipToContent')}
        </a>
        <I18nProvider locale={locale}>
          <QueryProvider>
            <Navbar />
            <CommandPalette />
            <main id="main-content" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {children}
            </main>
            <SiteFooter locale={locale} />
            <CookieConsentBanner />
          </QueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
