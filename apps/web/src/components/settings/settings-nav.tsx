'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreditCard, History, Key, LifeBuoy, ShieldCheck, Trash2, UserCog, Users } from 'lucide-react';
import { useT } from '@/i18n/client';

const ITEMS = [
  { href: '/settings', key: 'workspace', icon: Key },
  { href: '/settings/members', key: 'members', icon: Users },
  { href: '/settings/security', key: 'security', icon: ShieldCheck },
  { href: '/settings/account', key: 'account', icon: UserCog },
  { href: '/settings/billing', key: 'billing', icon: CreditCard },
  { href: '/settings/audit', key: 'audit', icon: History },
  { href: '/settings/retention', key: 'retention', icon: Trash2 },
  { href: '/settings/support', key: 'support', icon: LifeBuoy },
] as const;

/** Secondary navigation shared by all organization settings pages. */
export function SettingsNav() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav aria-label={t('app.settings.nav.label')} className="mb-6 overflow-x-auto">
      <ul className="flex gap-1 border-b border-border min-w-max">
        {ITEMS.map(({ href, key, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-t ${
                  active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {t(`app.settings.nav.${key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default SettingsNav;
