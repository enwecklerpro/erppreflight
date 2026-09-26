'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, Search, ShieldCheck } from 'lucide-react';
import { fetchReleaseMatrix } from '@/lib/api-client';
import { useEngineDomainLabel } from '@/components/engine-matrix';
import { ErrorState } from '@/components/commercial/states';
import { useLabel, useT } from "@/i18n/client";

export default function ReleaseMatrixPage() {
  const t = useT();
  const label = useLabel();
  const domainLabel = useEngineDomainLabel();
  const query = useQuery({ queryKey: ['matrix'], queryFn: fetchReleaseMatrix });
  const matrix = query.data?.matrix ?? [];
  const [search, setSearch] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('ALL');

  const domains = ['ALL', ...Array.from(new Set(matrix.map((m) => m.domain)))];
  const q = search.toLowerCase();
  const filtered = matrix.filter(
    (item) =>
      (selectedDomain === 'ALL' || item.domain === selectedDomain) &&
      (item.engineName.toLowerCase().includes(q) || item.engineId.toLowerCase().includes(q) || item.targetRelease.toLowerCase().includes(q))
  );

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider mb-3 border border-primary/20">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          {t('app.matrix.eyebrow')}
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">{t('app.matrix.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-2xl mx-auto">{t('app.matrix.intro')}</p>
      </div>

      {query.data?.source === 'STATIC_FALLBACK' && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          {t('app.matrix.staticSource')}
        </p>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('app.matrix.searchPlaceholder')}
            aria-label={t('app.matrix.searchLabel')}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('app.matrix.domainsLabel')}>
          {domains.map((dom) => (
            <button
              key={dom}
              type="button"
              aria-pressed={selectedDomain === dom}
              onClick={() => setSelectedDomain(dom)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                selectedDomain === dom ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              {dom === 'ALL' ? t('app.engineMatrix.domain.ALL') : domainLabel(dom)}
            </button>
          ))}
        </div>
      </div>

      {query.isError ? (
        <ErrorState title={t('app.matrix.loadFailed')} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto shadow-sm">
          <table className="w-full text-left text-sm border-collapse min-w-[860px]" aria-label={t('app.matrix.tableLabel')}>
            <thead className="bg-muted/60 text-xs text-muted-foreground font-semibold uppercase tracking-wide border-b border-border">
              <tr>
                <th scope="col" className="p-3">{t('app.matrix.colEngine')}</th>
                <th scope="col" className="p-3">{t('app.matrix.colDomain')}</th>
                <th scope="col" className="p-3">{t('app.matrix.colRelease')}</th>
                <th scope="col" className="p-3">{t('app.matrix.colFormats')}</th>
                <th scope="col" className="p-3">{t('app.matrix.colStatus')}</th>
                <th scope="col" className="p-3 text-right">{t('app.matrix.colFixtures')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">{t('app.matrix.loading')}</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">{t('app.matrix.empty')}</td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const verified = item.status === 'SUPPORTED_VERIFIED';
                  const StatusIcon = verified ? CheckCircle2 : CircleDashed;
                  return (
                    <tr key={item.engineId} className="hover:bg-muted/40 transition-colors align-top">
                      <td className="p-3">
                        <div className="font-bold text-foreground">{item.engineName}</div>
                        <div className="font-mono text-muted-foreground text-xs">{item.engineId}</div>
                      </td>
                      <td className="p-3 text-muted-foreground">{domainLabel(item.domain)}</td>
                      <td className="p-3">
                        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded border border-border">{item.targetRelease}</span>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {item.supportedFormats.map((f) => (
                            <span key={f} className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                              {f}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                            verified ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                          }`}
                        >
                          <StatusIcon className="w-3.5 h-3.5" aria-hidden="true" />
                          {label('app.matrix.status', item.status)}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-foreground whitespace-nowrap">
                        {t('app.matrix.fixtures', { count: item.verifiedFixtures ?? 0 })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
