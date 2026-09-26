'use client';

import Link from 'next/link';
import { ArrowRight, Bot, BookOpen, DatabaseZap, ListChecks } from 'lucide-react';
import { useT } from '@/i18n/client';

const LINKS = [
  { href: '/admin/rules', key: 'rules', icon: ListChecks },
  { href: '/admin/ai', key: 'ai', icon: Bot },
  { href: '/admin/knowledge', key: 'knowledge', icon: BookOpen },
  { href: '/admin/sources', key: 'sources', icon: DatabaseZap },
] as const;

/** Entry points to the platform governance screens (spec 10.9–10.12) on the admin portal. */
export function GovernanceLinks() {
  const t = useT();
  return (
    <nav aria-labelledby="governance-links-title" className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3" data-testid="governance-links">
      <div>
        <h2 id="governance-links-title" className="text-base font-bold">{t('app.governance.nav.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('app.governance.nav.intro')}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LINKS.map(({ href, key, icon: Icon }) => (
          <li key={key}>
            <Link
              href={href}
              className="flex h-full items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-semibold">
                  {t(`app.governance.nav.${key}`)} <ArrowRight className="size-3.5" aria-hidden="true" />
                </span>
                <span className="block text-xs text-muted-foreground">{t(`app.governance.nav.${key}Hint`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
