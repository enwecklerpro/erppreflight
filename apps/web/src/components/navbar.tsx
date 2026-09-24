'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Layers,
  LayoutDashboard,
  FolderGit2,
  SearchCode,
  ShieldCheck,
} from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();

  const navItems = [
    { label: 'Executive Dashboard', href: '/', icon: LayoutDashboard },
    { label: 'Project Workspaces', href: '/projects', icon: FolderGit2 },
    { label: 'Analysis Inspector', href: '/inspector', icon: SearchCode },
  ];

  return (
    <header className="border-b border-border bg-card sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-primary text-white p-2 rounded-lg shadow-sm">
            <Layers className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-foreground">
              ERP Preflight
            </span>
            <span className="hidden sm:inline-block ml-2 text-xs uppercase px-2 py-0.5 font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 rounded">
              Astra Ultra SaaS
            </span>
          </div>
        </div>

        <nav className="flex space-x-1 sm:space-x-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center space-x-3 text-xs text-muted-foreground">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300 rounded-full border border-green-200 dark:border-green-800">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="font-medium">18 Engines Operational</span>
          </div>
        </div>
      </div>
    </header>
  );
}
