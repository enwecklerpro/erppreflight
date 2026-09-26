'use client';

import React, { useState, useEffect, useCallback, useMemo, useId } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  FolderKanban,
  Play,
  Activity,
  ShieldCheck,
  FileSpreadsheet,
  ThumbsUp,
  Sparkles,
  Command,
  ArrowRight,
  X,
  Settings,
  Bell,
  Network,
} from 'lucide-react';
import { CANONICAL_ENGINES, fetchProjects } from '@/lib/api-client';
import { hasAuthHint } from '@/lib/api/custom-instance';
import { useMessages, useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';

type Category = 'NAVIGATION' | 'PROJECTS' | 'ENGINES';

interface PaletteItem {
  id: string;
  title: string;
  category: Category;
  description?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: Array<{ id: string; key: string; href: string; icon: PaletteItem['icon'] }> = [
  { id: 'nav-dashboard', key: 'dashboard', href: '/dashboard', icon: Activity },
  { id: 'nav-projects', key: 'projects', href: '/projects', icon: FolderKanban },
  { id: 'nav-templates', key: 'templates', href: '/templates', icon: FileSpreadsheet },
  { id: 'nav-matrix', key: 'matrix', href: '/matrix', icon: ShieldCheck },
  { id: 'nav-kg', key: 'knowledgeGraph', href: '/knowledge-graph', icon: Network },
  { id: 'nav-notifications', key: 'notifications', href: '/notifications', icon: Bell },
  { id: 'nav-settings', key: 'settings', href: '/settings', icon: Settings },
  { id: 'nav-status', key: 'status', href: '/status', icon: Activity },
  { id: 'nav-feedback', key: 'feedback', href: '/feedback', icon: ThumbsUp },
  { id: 'nav-demo', key: 'demo', href: '/demo', icon: Sparkles },
];

export function CommandPalette() {
  const router = useRouter();
  const t = useT();
  const messages = useMessages();
  const listId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Projects are searched only while the palette is open and a session exists.
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    enabled: isOpen && hasAuthHint(),
    staleTime: 60_000,
    retry: false,
  });

  // Keyboard shortcut listener (Cmd+K / Ctrl+K)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const categoryLabel = useCallback(
    (c: Category) => t(`app.shell.palette.category.${c}` as MessageKey),
    [t]
  );

  const allItems: PaletteItem[] = useMemo(() => {
    const nav: PaletteItem[] = NAV_ITEMS.map((n) => ({
      id: n.id,
      title: t(`app.shell.palette.nav.${n.key}.title` as MessageKey),
      description: t(`app.shell.palette.nav.${n.key}.description` as MessageKey),
      category: 'NAVIGATION',
      href: n.href,
      icon: n.icon,
    }));
    const projectItems: PaletteItem[] = projects.map((p) => ({
      id: `proj-${p.id}`,
      title: p.name,
      category: 'PROJECTS',
      description: t('app.shell.palette.projectDescription', { release: p.targetRelease ?? '—' }),
      href: `/projects/${p.id}`,
      icon: FolderKanban,
    }));
    const engines: PaletteItem[] = CANONICAL_ENGINES.map((e) => ({
      id: `eng-${e.id}`,
      title: e.name,
      category: 'ENGINES',
      description: messages.engines[e.id] ?? e.description,
      href: '/matrix',
      icon: Play,
    }));
    return [...projectItems, ...nav, ...engines];
  }, [projects, t, messages]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 12);
    const q = query.toLowerCase();
    return allItems
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          categoryLabel(item.category).toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [allItems, query, categoryLabel]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems]);

  const handleSelect = useCallback(
    (item: PaletteItem) => {
      setIsOpen(false);
      setQuery('');
      router.push(item.href);
    },
    [router]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
      e.preventDefault();
      handleSelect(filteredItems[selectedIndex]);
    }
  };

  if (!isOpen) return null;

  const activeId = filteredItems[selectedIndex] ? `${listId}-${filteredItems[selectedIndex].id}` : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('app.shell.palette.title')}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-950/80 backdrop-blur-sm transition-all motion-reduce:transition-none"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-800 bg-slate-950/50">
          <Search className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t('app.shell.palette.placeholder')}
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            aria-label={t('app.shell.palette.inputLabel')}
          />
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            aria-label={t('app.shell.palette.close')}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div id={listId} role="listbox" aria-label={t('app.shell.palette.results')} className="max-h-96 overflow-y-auto p-2 divide-y divide-slate-800/40">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              {t('app.shell.palette.noMatches', { query })}
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  id={`${listId}-${item.id}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-white'
                      : 'hover:bg-slate-800/50 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        isSelected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate flex items-center gap-2">
                        <span className="truncate">{item.title}</span>
                        <span className="text-[11px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
                          {categoryLabel(item.category)}
                        </span>
                      </div>
                      {item.description && <div className="text-xs text-slate-400 truncate mt-0.5">{item.description}</div>}
                    </div>
                  </div>

                  <ArrowRight
                    aria-hidden="true"
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      isSelected ? 'text-emerald-400 translate-x-0.5' : 'text-slate-600'
                    }`}
                  />
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-2.5 bg-slate-950/70 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">↑↓</kbd>{' '}
              {t('app.shell.palette.navigate')}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">↵</kbd>{' '}
              {t('app.shell.palette.select')}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">Esc</kbd>{' '}
              {t('app.ui.close')}
            </span>
          </div>
          <span className="flex items-center gap-1 font-mono" aria-hidden="true">
            <Command className="w-3 h-3" />K
          </span>
        </div>
      </div>
    </div>
  );
}
