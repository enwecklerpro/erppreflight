import * as React from 'react';
import { localizeRule } from '@/i18n/rule-catalog';
import Link from 'next/link';
import type { Metadata } from 'next';
import { AlertCircle, BookOpen, ExternalLink } from 'lucide-react';
import type { Locale } from '@/i18n/config';
import { getFormat, getT, type MessageKey } from '@/i18n/translate';
import { localizePath } from '@/lib/routing';
import { getAppBaseUrl, localizedUrl, publicPageMetadata } from '@/lib/seo';
import { DOCS_REVIEWED, DOC_SLUGS, type DocPage, type DocSlug } from '@/lib/docs/pages';
import { docsEn } from '@/lib/docs/content.en';
import { docsDe } from '@/lib/docs/content.de';
import { Markdown } from '@/components/public/markdown';
import { JsonLd, breadcrumbJsonLd } from '@/components/public/json-ld';
import { Breadcrumbs } from '@/components/tools/tool-shell';
import type { EngineEntry } from '@/lib/public-tools';

const DOCS: Record<Locale, Record<DocSlug, DocPage>> = { en: docsEn, de: docsDe };

export function getDoc(locale: Locale, slug: DocSlug): DocPage {
  return DOCS[locale][slug];
}

/** Public URL of the OpenAPI reference rendered by the API (Scalar, /api/v1/reference). */
export function apiReferenceUrl(): string {
  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${base}/api/v1/reference`;
}

export function docMetadata(locale: Locale, path: string, title: string, description: string): Metadata {
  return publicPageMetadata({ locale, path, title: `${title} — ERP Preflight Docs`, description, type: 'article' });
}

export function DocsNav({ locale, active }: { locale: Locale; active?: string }) {
  const t = getT(locale);
  return (
    <nav aria-label={t('publicTools.docs.allPages')} className="md:sticky md:top-20">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <BookOpen className="size-3.5" aria-hidden="true" /> {t('publicTools.docs.title')}
      </p>
      <ul className="space-y-0.5 text-sm" data-testid="docs-nav">
        <li>
          <Link
            href={localizePath(locale, '/docs')}
            aria-current={active === undefined ? 'page' : undefined}
            className={`block rounded-md px-2 py-1 hover:bg-muted ${active === undefined ? 'bg-muted font-semibold' : ''}`}
          >
            {t('publicTools.docs.title')}
          </Link>
        </li>
        {DOC_SLUGS.map((slug) => (
          <li key={slug}>
            <Link
              href={localizePath(locale, `/docs/${slug}`)}
              aria-current={active === slug ? 'page' : undefined}
              className={`block rounded-md px-2 py-1 hover:bg-muted ${active === slug ? 'bg-muted font-semibold' : ''}`}
            >
              {getDoc(locale, slug).title}
            </Link>
          </li>
        ))}
        <li>
          <a href={apiReferenceUrl()} rel="noopener" className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted">
            {t('publicTools.docs.apiReference')} <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </li>
      </ul>
    </nav>
  );
}

/** Two-column documentation frame with breadcrumbs, JSON-LD and the review date. */
export function DocsFrame({
  locale,
  slug,
  title,
  description,
  path,
  children,
  extraJsonLd = [],
}: {
  locale: Locale;
  slug?: string;
  title: string;
  description: string;
  path: string;
  children: React.ReactNode;
  extraJsonLd?: Record<string, unknown>[];
}) {
  const t = getT(locale);
  const format = getFormat(locale);
  const url = localizedUrl(locale, path);
  const crumbs = [
    { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
    { name: t('publicTools.docs.breadcrumb'), url: localizedUrl(locale, '/docs') },
    ...(path === '/docs' ? [] : [{ name: title, url }]),
  ];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row">
      <JsonLd
        data={[
          breadcrumbJsonLd(crumbs),
          {
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: title,
            description,
            inLanguage: locale,
            url,
            mainEntityOfPage: url,
            dateModified: DOCS_REVIEWED,
            author: { '@type': 'Organization', name: 'ERP Preflight', url: getAppBaseUrl() },
            publisher: { '@type': 'Organization', name: 'ERP Preflight', url: getAppBaseUrl() },
          },
          ...extraJsonLd,
        ]}
      />
      <aside className="md:w-60 md:shrink-0">
        <DocsNav locale={locale} active={slug} />
      </aside>
      <div className="min-w-0 flex-1 space-y-6" data-testid="docs-page">
        <Breadcrumbs
          items={[
            { name: t('knowledge.breadcrumbHome'), href: localizePath(locale, '/') },
            ...(path === '/docs'
              ? [{ name: t('publicTools.docs.breadcrumb') }]
              : [{ name: t('publicTools.docs.breadcrumb'), href: localizePath(locale, '/docs') }, { name: title }]),
          ]}
        />
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('publicTools.docs.lastUpdated', { date: format.dateTime(new Date(DOCS_REVIEWED), { dateStyle: 'long' }) })}
          </p>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Markdown sections of a documentation page with an in-page table of contents. */
export function DocSections({ locale, page }: { locale: Locale; page: DocPage }) {
  const t = getT(locale);
  return (
    <>
      {page.sections.length > 2 ? (
        <nav aria-label={t('publicTools.docs.onThisPage')} className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('publicTools.docs.onThisPage')}</p>
          <ul className="mt-1 space-y-0.5">
            {page.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="hover:text-primary">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {page.sections.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24 space-y-2">
          <h2 id={`${s.id}-title`} className="text-xl font-bold">
            {s.title}
          </h2>
          <Markdown source={s.body} />
        </section>
      ))}
    </>
  );
}

export function CatalogUnavailable({ locale }: { locale: Locale }) {
  const t = getT(locale);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {t('publicTools.docs.catalogUnavailable')}
    </div>
  );
}

const SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO'];

/** Rule table of one engine (severity as text, never colour alone). */
export function EngineRules({ locale, engine }: { locale: Locale; engine: EngineEntry }) {
  const t = getT(locale);
  const rules = [...engine.rules].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.defaultSeverity) - SEVERITY_ORDER.indexOf(b.defaultSeverity) || a.code.localeCompare(b.code)
  );
  const inputCodes = new Set(engine.input_validation_rule_codes);
  return (
    <div className="space-y-4">
      {[false, true].map((validation) => {
        const list = rules.filter((r) => inputCodes.has(r.code) === validation);
        if (list.length === 0) return null;
        return (
          <section key={String(validation)} className="space-y-2">
            <h3 className="text-base font-semibold">
              {validation ? t('publicTools.docs.inputRules') : t('publicTools.docs.rules')} ({list.length})
            </h3>
            <ul className="space-y-2">
              {list.map((r) => {
                // German rule catalog text on /de docs (engine catalog text otherwise).
                const text = localizeRule(locale, r.code, r.title, r.remediation);
                return (
                <li key={r.code} id={r.code} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-xs font-semibold">{r.code}</code>
                    <span className="rounded border border-border px-1 text-[11px]">
                      {t('publicTools.docs.severity')}: {t(`publicTools.severity.${r.defaultSeverity}` as MessageKey)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {t('publicTools.docs.category')}: {r.category}
                    </span>
                  </p>
                  <p className="mt-1 font-medium">{text.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong>{t('publicTools.docs.remediation')}:</strong> {text.remediation}
                  </p>
                </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
