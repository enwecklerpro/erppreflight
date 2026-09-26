'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Cpu, Layers, ArrowRight, TrendingUp, AlertTriangle, RefreshCw, FolderGit2, Clock } from 'lucide-react';
import { MetricsCard } from '../../components/metrics-card';
import { EngineMatrix } from '../../components/engine-matrix';
import { fetchDashboardSummary, fetchCurrentUser, DashboardSummaryData } from '../../lib/api-client';
import { useFmt, useT } from '../../i18n/client';

export default function ExecutiveDashboard() {
  const t = useT();
  const fmt = useFmt();
  const { data: authData, isLoading: authLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 1000 * 60,
  });

  const isAuthenticated = !!authData?.user;

  const {
    data: summary,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<DashboardSummaryData>({
    queryKey: ['dashboard', 'summary'],
    queryFn: fetchDashboardSummary,
    enabled: isAuthenticated,
    staleTime: 1000 * 30,
    retry: 1,
  });

  const cleanCore = summary?.cleanCoreIndex;
  const engines = summary?.enginesSummary;

  return (
    <div className="space-y-8">
      <div className="bg-gradient-to-r from-blue-900 to-indigo-950 text-white rounded-2xl p-6 sm:p-8 shadow-md">
        <div className="max-w-3xl">
          <span className="text-xs uppercase font-bold tracking-wider text-blue-300">{t('app.dashboard.eyebrow')}</span>
          <h1 className="text-2xl sm:text-3xl font-extrabold mt-1">{t('app.dashboard.title')}</h1>
          <p className="mt-3 text-sm text-blue-100 leading-relaxed">{t('app.dashboard.intro')}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {t('app.dashboard.openProjects')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Link
              href="/inspector"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 text-white text-sm font-semibold rounded-lg hover:bg-white/20 transition-colors backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {t('app.dashboard.openInspector')}
            </Link>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching || !isAuthenticated}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white/5 text-white/80 hover:text-white text-sm font-semibold rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={t('app.dashboard.refreshLabel')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              {t('app.dashboard.refresh')}
            </button>
          </div>
        </div>
      </div>

      {!isAuthenticated && !authLoading && (
        <div className="bg-card border border-blue-200 dark:border-blue-900 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-foreground">{t('app.dashboard.guestTitle')}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{t('app.dashboard.guestBody')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-xs"
            >
              {t('app.dashboard.guestCta')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} aria-hidden="true" className="bg-card border border-border rounded-xl p-6 h-36 animate-pulse motion-reduce:animate-none">
                <div className="h-4 bg-muted rounded w-24 mb-4" />
                <div className="h-8 bg-muted rounded w-16 mb-2" />
                <div className="h-3 bg-muted rounded w-36" />
              </div>
            ))}
          </>
        ) : isError ? (
          <div
            role="alert"
            className="col-span-full p-6 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <span className="text-sm flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              {t('app.dashboard.loadError')}
            </span>
            <button type="button" onClick={() => refetch()} className="text-sm font-semibold underline hover:no-underline">
              {t('app.ui.retry')}
            </button>
          </div>
        ) : (
          <>
            <MetricsCard
              title={t('app.dashboard.cleanCoreIndex')}
              value={typeof cleanCore === 'number' ? fmt.number(cleanCore / 100, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}
              change={
                typeof cleanCore !== 'number'
                  ? t('app.dashboard.cleanCoreNoData')
                  : cleanCore >= 85
                    ? t('app.dashboard.cleanCoreCompliant')
                    : t('app.dashboard.cleanCoreReview')
              }
              isPositive={typeof cleanCore === 'number' && cleanCore >= 80}
              icon={TrendingUp}
              description={t('app.dashboard.cleanCoreDescription')}
            />
            <MetricsCard
              title={t('app.dashboard.activeProjects')}
              value={fmt.number(summary?.activeProjects ?? 0)}
              change={t('app.dashboard.totalProjects', { count: summary?.totalProjects ?? 0 })}
              isPositive={true}
              icon={Layers}
              description={t('app.dashboard.activeProjectsDescription')}
            />
            <MetricsCard
              title={t('app.dashboard.blockers')}
              value={fmt.number(summary?.blockersAndCritical ?? 0)}
              change={(summary?.blockersAndCritical ?? 0) === 0 ? t('app.dashboard.zeroBlockers') : t('app.dashboard.actionNeeded')}
              isPositive={(summary?.blockersAndCritical ?? 0) === 0}
              icon={AlertTriangle}
              description={t('app.dashboard.blockersDescription')}
            />
            <MetricsCard
              title={t('app.dashboard.engines')}
              value={engines ? `${engines.operationalCount} / ${engines.totalEngines}` : summary?.enginesOperational ?? '—'}
              change={engines?.serviceStatus}
              isPositive={!!engines && engines.operationalCount === engines.totalEngines}
              icon={Cpu}
              description={t('app.dashboard.enginesDescription')}
            />
          </>
        )}
      </div>

      {summary && summary.recentProjects && summary.recentProjects.length > 0 && (
        <section aria-labelledby="recent-projects-heading" className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 id="recent-projects-heading" className="text-sm font-bold text-foreground flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 text-primary" aria-hidden="true" />
              {t('app.dashboard.recentTitle')}
            </h2>
            <Link href="/projects" className="text-sm font-semibold text-primary hover:underline flex items-center gap-1">
              {t('app.dashboard.viewAll')}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {summary.recentProjects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="p-4 rounded-lg border border-border hover:border-primary/50 transition-colors bg-muted/20 flex flex-col justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-foreground break-words">{p.name}</h3>
                  <span className="text-xs font-mono text-muted-foreground mt-1 block">{t('app.dashboard.target', { release: p.targetRelease })}</span>
                </div>
                <span className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {t('app.dashboard.created', { date: fmt.date(p.createdAt) })}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <EngineMatrix />
    </div>
  );
}
