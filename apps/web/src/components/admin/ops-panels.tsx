'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  LifeBuoy,
  Plus,
  Search,
  ServerCrash,
  ShieldAlert,
  Trash2,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { PLAN_TIERS, type FeatureFlag, type PlanTierId } from '@erppreflight/schemas';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect } from '@/components/form/form-inputs';
import { ErrorState, Notice, SkeletonBlock, UsageMeterRow, errorMessage, useCommercialErrorText } from '@/components/commercial/states';
import { useFmt, useLabel, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';
import {
  fetchAdminBusiness,
  fetchAdminEngines,
  fetchAdminIncidents,
  searchAdminTenants,
  setAdminTenantLimits,
  setAdminTenantPlan,
  type TenantDetail,
} from '@/lib/api/commercial';
import {
  TICKET_STATUSES,
  deleteAdminFeatureFlag,
  fetchAdminFeatureFlags,
  fetchAdminTenantDetailWithReason,
  fetchAdminTickets,
  updateAdminTicketStatus,
  upsertAdminFeatureFlag,
} from '@/lib/api/admin-ops';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { AdminTicketThread } from '@/components/tenant-access/ticket-thread';

const card = 'bg-card border border-border rounded-xl p-5 shadow-sm';

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className={card}>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className="text-2xl font-extrabold mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Business overview (spec 10.6 / C §24)
// -----------------------------------------------------------------------------

export function BusinessPanel() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const eur = (v: number) => fmt.number(v, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const q = useQuery({ queryKey: ['admin', 'business'], queryFn: fetchAdminBusiness });
  if (q.isLoading) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="h-24" />)}</div>;
  if (q.isError) return <ErrorState title={t('app.admin.business.loadFailed')} error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const maxDay = Math.max(1, ...d.analysesPerDay.map((x) => x.total));
  return (
    <div className="space-y-4" data-testid="admin-business">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t('app.admin.business.mrr')} value={eur(d.revenue.estimatedMrrEur)} hint={t('app.admin.business.mrrHint', { arr: eur(d.revenue.estimatedArrEur) })} />
        <Kpi label={t('app.admin.business.trials')} value={fmt.number(d.tenants.activeTrials)} hint={t('app.admin.business.trialsHint', { count: fmt.number(d.tenants.total) })} />
        <Kpi label={t('app.admin.business.activeOrgs')} value={fmt.number(d.tenants.activeLast30Days)} hint={t('app.admin.business.activeOrgsHint', { count: fmt.number(d.activeUsersLast30Days) })} />
        <Kpi
          label={t('app.admin.business.errorRate')}
          value={d.analysisErrorRate7d === null ? '—' : fmt.percent(d.analysisErrorRate7d, 1)}
          hint={t('app.admin.business.errorRateHint', { failed: d.analyses7d.failed, total: d.analyses7d.total })}
        />
      </div>
      <p className="text-xs text-muted-foreground">{d.revenue.basis}{d.revenue.unpricedPaidTenants > 0 ? ` ${t('app.admin.business.unpriced', { count: d.revenue.unpricedPaidTenants })}` : ''}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <h3 className="text-sm font-semibold mb-3 inline-flex items-center gap-2"><TrendingUp className="size-4" aria-hidden="true" /> {t('app.admin.business.perDay')}</h3>
          {d.analysesPerDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('app.admin.business.perDayEmpty')}</p>
          ) : (
            <table className="w-full text-xs">
              <caption className="sr-only">{t('app.admin.business.perDayCaption')}</caption>
              <tbody>
                {d.analysesPerDay.map((row) => (
                  <tr key={row.day}>
                    <th scope="row" className="py-1 pr-2 text-left font-normal text-muted-foreground whitespace-nowrap">{fmt.date(`${row.day}T12:00:00Z`)}</th>
                    <td className="py-1 w-full">
                      <div className="h-2 rounded bg-primary/70" style={{ width: `${(row.total / maxDay) * 100}%` }} aria-hidden="true" />
                    </td>
                    <td className="py-1 pl-2 tabular-nums whitespace-nowrap">
                      {row.failed ? t('app.admin.business.runsFailed', { count: row.total, failed: row.failed }) : t('app.admin.business.runs', { count: row.total })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold mb-3">{t('app.admin.business.byTier')}</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {Object.entries(d.tenants.byEffectiveTier).map(([tier, n]) => (
              <React.Fragment key={tier}>
                <dt className="text-muted-foreground">{tier}</dt>
                <dd className="tabular-nums">{n}</dd>
              </React.Fragment>
            ))}
            {Object.entries(d.tenants.bySubscriptionStatus).map(([st, n]) => (
              <React.Fragment key={st}>
                <dt className="text-muted-foreground">{t('app.admin.business.subscription', { status: label('app.commercial.subscription', st) })}</dt>
                <dd className="tabular-nums">{n}</dd>
              </React.Fragment>
            ))}
            <dt className="text-muted-foreground">{t('app.admin.business.storage')}</dt>
            <dd>{fmt.bytes(d.storageBytes)}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Incidents: queues, failed jobs, failed analyses, failure events, engines
// -----------------------------------------------------------------------------

export function IncidentsPanel() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const q = useQuery({ queryKey: ['admin', 'incidents'], queryFn: fetchAdminIncidents, refetchInterval: 30_000 });
  const engines = useQuery({ queryKey: ['admin', 'engine-registry'], queryFn: fetchAdminEngines });
  return (
    <div className="space-y-4" data-testid="admin-incidents">
      {q.isLoading ? (
        <SkeletonBlock className="h-40" />
      ) : q.isError ? (
        <ErrorState title={t('app.admin.incidents.loadFailed')} error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {q.data!.queues.map((queue) => (
              <div key={queue.queueName} className={card}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold font-mono">{queue.queueName}</h3>
                  <span className="text-xs inline-flex items-center gap-1">
                    {queue.status === 'ACTIVE' ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <AlertTriangle className="size-3.5" aria-hidden="true" />}
                    {label('app.engineMatrix.statusName', queue.status === 'ACTIVE' ? 'OPERATIONAL' : queue.status)}
                  </span>
                </div>
                <dl className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                  {Object.entries(queue.counts).map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-muted/40 p-2">
                      <dt className="text-muted-foreground">{label('app.admin.queues.counts', k)}</dt>
                      <dd className="text-lg font-bold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <div className={card}>
            <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-2"><ServerCrash className="size-4" aria-hidden="true" /> {t('app.admin.incidents.failedJobs')}</h3>
            {q.data!.failedJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('app.admin.incidents.noFailedJobs')}</p>
            ) : (
              <ul className="divide-y divide-border text-xs">
                {q.data!.failedJobs.map((j) => (
                  <li key={`${j.queue}-${j.jobId}`} className="py-2">
                    <span className="font-mono">{j.queue}/{j.name}#{j.jobId}</span> · {fmt.dateTime(j.failedAt)} · {t('app.admin.incidents.attempts', { count: j.attemptsMade })}
                    <span className="block text-destructive break-words">{j.failedReason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={card}>
              <h3 className="text-sm font-semibold mb-2">{t('app.admin.incidents.failedAnalyses')}</h3>
              {q.data!.failedAnalyses.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('app.admin.incidents.noFailedAnalyses')}</p>
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {q.data!.failedAnalyses.map((a) => (
                    <li key={a.id} className="py-2">
                      <XCircle className="size-3.5 inline mr-1" aria-hidden="true" />
                      <span className="font-semibold">{a.organizationName}</span> · <span className="font-mono">{a.id.slice(0, 8)}</span> ·{' '}
                      {fmt.dateTime(a.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={card}>
              <h3 className="text-sm font-semibold mb-2">{t('app.admin.incidents.failureEvents')}</h3>
              {q.data!.recentFailureEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('app.admin.incidents.noFailureEvents')}</p>
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {q.data!.recentFailureEvents.map((e, i) => (
                    <li key={i} className="py-2">
                      <span className="font-mono">{e.action}</span> · {e.organizationName} · {fmt.dateTime(e.createdAt)}
                      {e.httpStatus && <> · HTTP {e.httpStatus}</>}
                      {e.error && <span className="block text-destructive break-words">{e.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <div className={card}>
        <h3 className="text-sm font-semibold mb-2">{t('app.admin.incidents.registry')}</h3>
        {engines.isLoading ? (
          <SkeletonBlock className="h-16" />
        ) : engines.isError ? (
          <ErrorState title={t('app.admin.incidents.registryFailed')} error={engines.error} onRetry={() => engines.refetch()} />
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2" data-testid="engine-registry-summary">
              {t('app.admin.incidents.registrySummary', {
                status: engines.data!.summary.serviceStatus,
                version: engines.data!.summary.serviceVersion ? ` v${engines.data!.summary.serviceVersion}` : '',
                count: engines.data!.summary.registeredCount,
                time: fmt.time(engines.data!.summary.checkedAt),
              })}
              {engines.data!.summary.error ? ` · ${engines.data!.summary.error}` : ''}
            </p>
            <ul className="grid gap-1 sm:grid-cols-2 text-xs">
              {engines.data!.engines.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 border-b border-border/50 py-1">
                  <span>{e.name}</span>
                  <span className="text-muted-foreground font-mono">{e.version ?? '—'}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Support console: tenant lookup, limit/plan overrides, ticket queue
// -----------------------------------------------------------------------------

const LimitOverrideSchema = z.object({
  analysesPerMonth: z.string().regex(/^(-1|\d*)$/, vmsg('app.validation.wholeNumberLimit')),
  exportsPerMonth: z.string().regex(/^(-1|\d*)$/, vmsg('app.validation.wholeNumberLimit')),
  projects: z.string().regex(/^(-1|\d*)$/, vmsg('app.validation.wholeNumberLimit')),
  storageGb: z.string().regex(/^(-1|\d*)$/, vmsg('app.validation.wholeNumberGbLimit')),
});

function LimitOverrideForm({ detail, onSaved }: { detail: TenantDetail; onSaved: () => void }) {
  const t = useT();
  const errText = useCommercialErrorText();
  const o = detail.organization.limitOverrides;
  const save = useMutation({
    mutationFn: (overrides: Record<string, number>) => setAdminTenantLimits(detail.organization.id, overrides),
    onSuccess: onSaved,
  });
  const form = useForm({
    defaultValues: {
      analysesPerMonth: o.analysesPerMonth !== undefined ? String(o.analysesPerMonth) : '',
      exportsPerMonth: o.exportsPerMonth !== undefined ? String(o.exportsPerMonth) : '',
      projects: o.projects !== undefined ? String(o.projects) : '',
      storageGb: o.storageBytes !== undefined ? String(o.storageBytes === -1 ? -1 : Math.round(o.storageBytes / 1024 ** 3)) : '',
    },
    validators: { onChange: LimitOverrideSchema, onSubmit: LimitOverrideSchema },
    onSubmit: async ({ value }) => {
      const out: Record<string, number> = {};
      if (value.analysesPerMonth !== '') out.analysesPerMonth = Number(value.analysesPerMonth);
      if (value.exportsPerMonth !== '') out.exportsPerMonth = Number(value.exportsPerMonth);
      if (value.projects !== '') out.projects = Number(value.projects);
      if (value.storageGb !== '') out.storageBytes = value.storageGb === '-1' ? -1 : Number(value.storageGb) * 1024 ** 3;
      await save.mutateAsync(out);
    },
  });
  const fields: Array<[keyof z.infer<typeof LimitOverrideSchema>, string]> = (
    ['analysesPerMonth', 'exportsPerMonth', 'projects', 'storageGb'] as const
  ).map((k) => [k, t(`app.admin.supportConsole.limits.${k}`)]);
  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <Guard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
            className="space-y-3"
            aria-label={t('app.admin.supportConsole.limitsLabel')}
          >
            <div className="grid gap-3 sm:grid-cols-4">
              {fields.map(([name, label]) => (
                <form.Field
                  key={name}
                  name={name}
                  children={(field) => (
                    <FormField id={`limit-${name}`} name={field.name} label={label} error={field.state.meta.errors as any}>
                      <FormInput inputMode="numeric" placeholder={t('app.admin.supportConsole.planDefault')} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                    </FormField>
                  )}
                />
              ))}
            </div>
            {save.isError && <p role="alert" className="text-xs text-destructive">{errText(save.error)}</p>}
            {save.isSuccess && !isDirty && <p role="status" className="text-xs">{t('app.admin.supportConsole.limitsSaved')}</p>}
            <button type="submit" disabled={!isDirty || !canSubmit || isSubmitting} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {isSubmitting ? t('app.admin.supportConsole.saving') : t('app.admin.supportConsole.saveLimits')}
            </button>
          </form>
        </Guard>
      )}
    />
  );
}

function Guard({ isDirty, isSubmitting, children }: { isDirty: boolean; isSubmitting: boolean; children: React.ReactNode }) {
  useUnsavedChangesGuard({ isDirty, isSubmitting });
  return <>{children}</>;
}

export function SupportConsolePanel() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [submitted, setSubmitted] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const [reasonSubmitted, setReasonSubmitted] = React.useState<string | undefined>(undefined);
  const [ticketFilter, setTicketFilter] = React.useState('OPEN');

  const results = useQuery({
    queryKey: ['admin', 'tenant-search', submitted],
    queryFn: () => searchAdminTenants(submitted),
    enabled: submitted.length >= 2,
  });
  const detail = useQuery({
    queryKey: ['admin', 'tenant-detail', selected, reasonSubmitted],
    queryFn: () => fetchAdminTenantDetailWithReason(selected!, reasonSubmitted),
    enabled: !!selected,
    retry: false,
  });
  const tickets = useQuery({ queryKey: ['admin', 'tickets', ticketFilter], queryFn: () => fetchAdminTickets(ticketFilter || undefined) });
  const ticketStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateAdminTicketStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tickets'] }),
  });
  const plan = useMutation({
    mutationFn: (tier: PlanTierId) => setAdminTenantPlan(selected!, tier),
    onSuccess: () => detail.refetch(),
  });

  const needsReason = detail.isError && errorMessage(detail.error).includes('break-glass');

  return (
    <div className="space-y-4" data-testid="admin-support">
      <div className={card}>
        <h3 className="text-sm font-semibold mb-3 inline-flex items-center gap-2"><LifeBuoy className="size-4" aria-hidden="true" /> {t('app.admin.supportConsole.lookupTitle')}</h3>
        <form
          className="flex gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(search.trim());
          }}
        >
          <label htmlFor="tenant-search" className="sr-only">{t('app.admin.supportConsole.searchLabel')}</label>
          <input
            id="tenant-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('app.admin.supportConsole.searchLabel')}
            className="flex-1 min-w-0 h-9 rounded-lg border border-input bg-background px-3 text-sm"
          />
          <button type="submit" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-muted">
            <Search className="size-4" aria-hidden="true" /> {t('app.admin.supportConsole.search')}
          </button>
        </form>
        {results.isError && <div className="mt-3"><ErrorState title={t('app.admin.supportConsole.searchFailed')} error={results.error} /></div>}
        {results.data && results.data.length === 0 && <p className="mt-3 text-sm text-muted-foreground">{t('app.admin.supportConsole.noMatch', { query: submitted })}</p>}
        {results.data && results.data.length > 0 && (
          <ul className="mt-3 divide-y divide-border text-sm">
            {results.data.map((tenant) => (
              <li key={tenant.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  <strong>{tenant.name}</strong>{' '}
                  <span className="text-muted-foreground">({tenant.slug}) · {tenant.planTier} · {label('app.projects.status', tenant.status)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(tenant.id);
                    setReasonSubmitted(undefined);
                  }}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                >
                  {t('app.admin.supportConsole.open')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className={card} aria-live="polite">
          {detail.isLoading ? (
            <SkeletonBlock className="h-40" />
          ) : needsReason ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim().length >= 5) setReasonSubmitted(reason.trim());
              }}
            >
              <Notice tone="warning" title={t('app.admin.supportConsole.noGrantTitle')}>
                {t('app.admin.supportConsole.noGrantBody')}
              </Notice>
              <FormField id="break-glass-reason" label={t('app.admin.supportConsole.reason')} required error={reason && reason.trim().length < 5 ? vmsg('app.validation.minChars', { min: 5 }) : undefined}>
                <FormInput value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
              <button type="submit" disabled={reason.trim().length < 5} className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-50">
                <ShieldAlert className="size-3.5 inline mr-1" aria-hidden="true" /> {t('app.admin.supportConsole.openWithReason')}
              </button>
            </form>
          ) : detail.isError ? (
            <ErrorState title={t('app.admin.supportConsole.openFailed')} error={detail.error} onRetry={() => detail.refetch()} />
          ) : detail.data ? (
            <TenantDetailView detail={detail.data} onChanged={() => detail.refetch()} onPlan={(t) => plan.mutate(t)} planPending={plan.isPending} planError={plan.error} />
          ) : null}
        </div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t('app.admin.supportConsole.ticketsTitle')}</h3>
          <label className="text-sm inline-flex items-center gap-2">
            {t('app.admin.supportConsole.statusFilter')}
            <select value={ticketFilter} onChange={(e) => setTicketFilter(e.target.value)} className="h-8 rounded border border-input bg-background px-2 text-sm">
              <option value="">{t('app.admin.supportConsole.all')}</option>
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{label('app.support.ticketStatus', s)}</option>)}
            </select>
          </label>
        </div>
        {tickets.isLoading ? (
          <SkeletonBlock className="h-20" />
        ) : tickets.isError ? (
          <ErrorState title={t('app.admin.supportConsole.ticketsFailed')} error={tickets.error} onRetry={() => tickets.refetch()} />
        ) : tickets.data!.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('app.admin.supportConsole.noTickets')}</p>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {tickets.data!.map((ticket) => (
              <li key={ticket.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <strong>{ticket.subject}</strong>{' '}
                  <span className="text-muted-foreground">
                    · {label('app.support.categories', ticket.category)} · {ticket.organizationName} · {ticket.createdByEmail ?? '—'} · {fmt.dateTime(ticket.createdAt)}
                  </span>
                  {ticket.correlationId && <span className="block font-mono text-muted-foreground">{t('app.admin.supportConsole.correlation', { id: ticket.correlationId })}</span>}
                  <span className="block text-muted-foreground line-clamp-2">{ticket.description}</span>
                </span>
                <label className="inline-flex items-center gap-1">
                  <span className="sr-only">{t('app.admin.supportConsole.ticketStatusLabel', { subject: ticket.subject })}</span>
                  <select
                    value={ticket.status}
                    onChange={(e) => ticketStatus.mutate({ id: ticket.id, status: e.target.value })}
                    className="h-7 rounded border border-input bg-background px-1 text-xs"
                  >
                    {TICKET_STATUSES.map((s) => <option key={s} value={s}>{label('app.support.ticketStatus', s)}</option>)}
                  </select>
                </label>
                <AdminTicketThread ticketId={ticket.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TenantDetailView({
  detail,
  onChanged,
  onPlan,
  planPending,
  planError,
}: {
  detail: TenantDetail;
  onChanged: () => void;
  onPlan: (tier: PlanTierId) => void;
  planPending: boolean;
  planError: unknown;
}) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useCommercialErrorText();
  const org = detail.organization;
  const [tier, setTier] = React.useState<PlanTierId>(org.planTier as PlanTierId);
  return (
    <div className="space-y-4" data-testid="tenant-detail">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">{org.name}</h3>
          <p className="text-xs text-muted-foreground font-mono">{org.id}</p>
        </div>
        <p className="text-xs">
          {detail.activeSupportGrant
            ? t('app.admin.supportConsole.viaGrant', { date: fmt.dateTime(detail.activeSupportGrant.expiresAt) })
            : t('app.admin.supportConsole.viaBreakGlass')}
        </p>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <dt className="text-muted-foreground">{t('app.admin.supportConsole.plan')}</dt>
        <dd>{t('app.admin.supportConsole.planValue', { plan: org.planTier, effective: detail.usage?.effectiveTier ?? '—' })}</dd>
        <dt className="text-muted-foreground">{t('app.admin.supportConsole.subscription')}</dt>
        <dd>{label('app.commercial.subscription', org.subscriptionStatus)}</dd>
        <dt className="text-muted-foreground">{t('app.admin.supportConsole.trialEnds')}</dt>
        <dd>{fmt.date(org.trial.endsAt)}</dd>
        <dt className="text-muted-foreground">{t('app.admin.supportConsole.members')}</dt>
        <dd>{detail.members.length}</dd>
      </dl>
      {detail.usage && (
        <div className="grid gap-4 sm:grid-cols-2">
          {detail.usage.meters.map((m) => <UsageMeterRow key={m.key} meterKey={m.key} used={m.used} limit={m.limit} unlimited={m.unlimited} />)}
        </div>
      )}
      <div className="border-t border-border pt-3 space-y-3">
        <h4 className="text-sm font-semibold">{t('app.admin.supportConsole.billingOverride')}</h4>
        <div className="flex flex-wrap gap-2 items-end">
          <FormField id="override-plan" label={t('app.admin.supportConsole.planTier')}>
            <FormSelect value={tier} onChange={(e) => setTier(e.target.value as PlanTierId)} options={PLAN_TIERS.map((t) => ({ value: t, label: t }))} />
          </FormField>
          <button type="button" onClick={() => onPlan(tier)} disabled={planPending || tier === org.planTier} className="h-9 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50">
            {planPending ? t('app.admin.supportConsole.applying') : t('app.admin.supportConsole.applyPlan')}
          </button>
        </div>
        {planError ? <p role="alert" className="text-xs text-destructive">{errText(planError)}</p> : null}
        <h4 className="text-sm font-semibold">{t('app.admin.supportConsole.limitOverrides')}</h4>
        <LimitOverrideForm key={JSON.stringify(org.limitOverrides)} detail={detail} onSaved={onChanged} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 border-t border-border pt-3">
        <div>
          <h4 className="text-sm font-semibold mb-1">{t('app.admin.supportConsole.recentAnalyses')}</h4>
          {detail.recentAnalyses.length === 0 ? <p className="text-xs text-muted-foreground">{t('app.admin.supportConsole.none')}</p> : (
            <ul className="text-xs space-y-1">
              {detail.recentAnalyses.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span className="font-mono">{a.id.slice(0, 8)}</span>
                  <span>{a.status === 'FAILED' ? <XCircle className="size-3 inline mr-0.5" aria-hidden="true" /> : null}{a.status} · {t('app.admin.supportConsole.findings', { count: a.findingsCount })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-1">{t('app.admin.supportConsole.auditTail')}</h4>
          <ul className="text-xs space-y-1">
            {detail.auditTail.map((e) => (
              <li key={String(e.sequenceNum)} className="flex justify-between gap-2">
                <span className="font-mono">{e.action}</span>
                <span className="text-muted-foreground">{fmt.dateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Feature flags (C §63)
// -----------------------------------------------------------------------------

const FlagFormSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,99}$/, vmsg('app.validation.keyFormat')),
  description: z.string().max(500),
  enabled: z.boolean(),
  environments: z.array(z.enum(['development', 'test', 'production'])),
  planTiers: z.array(z.enum(PLAN_TIERS as [PlanTierId, ...PlanTierId[]])),
  allowOrganizations: z.string().refine(
    (v) => v.split(/[\s,]+/).filter(Boolean).every((id) => /^[0-9a-f-]{36}$/i.test(id)),
    vmsg('app.validation.uuidList')
  ),
  rolloutPercentage: z.number().int().min(0).max(100),
  betaOnly: z.boolean(),
});
type FlagForm = z.infer<typeof FlagFormSchema>;

function toFormValues(f?: FeatureFlag): FlagForm {
  return {
    key: f?.key ?? '',
    description: f?.description ?? '',
    enabled: f?.enabled ?? false,
    environments: (f?.environments ?? []) as FlagForm['environments'],
    planTiers: (f?.planTiers ?? []) as FlagForm['planTiers'],
    allowOrganizations: (f?.allowOrganizations ?? []).join(', '),
    rolloutPercentage: f?.rolloutPercentage ?? 100,
    betaOnly: f?.betaOnly ?? false,
  };
}

function FlagEditor({ flag, onDone }: { flag?: FeatureFlag; onDone: () => void }) {
  const t = useT();
  const errText = useCommercialErrorText();
  const save = useMutation({
    mutationFn: (v: FlagForm) =>
      upsertAdminFeatureFlag(v.key, {
        description: v.description,
        enabled: v.enabled,
        environments: v.environments,
        planTiers: v.planTiers,
        allowOrganizations: v.allowOrganizations.split(/[\s,]+/).filter(Boolean),
        denyOrganizations: flag?.denyOrganizations ?? [],
        rolloutPercentage: v.rolloutPercentage,
        betaOnly: v.betaOnly,
      }),
    onSuccess: onDone,
  });
  const form = useForm({
    defaultValues: toFormValues(flag),
    validators: { onChange: FlagFormSchema, onSubmit: FlagFormSchema },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value);
    },
  });
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <Guard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
            className="space-y-3 rounded-lg border border-border p-4 bg-muted/20"
            aria-label={flag ? t('app.admin.flags.editLabel', { key: flag.key }) : t('app.admin.flags.newLabel')}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="key" children={(field) => (
                <FormField id="flag-key" name={field.name} label={t('app.admin.flags.key')} required error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} disabled={!!flag} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="description" children={(field) => (
                <FormField id="flag-desc" name={field.name} label={t('app.admin.flags.description')} error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="rolloutPercentage" children={(field) => (
                <FormField id="flag-rollout" name={field.name} label={t('app.admin.flags.rollout')} error={field.state.meta.errors as any}>
                  <FormInput type="number" min={0} max={100} value={String(field.state.value)} onChange={(e) => field.handleChange(Number(e.target.value))} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="allowOrganizations" children={(field) => (
                <FormField id="flag-allow" name={field.name} label={t('app.admin.flags.allow')} error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <form.Field name="enabled" children={(field) => (
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} /> {t('app.admin.flags.enabled')}</label>
              )} />
              <form.Field name="betaOnly" children={(field) => (
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} /> {t('app.admin.flags.beta')}</label>
              )} />
              <form.Field name="environments" children={(field) => (
                <fieldset className="inline-flex items-center gap-3">
                  <legend className="sr-only">{t('app.admin.flags.environments')}</legend>
                  <span className="text-muted-foreground" aria-hidden="true">{t('app.admin.flags.envShort')}</span>
                  {(['development', 'test', 'production'] as const).map((env) => (
                    <label key={env} className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={field.state.value.includes(env)} onChange={() => field.handleChange(toggle(field.state.value, env))} /> {env}
                    </label>
                  ))}
                </fieldset>
              )} />
              <form.Field name="planTiers" children={(field) => (
                <fieldset className="inline-flex flex-wrap items-center gap-3">
                  <legend className="sr-only">{t('app.admin.flags.plans')}</legend>
                  <span className="text-muted-foreground" aria-hidden="true">{t('app.admin.flags.plansShort')}</span>
                  {PLAN_TIERS.map((t) => (
                    <label key={t} className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={field.state.value.includes(t)} onChange={() => field.handleChange(toggle(field.state.value, t))} /> {t}
                    </label>
                  ))}
                </fieldset>
              )} />
            </div>
            <p className="text-xs text-muted-foreground">{t('app.admin.flags.hint')}</p>
            {save.isError && <p role="alert" className="text-xs text-destructive">{errText(save.error)}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={!isDirty || !canSubmit || isSubmitting} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                {isSubmitting ? t('app.admin.flags.saving') : t('app.admin.flags.save')}
              </button>
              <button type="button" onClick={onDone} className="rounded-lg border border-border px-3 py-1.5 text-xs">{t('app.ui.cancel')}</button>
            </div>
          </form>
        </Guard>
      )}
    />
  );
}

export function FeatureFlagsPanel() {
  const t = useT();
  const errText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'feature-flags'], queryFn: fetchAdminFeatureFlags });
  const [editing, setEditing] = React.useState<string | 'new' | null>(null);
  const del = useMutation({
    mutationFn: deleteAdminFeatureFlag,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'feature-flags'] }),
  });
  const done = () => {
    setEditing(null);
    queryClient.invalidateQueries({ queryKey: ['admin', 'feature-flags'] });
  };
  return (
    <div className={`${card} space-y-4`} data-testid="admin-flags">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold inline-flex items-center gap-2"><Flag className="size-4" aria-hidden="true" /> {t('app.admin.flags.title')}{' '}
          {q.data && <span className="text-xs font-normal text-muted-foreground">{t('app.admin.flags.environment', { env: q.data.environment })}</span>}</h3>
        <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">
          <Plus className="size-3.5" aria-hidden="true" /> {t('app.admin.flags.newFlag')}
        </button>
      </div>
      {editing === 'new' && <FlagEditor onDone={done} />}
      {q.isLoading ? (
        <SkeletonBlock className="h-24" />
      ) : q.isError ? (
        <ErrorState title={t('app.admin.flags.loadFailed')} error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('app.admin.flags.empty')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {q.data!.flags.map((f) => (
            <li key={f.key} className="py-2 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-mono font-semibold">{f.key}</span>{' '}
                  <span className="inline-flex items-center gap-1 text-xs">
                    {f.enabled ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <XCircle className="size-3.5" aria-hidden="true" />}
                    {f.enabled ? t('app.admin.flags.on') : t('app.admin.flags.off')}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t('app.admin.flags.summary', {
                      description: f.description || t('app.admin.flags.noDescription'),
                      rollout: f.rolloutPercentage,
                      env: f.environments.join('/') || t('app.admin.flags.all'),
                      plans: f.planTiers.join('/') || t('app.admin.flags.all'),
                    })}
                    {f.betaOnly ? ` · ${t('app.admin.flags.betaOnly')}` : ''} · {t('app.admin.flags.allowListed', { count: f.allowOrganizations.length })}
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => setEditing(editing === f.key ? null : f.key)} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">{t('app.admin.flags.edit')}</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('app.admin.flags.deleteConfirm', { key: f.key }))) del.mutate(f.key);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3" aria-hidden="true" /> {t('app.admin.flags.delete')}
                  </button>
                </span>
              </div>
              {editing === f.key && <FlagEditor flag={f} onDone={done} />}
            </li>
          ))}
        </ul>
      )}
      {del.isError && <p role="alert" className="text-xs text-destructive">{errText(del.error)}</p>}
    </div>
  );
}
