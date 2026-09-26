import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getMessages, getT } from '../../../i18n/translate';
import { localizePath } from '../../../lib/routing';
import { SOLUTION_SLUGS, enginesForSolution } from '../../../lib/solutions';
import { localizedUrl, publicPageMetadata } from '../../../lib/seo';
import { JsonLd, breadcrumbJsonLd } from '../../../components/public/json-ld';
import { resolveLocale, type LocaleParams } from '../locale-params';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  return publicPageMetadata({
    locale,
    path: '/solutions',
    title: t('solutions.indexMetaTitle'),
    description: t('solutions.indexMetaDescription'),
  });
}

export default async function SolutionsIndexPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  const m = getMessages(locale);

  return (
    <div className="space-y-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
          { name: t('solutions.indexTitle'), url: localizedUrl(locale, '/solutions') },
        ])}
      />
      <header className="max-w-3xl">
        <h1 className="text-3xl font-extrabold tracking-tight">{t('solutions.indexTitle')}</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t('solutions.indexIntro')}</p>
      </header>
      <ul className="grid gap-5 md:grid-cols-2">
        {SOLUTION_SLUGS.map((slug) => {
          const item = m.solutions.items[slug];
          return (
            <li key={slug} className="rounded-xl border border-border bg-card p-6 flex flex-col">
              <h2 className="text-lg font-bold">{item.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{item.tagline}</p>
              <ul className="mt-4 space-y-1.5 text-sm flex-1">
                {enginesForSolution(slug).map((engine) => (
                  <li key={engine.id}>
                    <span className="font-medium">{engine.name}</span>
                    <span className="text-muted-foreground"> — {m.engines[engine.id] ?? engine.description}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={localizePath(locale, `/solutions/${slug}`)}
                className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                {t('common.learnMore')}
                <span className="sr-only">: {item.name}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
