import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Network } from 'lucide-react';
import { KnowledgeGraphNav } from '@/components/knowledge-graph/kg-nav';
import { ObjectLookup } from '@/components/knowledge-graph/object-lookup';

export const metadata: Metadata = {
  title: 'Knowledge Graph — ERP Preflight',
  robots: { index: false, follow: false },
};

export default function KnowledgeGraphPage() {
  return (
    <div className="space-y-6">
      <KnowledgeGraphNav />
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Network className="size-6 text-primary" aria-hidden="true" /> SAP knowledge graph
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Release-aware SAP object knowledge from immutable snapshots of the official SAP Cloudification Repository,
          plus your organization&apos;s customer objects. Every state carries its evidence source and trust level.
        </p>
      </header>
      <Suspense fallback={<div className="h-11 animate-pulse rounded-xl bg-muted/40" />}>
        <ObjectLookup mode="app" />
      </Suspense>
    </div>
  );
}
