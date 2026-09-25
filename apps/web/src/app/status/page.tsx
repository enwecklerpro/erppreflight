'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  AlertTriangle,
  Activity,
  Clock,
  RefreshCw,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import { customInstance, resolveApiRootUrl } from '@/lib/api/custom-instance';

type ComponentStatus = 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'NOT_MONITORED' | 'UNKNOWN';

interface DependencyHealth {
  status?: string;
  latencyMs?: number;
  engines?: number;
  error?: string;
}

interface ReadinessResponse {
  status?: string;
  timestamp?: string;
  dependencies?: Record<string, DependencyHealth | undefined>;
}

interface ReadinessProbe {
  reachable: boolean;
  httpStatus: number | null;
  roundTripMs: number;
  body: ReadinessResponse | null;
  error?: string;
}

interface EngineStatusSummary {
  summary?: {
    totalEngines?: number;
    operationalCount?: number;
    serviceStatus?: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | string;
  };
}

interface ServiceRow {
  name: string;
  status: ComponentStatus;
  details?: string;
}

/**
 * Probes GET /health/readiness (served outside the /api/v1 prefix). The API
 * answers 503 with a JSON body when a dependency is down, so the body is
 * parsed regardless of the HTTP status.
 */
async function probeReadiness(): Promise<ReadinessProbe> {
  const t0 = performance.now();
  try {
    const res = await fetch(resolveApiRootUrl('/health/readiness'), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const roundTripMs = Math.round(performance.now() - t0);
    let body: ReadinessResponse | null = null;
    try {
      body = (await res.json()) as ReadinessResponse;
    } catch {
      body = null;
    }
    return { reachable: true, httpStatus: res.status, roundTripMs, body };
  } catch (err) {
    return {
      reachable: false,
      httpStatus: null,
      roundTripMs: Math.round(performance.now() - t0),
      body: null,
      error: (err as Error)?.message || 'Connection failed',
    };
  }
}

function dependencyToStatus(dep: DependencyHealth | undefined): ComponentStatus {
  switch (dep?.status) {
    case 'up':
      return 'OPERATIONAL';
    case 'down':
      return 'DOWN';
    case 'mock_mode':
    case 'unconfigured':
      return 'NOT_MONITORED';
    default:
      return 'UNKNOWN';
  }
}

function engineServiceToStatus(serviceStatus: string | undefined): ComponentStatus {
  switch (serviceStatus) {
    case 'ONLINE':
      return 'OPERATIONAL';
    case 'DEGRADED':
      return 'DEGRADED';
    case 'OFFLINE':
      return 'DOWN';
    default:
      return 'UNKNOWN';
  }
}

function latency(dep: DependencyHealth | undefined): string | undefined {
  return typeof dep?.latencyMs === 'number' ? `${dep.latencyMs} ms` : undefined;
}

const STATUS_BADGE: Record<ComponentStatus, { label: string; className: string; Icon: React.ElementType }> = {
  OPERATIONAL: {
    label: 'OPERATIONAL',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    Icon: CheckCircle2,
  },
  DEGRADED: {
    label: 'DEGRADED',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    Icon: AlertTriangle,
  },
  DOWN: {
    label: 'DOWN',
    className: 'bg-red-500/10 text-red-400 border-red-500/20',
    Icon: XCircle,
  },
  NOT_MONITORED: {
    label: 'NOT MONITORED',
    className: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
    Icon: HelpCircle,
  },
  UNKNOWN: {
    label: 'UNKNOWN',
    className: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
    Icon: HelpCircle,
  },
};

export default function StatusPage() {
  const {
    data: probe,
    isLoading,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['system-status', 'readiness'],
    queryFn: probeReadiness,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const {
    data: engineData,
    isError: isEngineError,
    refetch: refetchEngines,
  } = useQuery({
    queryKey: ['system-status', 'engines'],
    queryFn: () => customInstance<EngineStatusSummary>('/engines/status'),
    refetchInterval: 60000,
    retry: 1,
  });

  const deps = probe?.body?.dependencies ?? {};
  const apiReachable = Boolean(probe?.reachable);

  const services: ServiceRow[] = [
    {
      name: 'Core API',
      status: !probe ? 'UNKNOWN' : apiReachable ? 'OPERATIONAL' : 'DOWN',
      details: probe
        ? apiReachable
          ? `Readiness responded HTTP ${probe.httpStatus} in ${probe.roundTripMs} ms (measured from this browser)`
          : probe.error
        : undefined,
    },
    {
      name: 'PostgreSQL',
      status: apiReachable ? dependencyToStatus(deps.postgres) : 'UNKNOWN',
      details: latency(deps.postgres),
    },
    {
      name: 'Redis (cache & job queue)',
      status: apiReachable ? dependencyToStatus(deps.redis) : 'UNKNOWN',
      details: latency(deps.redis),
    },
    {
      name: 'Object storage',
      status: apiReachable ? dependencyToStatus(deps.minio) : 'UNKNOWN',
    },
    {
      name: 'Antivirus scanner',
      status: apiReachable ? dependencyToStatus(deps.clamav) : 'UNKNOWN',
      details: deps.clamav?.status === 'mock_mode' ? 'Scanner runs in mock mode' : undefined,
    },
    {
      name: 'Analysis engines',
      status: isEngineError ? 'UNKNOWN' : engineServiceToStatus(engineData?.summary?.serviceStatus),
      details:
        engineData?.summary &&
        typeof engineData.summary.operationalCount === 'number' &&
        typeof engineData.summary.totalEngines === 'number'
          ? `${engineData.summary.operationalCount} / ${engineData.summary.totalEngines} engines operational`
          : isEngineError
          ? 'Engine status could not be retrieved'
          : undefined,
    },
  ];

  const monitored = services.filter((s) => s.status !== 'NOT_MONITORED');
  const hasDown = monitored.some((s) => s.status === 'DOWN');
  const hasUnknown = monitored.some((s) => s.status === 'UNKNOWN');
  const allOperational = !isLoading && monitored.every((s) => s.status === 'OPERATIONAL');

  const overall: ComponentStatus = isLoading
    ? 'UNKNOWN'
    : allOperational
    ? 'OPERATIONAL'
    : hasDown
    ? 'DOWN'
    : hasUnknown
    ? 'UNKNOWN'
    : 'DEGRADED';

  const overallText: Record<ComponentStatus, string> = {
    OPERATIONAL: 'All monitored components operational',
    DEGRADED: 'Partial service degradation',
    DOWN: 'One or more components are down',
    UNKNOWN: isLoading ? 'Checking status…' : 'Status partially unknown',
    NOT_MONITORED: 'Not monitored',
  };
  const OverallIcon = STATUS_BADGE[overall].Icon;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-3 border border-emerald-500/20">
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
            Live status
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            ERP Preflight Service Status
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Current results of the API readiness probe and engine status endpoint. No historical uptime is recorded on this page.
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4" role="status" aria-live="polite">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center border ${STATUS_BADGE[overall].className}`}
            >
              <OverallIcon className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{overallText[overall]}</h2>
              {probe?.body?.status && (
                <p className="text-xs text-slate-400">
                  API readiness reports: <span className="font-mono">{probe.body.status}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                refetch();
                refetchEngines();
              }}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              Refresh
            </button>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 font-mono">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : 'Checking…'}</span>
            </div>
          </div>
        </div>

        <ul className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800">
          {services.map((svc) => {
            const badge = STATUS_BADGE[svc.status];
            const Icon = badge.Icon;
            return (
              <li key={svc.name} className="p-4 sm:p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-bold text-white text-sm">{svc.name}</div>
                  {svc.details && (
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5 break-words">{svc.details}</div>
                  )}
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border shrink-0 ${badge.className}`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {badge.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
