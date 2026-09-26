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
  XCircle,
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

export default function SuperAdminPortal() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'business' | 'incidents' | 'support' | 'flags' | 'tenants' | 'users' | 'engines' | 'queues'
  >('overview');
  const [userSearch, setUserSearch] = useState('');
  const [tenantSearch, setTenantSearch] = useState('');

  // 1. Current user check
  const { data: authData, isLoading: authLoading, isError: authError } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchCurrentUser,
    retry: 1,
  });

  const isSuperAdmin = authData?.user?.systemRole === 'SUPER_ADMIN';

  // 2. Admin queries (only enabled if super admin)
  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
    refetch: refetchOverview,
  } = useQuery<AdminOverviewData>({
    queryKey: ['admin', 'overview'],
    queryFn: fetchAdminOverview,
    enabled: isSuperAdmin,
    staleTime: 1000 * 30,
  });

  const {
    data: tenants,
    isLoading: tenantsLoading,
    refetch: refetchTenants,
  } = useQuery<AdminTenantItem[]>({
    queryKey: ['admin', 'tenants'],
    queryFn: fetchAdminTenants,
    enabled: isSuperAdmin && activeTab === 'tenants',
  });

  const {
    data: users,
    isLoading: usersLoading,
    refetch: refetchUsers,
  } = useQuery<AdminUserItem[]>({
    queryKey: ['admin', 'users'],
    queryFn: fetchAdminUsers,
    enabled: isSuperAdmin && activeTab === 'users',
  });

  const {
    data: queues,
    isLoading: queuesLoading,
    refetch: refetchQueues,
  } = useQuery<AdminQueueData>({
    queryKey: ['admin', 'queues'],
    queryFn: fetchAdminQueues,
    enabled: isSuperAdmin && activeTab === 'queues',
  });

  const {
    data: engineStatus,
    isLoading: enginesLoading,
    refetch: refetchEngines,
  } = useQuery({
    queryKey: ['admin', 'engines'],
    queryFn: fetchEngineStatus,
    enabled: isSuperAdmin && activeTab === 'engines',
  });

  // User role mutation
  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' }) =>
      updateAdminUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });

  // Unauthenticated or not Super Admin state
  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <RefreshCw className="h-8 w-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Verifying Super Admin Authorization...</p>
      </div>
    );
  }

  if (authError || !isSuperAdmin) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4">
        <div className="bg-card border border-destructive/30 rounded-2xl p-8 shadow-sm text-center space-y-4">
          <div className="inline-flex p-3 bg-destructive/10 rounded-full text-destructive mb-2">
            <Lock className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Super Admin Access Required</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You must be logged in with an account that holds the Super Admin system role to access the ERP
            Preflight Trust Center, tenant directory, and global infrastructure telemetry.
          </p>
          <div className="pt-4 flex flex-col sm:flex-row justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
            >
              Sign In as Super Admin
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-4 py-2 bg-muted text-foreground text-sm font-medium rounded-lg hover:bg-muted/80 transition-colors"
            >
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const filteredUsers = (users || []).filter((u) => {
    if (!userSearch) return true;
    const term = userSearch.toLowerCase();
    return (
      u.email.toLowerCase().includes(term) ||
      (u.fullName && u.fullName.toLowerCase().includes(term)) ||
      u.systemRole.toLowerCase().includes(term)
    );
  });

  const filteredTenants = (tenants || []).filter((t) => {
    if (!tenantSearch) return true;
    const term = tenantSearch.toLowerCase();
    return t.name.toLowerCase().includes(term) || t.slug.toLowerCase().includes(term);
  });

  return (
    <div className="space-y-8">
      {/* Super Admin Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white rounded-2xl p-6 sm:p-8 shadow-md border border-blue-900/50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-extrabold tracking-wider px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded border border-blue-500/30">
                Super Admin Trust Center
              </span>
              <span className="text-xs text-slate-300">
                Active Admin: <strong className="text-white">{authData?.user?.email}</strong>
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold mt-2 tracking-tight">
              Enterprise Global Governance & System Diagnostics
            </h1>
            <p className="mt-2 text-sm text-slate-300 max-w-2xl leading-relaxed">
              Global multi-tenant administration, PostgreSQL RLS tenant bypass introspection, BullMQ Redis
              queue monitor, and live preflight engine health.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                refetchOverview();
                if (activeTab === 'tenants') refetchTenants();
                if (activeTab === 'users') refetchUsers();
                if (activeTab === 'queues') refetchQueues();
                if (activeTab === 'engines') refetchEngines();
              }}
              className="inline-flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-lg transition-colors border border-white/10 shadow-sm"
              title="Refresh all metrics"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync Diagnostics
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-white/10">
          {[
            { id: 'overview', label: 'Global Overview', icon: Activity },
            { id: 'business', label: 'Business & Usage', icon: Layers },
            { id: 'incidents', label: 'Incidents & Jobs', icon: AlertTriangle },
            { id: 'support', label: 'Support Console', icon: Search },
            { id: 'flags', label: 'Feature Flags', icon: CheckCircle2 },
            { id: 'tenants', label: 'Tenant Directory', icon: Building2 },
            { id: 'users', label: 'User Administration', icon: Users },
            { id: 'engines', label: 'SAP Engine Matrix', icon: Cpu },
            { id: 'queues', label: 'BullMQ Queues', icon: Zap },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'business' && <BusinessPanel />}
      {activeTab === 'incidents' && <IncidentsPanel />}
      {activeTab === 'support' && <SupportConsolePanel />}
      {activeTab === 'flags' && <FeatureFlagsPanel />}

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {overviewLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 bg-muted rounded-xl" />
              ))}
            </div>
          ) : overviewError ? (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-xl text-sm">
              Failed to load global system overview. Check backend API status.
            </div>
          ) : overview ? (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
                  <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
                    <span>Enterprise Tenants</span>
                    <Building2 className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="text-3xl font-extrabold text-foreground mt-2">{overview.totalTenants}</div>
                  <div className="text-xs text-muted-foreground mt-1">Multi-tenant isolated organizations</div>
                </div>

                <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
                  <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
                    <span>Registered Users</span>
                    <Users className="h-4 w-4 text-indigo-500" />
                  </div>
                  <div className="text-3xl font-extrabold text-foreground mt-2">{overview.totalUsers}</div>
                  <div className="text-xs text-muted-foreground mt-1">Global registered accounts</div>
                </div>

                <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
                  <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
                    <span>Preflight Analyses</span>
                    <Layers className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="text-3xl font-extrabold text-foreground mt-2">{overview.totalAnalyses}</div>
                  <div className="text-xs text-muted-foreground mt-1">Across {overview.totalProjects} workspaces</div>
                </div>

                <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
                  <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
                    <span>Blocker / Critical Findings</span>
                    <ShieldCheck className="h-4 w-4 text-amber-500" />
                  </div>
                  <div className="text-3xl font-extrabold text-foreground mt-2">{overview.blockersAndCritical}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    of {overview.totalFindings} findings across all tenants
                  </div>
                </div>
              </div>

              {/* Subsystem Health Cards */}
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Server className="h-5 w-5 text-primary" />
                  Core SaaS Subsystem Topology Matrix
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="border border-border rounded-lg p-4 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Database className="h-4 w-4 text-blue-500" />
                        PostgreSQL 16 + pgvector
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-bold ${
                          overview.systemHealth.database === 'HEALTHY'
                            ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {overview.systemHealth.database}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Multi-tenant row-level security (RLS) active across all schemas.
                    </p>
                  </div>

                  <div className="border border-border rounded-lg p-4 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Zap className="h-4 w-4 text-amber-500" />
                        BullMQ Redis 7.2
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-bold ${
                          overview.systemHealth.redisQueue === 'HEALTHY'
                            ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {overview.systemHealth.redisQueue}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Asynchronous queue broker for durable analysis execution.
                    </p>
                  </div>

                  <div className="border border-border rounded-lg p-4 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-indigo-500" />
                        Python Analysis Microservice
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-bold ${
                          overview.systemHealth.pythonEngines === 'ONLINE'
                            ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {overview.systemHealth.pythonEngines}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      19 deterministic preflight engines with pure AST & XML parsers.
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Tab: Tenants */}
      {activeTab === 'tenants' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search organizations by name or slug..."
                value={tenantSearch}
                onChange={(e) => setTenantSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-border rounded-lg bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs uppercase font-semibold text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-6 py-3">Organization Name</th>
                    <th className="px-6 py-3">Slug</th>
                    <th className="px-6 py-3">Plan Tier</th>
                    <th className="px-6 py-3">Users</th>
                    <th className="px-6 py-3">Projects</th>
                    <th className="px-6 py-3">Analyses</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tenantsLoading ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">
                        Loading tenant directory...
                      </td>
                    </tr>
                  ) : filteredTenants.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">
                        No organizations found.
                      </td>
                    </tr>
                  ) : (
                    filteredTenants.map((t) => (
                      <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4 font-semibold text-foreground">{t.name}</td>
                        <td className="px-6 py-4 text-muted-foreground font-mono text-xs">{t.slug}</td>
                        <td className="px-6 py-4">
                          <span className="text-xs px-2 py-0.5 rounded font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                            {t.planTier}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-foreground">{t.userCount}</td>
                        <td className="px-6 py-4 text-foreground">{t.projectCount}</td>
                        <td className="px-6 py-4 text-foreground">{t.analysisCount}</td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {t.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Users */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search users by email, name or role..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-border rounded-lg bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs uppercase font-semibold text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-6 py-3">Email</th>
                    <th className="px-6 py-3">Full Name</th>
                    <th className="px-6 py-3">System Role</th>
                    <th className="px-6 py-3">Tenant Membership</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Role Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {usersLoading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                        Loading users directory...
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4 font-mono text-xs text-foreground font-semibold">{u.email}</td>
                        <td className="px-6 py-4 text-muted-foreground">{u.fullName || '—'}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 w-max ${
                              u.systemRole === 'SUPER_ADMIN'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                                : u.systemRole === 'ADMIN'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {u.systemRole === 'SUPER_ADMIN' ? (
                              <ShieldAlert className="h-3 w-3" />
                            ) : (
                              <ShieldCheck className="h-3 w-3" />
                            )}
                            {u.systemRole}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-muted-foreground">
                          {u.organizations?.length > 0 ? (
                            <div className="space-y-1">
                              {u.organizations.map((org, idx) => (
                                <div key={idx}>
                                  <span className="font-medium text-foreground">{org.organizationName}</span>{' '}
                                  <span className="text-muted-foreground">({org.role})</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {u.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <select
                            value={u.systemRole}
                            disabled={roleMutation.isPending}
                            onChange={(e) =>
                              roleMutation.mutate({
                                userId: u.id,
                                role: e.target.value as any,
                              })
                            }
                            className="text-xs border border-border rounded px-2 py-1 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer disabled:opacity-50"
                          >
                            <option value="USER">USER</option>
                            <option value="ADMIN">ADMIN</option>
                            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Engines */}
      {activeTab === 'engines' && (
        <div className="space-y-4">
          <div className="bg-card border border-border p-6 rounded-xl shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-primary" />
                  Canonical SAP Preflight Engine Status Matrix
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  18 specialized preflight engines + Material Flow System (MFS) BlackBox analyzer.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2.5 py-1 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 font-bold rounded-full">
                  {engineStatus?.summary
                    ? `${engineStatus.summary.operationalCount} / ${engineStatus.summary.totalEngines} Operational`
                    : 'Status unavailable'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
              {(engineStatus?.engines || []).map((eng: any) => (
                <div key={eng.id} className="border border-border p-4 rounded-lg bg-muted/20 space-y-2">
                  <div className="flex items-start justify-between">
                    <span className="font-semibold text-sm text-foreground">{eng.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-bold ${
                        eng.status === 'OPERATIONAL'
                          ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {eng.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{eng.description}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
                    <span>{eng.domain}</span>
                    <span className="font-mono">{eng.id}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Queues */}
      {activeTab === 'queues' && (
        <div className="space-y-4">
          <div className="bg-card border border-border p-6 rounded-xl shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                BullMQ Distributed Redis Analysis Queue
              </h3>
              <span className="text-xs px-2.5 py-1 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 font-bold rounded-full">
                Queue Status: {queues?.status || 'ACTIVE'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'Waiting', value: queues?.counts?.waiting ?? 0, color: 'text-amber-500' },
                { label: 'Active', value: queues?.counts?.active ?? 0, color: 'text-blue-500' },
                { label: 'Completed', value: queues?.counts?.completed ?? 0, color: 'text-green-500' },
                { label: 'Failed', value: queues?.counts?.failed ?? 0, color: 'text-red-500' },
                { label: 'Delayed', value: queues?.counts?.delayed ?? 0, color: 'text-slate-500' },
                { label: 'Paused', value: queues?.counts?.paused ?? 0, color: 'text-slate-500' },
              ].map((item, idx) => (
                <div key={idx} className="border border-border p-4 rounded-lg bg-muted/20 text-center">
                  <div className="text-xs text-muted-foreground font-medium">{item.label}</div>
                  <div className={`text-2xl font-black mt-1 ${item.color}`}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
