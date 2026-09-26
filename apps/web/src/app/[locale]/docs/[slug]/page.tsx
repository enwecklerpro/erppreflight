import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import type { Locale } from '../../../../i18n/config';
import { getT } from '../../../../i18n/translate';
import { localizePath } from '../../../../lib/routing';
import { isDocSlug, type DocSlug } from '../../../../lib/docs/pages';
import { fetchEngineCatalog, type EngineCatalog } from '../../../../lib/public-tools';
import {
  CatalogUnavailable,
  DocSections,
  DocsFrame,
  apiReferenceUrl,
  docMetadata,
  getDoc,
} from '../../../../components/docs/docs-shell';
import { resolveLocale } from '../../locale-params';

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  if (!isDocSlug(slug)) return { robots: { index: false, follow: true } };
  const page = getDoc(locale, slug);
  return docMetadata(locale, `/docs/${slug}`, page.title, page.description);
}

async function loadCatalog(): Promise<EngineCatalog | null> {
  try {
    return await fetchEngineCatalog();
  } catch {
    return null;
  }
}

/** File formats per engine, generated from the engines' declared input contracts. */
async function FileFormats({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const catalog = await loadCatalog();
  if (!catalog) return <CatalogUnavailable locale={locale} />;
  return (
    <section aria-labelledby="formats-title" className="space-y-3">
      <h2 id="formats-title" className="text-xl font-bold">
        {t('publicTools.docs.formatsTitle')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('publicTools.docs.formatsIntro')}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-left text-sm" data-testid="formats-table">
          <caption className="sr-only">{t('publicTools.docs.formatsTitle')}</caption>
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">{t('publicTools.docs.engine')}</th>
              <th scope="col" className="px-3 py-2">{t('publicTools.docs.accepted')}</th>
              <th scope="col" className="px-3 py-2">{t('publicTools.docs.inputContract')}</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((e) => (
              <tr key={e.engine_type} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 font-semibold">
                  <Link href={localizePath(locale, `/docs/engines/${e.engine_type}`)} className="hover:text-primary">
                    {e.name}
                  </Link>
                </th>
                <td className="px-3 py-2 font-mono text-xs">{(e.input_contract?.acceptedFormats ?? e.supported_artifact_types).join(', ')}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {e.input_contract?.summary}
                  {e.input_contract?.required.length ? (
                    <span className="mt-1 block">
                      <strong className="text-foreground">{t('publicTools.docs.required')}:</strong> {e.input_contract.required.join('; ')}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function DocPageRoute({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  if (!isDocSlug(slug) || slug === 'engines') notFound();
  const docSlug: DocSlug = slug;
  const page = getDoc(locale, docSlug);
  const t = getT(locale);
  const faqJsonLd = page.faq
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: page.faq.map((f) => ({
            '@type': 'Question',
            name: f.question,
            acceptedAnswer: { '@type': 'Answer', text: f.answer },
          })),
        },
      ]
    : [];

  return (
    <DocsFrame locale={locale} slug={docSlug} title={page.title} description={page.description} path={`/docs/${docSlug}`} extraJsonLd={faqJsonLd}>
      <DocSections locale={locale} page={page} />
      {docSlug === 'file-formats' ? <FileFormats locale={locale} /> : null}
      {page.faq ? (
        <dl className="space-y-4" data-testid="faq">
          {page.faq.map((f) => (
            <div key={f.question} className="rounded-lg border border-border bg-card p-4">
              <dt className="font-semibold">{f.question}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{f.answer}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {docSlug === 'api-cli' ? (
        <p>
          <a href={apiReferenceUrl()} rel="noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="api-reference-link">
            {t('publicTools.docs.apiReference')} <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </p>
      ) : null}
    </DocsFrame>
  );
}
