'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CANONICAL_ENGINES,
  EngineStatusItem,
  fetchEngineStatus,
} from '../lib/api-client';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  WifiOff,
  HelpCircle,
  Shield,
  Search,
  RefreshCw,
} from 'lucide-react';
import { useMessages, useT } from '../i18n/client';

const STATUS_CONFIG: Record<
  EngineStatusItem['status'],
  {
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
    badgeClasses: string;
  }
> = {
  OPERATIONAL: {
    icon: CheckCircle2,
    badgeClasses:
      'bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 border-green-200 dark:border-green-800',
  },
  DEGRADED: {
    icon: AlertTriangle,
    badgeClasses:
      'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  STANDBY: {
    icon: Clock,
    badgeClasses:
      'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  },
  OFFLINE: {
    icon: WifiOff,
    badgeClasses:
      'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 border-red-200 dark:border-red-800',
  },
  UNKNOWN: {
    icon: HelpCircle,
    badgeClasses:
      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700',
  },
};

/** API domain names → dictionary keys (`app.engineMatrix.domain.*`). */
const DOMAIN_KEYS: Record<string, 'output' | 'migration' | 'integration' | 'release' | 'operations' | 'warehouse'> = {
  'Output & Extensibility': 'output',
  'Migration & Clean Core': 'migration',
  Integration: 'integration',
  'Release & Transport': 'release',
  Operations: 'operations',
  'Warehouse Automation': 'warehouse',
};

/** Localized engine domain label (unknown domains are shown as delivered by the API). */
export function useEngineDomainLabel(): (domain: string) => string {
  const t = useT();
  return React.useCallback(
    (domain: string) => (DOMAIN_KEYS[domain] ? t(`app.engineMatrix.domain.${DOMAIN_KEYS[domain]}`) : domain),
    [t]
  );
}

export function EngineMatrix() {
  const t = useT();
  const messages = useMessages();
  const domainLabel = useEngineDomainLabel();
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const {
    data: engineData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['engines', 'status'],
    queryFn: fetchEngineStatus,
    staleTime: 1000 * 60,
    retry: 1,
  });

  const fallbackStatus: EngineStatusItem['status'] = isError ? 'OFFLINE' : 'UNKNOWN';

  const engines: EngineStatusItem[] = useMemo(() => {
    if (engineData?.engines && engineData.engines.length > 0) {
      return engineData.engines;
    }
    return CANONICAL_ENGINES.map((eng) => ({
      ...eng,
      status: fallbackStatus,
    }));
  }, [engineData?.engines, fallbackStatus]);

  const domains = ['ALL', ...Object.keys(DOMAIN_KEYS)];
  const describe = (eng: EngineStatusItem) => messages.engines[eng.id] ?? eng.description;

  const filteredEngines = engines.filter((eng) => {
    const matchesDomain =
      selectedDomain === 'ALL' || eng.domain === selectedDomain;
    const matchesSearch =
      eng.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      describe(eng).toLowerCase().includes(searchTerm.toLowerCase()) ||
      eng.id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesDomain && matchesSearch;
  });

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('app.engineMatrix.title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('app.engineMatrix.intro')}
            {engineData?.summary ? (
              <span className="ml-2 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                • {t('app.engineMatrix.active', { active: engineData.summary.operationalCount, total: engineData.summary.totalEngines })}
              </span>
            ) : isError ? (
              <span className="ml-2 font-mono font-semibold text-red-600 dark:text-red-400">
                • {t('app.engineMatrix.disconnected', { total: CANONICAL_ENGINES.length })}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              placeholder={t('app.engineMatrix.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label={t('app.engineMatrix.searchLabel')}
              className="pl-9 pr-3 py-1.5 text-xs bg-muted rounded-lg border border-transparent focus:border-primary focus:outline-none w-full sm:w-48 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 cursor-pointer"
            title={t('app.engineMatrix.refresh')}
            aria-label={t('app.engineMatrix.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Disconnected / Error Alert Banner */}
      {isError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-5 p-4 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40 text-red-800 dark:text-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 shrink-0">
              <WifiOff className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-red-900 dark:text-red-100">
                {t('app.engineMatrix.offlineTitle')}
              </h4>
              <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">
                {error instanceof Error && error.message
                  ? t('app.engineMatrix.offlineWithError', { error: error.message })
                  : t('app.engineMatrix.offlineGeneric')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
            aria-label={t('app.engineMatrix.retryLabel')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isFetching ? t('app.engineMatrix.retrying') : t('app.engineMatrix.retry')}</span>
          </button>
        </div>
      )}

      {/* Domain Filter Pills */}
      <div className="flex flex-wrap gap-1.5 mt-4" role="group" aria-label={t('app.engineMatrix.domainsLabel')}>
        {domains.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setSelectedDomain(d)}
            aria-pressed={selectedDomain === d}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer ${
              selectedDomain === d
                ? 'bg-primary text-white'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {d === 'ALL' ? t('app.engineMatrix.domain.ALL') : domainLabel(d)}
          </button>
        ))}
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5"
          aria-busy="true"
          aria-label={t('app.engineMatrix.loading')}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border border-border/70 rounded-lg p-4 bg-background/50 flex flex-col justify-between animate-pulse min-h-[148px]"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5 w-3/4">
                    <div className="h-2.5 w-24 bg-muted rounded" />
                    <div className="h-4 w-36 bg-muted rounded" />
                  </div>
                  <div className="h-5 w-20 bg-muted rounded" />
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="h-3 w-full bg-muted rounded" />
                  <div className="h-3 w-4/5 bg-muted rounded" />
                </div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                <div className="h-3 w-28 bg-muted rounded" />
                <div className="h-4 w-16 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredEngines.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg mt-5">
          <Search className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">{t('app.engineMatrix.noMatchTitle')}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            {t('app.engineMatrix.noMatchBody', { search: searchTerm })}
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedDomain('ALL');
              setSearchTerm('');
            }}
            className="mt-3 text-xs text-primary font-medium hover:underline cursor-pointer"
          >
            {t('app.engineMatrix.resetFilters')}
          </button>
        </div>
      ) : (
        /* Grid of Engine Cards with Triad Status Representation */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
          {filteredEngines.map((eng) => {
            const statusKey = STATUS_CONFIG[eng.status] ? eng.status : 'UNKNOWN';
            const statusInfo = STATUS_CONFIG[statusKey];
            const StatusIcon = statusInfo.icon;
            return (
              <div
                key={eng.id}
                className="border border-border/70 rounded-lg p-4 bg-background/50 hover:border-primary/50 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">
                        {domainLabel(eng.domain)}
                      </span>
                      <h3 className="font-bold text-sm text-foreground mt-0.5" translate="no">
                        {eng.name}
                      </h3>
                    </div>
                    <span
                      role="status"
                      aria-label={t('app.engineMatrix.statusLabel', { status: t(`app.engineMatrix.statusName.${statusKey}`) })}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border select-none ${statusInfo.badgeClasses}`}
                    >
                      <StatusIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{t(`app.engineMatrix.status.${statusKey}`)}</span>
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                    {describe(eng)}
                  </p>
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50 text-xs">
                  <span className="text-muted-foreground">{domainLabel(eng.domain)}</span>
                  <span className="font-mono text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded break-all">
                    {eng.id}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
