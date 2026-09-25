'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  FolderKanban,
  Boxes,
  Play,
  GitCompare,
  Layers,
  Activity,
  ShieldCheck,
  FileSpreadsheet,
  ThumbsUp,
  Sparkles,
  Command,
  ArrowRight,
  X,
} from 'lucide-react';
import { fetchProjects, ProjectListItem } from '@/lib/api-client';
import type { Project } from '@erppreflight/schemas';

interface PaletteItem {
  id: string;
  title: string;
  category: 'NAVIGATION' | 'PROJECTS' | 'SAP_OBJECTS' | 'ENGINES';
  description?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STATIC_ACTIONS: PaletteItem[] = [
  {
    id: 'nav-projects',
    title: 'Project Workspaces',
    category: 'NAVIGATION',
    description: 'Browse all active SAP preflight workspaces and migrations',
    href: '/projects',
    icon: FolderKanban,
  },
  {
    id: 'nav-demo',
    title: 'Explore Demo Sandbox',
    category: 'NAVIGATION',
    description: 'Launch pre-configured sandbox with synthetic OPD & Clean Core failures',
    href: '/demo',
    icon: Sparkles,
  },
  {
    id: 'nav-templates',
    title: 'Preflight Analysis Templates',
    category: 'NAVIGATION',
    description: 'Reusable enterprise assessment profiles (PO Email, Clean Core scan)',
    href: '/templates',
    icon: FileSpreadsheet,
  },
  {
    id: 'nav-matrix',
    title: 'SAP Release Compatibility Matrix',
    category: 'NAVIGATION',
    description: 'Verified matrix across all 19 engines x S/4HANA & ECC 6.0 releases',
    href: '/matrix',
    icon: ShieldCheck,
  },
  {
    id: 'nav-status',
    title: 'Service Health & Telemetry Status',
    category: 'NAVIGATION',
    description: 'Live probe of Next.js web, API, Redis queues, and Python workers',
    href: '/status',
    icon: Activity,
  },
  {
    id: 'nav-feedback',
    title: 'Feedback & Gap Radar Voting',
    category: 'NAVIGATION',
    description: 'Request new preflight rules or vote on migration feature requests',
    href: '/feedback',
    icon: ThumbsUp,
  },
  {
    id: 'nav-admin',
    title: 'Super Admin Trust Center',
    category: 'NAVIGATION',
    description: 'Multi-tenant metrics, BullMQ queues, and engine telemetry',
    href: '/admin',
    icon: ShieldCheck,
  },
  // Engine Quick Launch
  {
    id: 'eng-opd',
    title: 'Engine: OPD Guard',
    category: 'ENGINES',
    description: 'Output Parameter Determination & dispatch channel verifier',
    href: '/matrix',
    icon: Play,
  },
  {
    id: 'eng-clean-core',
    title: 'Engine: Clean Core Object Guard',
    category: 'ENGINES',
    description: 'Tier 1/2/3 extensibility, unreleased APIs & direct DB mutations',
    href: '/matrix',
    icon: Play,
  },
  {
    id: 'eng-form',
    title: 'Engine: Form Doctor',
    category: 'ENGINES',
    description: 'Adobe Document Services (ADS) LiveCycle schema & binding auditor',
    href: '/matrix',
    icon: Play,
  },
  {
    id: 'eng-mfs',
    title: 'Engine: MFS BlackBox',
    category: 'ENGINES',
    description: 'SAP EWM Material Flow Systems telegram buffer diagnostics',
    href: '/matrix',
    icon: Play,
  },
  // SAP Objects Quick Search
  {
    id: 'obj-sales-order',
    title: 'Z_I_SalesOrderEnhanced (CDS Entity)',
    category: 'SAP_OBJECTS',
    description: 'Clean Core Tier 1 Cloud CDS view extending I_SalesOrder',
    href: '/inspector',
    icon: Boxes,
  },
  {
    id: 'obj-po-engine',
    title: 'ZCL_PURCHASE_ORDER_ENGINE (ABAP Class)',
    category: 'SAP_OBJECTS',
    description: 'Clean Core Tier 2 Developer extensibility class',
    href: '/inspector',
    icon: Boxes,
  },
  {
    id: 'obj-bkpf-mutation',
    title: 'ZR_BILLING_OUTPUT_DISPATCH (Report)',
    category: 'SAP_OBJECTS',
    description: 'Clean Core Tier 3 Classic legacy direct Open SQL mutation into BKPF',
    href: '/inspector',
    icon: Boxes,
  },
];

export function CommandPalette() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);

  // Load projects for dynamic search
  useEffect(() => {
    async function load() {
      try {
        const list = await fetchProjects();
        setProjects(list);
      } catch {
        // Ignored in background
      }
    }
    load();
  }, []);

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

  // Combine dynamic project items with static items
  const allItems: PaletteItem[] = useMemo(() => {
    const projectItems: PaletteItem[] = projects.map((p) => ({
      id: `proj-${p.id}`,
      title: p.name,
      category: 'PROJECTS',
      description: `Target Release: ${p.targetRelease} • ID: ${p.id.slice(0, 8)}...`,
      href: `/projects/${p.id}`,
      icon: FolderKanban,
    }));
    return [...projectItems, ...STATIC_ACTIONS];
  }, [projects]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 12);
    const q = query.toLowerCase();
    return allItems
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [allItems, query]);

  // Reset selected index when filtered items change
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

  // Arrow key navigation inside palette
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-950/80 backdrop-blur-sm transition-all"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-800 bg-slate-950/50">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command, search SAP objects, projects, or engines..."
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            aria-label="Search command input"
          />
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label="Close command palette"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 divide-y divide-slate-800/40">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              No matching commands or objects found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
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
                        isSelected
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate flex items-center gap-2">
                        <span>{item.title}</span>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                          {item.category.replace('_', ' ')}
                        </span>
                      </div>
                      {item.description && (
                        <div className="text-xs text-slate-400 truncate mt-0.5">
                          {item.description}
                        </div>
                      )}
                    </div>
                  </div>

                  <ArrowRight
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      isSelected ? 'text-emerald-400 translate-x-0.5' : 'text-slate-600'
                    }`}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2.5 bg-slate-950/70 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                ↑↓
              </kbd>{' '}
              Navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                ↵
              </kbd>{' '}
              Select
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                ESC
              </kbd>{' '}
              Close
            </span>
          </div>
          <span className="flex items-center gap-1 font-mono">
            <Command className="w-3 h-3" />K
          </span>
        </div>
      </div>
    </div>
  );
}
