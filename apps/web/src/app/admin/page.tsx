'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert,
  ShieldCheck,
  Users,
  Building2,
  Cpu,
  Layers,
  Activity,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ArrowRight,
  Database,
  Server,
  Zap,
} from 'lucide-react';
import {
  fetchCurrentUser,
  fetchAdminOverview,
  fetchAdminTenants,
  fetchAdminUsers,
  updateAdminUserRole,
  fetchAdminQueues,
  fetchEngineStatus,
  AdminOverviewData,
  AdminTenantItem,
  AdminUserItem,
  AdminQueueData,
} from '../../lib/api-client';
import { BusinessPanel, FeatureFlagsPanel, IncidentsPanel, SupportConsolePanel } from '@/components/admin/ops-panels';
import { ErrorState } from '@/components/commercial/states';
import { useEngineDomainLabel } from '@/components/engine-matrix';
import { useFmt, useLabel, useMessages, useT } from '@/i18n/client';
import { useRoleLabel } from '@/components/account/role-label';

type Tab = 'overview' | 'business' | 'incidents' | 'support' | 'flags' | 'tenants' | 'users' | 'engines' | 'queues';

const TABS: Array<{ id: Tab; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', icon: Activity },
  { id: 'business', icon: Layers },
  { id: 'incidents', icon: AlertTriangle },
  { id: 'support', icon: Search },
  { id: 'flags', icon: CheckCircle2 },
  { id: 'tenants', icon: Building2 },
  { id: 'users', icon: Users },
  { id: 'engines', icon: Cpu },
  { id: 'queues', icon: Zap },
];

const QUEUE_COUNTS = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'] as const;

