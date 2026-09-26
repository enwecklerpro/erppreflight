import * as React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertCircle, ArrowRight, CalendarCheck, ExternalLink, Fingerprint, Info, Network, ShieldCheck } from 'lucide-react';
import type { Locale } from '@/i18n/config';
import { getFormat, getT, type MessageKey, type TFunction } from '@/i18n/translate';
import { localizePath } from '@/lib/routing';
import { getAppBaseUrl, localizedUrl, publicPageMetadata } from '@/lib/seo';
import { fetchSeoObject, type SeoObject } from '@/lib/public-tools';
import { JsonLd, breadcrumbJsonLd } from '@/components/public/json-ld';
import { Breadcrumbs, ToolCta } from './tool-shell';
import { StateBadge } from './state-badge';
import { ReleaseTable, VerdictBanner } from './verdict';

export type SapPageKind = 'clean-core' | 'migration';

const PATHS: Record<SapPageKind, string> = { 'clean-core': '/sap/clean-core', migration: '/sap/cloud/migration' };

type Load = { status: 'ok'; data: SeoObject } | { status: 'missing' } | { status: 'error' };

export async function loadSapObject(slug: string): Promise<Load> {
  try {
    const data = await fetchSeoObject(slug);
    return data ? { status: 'ok', data } : { status: 'missing' };
  } catch {
    return { status: 'error' };
  }
}

function successorNames(d: SeoObject, max = 3) {
  const names = d.successors.map((s) => s.objectKey);
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');
}

/** Indexability of a page kind: the quality gate plus, for the migration view, a legacy object with a successor. */
export function isIndexable(kind: SapPageKind, d: SeoObject): boolean {
  return kind === 'clean-core' ? d.gate.indexable : d.migration.indexable;
}

export async function sapObjectMetadata(kind: SapPageKind, locale: Locale, slug: string): Promise<Metadata> {
  const t = getT(locale);
  const result = await loadSapObject(slug);
  if (result.status !== 'ok' || (kind === 'migration' && !result.data.migration.applicable)) {
    return {
      title: `${result.status === 'error' ? t('publicTools.sap.unavailableTitle') : t('notFound.title')} — ERP Preflight`,
      robots: { index: false, follow: true },
    };
  }
  const d = result.data;
  const format = getFormat(locale);
  const o = d.object;
  const successors = successorNames(d);
  const date = d.lastVerifiedAt ? format.dateTime(new Date(d.lastVerifiedAt), { dateStyle: 'medium' }) : '—';
  const verdict = t(`publicTools.verdicts.${d.verdict}` as MessageKey);
  const title =
    kind === 'clean-core'
      ? t('publicTools.sap.cleanCoreMetaTitle', { key: o.objectKey, type: o.sapObjectType, verdict })
      : t('publicTools.sap.migrationMetaTitle', { key: o.objectKey, successors: successors || '—' });
  const description =
    kind === 'clean-core'
      ? t('publicTools.sap.cleanCoreMetaDescription', {
          key: o.objectKey,
          type: o.sapObjectType,
          successorPart: successors ? t('publicTools.sap.successorPart', { successors }) : '',
          date,
        })
      : t('publicTools.sap.migrationMetaDescription', { key: o.objectKey, type: o.sapObjectType, successors: successors || '—' });
  return publicPageMetadata({
    locale,
    path: `${PATHS[kind]}/${d.slug}`,
    title,
    description,
    type: 'article',
    modifiedTime: d.lastVerifiedAt,
    noindex: !isIndexable(kind, d),
  });
}

function actionText(d: SeoObject, t: TFunction): string {
  const key = d.object.objectKey;
  switch (d.verdict) {
    case 'RELEASED':
      return t('publicTools.sap.actReleased', { key });
    case 'SUCCESSOR_AVAILABLE':
    case 'RELEASED_ELSEWHERE':
      return d.successors.length > 0 ? t('publicTools.sap.actSuccessor', { key }) : t('publicTools.sap.actNone');
    case 'CONCEPT_AVAILABLE':
      return t('publicTools.sap.actConcept', { concept: d.headline?.successorConcept ?? '—' });
    case 'NOT_RELEASED_NO_SUCCESSOR':
      return t('publicTools.sap.actNone');
    default:
      return t('publicTools.sap.actUnknown', { key });
  }
}

