import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, BookOpen, CheckCircle2, Cpu, AlertCircle } from 'lucide-react';
import { getMessages, getT } from '../../../../i18n/translate';
import { localizePath } from '../../../../lib/routing';
import { enginesForSolution, isSolutionSlug } from '../../../../lib/solutions';
import { localizedUrl, publicPageMetadata } from '../../../../lib/seo';
import { fetchKnowledgeListSafe } from '../../../../lib/knowledge';
import { JsonLd, breadcrumbJsonLd } from '../../../../components/public/json-ld';
import { resolveLocale } from '../../locale-params';

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  if (!isSolutionSlug(slug)) return {};
  const item = getMessages(locale).solutions.items[slug];
  return publicPageMetadata({
    locale,
    path: `/solutions/${slug}`,
    title: `${item.name} — ERP Preflight`,
    description: item.metaDescription,
  });
}

export default async function SolutionPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  if (!isSolutionSlug(slug)) notFound();

  const t = getT(locale);
  const m = getMessages(locale);
  const item = m.solutions.items[slug];
  const engines = enginesForSolution(slug);
  const engineIds = new Set(engines.map((e) => e.id));

  // Related knowledge is derived from the articles' engine references, not hardcoded.
  const articles = await fetchKnowledgeListSafe(locale);
  const related = articles?.filter((a) => a.relatedEngineTypes.some((e) => engineIds.has(e))) ?? null;

  return (
    <div className="space-y-12">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
          { name: t('solutions.indexTitle'), url: localizedUrl(locale, '/solutions') },
          { name: item.name, url: localizedUrl(locale, `/solutions/${slug}`) },
        ])}
      />

      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href={localizePath(locale, '/')} className="hover:text-foreground">
              {t('knowledge.breadcrumbHome')}
            </Link>{' '}
            /
          </li>
          <li>
            <Link href={localizePath(locale, '/solutions')} className="hover:text-foreground">
              {t('solutions.indexTitle')}
            </Link>{' '}
            /
          </li>
          <li aria-current="page" className="text-foreground">
            {item.name}
          </li>
        </ol>
      </nav>

      <header className="max-w-3xl">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{item.name}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{item.tagline}</p>
      </header>

      <section aria-labelledby="pain-title" className="max-w-3xl">
        <h2 id="pain-title" className="text-xl font-bold">
          {t('solutions.painTitle')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.pain}</p>
      </section>

      <section aria-labelledby="engines-title">
        <h2 id="engines-title" className="text-xl font-bold">
          {t('solutions.enginesTitle')}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {engines.map((engine) => (
            <li key={engine.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">{engine.name}</h3>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{m.engines[engine.id] ?? engine.description}</p>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">{engine.id}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="examples-title">
        <h2 id="examples-title" className="text-xl font-bold">
          {t('solutions.examplesTitle')}
        </h2>
        <ul className="mt-4 space-y-2 max-w-3xl">
          {item.examples.map((example) => (
            <li key={example} className="flex gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{example}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="knowledge-title">
        <h2 id="knowledge-title" className="text-xl font-bold">
          {t('solutions.knowledgeTitle')}
        </h2>
        {related === null ? (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {t('solutions.knowledgeUnavailable')}
          </p>
        ) : related.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('solutions.noKnowledge')}</p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {related.map((article) => (
              <li key={article.slug}>
                <Link
                  href={localizePath(locale, `/knowledge/${article.slug}`)}
                  className="block h-full rounded-lg border border-border bg-card p-4 hover:border-primary/60"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <BookOpen className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                    {article.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{article.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-8 text-center">
        <h2 className="text-xl font-bold">{t('solutions.ctaTitle')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('solutions.ctaBody')}</p>
        <div className="mt-5 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/signup" className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600">
            {t('common.runPreflight')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href={localizePath(locale, '/pricing')} className="inline-flex items-center justify-center px-5 py-2.5 border border-border text-sm font-semibold rounded-lg hover:bg-muted">
            {t('nav.pricing')}
          </Link>
        </div>
      </section>
    </div>
  );
}
