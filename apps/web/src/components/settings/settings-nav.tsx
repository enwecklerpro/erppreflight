'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreditCard, History, Key, Trash2 } from 'lucide-react';

const ITEMS = [
  { href: '/settings', label: 'Developer & AI', icon: Key },
  { href: '/settings/billing', label: 'Plan & billing', icon: CreditCard },
  { href: '/settings/audit', label: 'Audit log', icon: History },
  { href: '/settings/retention', label: 'Data retention', icon: Trash2 },
] as const;

/** Secondary navigation shared by all organization settings pages. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Organization settings" className="mb-6 overflow-x-auto">
      <ul className="flex gap-1 border-b border-border min-w-max">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-t ${
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default SettingsNav;
