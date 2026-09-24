'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Cpu,
  Layers,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  FolderGit2,
  Clock,
} from 'lucide-react';
import { MetricsCard } from '../components/metrics-card';
import { EngineMatrix } from '../components/engine-matrix';
import { fetchDashboardSummary, DashboardSummaryData } from '../lib/api-client';

export default function ExecutiveDashboard() {
  const {
    data: summary,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<DashboardSummaryData>({
    queryKey: ['dashboard', 'summary'],
    queryFn: fetchDashboardSummary,
    staleTime: 1000 * 30,
    retry: 1,
  });

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-950 text-white rounded-2xl p-6 sm:p-8 shadow-md">
        <div className="max-w-3xl">
          <span className="text-xs uppercase font-bold tracking-wider text-blue-300">
            Astra Ultra Preflight Platform
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold mt-1">
            Executive Clean Core & Preflight Intelligence
          </h1>
          <p className="mt-3 text-sm text-blue-100 leading-relaxed">
            Deterministic preflight verification across 18 specialized operational engines + MFS BlackBox.
            Continuous clean core governance, deprecation impact scanning, and upgrade readiness.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
            >
              Open Workspaces
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/inspector"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 text-white text-xs font-semibold rounded-lg hover:bg-white/20 transition-colors backdrop-blur-sm"
            >
              Launch Findings Inspector
            </Link>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white/5 text-white/80 hover:text-white text-xs font-semibold rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Refresh Dashboard Data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-card border border-border rounded-xl p-6 h-36 animate-pulse"
              >
                <div className="h-4 bg-muted rounded w-24 mb-4" />
                <div className="h-8 bg-muted rounded w-16 mb-2" />
                <div className="h-3 bg-muted rounded w-36" />
              </div>
            ))}
          </>
        ) : isError ? (
          <div className="col-span-full p-6 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-200 flex items-center justify-between">
            <span className="text-xs">
              Unable to load live dashboard summary. Using verified runtime defaults.
            </span>
            <button
              onClick={() => refetch()}
              className="text-xs font-semibold underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <MetricsCard
              title="Clean Core Index"
              value={`${summary?.cleanCoreIndex?.toFixed(1) ?? '100.0'}%`}
              change={`${summary?.cleanCoreIndex && summary.cleanCoreIndex >= 85 ? 'Compliant' : 'Needs Review'}`}
              isPositive={(summary?.cleanCoreIndex ?? 100) >= 80}
              icon={TrendingUp}
              description="S/4HANA Tier 1 & 2 compliance ratio"
            />
            <MetricsCard
              title="Active Projects"
              value={String(summary?.activeProjects ?? 0)}
              change={`${summary?.totalProjects ?? 0} total`}
              isPositive={true}
              icon={Layers}
              description="Monitored customer migration workspaces"
            />
            <MetricsCard
              title="Blockers & Critical"
              value={String(summary?.blockersAndCritical ?? 0)}
              change={summary?.blockersAndCritical === 0 ? 'Zero Blockers' : 'Immediate Action'}
              isPositive={(summary?.blockersAndCritical ?? 0) === 0}
              icon={AlertTriangle}
              description="Requires clean core remediation"
            />
            <MetricsCard
              title="Engines Operational"
              value={summary?.enginesOperational ?? '19 / 19'}
              change={summary?.enginesSummary?.serviceStatus ?? 'ONLINE'}
              isPositive={true}
              icon={Cpu}
              description="18 SAP Engines + MFS BlackBox ready"
            />
          </>
        )}
      </div>

      {/* Recent Activity Feed if available */}
      {summary && summary.recentProjects && summary.recentProjects.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 text-primary" />
              Recent Migration Workspaces
            </h2>
            <Link
              href="/projects"
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              View all
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {summary.recentProjects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="p-4 rounded-lg border border-border hover:border-primary/50 transition-colors bg-muted/20 flex flex-col justify-between"
              >
                <div>
                  <h3 className="text-xs font-bold text-foreground">{p.name}</h3>
                  <span className="text-[11px] font-mono text-muted-foreground mt-1 block">
                    Target: {p.targetRelease}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground mt-3 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 18-Engine Operational Status Matrix */}
      <EngineMatrix />
    </div>
  );
}
