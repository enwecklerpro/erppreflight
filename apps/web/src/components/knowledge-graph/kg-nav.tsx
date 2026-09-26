'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Eye, GitCompareArrows, Globe, Search } from 'lucide-react';
import { ApiError } from '@/lib/api/custom-instance';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useErrorText, useT } from '@/i18n/client';

const ITEMS = [
  { href: '/knowledge-graph', key: 'explorer', icon: Search, exact: true },
  { href: '/knowledge-graph/releases', key: 'releases', icon: GitCompareArrows },
  { href: '/knowledge-graph/watches', key: 'watches', icon: Eye },
  { href: '/knowledge-graph/lookup', key: 'lookup', icon: Globe },
] as const;

export function KnowledgeGraphNav() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav aria-label={t('app.kg.nav.label')} className="flex flex-wrap gap-1 border-b border-border pb-2">
      {ITEMS.map((it) => {
        const active = 'exact' in it ? pathname === it.href : pathname.startsWith(it.href);
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {t(`app.kg.nav.${it.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Contextual error with retry; 401 offers sign-in instead of a dead end. */
export function QueryErrorState({ error, onRetry, title }: { error: unknown; onRetry: () => void; title: string }) {
  const t = useT();
  const errText = useErrorText();
  const unauthorized = error instanceof ApiError && (error.statusCode === 401 || error.statusCode === 403);
  return (
    <div role="alert" className="flex flex-wrap items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-destructive/90">{unauthorized ? t('app.kg.error.unauthorized') : errText(error, t('app.kg.error.unknown'))}</p>
      </div>
      {unauthorized ? (
        <Link href="/login" className="rounded-md border border-destructive/40 px-2 py-1 text-xs">
          {t('app.kg.error.signIn')}
        </Link>
      ) : (
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs">
          <RefreshCw className="size-3" aria-hidden="true" /> {t('app.kg.error.retry')}
        </button>
      )}
    </div>
  );
}
