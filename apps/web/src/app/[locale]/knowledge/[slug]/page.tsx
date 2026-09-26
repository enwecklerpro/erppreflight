import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertCircle, ArrowRight, CalendarCheck, ExternalLink, Info } from 'lucide-react';
import { LOCALE_TAGS, type Locale } from '../../../../i18n/config';
import { getMessages, getT } from '../../../../i18n/translate';
import { localizePath } from '../../../../lib/routing';
import { getAppBaseUrl, localizedUrl, publicPageMetadata } from '../../../../lib/seo';
import { engineName, solutionForEngine, type SolutionSlug } from '../../../../lib/solutions';
import { fetchKnowledgeArticle, type KnowledgeArticle } from '../../../../lib/knowledge';
import { Markdown } from '../../../../components/public/markdown';
import { JsonLd, breadcrumbJsonLd } from '../../../../components/public/json-ld';
import { resolveLocale } from '../../locale-params';

export const revalidate = 300;

type Params = Promise<{ locale: string; slug: string }>;

type LoadResult = { status: 'ok'; article: KnowledgeArticle } | { status: 'missing' } | { status: 'error' };

async function load(slug: string, locale: Locale): Promise<LoadResult> {
  try {
    const article = await fetchKnowledgeArticle(slug, locale);
    return article ? { status: 'ok', article } : { status: 'missing' };
  } catch {
    return { status: 'error' };
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const result = await load(slug, locale);
  const t = getT(locale);
  if (result.status !== 'ok') {
    return {
      title: `${result.status === 'missing' ? t('knowledge.notFoundTitle') : t('knowledge.errorTitle')} — ERP Preflight`,
      robots: { index: false, follow: true },
    };
  }
  const a = result.article;
  return publicPageMetadata({
    locale,
    path: `/knowledge/${a.slug}`,
    title: `${a.title} — ERP Preflight`,
    description: a.summary,
    type: 'article',
    availableLocales: a.availableLocales,
    publishedTime: a.publishedAt,
    modifiedTime: a.updatedAt,
  });
}

export default async function KnowledgeArticlePage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const result = await load(slug, locale);
  const t = getT(locale);

  if (result.status === 'missing') notFound();
  if (result.status === 'error') {
    return (
      <div role="alert" className="max-w-2xl mx-auto rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
          {t('knowledge.errorTitle')}
        </div>
        <p className="mt-2 text-sm">{t('knowledge.errorBody')}</p>
        <Link href={localizePath(locale, `/knowledge/${slug}`)} className="mt-3 inline-block text-sm font-semibold underline">
          {t('common.retry')}
        </Link>
      </div>
    );
  }

  const article = result.article;
  const m = getMessages(locale);
  const dateFormat = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { dateStyle: 'long', timeZone: 'UTC' });
  const url = localizedUrl(locale, `/knowledge/${article.slug}`);
  const solutions = Array.from(
    new Set(article.relatedEngineTypes.map(solutionForEngine).filter((s): s is SolutionSlug => s !== null))
  );

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: article.title,
      description: article.summary,
      inLanguage: locale,
      url,
      mainEntityOfPage: url,
      datePublished: article.publishedAt ?? undefined,
      dateModified: article.updatedAt,
      ...(article.reviewedAt ? { lastReviewed: article.reviewedAt } : {}),
      author: { '@type': 'Organization', name: 'ERP Preflight', url: getAppBaseUrl() },
      publisher: { '@type': 'Organization', name: 'ERP Preflight', url: getAppBaseUrl() },
      about: article.relatedEngineTypes.map(engineName),
      citation: article.sources.map((s) => s.url),
    },
    breadcrumbJsonLd([
      { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
      { name: t('knowledge.title'), url: localizedUrl(locale, '/knowledge') },
      { name: article.title, url },
    ]),
  ];

  return (
    <article className="max-w-3xl mx-auto space-y-8">
      <JsonLd data={structuredData} />

      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href={localizePath(locale, '/')} className="hover:text-foreground">
              {t('knowledge.breadcrumbHome')}
            </Link>{' '}
            /
          </li>
          <li>
            <Link href={localizePath(locale, '/knowledge')} className="hover:text-foreground">
              {t('knowledge.title')}
            </Link>{' '}
            /
          </li>
          <li aria-current="page" className="text-foreground line-clamp-1">
            {article.title}
          </li>
        </ol>
      </nav>

      <header>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">{article.title}</h1>
        <p className="mt-4 text-base text-muted-foreground leading-relaxed">{article.summary}</p>
        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          {article.reviewedAt && (
            <div className="flex items-center gap-1.5">
              <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <dt>{t('common.lastReviewed')}:</dt>
              <dd>
                <time dateTime={article.reviewedAt}>{dateFormat.format(new Date(article.reviewedAt))}</time>
              </dd>
            </div>
          )}
          {article.targetReleases.length > 0 && (
            <div className="flex gap-1.5">
              <dt>{t('common.targetReleases')}:</dt>
              <dd>{article.targetReleases.join(', ')}</dd>
            </div>
          )}
          <div className="flex gap-1.5">
            <dt>{t('common.version')}:</dt>
            <dd>{article.version}</dd>
          </div>
        </dl>
      </header>

      <Markdown source={article.bodyMarkdown} />

      <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('knowledge.reviewNote')}
      </p>

      {article.sources.length > 0 && (
        <section aria-labelledby="sources-title">
          <h2 id="sources-title" className="text-lg font-bold">
            {t('knowledge.sourcesTitle')}
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {article.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
                  {source.title}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="related-title" className="rounded-xl border border-border bg-card p-6">
        <h2 id="related-title" className="text-lg font-bold">
          {t('knowledge.relatedSolutions')}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('common.relatedEngines')}: {article.relatedEngineTypes.map(engineName).join(', ')}
        </p>
        <ul className="mt-4 flex flex-wrap gap-3">
          {solutions.map((slug) => (
            <li key={slug}>
              <Link
                href={localizePath(locale, `/solutions/${slug}`)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600"
              >
                {m.solutions.items[slug].name}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
