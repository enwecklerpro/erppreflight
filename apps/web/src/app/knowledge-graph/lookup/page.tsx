import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { ObjectLookup } from '@/components/knowledge-graph/object-lookup';
import { getRequestLocale } from '@/i18n/server';
import { getT } from '@/i18n/translate';

export const metadata: Metadata = {
  title: 'Clean Core Object Lookup — is this SAP object released for ABAP Cloud? | ERP Preflight',
  description:
    'Free lookup of SAP tables, CDS views, classes, function modules and BAdIs: release state per SAP Cloud ERP / Private edition release and the official successor, from the SAP Cloudification Repository.',
  alternates: { canonical: '/knowledge-graph/lookup' },
  // Overrides the private knowledge-graph layout: this free tool is public and indexable.
  robots: { index: true, follow: true },
};

/**
 * Public free tool (Part 01 §1.11): only global, reviewed knowledge is served
 * (the API filters to GLOBAL + PUBLISHED rows); rate limited per IP.
 */
export default async function PublicLookupPage() {
  const t = getT(await getRequestLocale());
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2 text-center">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <ShieldCheck className="size-3.5" aria-hidden="true" /> {t('app.kg.publicLookup.badge')}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">{t('app.kg.publicLookup.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('app.kg.publicLookup.intro')}</p>
      </header>
      <Suspense fallback={<div className="h-11 animate-pulse rounded-xl bg-muted/40" />}>
        <ObjectLookup mode="public" />
      </Suspense>
      <aside className="rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold">{t('app.kg.publicLookup.ctaTitle')}</p>
        <p className="mt-1 text-muted-foreground">{t('app.kg.publicLookup.ctaBody')}</p>
        <Link href="/signup" className="mt-2 inline-flex items-center gap-1 text-primary hover:underline">
          {t('app.kg.publicLookup.ctaLink')} <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </aside>
      <p className="text-center text-xs text-muted-foreground">{t('app.kg.publicLookup.disclaimer')}</p>
    </div>
  );
}
