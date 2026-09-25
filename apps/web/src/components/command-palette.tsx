'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Command,
  Layers,
  ShieldCheck,
  Server,
  BookOpen,
  Folder,
  ArrowRight,
  Sparkles,
  Sliders,
} from 'lucide-react';
import { CANONICAL_ENGINES } from '@/lib/api-client';

interface CommandItem {
  id: string;
  category: 'NAVIGATION' | 'ENGINE' | 'TOOL';
  title: string;
  subtitle: string;
  href: string;
}

export function CommandPalette() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut listener for Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const items: CommandItem[] = [
    { id: 'nav-dashboard', category: 'NAVIGATION', title: 'Executive Dashboard', subtitle: 'View Clean Core Index and Project Summaries', href: '/' },
    { id: 'nav-inspector', category: 'NAVIGATION', title: 'Universal Findings Inspector', subtitle: 'Search all findings, rules, and cryptographic evidence', href: '/inspector' },
    { id: 'nav-templates', category: 'TOOL', title: 'Analysis Templates Catalog', subtitle: 'Standardized preflight templates across all SAP domains', href: '/templates' },
    { id: 'nav-artifacts', category: 'NAVIGATION', title: 'SAP-Native Artifact Ingestion Center', subtitle: 'Step-by-step export instructions & file specs for SAP artifacts', href: '/artifacts' },
    { id: 'nav-changelog', category: 'NAVIGATION', title: 'Product & Knowledge Changelog', subtitle: 'Platform release notes and SAP knowledge snapshot history', href: '/changelog' },
    { id: 'nav-feedback', category: 'TOOL', title: 'Feature Requests & Gap Voting', subtitle: 'Vote on upcoming capabilities and SAP gap closures', href: '/feedback' },
    { id: 'nav-matrix', category: 'NAVIGATION', title: 'Release Compatibility Matrix', subtitle: 'Check engine support across S/4HANA releases', href: '/matrix' },
    { id: 'nav-demo', category: 'TOOL', title: 'Launch Demo Sandbox', subtitle: 'Explore all 7 synthetic failure scenarios', href: '/demo' },
    { id: 'nav-landscapes', category: 'NAVIGATION', title: 'Enterprise Landscape Registry', subtitle: 'Manage DEV, QA, and PROD SAP systems', href: '/landscapes' },
    { id: 'nav-procurement', category: 'NAVIGATION', title: 'Procurement & Assurance Portal', subtitle: 'Download Security Overview, DPA, and CycloneDX SBOM', href: '/procurement' },
    { id: 'nav-settings', category: 'NAVIGATION', title: 'Developer Settings & API Keys', subtitle: 'Manage organization API keys and webhooks', href: '/settings' },
    { id: 'nav-status', category: 'NAVIGATION', title: 'System Status Page', subtitle: 'Live uptime and telemetry for all services', href: '/status' },
    { id: 'nav-trust', category: 'NAVIGATION', title: 'Trust Center', subtitle: 'Security overview, subprocessors, and compliance', href: '/trust' },
    { id: 'nav-docs', category: 'NAVIGATION', title: 'Documentation & CLI Guide', subtitle: 'Read API and CLI developer references', href: '/docs' },
    ...CANONICAL_ENGINES.map((eng) => ({
      id: `eng-${eng.id}`,
      category: 'ENGINE' as const,
      title: eng.name,
      subtitle: `${eng.domain} • ${eng.description}`,
      href: `/inspector?engine=${eng.id}`,
    })),
  ];

  const filtered = items.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.subtitle.toLowerCase().includes(query.toLowerCase())
  );

  function handleSelect(href: string) {
    setIsOpen(false);
    router.push(href);
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      handleSelect(filtered[selectedIndex].href);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 px-4">
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input Bar */}
        <div className="relative border-b border-slate-800 flex items-center px-4">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command, search engines, or jump to page... (ESC to close)"
            className="w-full bg-transparent px-3 py-4 text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-400 bg-slate-800 border border-slate-700 rounded">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No matching commands or engines found for "{query}"
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.href)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full text-left p-3 rounded-xl flex items-center justify-between transition-colors ${
                      isSelected ? 'bg-emerald-500/10 border border-emerald-500/30 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase ${
                            item.category === 'ENGINE'
                              ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                              : item.category === 'TOOL'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {item.category}
                        </span>
                        <span className="font-semibold text-sm">{item.title}</span>
                      </div>
                      <div className="text-xs text-slate-400 truncate max-w-lg mt-0.5">{item.subtitle}</div>
                    </div>
                    {isSelected && <ArrowRight className="w-4 h-4 text-emerald-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