/** Health badge with an icon and text (never color alone). */
function HealthBadge({ value, good }: { value: string; good: boolean }) {
  const label = useLabel();
  const Icon = good ? CheckCircle2 : AlertTriangle;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-bold ${
        good ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
      }`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label('app.admin.overview.status', value)}
    </span>
  );
}

export default function SuperAdminPortal() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const messages = useMessages();
  const roleLabel = useRoleLabel();
  const domainLabel = useEngineDomainLabel();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [userSearch, setUserSearch] = useState('');
  const [tenantSearch, setTenantSearch] = useState('');

  const { data: authData, isLoading: authLoading, isError: authError } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchCurrentUser,
    retry: 1,
  });

  const isSuperAdmin = authData?.user?.systemRole === 'SUPER_ADMIN';

  const overviewQuery = useQuery<AdminOverviewData>({
    queryKey: ['admin', 'overview'],
    queryFn: fetchAdminOverview,
    enabled: isSuperAdmin,
    staleTime: 1000 * 30,
  });
  const tenantsQuery = useQuery<AdminTenantItem[]>({
    queryKey: ['admin', 'tenants'],
    queryFn: fetchAdminTenants,
    enabled: isSuperAdmin && activeTab === 'tenants',
  });
  const usersQuery = useQuery<AdminUserItem[]>({
    queryKey: ['admin', 'users'],
    queryFn: fetchAdminUsers,
    enabled: isSuperAdmin && activeTab === 'users',
  });
  const queuesQuery = useQuery<AdminQueueData>({
    queryKey: ['admin', 'queues'],
    queryFn: fetchAdminQueues,
    enabled: isSuperAdmin && activeTab === 'queues',
  });
  const enginesQuery = useQuery({
    queryKey: ['admin', 'engines'],
    queryFn: fetchEngineStatus,
    enabled: isSuperAdmin && activeTab === 'engines',
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' }) => updateAdminUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4" role="status">
        <RefreshCw className="h-8 w-8 text-primary animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <p className="text-sm text-muted-foreground font-medium">{t('app.admin.verifying')}</p>
      </div>
    );
  }

  if (authError || !isSuperAdmin) {
    return (
      <div className="max-w-xl mx-auto py-16">
        <div className="bg-card border border-destructive/30 rounded-2xl p-6 sm:p-8 shadow-sm text-center space-y-4">
          <div className="inline-flex p-3 bg-destructive/10 rounded-full text-destructive mb-2">
            <Lock className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{t('app.admin.deniedTitle')}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{t('app.admin.deniedBody')}</p>
          <div className="pt-4 flex flex-col sm:flex-row justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
            >
              {t('app.admin.signIn')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center px-4 py-2 bg-muted text-foreground text-sm font-medium rounded-lg hover:bg-muted/80 transition-colors"
            >
              {t('app.admin.backToDashboard')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const overview = overviewQuery.data;
  const filteredUsers = (usersQuery.data || []).filter((u) => {
    if (!userSearch) return true;
    const term = userSearch.toLowerCase();
    return u.email.toLowerCase().includes(term) || (u.fullName && u.fullName.toLowerCase().includes(term)) || u.systemRole.toLowerCase().includes(term);
  });
  const filteredTenants = (tenantsQuery.data || []).filter((tn) => {
    if (!tenantSearch) return true;
    const term = tenantSearch.toLowerCase();
    return tn.name.toLowerCase().includes(term) || tn.slug.toLowerCase().includes(term);
  });

  const th = 'px-4 sm:px-6 py-3';
  const td = 'px-4 sm:px-6 py-4';

  return (
    <div className="space-y-8">
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white rounded-2xl p-6 sm:p-8 shadow-md border border-blue-900/50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase font-extrabold tracking-wider px-2 py-0.5 bg-blue-500/20 text-blue-200 rounded border border-blue-500/30">
                {t('app.admin.badge')}
              </span>
              <span className="text-xs text-slate-300 break-all">{t('app.admin.signedInAs', { email: authData?.user?.email ?? '' })}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold mt-2 tracking-tight">{t('app.admin.title')}</h1>
            <p className="mt-2 text-sm text-slate-300 max-w-2xl leading-relaxed">{t('app.admin.intro')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              overviewQuery.refetch();
              if (activeTab === 'tenants') tenantsQuery.refetch();
              if (activeTab === 'users') usersQuery.refetch();
              if (activeTab === 'queues') queuesQuery.refetch();
              if (activeTab === 'engines') enginesQuery.refetch();
            }}
            className="inline-flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-lg transition-colors border border-white/10 shadow-sm self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            title={t('app.admin.refreshLabel')}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('app.admin.refresh')}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-white/10" role="group" aria-label={t('app.admin.tabsLabel')}>
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  active ? 'bg-blue-600 text-white shadow-sm' : 'bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(`app.admin.tabs.${tab.id}`)}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'business' && <BusinessPanel />}
      {activeTab === 'incidents' && <IncidentsPanel />}
      {activeTab === 'support' && <SupportConsolePanel />}
      {activeTab === 'flags' && <FeatureFlagsPanel />}

      {activeTab === 'overview' && (
        <div className="space-y-6">
          {overviewQuery.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse motion-reduce:animate-none" aria-busy="true" aria-label={t('app.ui.loading')}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 bg-muted rounded-xl" />
              ))}
            </div>
          ) : overviewQuery.isError ? (
            <ErrorState title={t('app.admin.overview.loadFailed')} error={overviewQuery.error} onRetry={() => overviewQuery.refetch()} />
          ) : overview ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: t('app.admin.overview.tenants'), value: overview.totalTenants, hint: t('app.admin.overview.tenantsHint'), icon: Building2 },
                  { label: t('app.admin.overview.users'), value: overview.totalUsers, hint: t('app.admin.overview.usersHint'), icon: Users },
                  {
                    label: t('app.admin.overview.analyses'),
                    value: overview.totalAnalyses,
                    hint: t('app.admin.overview.analysesHint', { count: overview.totalProjects }),
                    icon: Layers,
                  },
                  {
                    label: t('app.admin.overview.blockers'),
                    value: overview.blockersAndCritical,
                    hint: t('app.admin.overview.blockersHint', { count: fmt.number(overview.totalFindings) }),
                    icon: ShieldCheck,
                  },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-card border border-border p-5 rounded-xl shadow-sm">
                    <div className="flex items-center justify-between text-muted-foreground text-sm font-medium">
                      <span>{kpi.label}</span>
                      <kpi.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                    </div>
                    <div className="text-3xl font-extrabold text-foreground mt-2">{fmt.number(kpi.value)}</div>
                    <div className="text-xs text-muted-foreground mt-1">{kpi.hint}</div>
                  </div>
                ))}
              </div>

              <section aria-labelledby="core-services" className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
                <h2 id="core-services" className="text-base font-bold text-foreground flex items-center gap-2">
                  <Server className="h-5 w-5 text-primary" aria-hidden="true" />
                  {t('app.admin.overview.servicesTitle')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { name: t('app.admin.overview.database'), hint: t('app.admin.overview.databaseHint'), value: overview.systemHealth.database, good: overview.systemHealth.database === 'HEALTHY', icon: Database },
                    { name: t('app.admin.overview.queue'), hint: t('app.admin.overview.queueHint'), value: overview.systemHealth.redisQueue, good: overview.systemHealth.redisQueue === 'HEALTHY', icon: Zap },
                    { name: t('app.admin.overview.analysis'), hint: t('app.admin.overview.analysisHint'), value: overview.systemHealth.pythonEngines, good: overview.systemHealth.pythonEngines === 'ONLINE', icon: Cpu },
                  ].map((svc) => (
                    <div key={svc.name} className="border border-border rounded-lg p-4 bg-muted/30">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <svc.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                          {svc.name}
                        </span>
                        <HealthBadge value={svc.value} good={svc.good} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">{svc.hint}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </div>
      )}

      {activeTab === 'tenants' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              placeholder={t('app.admin.tenants.search')}
              aria-label={t('app.admin.tenants.searchLabel')}
              value={tenantSearch}
              onChange={(e) => setTenantSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-border rounded-lg bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          {tenantsQuery.isError ? (
            <ErrorState title={t('app.admin.tenants.loadFailed')} error={tenantsQuery.error} onRetry={() => tenantsQuery.refetch()} />
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[760px]">
                  <thead className="bg-muted text-xs uppercase font-semibold text-muted-foreground border-b border-border">
                    <tr>
                      <th scope="col" className={th}>{t('app.admin.tenants.colName')}</th>
                      <th scope="col" className={th}>{t('app.admin.tenants.colSlug')}</th>
                      <th scope="col" className={th}>{t('app.admin.tenants.colPlan')}</th>
                      <th scope="col" className={th}>{t('app.admin.tenants.colUsers')}</th>
                      <th scope="col" className={th}>{t('app.admin.tenants.colProjects')}</th>
                      <th scope="col" className={th}>{t('app.admin.tenants.colAnalyses')}</th>
                      <th scope="col" className={th}>{t('app.admin.tenants.colStatus')}</th>
                      <th scope="col" className={th}>{t('app.admin.tenants.colCreated')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tenantsQuery.isLoading ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">{t('app.admin.tenants.loading')}</td>
                      </tr>
                    ) : filteredTenants.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">{t('app.admin.tenants.empty')}</td>
                      </tr>
                    ) : (
                      filteredTenants.map((tn) => (
                        <tr key={tn.id} className="hover:bg-muted/30 transition-colors">
                          <td className={`${td} font-semibold text-foreground`}>{tn.name}</td>
                          <td className={`${td} text-muted-foreground font-mono text-xs`}>{tn.slug}</td>
                          <td className={td}>
                            <span className="text-xs px-2 py-0.5 rounded font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">{tn.planTier}</span>
                          </td>
                          <td className={td}>{fmt.number(tn.userCount)}</td>
                          <td className={td}>{fmt.number(tn.projectCount)}</td>
                          <td className={td}>{fmt.number(tn.analysisCount)}</td>
                          <td className={td}>
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                              {tn.status === 'ACTIVE' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />}
                              {label('app.projects.status', tn.status)}
                            </span>
                          </td>
                          <td className={`${td} text-xs text-muted-foreground`}>{fmt.date(tn.createdAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              placeholder={t('app.admin.users.search')}
              aria-label={t('app.admin.users.searchLabel')}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-border rounded-lg bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          {roleMutation.isError && <ErrorState title={t('app.admin.users.roleFailed')} error={roleMutation.error} />}
          {usersQuery.isError ? (
            <ErrorState title={t('app.admin.users.loadFailed')} error={usersQuery.error} onRetry={() => usersQuery.refetch()} />
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[760px]">
                  <thead className="bg-muted text-xs uppercase font-semibold text-muted-foreground border-b border-border">
                    <tr>
                      <th scope="col" className={th}>{t('app.admin.users.colEmail')}</th>
                      <th scope="col" className={th}>{t('app.admin.users.colName')}</th>
                      <th scope="col" className={th}>{t('app.admin.users.colRole')}</th>
                      <th scope="col" className={th}>{t('app.admin.users.colMemberships')}</th>
                      <th scope="col" className={th}>{t('app.admin.users.colStatus')}</th>
                      <th scope="col" className={th}>{t('app.admin.users.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {usersQuery.isLoading ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">{t('app.admin.users.loading')}</td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">{t('app.admin.users.empty')}</td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                          <td className={`${td} font-mono text-xs text-foreground font-semibold break-all`}>{u.email}</td>
                          <td className={`${td} text-muted-foreground`}>{u.fullName || '—'}</td>
                          <td className={td}>
                            <span
                              className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 w-max ${
                                u.systemRole === 'SUPER_ADMIN'
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                                  : u.systemRole === 'ADMIN'
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {u.systemRole === 'SUPER_ADMIN' ? <ShieldAlert className="h-3 w-3" aria-hidden="true" /> : <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
                              {label('app.admin.users.roles', u.systemRole)}
                            </span>
                          </td>
                          <td className={`${td} text-xs text-muted-foreground`}>
                            {u.organizations?.length > 0 ? (
                              <div className="space-y-1">
                                {u.organizations.map((org, idx) => (
                                  <div key={idx}>
                                    <span className="font-medium text-foreground">{org.organizationName}</span>{' '}
                                    <span className="text-muted-foreground">({roleLabel(org.role)})</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={td}>
                            <span className="inline-flex items-center gap-1 text-xs">
                              {u.status === 'ACTIVE' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />}
                              {label('app.projects.status', u.status)}
                            </span>
                          </td>
                          <td className={td}>
                            <label className="sr-only" htmlFor={`sysrole-${u.id}`}>
                              {t('app.admin.users.roleLabel', { email: u.email })}
                            </label>
                            <select
                              id={`sysrole-${u.id}`}
                              value={u.systemRole}
                              disabled={roleMutation.isPending}
                              onChange={(e) => roleMutation.mutate({ userId: u.id, role: e.target.value as 'USER' | 'ADMIN' | 'SUPER_ADMIN' })}
                              className="text-sm border border-border rounded px-2 py-1 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer disabled:opacity-50"
                            >
                              {(['USER', 'ADMIN', 'SUPER_ADMIN'] as const).map((r) => (
                                <option key={r} value={r}>
                                  {t(`app.admin.users.roles.${r}`)}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'engines' && (
        <section aria-labelledby="admin-engines" className="bg-card border border-border p-6 rounded-xl shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h2 id="admin-engines" className="text-lg font-bold text-foreground flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" aria-hidden="true" />
                {t('app.admin.engines.title')}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">{t('app.admin.engines.intro')}</p>
            </div>
            <span className="text-xs px-2.5 py-1 bg-muted text-foreground font-bold rounded-full">
              {enginesQuery.data?.summary
                ? t('app.admin.engines.operational', { active: enginesQuery.data.summary.operationalCount, total: enginesQuery.data.summary.totalEngines })
                : t('app.admin.engines.unavailable')}
            </span>
          </div>
          {enginesQuery.isError && <ErrorState title={t('app.admin.engines.loadFailed')} error={enginesQuery.error} onRetry={() => enginesQuery.refetch()} />}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
            {(enginesQuery.data?.engines || []).map((eng) => (
              <div key={eng.id} className="border border-border p-4 rounded-lg bg-muted/20 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-sm text-foreground">{eng.name}</span>
                  <HealthBadge value={eng.status} good={eng.status === 'OPERATIONAL'} />
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{messages.engines[eng.id] ?? eng.description}</p>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
                  <span>{domainLabel(eng.domain)}</span>
                  <span className="font-mono break-all">{eng.id}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'queues' && (
        <section aria-labelledby="admin-queues" className="bg-card border border-border p-6 rounded-xl shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="admin-queues" className="text-lg font-bold text-foreground flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" aria-hidden="true" />
              {t('app.admin.queues.title')}
            </h2>
            <span className="text-xs px-2.5 py-1 bg-muted text-foreground font-bold rounded-full">
              {t('app.admin.queues.status', { status: queuesQuery.data?.status ?? '—' })}
            </span>
          </div>
          {queuesQuery.isError ? (
            <ErrorState title={t('app.admin.queues.loadFailed')} error={queuesQuery.error} onRetry={() => queuesQuery.refetch()} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {QUEUE_COUNTS.map((key) => (
                <div key={key} className="border border-border p-4 rounded-lg bg-muted/20 text-center">
                  <div className="text-xs text-muted-foreground font-medium">{t(`app.admin.queues.counts.${key}`)}</div>
                  <div className="text-2xl font-black mt-1 text-foreground">
                    {queuesQuery.isLoading ? '…' : fmt.number(queuesQuery.data?.counts?.[key] ?? 0)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