/**
 * Programmatic SEO page for one global SAP object (Part 02 §2.8/§2.9/§2.12).
 * Rendered on demand from the API (cached for an hour); indexable only when
 * the quality gate passes, otherwise served noindex with the reason shown.
 */
export async function SapObjectPage({ kind, locale, slug }: { kind: SapPageKind; locale: Locale; slug: string }) {
  const t = getT(locale);
  const format = getFormat(locale);
  const result = await loadSapObject(slug);
  if (result.status === 'missing') notFound();
  if (result.status === 'error') {
    return (
      <div role="alert" className="mx-auto max-w-2xl rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="flex items-center gap-2 font-semibold">
          <AlertCircle className="size-5" aria-hidden="true" /> {t('publicTools.sap.unavailableTitle')}
        </p>
        <p className="mt-2 text-sm">{t('publicTools.common.unavailable')}</p>
        <Link href={localizePath(locale, `${PATHS[kind]}/${slug}`)} className="mt-3 inline-block text-sm font-semibold underline">
          {t('publicTools.common.retry')}
        </Link>
      </div>
    );
  }
  const d = result.data;
  if (kind === 'migration' && !d.migration.applicable) notFound();

  const o = d.object;
  const path = `${PATHS[kind]}/${d.slug}`;
  const url = localizedUrl(locale, path);
  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'long' }) : '—');
  const title =
    kind === 'clean-core'
      ? t('publicTools.sap.cleanCoreTitle', { key: o.objectKey })
      : t('publicTools.sap.migrationTitle', { key: o.objectKey });
  const indexable = isIndexable(kind, d);
  const shownRelated = d.related.slice(0, 24);
  const citations = [...new Set(d.evidence.map((e) => e.url).filter((u): u is string => Boolean(u)))];

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description: `${t(`publicTools.verdicts.${d.verdict}` as MessageKey)} — ${o.objectKey} (${o.sapObjectType})`,
      inLanguage: locale,
      url,
      mainEntityOfPage: url,
      ...(d.lastVerifiedAt ? { dateModified: d.lastVerifiedAt, lastReviewed: d.lastVerifiedAt } : {}),
      about: { '@type': 'Thing', name: o.objectKey, description: `${o.objectType} ${o.sapObjectType}` },
      author: { '@type': 'Organization', name: 'ERP Preflight', url: getAppBaseUrl() },
      publisher: { '@type': 'Organization', name: 'ERP Preflight', url: getAppBaseUrl() },
      isBasedOn: citations,
      citation: citations,
    },
    breadcrumbJsonLd([
      { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
      { name: t('publicTools.sap.breadcrumb'), url: localizedUrl(locale, '/tools/clean-core-lookup') },
      { name: o.objectKey, url },
    ]),
  ];

  return (
    <article className="mx-auto max-w-4xl space-y-8" data-testid="sap-object-page" data-indexable={String(indexable)}>
      <JsonLd data={structuredData} />
      <Breadcrumbs
        items={[
          { name: t('knowledge.breadcrumbHome'), href: localizePath(locale, '/') },
          { name: t('publicTools.sap.breadcrumb'), href: localizePath(locale, '/tools/clean-core-lookup') },
          { name: o.objectKey },
        ]}
      />

      <header className="space-y-3">
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{o.sapObjectType}</span>
          <span>{o.objectType.replace(/_/g, ' ').toLowerCase()}</span>
          {o.applicationComponent ? <span>· {o.applicationComponent}</span> : null}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight break-words">{title}</h1>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CalendarCheck className="size-3.5" aria-hidden="true" />
            <dt>{t('publicTools.common.lastVerified')}:</dt>
            <dd>{d.lastVerifiedAt ? <time dateTime={d.lastVerifiedAt}>{date(d.lastVerifiedAt)}</time> : '—'}</dd>
          </div>
          {d.snapshot ? (
            <div className="flex items-center gap-1.5">
              <Fingerprint className="size-3.5" aria-hidden="true" />
              <dt className="sr-only">{t('publicTools.common.dataSource')}</dt>
              <dd>
                {t('publicTools.common.snapshot', { seq: d.snapshot.seq })} ·{' '}
                <span className="font-mono">{d.snapshot.contentSha256.slice(0, 12)}</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </header>

      {!indexable ? (
        <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="low-info-notice">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          {t('publicTools.sap.lowInfo', {
            failed:
              d.gate.failed.map((c) => t(`publicTools.sap.gateChecks.${c}` as MessageKey)).join(', ') ||
              t('publicTools.verdicts.RELEASED'),
          })}
        </p>
      ) : null}

      <section aria-labelledby="answer" className="space-y-3">
        <h2 id="answer" className="text-lg font-bold">
          {t('publicTools.sap.answer')}
        </h2>
        <VerdictBanner verdict={d.verdict} headline={d.headline} t={t} />
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{t('publicTools.sap.purpose')}:</strong>{' '}
          {kind === 'clean-core'
            ? t('publicTools.sap.purposeCleanCore', { key: o.objectKey })
            : t('publicTools.sap.purposeMigration', { key: o.objectKey })}
        </p>
      </section>

      {d.successors.length > 0 ? (
        <section aria-labelledby="successors" className="space-y-2">
          <h2 id="successors" className="text-lg font-bold">
            {t('publicTools.sap.successorsTitle')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {d.successors.map((s) => (
              <li key={`${s.sapObjectType}-${s.objectKey}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-sm">
                <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {s.slug ? (
                  <Link href={localizePath(locale, `/sap/clean-core/${s.slug}`)} className="font-mono font-semibold text-primary hover:underline">
                    {s.objectKey}
                  </Link>
                ) : (
                  <span className="font-mono font-semibold">{s.objectKey}</span>
                )}
                <span className="text-xs text-muted-foreground">{s.sapObjectType}</span>
                {s.supportState ? <StateBadge state={s.supportState} label={t(`publicTools.states.${s.supportState}` as MessageKey)} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="act" className="space-y-2">
        <h2 id="act" className="text-lg font-bold">
          {t('publicTools.sap.howToAct')}
        </h2>
        <p className="text-sm leading-relaxed">{actionText(d, t)}</p>
      </section>

      <section aria-labelledby="releases" className="space-y-2">
        <h2 id="releases" className="text-lg font-bold">
          {t('publicTools.sap.releasesTitle')}
        </h2>
        <ReleaseTable releases={d.releases} t={t} locale={locale} caption={t('publicTools.sap.releasesTitle')} />
        {d.classicApi ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t('publicTools.common.classicApi')} ({t(`publicTools.editions.${d.classicApi.editionCode}` as MessageKey)}):
            <StateBadge
              state={d.classicApi.supportState}
              label={t(`publicTools.states.${d.classicApi.supportState}` as MessageKey)}
              level={d.classicApi.cleanCoreLevel}
            />
          </p>
        ) : null}
      </section>

      {d.lifecycle.length > 0 ? (
        <section aria-labelledby="lifecycle" className="space-y-2">
          <h2 id="lifecycle" className="text-lg font-bold">
            {t('publicTools.sap.lifecycleTitle')}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {d.lifecycle.map((l) => (
              <li key={l.editionCode} className="rounded-lg border border-border bg-card p-3 text-xs">
                <p className="font-semibold">{t(`publicTools.editions.${l.editionCode}` as MessageKey)}</p>
                <p className="mt-1">
                  {t('publicTools.api.current')}:{' '}
                  <StateBadge state={l.currentState} label={t(`publicTools.states.${l.currentState}` as MessageKey)} /> ({l.currentRelease})
                </p>
                <p>
                  {t('publicTools.api.firstReleased')}: {l.firstReleasedIn ?? t('publicTools.api.neverReleased')}
                </p>
                <p>
                  {t('publicTools.api.firstDeprecated')}: {l.firstDeprecatedIn ?? t('publicTools.api.notYet')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {shownRelated.length > 0 ? (
        <section aria-labelledby="related" className="space-y-2" data-testid="related-objects">
          <h2 id="related" className="flex items-center gap-1.5 text-lg font-bold">
            <Network className="size-5" aria-hidden="true" /> {t('publicTools.sap.relatedTitle')}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {shownRelated.map((r) => (
              <li key={`${r.sapObjectType}-${r.objectKey}`} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2 text-xs">
                {r.slug ? (
                  <Link href={localizePath(locale, `/sap/clean-core/${r.slug}`)} className="font-mono font-semibold text-primary hover:underline">
                    {r.objectKey}
                  </Link>
                ) : (
                  <span className="font-mono font-semibold">{r.objectKey}</span>
                )}
                <span className="text-muted-foreground">{r.sapObjectType}</span>
                <span className="rounded bg-muted px-1">{t(`publicTools.relations.${r.relation}` as MessageKey)}</span>
                {r.headline ? (
                  <StateBadge state={r.headline.supportState} label={t(`publicTools.states.${r.headline.supportState}` as MessageKey)} />
                ) : null}
              </li>
            ))}
          </ul>
          {d.relatedTotal > shownRelated.length ? (
            <p className="text-xs text-muted-foreground">{t('publicTools.sap.relatedMore', { count: d.relatedTotal - shownRelated.length })}</p>
          ) : null}
        </section>
      ) : null}

      {d.alternates.length > 0 ? (
        <section aria-labelledby="alternates" className="space-y-2">
          <h2 id="alternates" className="text-lg font-bold">
            {t('publicTools.sap.alternatesTitle')}
          </h2>
          <ul className="space-y-1 text-xs">
            {d.alternates.map((a) => (
              <li key={`${a.sapObjectType}-${a.objectKey}`} className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono font-semibold">{a.objectKey}</span>
                <span className="text-muted-foreground">
                  {a.sapObjectType} · {a.objectType.replace(/_/g, ' ').toLowerCase()}
                </span>
                {a.headline ? <StateBadge state={a.headline.supportState} label={t(`publicTools.states.${a.headline.supportState}` as MessageKey)} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="evidence" className="space-y-2 rounded-xl border border-border bg-card p-4" data-testid="evidence">
        <h2 id="evidence" className="flex items-center gap-1.5 text-base font-bold">
          <ShieldCheck className="size-4" aria-hidden="true" /> {t('publicTools.sap.evidenceTitle')}
        </h2>
        <ul className="space-y-1.5 text-xs">
          {d.evidence.map((e) => (
            <li key={e.title}>
              {e.url ? (
                <a href={e.url} rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-2">
                  {e.title} <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ) : (
                <span className="font-semibold">{e.title}</span>
              )}
              <span className="block text-muted-foreground">
                {t(`publicTools.trust.${e.trustLevel}` as MessageKey)} · {t('publicTools.sap.verifiedFrom', { date: date(e.retrievedAt), source: e.url ? new URL(e.url).host : e.title })}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">{t('publicTools.common.publicOnly')}</p>
      </section>

      <nav className="flex flex-wrap gap-4 text-sm" aria-label={o.objectKey}>
        {kind === 'clean-core' && d.migration.applicable ? (
          <Link href={localizePath(locale, `/sap/cloud/migration/${d.slug}`)} className="font-semibold text-primary hover:underline">
            {t('publicTools.sap.migrationLink', { key: o.objectKey })}
          </Link>
        ) : null}
        {kind === 'migration' ? (
          <Link href={localizePath(locale, `/sap/clean-core/${d.slug}`)} className="font-semibold text-primary hover:underline">
            {t('publicTools.sap.cleanCoreLink', { key: o.objectKey })}
          </Link>
        ) : null}
        <Link href={localizePath(locale, '/tools/clean-core-lookup')} className="font-semibold text-primary hover:underline">
          {t('publicTools.sap.lookupAnother')}
        </Link>
      </nav>

      <ToolCta locale={locale} />
      <p className="text-center text-[11px] text-muted-foreground">{t('publicTools.common.independence')}</p>
    </article>
  );
}
