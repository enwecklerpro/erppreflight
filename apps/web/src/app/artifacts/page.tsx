'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, Terminal, ExternalLink, Lock, Search } from 'lucide-react';
import { useEngineDomainLabel } from '@/components/engine-matrix';
import { useMessages, useT } from '@/i18n/client';

/** Technical facts per artifact family; the prose (name, summary, export steps) lives in the dictionaries. */
const ARTIFACT_FAMILIES = [
  { id: 'opd-matrix', category: 'Output & Extensibility', formats: ['.xml', '.xlsx', '.json'], engines: ['OPD_GUARD', 'FORM_DOCTOR'], transactions: ['BRF+', 'OPD'] },
  { id: 'form-xdp', category: 'Output & Extensibility', formats: ['.xml', '.xdp', '.pdf'], engines: ['FORM_DOCTOR', 'CUSTOM_FIELD_FLOW_DOCTOR'], transactions: ['SFP', 'SE80'] },
  { id: 'custom-code-abapgit', category: 'Migration & Clean Core', formats: ['.zip', '.abap', '.xml'], engines: ['CLEAN_CORE_OBJECT_GUARD', 'EXTENSION_IMPACT_GUARD'], transactions: ['SE80', 'abapGit', 'SE38'] },
  { id: 'spro-cbc-config', category: 'Migration & Clean Core', formats: ['.csv', '.xlsx', '.json'], engines: ['SPRO2CLOUD', 'SAP_GAP_RADAR'], transactions: ['SPRO', 'SE16N', 'SCU3'] },
  { id: 'api-metadata', category: 'Integration', formats: ['.edmx', '.xml', '.wsdl', '.yaml'], engines: ['API_CHANGE_GUARD'], transactions: ['/IWFND/GW_CLIENT', 'SOAMANAGER', 'SE80'] },
  { id: 'transport-requests', category: 'Release & Transport', formats: ['.csv', '.txt', '.json'], engines: ['TRANSPORT_DEPENDENCY_ANALYZER', 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD'], transactions: ['SE09', 'SE10', 'STMS'] },
  { id: 'mfs-telegrams', category: 'Warehouse Automation', formats: ['.csv', '.log', '.txt'], engines: ['MFS_BLACKBOX'], transactions: ['/SCWM/MFS_TELE', '/SCWM/MON'] },
  { id: 'change-pointer-tbd52', category: 'Integration', formats: ['.csv', '.json', '.xml'], engines: ['CHANGE_POINTER_COVERAGE_AUDITOR'], transactions: ['BD52', 'BD21', 'BD50'] },
] as const;

const CATEGORIES = ['ALL', 'Output & Extensibility', 'Migration & Clean Core', 'Integration', 'Release & Transport', 'Warehouse Automation'];

export default function ArtifactsPage() {
  const t = useT();
  const messages = useMessages();
  const domainLabel = useEngineDomainLabel();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const families = messages.app.artifacts.families;

  const q = searchQuery.toLowerCase();
  const filtered = ARTIFACT_FAMILIES.filter((art) => {
    const text = families[art.id];
    return (
      (selectedCategory === 'ALL' || art.category === selectedCategory) &&
      (text.name.toLowerCase().includes(q) ||
        text.summary.toLowerCase().includes(q) ||
        art.transactions.some((tc) => tc.toLowerCase().includes(q)) ||
        art.engines.some((e) => e.toLowerCase().includes(q)))
    );
  });

  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase font-bold tracking-wider text-primary px-2 py-0.5 bg-primary/10 rounded">{t('app.artifacts.eyebrow')}</span>
          <span className="text-xs text-muted-foreground">{t('app.artifacts.noPii')}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{t('app.artifacts.title')}</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">{t('app.artifacts.intro')}</p>
      </div>

      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-6 w-6 text-emerald-600 shrink-0" aria-hidden="true" />
          <div className="text-sm space-y-0.5">
            <span className="font-bold text-foreground">{t('app.artifacts.securityTitle')}</span>
            <p className="text-muted-foreground">{t('app.artifacts.securityBody')}</p>
          </div>
        </div>
        <Link href="/trust" className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline shrink-0">
          {t('app.artifacts.trustLink')}
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            placeholder={t('app.artifacts.searchPlaceholder')}
            aria-label={t('app.artifacts.searchLabel')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('app.artifacts.categoriesLabel')}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={selectedCategory === cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                selectedCategory === cat ? 'bg-primary text-white font-semibold shadow-sm' : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {cat === 'ALL' ? t('app.artifacts.allCategories') : domainLabel(cat)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('app.artifacts.empty')}</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((art) => {
            const text = families[art.id];
            return (
              <li key={art.id} className="rounded-xl border border-border bg-card p-5 sm:p-6 flex flex-col justify-between hover:border-primary/50 transition-colors shadow-sm space-y-4 min-w-0">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-bold uppercase tracking-wider text-primary">{domainLabel(art.category)}</span>
                      <h2 className="text-base font-bold text-foreground mt-0.5">{text.name}</h2>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {art.formats.map((f) => (
                        <span key={f} className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{text.summary}</p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs font-bold uppercase text-muted-foreground">{t('app.artifacts.tcodes')}</span>
                    {art.transactions.map((tc) => (
                      <span key={tc} className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-900/50">
                        {tc}
                      </span>
                    ))}
                  </div>
                  <div className="p-3 bg-muted/40 rounded-lg border border-border/60 text-sm space-y-1.5">
                    <h3 className="font-semibold text-foreground flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      <span>{t('app.artifacts.howTo')}</span>
                    </h3>
                    <ol className="list-decimal pl-4 space-y-1 text-muted-foreground text-xs break-words">
                      {text.steps.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>
                  </div>
                  <p className="flex items-start gap-2 text-xs text-muted-foreground pt-1">
                    <Lock className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{text.note}</span>
                  </p>
                </div>
                <div className="pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground uppercase">{t('app.artifacts.engines')}</span>
                    <span className="font-mono text-xs text-foreground font-semibold break-all">{art.engines.join(', ')}</span>
                  </div>
                  <Link
                    href="/projects"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm"
                  >
                    <span>{t('app.artifacts.upload')}</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
