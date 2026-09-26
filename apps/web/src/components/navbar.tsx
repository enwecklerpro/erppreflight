'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Layers,
  LayoutDashboard,
  FolderGit2,
  SearchCode,
  ShieldCheck,
  ShieldAlert,
  LogOut,
  LogIn,
  Search,
  Sparkles,
  Server,
  Sliders,
  Bot,
  Network,
} from 'lucide-react';
import { NotificationsBell } from './notifications/notifications-bell';
import { fetchCurrentUser } from '../lib/api-client';
import { customInstance } from '../lib/api/custom-instance';
import { useLogout } from '../lib/query/query-provider';

export function Navbar() {
  const pathname = usePathname();
  const logout = useLogout();

  const { data: authData } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 1000 * 60,
  });

  const currentUser = authData?.user;
  const isSuperAdmin = currentUser?.systemRole === 'SUPER_ADMIN';

  const navItems = [
    { label: 'Executive Dashboard', href: '/', icon: LayoutDashboard },
    { label: 'Project Workspaces', href: '/projects', icon: FolderGit2 },
    { label: 'Analysis Inspector', href: '/inspector', icon: SearchCode },
    { label: 'Templates', href: '/templates', icon: Layers },
    { label: 'Artifacts', href: '/artifacts', icon: SearchCode },
    { label: 'Release Matrix', href: '/matrix', icon: ShieldCheck },
    { label: 'Knowledge Graph', href: '/knowledge-graph', icon: Network },
    { label: 'Landscapes', href: '/landscapes', icon: Server },
    { label: 'Agent Gate', href: '/agent-gate', icon: Bot },
    { label: 'Settings', href: '/settings', icon: Sliders },
  ];

  if (isSuperAdmin) {
    navItems.push({
      label: 'Admin Trust Center',
      href: '/admin',
      icon: ShieldAlert,
    });
  }

  const handleLogout = async () => {
    try {
      // Best-effort server-side session invalidation; local eviction runs regardless.
      await customInstance('/auth/logout', { method: 'POST' });
    } catch {
      // ignore — the local token is cleared below either way
    }
    // Cancels in-flight queries, clears the cache, removes the stored token and
    // tenant ID, broadcasts the logout event and redirects to /login.
    await logout('/login');
  };

  const triggerCommandPalette = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: true }));
  };

  return (
    <header className="border-b border-border bg-card sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link href="/" className="flex items-center space-x-3">
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
          </Link>
        </div>

        <nav className="hidden lg:flex space-x-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400 font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center space-x-3 text-xs">
          {/* Cmd+K Search Button */}
          <button
            onClick={triggerCommandPalette}
            className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs"
            title="Search & Commands (Cmd+K)"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="text-[11px]">Search...</span>
            <kbd className="font-mono text-[9px] bg-background border border-border px-1 py-0.2 rounded font-bold">
              ⌘K
            </kbd>
          </button>

          {/* Demo Sandbox Link */}
          <Link
            href="/demo"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 hover:bg-amber-500/20 font-semibold transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Demo Sandbox</span>
          </Link>

          {currentUser ? (
            <div className="flex items-center gap-3">
              <NotificationsBell />
              <div className="hidden xl:flex flex-col items-end">
                <span className="font-semibold text-foreground">{currentUser.email}</span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                    isSuperAdmin
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {currentUser.systemRole}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted font-medium transition-colors"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Login</span>
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg font-medium hover:bg-blue-600 transition-colors shadow-sm"
              >
                <span>Sign Up</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
