import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getT } from '../../../i18n/translate';
import { localizePath } from '../../../lib/routing';
import { DOC_SLUGS } from '../../../lib/docs/pages';
import { DocsFrame, docMetadata, getDoc } from '../../../components/docs/docs-shell';
import { resolveLocale, type LocaleParams } from '../locale-params';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  return docMetadata(locale, '/docs', t('publicTools.docs.metaTitle'), t('publicTools.docs.metaDescription'));
}

/** Documentation home (C §46): typed content pages, see ADR-021. */
export default async function DocsIndexPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  return (
    <DocsFrame locale={locale} title={t('publicTools.docs.title')} description={t('publicTools.docs.intro')} path="/docs">
      <ul className="grid gap-4 sm:grid-cols-2" data-testid="docs-index">
        {DOC_SLUGS.map((slug) => {
          const page = getDoc(locale, slug);
          return (
            <li key={slug} className="flex flex-col rounded-xl border border-border bg-card p-5">
              <h2 className="text-base font-bold">
                <Link href={localizePath(locale, `/docs/${slug}`)} className="hover:text-primary">
                  {page.title}
                </Link>
              </h2>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{page.description}</p>
              <Link
                href={localizePath(locale, `/docs/${slug}`)}
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                tabIndex={-1}
                aria-hidden="true"
              >
                {page.title} <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </DocsFrame>
  );
}
