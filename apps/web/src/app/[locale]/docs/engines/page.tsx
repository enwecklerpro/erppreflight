import type { Metadata } from 'next';
import Link from 'next/link';
import { getT } from '../../../../i18n/translate';
import { localizePath } from '../../../../lib/routing';
import { fetchEngineCatalog, type EngineCatalog } from '../../../../lib/public-tools';
import { CatalogUnavailable, DocSections, DocsFrame, docMetadata, getDoc } from '../../../../components/docs/docs-shell';
import { resolveLocale, type LocaleParams } from '../../locale-params';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const page = getDoc(locale, 'engines');
  return docMetadata(locale, '/docs/engines', page.title, page.description);
}

/** Engine catalog generated from the analysis service's live catalog (via the API). */
export default async function EngineCatalogPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  const page = getDoc(locale, 'engines');
  let catalog: EngineCatalog | null = null;
  try {
    catalog = await fetchEngineCatalog();
  } catch {
    catalog = null;
  }
  const domains = catalog ? [...new Set(catalog.map((e) => e.domain))] : [];

  return (
    <DocsFrame locale={locale} slug="engines" title={page.title} description={page.description} path="/docs/engines">
      <DocSections locale={locale} page={page} />
      {!catalog ? (
        <CatalogUnavailable locale={locale} />
      ) : (
        <section aria-labelledby="catalog-title" className="space-y-4">
          <h2 id="catalog-title" className="text-xl font-bold">
            {t('publicTools.docs.engineCatalogTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('publicTools.docs.engineCatalogIntro', { count: catalog.length })}</p>
          {domains.map((domain) => (
            <section key={domain} aria-label={domain} className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{domain}</h3>
              <ul className="grid gap-3 sm:grid-cols-2" data-testid="engine-list">
                {catalog!
                  .filter((e) => e.domain === domain)
                  .map((e) => (
                    <li key={e.engine_type} className="rounded-xl border border-border bg-card p-4">
                      <h4 className="font-bold">
                        <Link href={localizePath(locale, `/docs/engines/${e.engine_type}`)} className="hover:text-primary">
                          {e.name}
                        </Link>
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">{e.description}</p>
                      <p className="mt-2 text-xs">
                        <span className="font-mono">{e.engine_type}</span> · {t('publicTools.docs.version')} {e.version} ·{' '}
                        {e.rule_count} {t('publicTools.docs.rules')}
                      </p>
                      <p className="mt-1 text-xs">
                        {t('publicTools.docs.accepted')}:{' '}
                        <span className="font-mono">{(e.input_contract?.acceptedFormats ?? e.supported_artifact_types).join(', ')}</span>
                      </p>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </section>
      )}
    </DocsFrame>
  );
}
