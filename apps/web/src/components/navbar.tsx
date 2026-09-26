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
  BookOpen,
  Tag,
  Boxes,
  Lock,
  PlayCircle,
  FileBox,
  FileText,
  CreditCard,
  ScrollText,
  Archive,
  LifeBuoy,
} from 'lucide-react';
import { NavMoreMenu, type NavLinkItem } from './nav-more-menu';
import { fetchCurrentUser } from '../lib/api-client';
import { customInstance, getStoredAuthToken, setAuthHintCookie } from '../lib/api/custom-instance';
import { useLogout } from '../lib/query/query-provider';
import { useLocale, useT } from '../i18n/client';
import { localizePath } from '../lib/routing';
import { LanguageSwitcher } from './public/language-switcher';

export function Navbar() {
  const pathname = usePathname() || '/';
  const logout = useLogout();
  const t = useT();
  const locale = useLocale();

  // Sessions created before the auth marker cookie existed: restore it so the
  // middleware navigation guard recognises the signed-in user.
  React.useEffect(() => {
    if (getStoredAuthToken() && !document.cookie.includes('erp_auth=')) {
      setAuthHintCookie(true);
    }
  }, []);

  const { data: authData } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 1000 * 60,
  });

  const currentUser = authData?.user;
  const isSuperAdmin = currentUser?.systemRole === 'SUPER_ADMIN';

  // Part 01 §1.3: a short primary bar (Home, Projects, Analyze, Knowledge[, Reports])
  // and secondary areas in a menu. Items appear only when their page exists:
  // Reports, Notifications, Integrations and Billing have no page yet.
  // "Analyze" leads to the project workspaces, where the analysis launcher lives.
  const appPrimary: NavLinkItem[] = [
    { key: 'dashboard', label: t('nav.dashboard'), href: '/dashboard', icon: LayoutDashboard },
    { key: 'projects', label: t('nav.projects'), href: '/projects', icon: FolderGit2 },
    { key: 'analyze', label: t('nav.analyze'), href: '/projects', icon: PlayCircle },
    { key: 'knowledge', label: t('nav.knowledge'), href: localizePath(locale, '/knowledge'), icon: BookOpen },
  ];
  const appSecondary: NavLinkItem[] = [
    { key: 'inspector', label: t('nav.inspector'), href: '/inspector', icon: SearchCode },
    { key: 'templates', label: t('nav.templates'), href: '/templates', icon: Layers },
    { key: 'artifacts', label: t('nav.artifacts'), href: '/artifacts', icon: FileBox },
    { key: 'landscapes', label: t('nav.landscapes'), href: '/landscapes', icon: Server },
    { key: 'agent-gate', label: t('nav.agentGate'), href: '/agent-gate', icon: Bot },
    { key: 'matrix', label: t('nav.matrix'), href: '/matrix', icon: ShieldCheck },
    { key: 'settings', label: t('nav.settings'), href: '/settings', icon: Sliders },
    { key: 'billing', label: t('nav.billing'), href: '/settings/billing', icon: CreditCard },
    { key: 'audit', label: t('nav.audit'), href: '/settings/audit', icon: ScrollText },
    { key: 'retention', label: t('nav.retention'), href: '/settings/retention', icon: Archive },
    { key: 'support', label: t('nav.support'), href: '/settings/support', icon: LifeBuoy },
  ];
  if (isSuperAdmin) {
    appSecondary.push({ key: 'admin', label: t('nav.admin'), href: '/admin', icon: ShieldAlert });
  }

  const publicPrimary: NavLinkItem[] = [
    { key: 'solutions', label: t('nav.solutions'), href: localizePath(locale, '/solutions'), icon: Boxes },
    { key: 'pricing', label: t('nav.pricing'), href: localizePath(locale, '/pricing'), icon: Tag },
    { key: 'knowledge', label: t('nav.knowledge'), href: localizePath(locale, '/knowledge'), icon: BookOpen },
    { key: 'security', label: t('nav.security'), href: localizePath(locale, '/security'), icon: Lock },
    { key: 'docs', label: t('nav.docs'), href: '/docs', icon: FileText },
  ];
  const publicSecondary: NavLinkItem[] = [
    { key: 'matrix', label: t('nav.matrix'), href: '/matrix', icon: ShieldCheck },
    { key: 'demo', label: t('nav.demo'), href: '/demo', icon: Sparkles },
  ];

  const navItems = currentUser ? appPrimary : publicPrimary;
  const secondaryItems = currentUser ? appSecondary : publicSecondary;
  const homeHref = currentUser ? '/dashboard' : localizePath(locale, '/');
  const hrefPath = (href: string) => href.split('?')[0];

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
          <Link href={homeHref} className="flex items-center space-x-3" aria-label={t('common.brand')}>
            <div className="bg-primary text-white p-2 rounded-lg shadow-sm">
              <Layers className="h-6 w-6" />
            </div>
            <span className="text-xl font-bold tracking-tight text-foreground whitespace-nowrap">
              ERP Preflight
            </span>
          </Link>
        </div>

        <nav className="hidden lg:flex space-x-1" aria-label={t('nav.primary')}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const path = hrefPath(item.href);
            // "Analyze" shares /projects; only "Projects" is marked current there.
            const active =
              item.key !== 'analyze' && (pathname === path || pathname.startsWith(`${path}/`));

            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400 font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center space-x-3 text-xs">
          <NavMoreMenu
            label={t('nav.more')}
            menuLabel={t('nav.secondary')}
            primary={navItems}
            secondary={secondaryItems}
          />
          {/* Cmd+K Search Button */}
          <button
            onClick={triggerCommandPalette}
            className="hidden md:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs"
            title={t('nav.searchTitle')}
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-[11px]">{t('nav.search')}</span>
            <kbd className="font-mono text-[9px] bg-background border border-border px-1 py-0.2 rounded font-bold">
              ⌘K
            </kbd>
          </button>

          {/* Demo Sandbox Link */}
          <Link
            href="/demo"
            className="hidden xl:inline-flex whitespace-nowrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 hover:bg-amber-500/20 font-semibold transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{t('nav.demo')}</span>
          </Link>

          <LanguageSwitcher />

          {currentUser ? (
            <div className="flex items-center gap-3">
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
                title={t('nav.logoutTitle')}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t('nav.logout')}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted font-medium transition-colors"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('nav.login')}</span>
              </Link>
              <Link
                href="/signup"
                className="inline-flex whitespace-nowrap items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg font-medium hover:bg-blue-600 transition-colors shadow-sm"
              >
                <span>{t('nav.signup')}</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
