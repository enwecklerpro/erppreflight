import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Network } from 'lucide-react';
import { KnowledgeGraphNav } from '@/components/knowledge-graph/kg-nav';
import { ObjectLookup } from '@/components/knowledge-graph/object-lookup';
import { getRequestLocale } from '@/i18n/server';
import { getT } from '@/i18n/translate';

export const metadata: Metadata = {
  title: 'Knowledge Graph — ERP Preflight',
  robots: { index: false, follow: false },
};

export default async function KnowledgeGraphPage() {
  const t = getT(await getRequestLocale());
  return (
    <div className="space-y-6">
      <KnowledgeGraphNav />
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Network className="size-6 text-primary" aria-hidden="true" /> {t('app.kg.explorer.title')}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('app.kg.explorer.intro')}</p>
      </header>
      <Suspense fallback={<div className="h-11 animate-pulse rounded-xl bg-muted/40" />}>
        <ObjectLookup mode="app" />
      </Suspense>
    </div>
  );
}
