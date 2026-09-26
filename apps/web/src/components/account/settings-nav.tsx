'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings2, ShieldCheck, UserCog, Users } from 'lucide-react';

const ITEMS = [
  { href: '/settings', label: 'Workspace', icon: Settings2 },
  { href: '/settings/security', label: 'Security', icon: ShieldCheck },
  { href: '/settings/members', label: 'Members', icon: Users },
  { href: '/settings/account', label: 'Account & privacy', icon: UserCog },
];

/** Secondary navigation between the settings pages (keyboard accessible, current page marked). */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="mb-6 overflow-x-auto">
      <ul className="flex gap-1 border-b border-border min-w-max">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-t ${
                  active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
