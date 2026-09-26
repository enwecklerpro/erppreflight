import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { getRequestLocale } from '../i18n/server';
import { getT } from '../i18n/translate';
import { localizePath } from '../lib/routing';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return {
    title: `${t('notFound.title')} — ERP Preflight`,
    robots: { index: false, follow: true },
  };
}

export default async function NotFound() {
  const locale = await getRequestLocale();
  const t = getT(locale);
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4" data-testid="not-found">
      <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-mono text-muted-foreground">404</p>
      <h1 className="text-2xl font-bold tracking-tight">{t('notFound.title')}</h1>
      <p className="text-muted-foreground max-w-md">{t('notFound.body')}</p>
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Link href={localizePath(locale, '/')} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600">
          {t('notFound.home')}
        </Link>
        <Link href={localizePath(locale, '/knowledge')} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-muted">
          {t('notFound.knowledge')}
        </Link>
      </div>
    </div>
  );
}
