import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Boxes, FileCode2, History, Search, ShieldQuestion, Sparkles } from 'lucide-react';
import { getT, type MessageKey } from '../../../i18n/translate';
import { localizePath } from '../../../lib/routing';
import { localizedUrl, publicPageMetadata } from '../../../lib/seo';
import { TOOL_SLUGS, type ToolSlug } from '../../../lib/tools';
import { fetchServerToolsMeta, type ToolsMeta } from '../../../lib/public-tools';
import { JsonLd, breadcrumbJsonLd } from '../../../components/public/json-ld';
import { Breadcrumbs, ProvenancePanel, ToolCta } from '../../../components/tools/tool-shell';
import { resolveLocale, type LocaleParams } from '../locale-params';

const ICONS: Record<ToolSlug, React.ComponentType<{ className?: string }>> = {
  'clean-core-lookup': Sparkles,
  'cloud-successor': Boxes,
  'api-deprecations': History,
  'xml-field-checker': FileCode2,
  'fiori-403': ShieldQuestion,
  search: Search,
};

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  return publicPageMetadata({
    locale,
    path: '/tools',
    title: t('publicTools.hub.metaTitle'),
    description: t('publicTools.hub.metaDescription'),
  });
}

/** Free tools hub (Part 01 §1.11): every tool leads to "Create workspace → run full project analysis". */
export default async function ToolsHubPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  let meta: ToolsMeta | null = null;
  try {
    meta = await fetchServerToolsMeta();
  } catch {
    meta = null;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
            { name: t('publicTools.hub.breadcrumb'), url: localizedUrl(locale, '/tools') },
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            itemListElement: TOOL_SLUGS.map((slug, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: t(`publicTools.tools.${slug}.name` as MessageKey),
              url: localizedUrl(locale, `/tools/${slug}`),
            })),
          },
        ]}
      />
      <Breadcrumbs items={[{ name: t('knowledge.breadcrumbHome'), href: localizePath(locale, '/') }, { name: t('publicTools.hub.breadcrumb') }]} />
      <header className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('publicTools.hub.title')}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('publicTools.hub.intro')}</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="tools-list">
        {TOOL_SLUGS.map((slug) => {
          const Icon = ICONS[slug];
          return (
            <li key={slug} className="flex flex-col rounded-xl border border-border bg-card p-5">
              <Icon className="size-5 text-primary" aria-hidden="true" />
              <h2 className="mt-3 text-base font-bold">
                <Link href={localizePath(locale, `/tools/${slug}`)} className="hover:text-primary">
                  {t(`publicTools.tools.${slug}.name` as MessageKey)}
                </Link>
              </h2>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{t(`publicTools.tools.${slug}.short` as MessageKey)}</p>
              <Link
                href={localizePath(locale, `/tools/${slug}`)}
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                aria-hidden="true"
                tabIndex={-1}
              >
                {t('publicTools.hub.open')} <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
      <ProvenancePanel locale={locale} kind="knowledge-graph" meta={meta} />
      <ToolCta locale={locale} />
      <p className="text-center text-[11px] text-muted-foreground">{t('publicTools.common.independence')}</p>
    </div>
  );
}
