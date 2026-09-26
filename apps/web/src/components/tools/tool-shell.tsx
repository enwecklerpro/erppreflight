import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Database, Fingerprint, ShieldCheck, Wrench } from 'lucide-react';
import type { Locale } from '@/i18n/config';
import { getFormat, getT, type MessageKey } from '@/i18n/translate';
import { localizePath } from '@/lib/routing';
import { localizedUrl } from '@/lib/seo';
import type { ToolsMeta } from '@/lib/public-tools';
import type { ToolSlug } from '@/lib/tools';
import { JsonLd, breadcrumbJsonLd } from '@/components/public/json-ld';

/** Where a tool's answer comes from (Part 01 §1.11: every tool states source, date and trust level). */
export type ProvenanceKind = 'knowledge-graph' | 'document' | 'decision-tree' | 'search';

export function Breadcrumbs({ items }: { items: Array<{ name: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
      <ol className="flex flex-wrap gap-1">
        {items.map((item, i) => (
          <li key={`${item.name}-${i}`} className="flex items-center gap-1">
            {item.href ? (
              <Link href={item.href} className="hover:text-foreground">
                {item.name}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground break-all">
                {item.name}
              </span>
            )}
            {i < items.length - 1 ? <span aria-hidden="true">/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** "Create workspace → run full project analysis" (Part 01 §1.11). */
export function ToolCta({ locale }: { locale: Locale }) {
  const t = getT(locale);
  return (
    <aside className="rounded-xl border border-primary/30 bg-primary/5 p-5" data-testid="tool-cta">
      <h2 className="text-base font-bold">{t('publicTools.common.ctaTitle')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('publicTools.common.ctaBody')}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
        >
          {t('publicTools.common.ctaButton')}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        <Link
          href={localizePath(locale, '/docs/getting-started')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
        >
          <BookOpen className="size-4" aria-hidden="true" />
          {t('publicTools.common.ctaDocs')}
        </Link>
      </div>
    </aside>
  );
}

/** Data source, snapshot / review date and trust level behind a tool. */
export function ProvenancePanel({
  locale,
  kind,
  meta,
  reviewedAt,
}: {
  locale: Locale;
  kind: ProvenanceKind;
  meta: ToolsMeta | null;
  /** Review date of curated content (decision tree). */
  reviewedAt?: string;
}) {
  const t = getT(locale);
  const format = getFormat(locale);
  const date = (iso: string | null | undefined) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'medium' }) : '—');
  const official = meta?.sources.filter((s) => s.trustLevel.startsWith('OFFICIAL_')) ?? [];
  const copy = {
    source: t(`publicTools.provenance.${kind}.source` as MessageKey),
    trust: t(`publicTools.provenance.${kind}.trust` as MessageKey),
  };

  return (
    <section
      aria-labelledby="provenance-title"
      className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground"
      data-testid="tool-provenance"
    >
      <h2 id="provenance-title" className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Database className="size-4" aria-hidden="true" />
        {t('publicTools.common.sourcesTitle')}
      </h2>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
        <dt className="font-semibold text-foreground">{t('publicTools.common.dataSource')}</dt>
        <dd data-testid="provenance-source">{copy.source}</dd>
        {kind === 'knowledge-graph' || kind === 'search' ? (
          <>
            <dt className="font-semibold text-foreground">{t('publicTools.common.lastRetrieved')}</dt>
            <dd data-testid="provenance-date">
              {meta?.snapshot ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <Fingerprint className="size-3" aria-hidden="true" />
                    {t('publicTools.common.snapshot', { seq: meta.snapshot.seq })}
                  </span>{' '}
                  · {date(meta.lastRetrievedAt)}
                </>
              ) : (
                t('publicTools.common.noSnapshot')
              )}
            </dd>
          </>
        ) : null}
        {kind === 'decision-tree' && reviewedAt ? (
          <>
            <dt className="font-semibold text-foreground">{t('publicTools.common.lastVerified')}</dt>
            <dd data-testid="provenance-date">{date(reviewedAt)}</dd>
          </>
        ) : null}
        <dt className="font-semibold text-foreground">{t('publicTools.common.trustLevel')}</dt>
        <dd data-testid="provenance-trust" className="flex items-start gap-1">
          <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{copy.trust}</span>
        </dd>
      </dl>
      {(kind === 'knowledge-graph' || kind === 'search') && official.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-foreground">{official.length} × {t('publicTools.trust.OFFICIAL_REPOSITORY')}</summary>
          <ul className="mt-1 space-y-0.5">
            {official.map((s) => (
              <li key={s.sourceKey}>
                {s.url ? (
                  <a href={s.url} rel="noopener noreferrer" className="underline underline-offset-2">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}{' '}
                · {date(s.lastRetrievedAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-2">{t('publicTools.common.publicOnly')}</p>
    </section>
  );
}

/** Page frame of one free tool: breadcrumb, heading, tool body, provenance, CTA, disclaimer. */
export function ToolPage({
  locale,
  slug,
  intro,
  provenance,
  children,
}: {
  locale: Locale;
  slug: ToolSlug;
  intro?: string;
  provenance: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = getT(locale);
  const name = t(`publicTools.tools.${slug}.name` as MessageKey);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
            { name: t('publicTools.hub.breadcrumb'), url: localizedUrl(locale, '/tools') },
            { name, url: localizedUrl(locale, `/tools/${slug}`) },
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name,
            url: localizedUrl(locale, `/tools/${slug}`),
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'Web browser',
            inLanguage: locale,
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
          },
        ]}
      />
      <Breadcrumbs
        items={[
          { name: t('knowledge.breadcrumbHome'), href: localizePath(locale, '/') },
          { name: t('publicTools.hub.breadcrumb'), href: localizePath(locale, '/tools') },
          { name },
        ]}
      />
      <header className="space-y-2">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <Wrench className="size-3.5" aria-hidden="true" /> {t('publicTools.nav.tools')}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">{name}</h1>
        <p className="text-sm text-muted-foreground">{intro ?? t(`publicTools.tools.${slug}.short` as MessageKey)}</p>
      </header>
      {children}
      {provenance}
      <ToolCta locale={locale} />
      <p className="text-center text-[11px] text-muted-foreground">{t('publicTools.common.independence')}</p>
    </div>
  );
}
