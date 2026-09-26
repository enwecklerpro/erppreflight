import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, AlertCircle, CalendarCheck } from 'lucide-react';

import { getFormat, getT } from '../../../i18n/translate';
import { localizePath } from '../../../lib/routing';
import { localizedUrl, publicPageMetadata } from '../../../lib/seo';
import { engineName } from '../../../lib/solutions';
import { fetchKnowledgeList, type KnowledgeSummary } from '../../../lib/knowledge';
import { JsonLd, breadcrumbJsonLd } from '../../../components/public/json-ld';
import { resolveLocale, type LocaleParams } from '../locale-params';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  return publicPageMetadata({
    locale,
    path: '/knowledge',
    title: t('knowledge.metaTitle'),
    description: t('knowledge.metaDescription'),
  });
}

export default async function KnowledgeIndexPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  const format = getFormat(locale);

  let articles: KnowledgeSummary[] | null = null;
  try {
    articles = await fetchKnowledgeList(locale);
  } catch {
    articles = null;
  }

  return (
    <div className="space-y-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
          { name: t('knowledge.title'), url: localizedUrl(locale, '/knowledge') },
        ])}
      />
      <header className="max-w-3xl">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{t('knowledge.title')}</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t('knowledge.intro')}</p>
      </header>

      {articles === null ? (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
            {t('knowledge.errorTitle')}
          </div>
          <p className="mt-2 text-sm">{t('knowledge.errorBody')}</p>
          <Link href={localizePath(locale, '/knowledge')} className="mt-3 inline-block text-sm font-semibold underline">
            {t('common.retry')}
          </Link>
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm text-muted-foreground">{t('knowledge.empty')}</p>
        </div>
      ) : (
        <ul className="grid gap-5 md:grid-cols-2" data-testid="knowledge-list">
          {articles.map((article) => (
            <li key={article.slug} className="rounded-xl border border-border bg-card p-6 flex flex-col">
              <h2 className="text-lg font-bold leading-snug">
                <Link href={localizePath(locale, `/knowledge/${article.slug}`)} className="hover:text-primary">
                  {article.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed flex-1">{article.summary}</p>
              <p className="mt-4 text-xs text-muted-foreground">
                {article.relatedEngineTypes.map(engineName).join(' · ')}
              </p>
              {article.reviewedAt && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('common.lastReviewed')}: <time dateTime={article.reviewedAt}>{format.dateTime(new Date(article.reviewedAt), { dateStyle: 'medium' })}</time>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
