import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Locale } from '../../../../../i18n/config';
import { getT } from '../../../../../i18n/translate';
import { localizePath } from '../../../../../lib/routing';
import { fetchEngineCatalog, type EngineEntry } from '../../../../../lib/public-tools';
import { CatalogUnavailable, DocsFrame, EngineRules, docMetadata } from '../../../../../components/docs/docs-shell';
import { resolveLocale } from '../../../locale-params';

type Params = Promise<{ locale: string; engine: string }>;

type Load = { status: 'ok'; engine: EngineEntry } | { status: 'missing' } | { status: 'error' };

async function load(engineType: string): Promise<Load> {
  if (!/^[A-Z0-9_]{2,64}$/.test(engineType)) return { status: 'missing' };
  try {
    const catalog = await fetchEngineCatalog();
    const engine = catalog?.find((e) => e.engine_type === engineType);
    return engine ? { status: 'ok', engine } : { status: 'missing' };
  } catch {
    return { status: 'error' };
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { engine } = await params;
  const result = await load(engine);
  if (result.status !== 'ok') return { robots: { index: false, follow: true } };
  return docMetadata(locale, `/docs/engines/${engine}`, result.engine.name, result.engine.description);
}

export default async function EngineDocPage({ params }: { params: Params }) {
  const locale: Locale = await resolveLocale(params);
  const { engine: engineType } = await params;
  const t = getT(locale);
  const result = await load(engineType);
  if (result.status === 'missing') notFound();
  if (result.status === 'error') {
    return (
      <DocsFrame locale={locale} slug="engines" title={engineType} description="" path={`/docs/engines/${engineType}`}>
        <CatalogUnavailable locale={locale} />
      </DocsFrame>
    );
  }
  const e = result.engine;
  const contract = e.input_contract;
  return (
    <DocsFrame locale={locale} slug="engines" title={e.name} description={e.description} path={`/docs/engines/${e.engine_type}`}>
      <dl className="grid gap-x-6 gap-y-1 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="font-semibold">{t('publicTools.docs.engine')}</dt>
        <dd className="font-mono">{e.engine_type}</dd>
        <dt className="font-semibold">{t('publicTools.docs.domain')}</dt>
        <dd>{e.domain}</dd>
        <dt className="font-semibold">{t('publicTools.docs.version')}</dt>
        <dd>{e.version}</dd>
        <dt className="font-semibold">{t('publicTools.docs.targetReleases')}</dt>
        <dd>{e.target_releases.join(', ') || '—'}</dd>
        <dt className="font-semibold">{t('publicTools.docs.accepted')}</dt>
        <dd className="font-mono">{(contract?.acceptedFormats ?? e.supported_artifact_types).join(', ')}</dd>
      </dl>
      {contract ? (
        <section aria-labelledby="contract" className="space-y-2">
          <h2 id="contract" className="text-xl font-bold">
            {t('publicTools.docs.inputContract')}
          </h2>
          <p className="text-sm">{contract.summary}</p>
          {contract.required.length > 0 ? (
            <>
              <h3 className="text-sm font-semibold">{t('publicTools.docs.required')}</h3>
              <ul className="list-disc pl-5 text-sm">
                {contract.required.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          ) : null}
          {contract.notes.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {contract.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <section aria-labelledby="rules" className="space-y-2">
        <h2 id="rules" className="text-xl font-bold">
          {t('publicTools.docs.rules')}
        </h2>
        <EngineRules locale={locale} engine={e} />
      </section>
      <Link href={localizePath(locale, '/docs/engines')} className="inline-block text-sm font-semibold text-primary hover:underline">
        {t('publicTools.docs.backToDocs')}
      </Link>
    </DocsFrame>
  );
}
