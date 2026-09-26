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
import { ErrorState, Notice, SkeletonBlock, UsageMeterRow, errorMessage } from '@/components/commercial/states';
import {
  fetchAdminBusiness,
  fetchAdminEngines,
  fetchAdminIncidents,
  formatBytes,
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

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
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
  const q = useQuery({ queryKey: ['admin', 'business'], queryFn: fetchAdminBusiness });
  if (q.isLoading) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="h-24" />)}</div>;
  if (q.isError) return <ErrorState title="Could not load business metrics" error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const maxDay = Math.max(1, ...d.analysesPerDay.map((x) => x.total));
  return (
    <div className="space-y-4" data-testid="admin-business">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Estimated MRR" value={eur.format(d.revenue.estimatedMrrEur)} hint={`ARR ${eur.format(d.revenue.estimatedArrEur)} · list prices`} />
        <Kpi label="Active trials" value={d.tenants.activeTrials} hint={`${d.tenants.total} tenants in total`} />
        <Kpi label="Active orgs (30d)" value={d.tenants.activeLast30Days} hint={`${d.activeUsersLast30Days} users signed in (30d)`} />
        <Kpi
          label="Analysis error rate (7d)"
          value={d.analysisErrorRate7d === null ? '—' : `${(d.analysisErrorRate7d * 100).toFixed(1)}%`}
          hint={`${d.analyses7d.failed} failed of ${d.analyses7d.total}`}
        />
      </div>
      <p className="text-xs text-muted-foreground">{d.revenue.basis}{d.revenue.unpricedPaidTenants > 0 ? ` ${d.revenue.unpricedPaidTenants} paid tenant(s) on contract pricing are excluded.` : ''}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <h3 className="text-sm font-semibold mb-3 inline-flex items-center gap-2"><TrendingUp className="size-4" aria-hidden="true" /> Analyses per day (14 days)</h3>
          {d.analysesPerDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">No analyses in the last 14 days.</p>
          ) : (
            <table className="w-full text-xs">
              <caption className="sr-only">Analyses per day with failures</caption>
              <tbody>
                {d.analysesPerDay.map((row) => (
                  <tr key={row.day}>
                    <th scope="row" className="py-1 pr-2 text-left font-normal text-muted-foreground whitespace-nowrap">{row.day}</th>
                    <td className="py-1 w-full">
                      <div className="h-2 rounded bg-primary/70" style={{ width: `${(row.total / maxDay) * 100}%` }} aria-hidden="true" />
                    </td>
                    <td className="py-1 pl-2 tabular-nums whitespace-nowrap">{row.total} run{row.total === 1 ? '' : 's'}{row.failed ? `, ${row.failed} failed` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold mb-3">Tenants by enforced tier / subscription</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {Object.entries(d.tenants.byEffectiveTier).map(([tier, n]) => (
              <React.Fragment key={tier}>
                <dt className="text-muted-foreground">{tier}</dt>
                <dd className="tabular-nums">{n}</dd>
              </React.Fragment>
            ))}
            {Object.entries(d.tenants.bySubscriptionStatus).map(([st, n]) => (
              <React.Fragment key={st}>
                <dt className="text-muted-foreground">Subscription {st}</dt>
                <dd className="tabular-nums">{n}</dd>
              </React.Fragment>
            ))}
            <dt className="text-muted-foreground">Stored data</dt>
            <dd>{formatBytes(d.storageBytes)}</dd>
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
  const q = useQuery({ queryKey: ['admin', 'incidents'], queryFn: fetchAdminIncidents, refetchInterval: 30_000 });
  const engines = useQuery({ queryKey: ['admin', 'engine-registry'], queryFn: fetchAdminEngines });
  return (
    <div className="space-y-4" data-testid="admin-incidents">
      {q.isLoading ? (
        <SkeletonBlock className="h-40" />
      ) : q.isError ? (
        <ErrorState title="Could not load incident data" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {q.data!.queues.map((queue) => (
              <div key={queue.queueName} className={card}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold font-mono">{queue.queueName}</h3>
                  <span className="text-xs inline-flex items-center gap-1">
                    {queue.status === 'ACTIVE' ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <AlertTriangle className="size-3.5" aria-hidden="true" />}
                    {queue.status}
                  </span>
                </div>
                <dl className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                  {Object.entries(queue.counts).map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-muted/40 p-2">
                      <dt className="text-muted-foreground capitalize">{k}</dt>
                      <dd className="text-lg font-bold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <div className={card}>
            <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-2"><ServerCrash className="size-4" aria-hidden="true" /> Failed jobs</h3>
            {q.data!.failedJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No failed BullMQ jobs retained.</p>
            ) : (
              <ul className="divide-y divide-border text-xs">
                {q.data!.failedJobs.map((j) => (
                  <li key={`${j.queue}-${j.jobId}`} className="py-2">
                    <span className="font-mono">{j.queue}/{j.name}#{j.jobId}</span> · {j.failedAt ? new Date(j.failedAt).toLocaleString() : '—'} · attempts {j.attemptsMade}
                    <span className="block text-destructive break-words">{j.failedReason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={card}>
              <h3 className="text-sm font-semibold mb-2">Failed analyses (7 days)</h3>
              {q.data!.failedAnalyses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No failed analyses.</p>
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {q.data!.failedAnalyses.map((a) => (
                    <li key={a.id} className="py-2">
                      <XCircle className="size-3.5 inline mr-1" aria-hidden="true" />
                      <span className="font-semibold">{a.organizationName}</span> · <span className="font-mono">{a.id.slice(0, 8)}</span> ·{' '}
                      {new Date(a.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={card}>
              <h3 className="text-sm font-semibold mb-2">Recent failures &amp; denials (24 h)</h3>
              {q.data!.recentFailureEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No failure events recorded.</p>
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {q.data!.recentFailureEvents.map((e, i) => (
                    <li key={i} className="py-2">
                      <span className="font-mono">{e.action}</span> · {e.organizationName} · {new Date(e.createdAt).toLocaleString()}
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
        <h3 className="text-sm font-semibold mb-2">Analysis service engine registry (live)</h3>
        {engines.isLoading ? (
          <SkeletonBlock className="h-16" />
        ) : engines.isError ? (
          <ErrorState title="Engine registry unavailable" error={engines.error} onRetry={() => engines.refetch()} />
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2" data-testid="engine-registry-summary">
              Service {engines.data!.summary.serviceStatus}
              {engines.data!.summary.serviceVersion ? ` v${engines.data!.summary.serviceVersion}` : ''} ·{' '}
              {engines.data!.summary.registeredCount} engines registered · checked {new Date(engines.data!.summary.checkedAt).toLocaleTimeString()}
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
  analysesPerMonth: z.string().regex(/^(-1|\d*)$/, 'Whole number, -1 for unlimited, empty for plan default'),
  exportsPerMonth: z.string().regex(/^(-1|\d*)$/, 'Whole number, -1 for unlimited, empty for plan default'),
  projects: z.string().regex(/^(-1|\d*)$/, 'Whole number, -1 for unlimited, empty for plan default'),
  storageGb: z.string().regex(/^(-1|\d*)$/, 'Whole number of GB, -1 for unlimited, empty for plan default'),
});

function LimitOverrideForm({ detail, onSaved }: { detail: TenantDetail; onSaved: () => void }) {
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
  const fields: Array<[keyof z.infer<typeof LimitOverrideSchema>, string]> = [
    ['analysesPerMonth', 'Analyses / month'],
    ['exportsPerMonth', 'Exports / month'],
    ['projects', 'Projects'],
    ['storageGb', 'Storage (GB)'],
  ];
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
            aria-label="Tenant limit overrides"
          >
            <div className="grid gap-3 sm:grid-cols-4">
              {fields.map(([name, label]) => (
                <form.Field
                  key={name}
                  name={name}
                  children={(field) => (
                    <FormField id={`limit-${name}`} name={field.name} label={label} error={field.state.meta.errors as any}>
                      <FormInput inputMode="numeric" placeholder="plan default" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                    </FormField>
                  )}
                />
              ))}
            </div>
            {save.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(save.error)}</p>}
            {save.isSuccess && !isDirty && <p role="status" className="text-xs">Overrides saved and audited in the tenant ledger.</p>}
            <button type="submit" disabled={!isDirty || !canSubmit || isSubmitting} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              {isSubmitting ? 'Saving…' : 'Save limit overrides'}
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
        <h3 className="text-sm font-semibold mb-3 inline-flex items-center gap-2"><LifeBuoy className="size-4" aria-hidden="true" /> Tenant lookup (read-only)</h3>
        <form
          className="flex gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(search.trim());
          }}
        >
          <label htmlFor="tenant-search" className="sr-only">Organization name, slug, id or member e-mail</label>
          <input
            id="tenant-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Organization name, slug, id or member e-mail"
            className="flex-1 h-9 rounded-lg border border-input bg-background px-3 text-sm"
          />
          <button type="submit" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-muted">
            <Search className="size-4" aria-hidden="true" /> Search
          </button>
        </form>
        {results.isError && <div className="mt-3"><ErrorState title="Search failed" error={results.error} /></div>}
        {results.data && results.data.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No tenants match “{submitted}”.</p>}
        {results.data && results.data.length > 0 && (
          <ul className="mt-3 divide-y divide-border text-sm">
            {results.data.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-2">
                <span>
                  <strong>{t.name}</strong> <span className="text-muted-foreground">({t.slug}) · {t.planTier} · {t.status}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(t.id);
                    setReasonSubmitted(undefined);
                  }}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                >
                  Open
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
              <Notice tone="warning" title="No active support-access grant from this tenant">
                Viewing tenant data without a grant is a break-glass action. It is recorded in the customer&apos;s audit log with your reason.
              </Notice>
              <FormField id="break-glass-reason" label="Break-glass reason" required error={reason && reason.trim().length < 5 ? 'At least 5 characters' : undefined}>
                <FormInput value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
              <button type="submit" disabled={reason.trim().length < 5} className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-50">
                <ShieldAlert className="size-3.5 inline mr-1" aria-hidden="true" /> Open with reason
              </button>
            </form>
          ) : detail.isError ? (
            <ErrorState title="Could not open tenant" error={detail.error} onRetry={() => detail.refetch()} />
          ) : detail.data ? (
            <TenantDetailView detail={detail.data} onChanged={() => detail.refetch()} onPlan={(t) => plan.mutate(t)} planPending={plan.isPending} planError={plan.error} />
          ) : null}
        </div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Support tickets</h3>
          <label className="text-xs inline-flex items-center gap-2">
            Status
            <select value={ticketFilter} onChange={(e) => setTicketFilter(e.target.value)} className="h-8 rounded border border-input bg-background px-2 text-xs">
              <option value="">All</option>
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {tickets.isLoading ? (
          <SkeletonBlock className="h-20" />
        ) : tickets.isError ? (
          <ErrorState title="Could not load tickets" error={tickets.error} onRetry={() => tickets.refetch()} />
        ) : tickets.data!.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tickets with this status.</p>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {tickets.data!.map((t) => (
              <li key={t.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <strong>{t.subject}</strong> <span className="text-muted-foreground">· {t.category} · {t.organizationName} · {t.createdByEmail ?? '—'} · {new Date(t.createdAt).toLocaleString()}</span>
                  {t.correlationId && <span className="block font-mono text-muted-foreground">correlation {t.correlationId}</span>}
                  <span className="block text-muted-foreground line-clamp-2">{t.description}</span>
                </span>
                <label className="inline-flex items-center gap-1">
                  <span className="sr-only">Status of ticket {t.subject}</span>
                  <select
                    value={t.status}
                    onChange={(e) => ticketStatus.mutate({ id: t.id, status: e.target.value })}
                    className="h-7 rounded border border-input bg-background px-1 text-xs"
                  >
                    {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
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
            ? `Access via tenant grant until ${new Date(detail.activeSupportGrant.expiresAt).toLocaleString()}`
            : 'Access via break-glass (audited)'}
        </p>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <dt className="text-muted-foreground">Plan</dt><dd>{org.planTier} (enforced {detail.usage?.effectiveTier ?? '—'})</dd>
        <dt className="text-muted-foreground">Subscription</dt><dd>{org.subscriptionStatus}</dd>
        <dt className="text-muted-foreground">Trial ends</dt><dd>{org.trial.endsAt ? new Date(org.trial.endsAt).toLocaleDateString() : '—'}</dd>
        <dt className="text-muted-foreground">Members</dt><dd>{detail.members.length}</dd>
      </dl>
      {detail.usage && (
        <div className="grid gap-4 sm:grid-cols-2">
          {detail.usage.meters.map((m) => <UsageMeterRow key={m.key} meterKey={m.key} used={m.used} limit={m.limit} unlimited={m.unlimited} />)}
        </div>
      )}
      <div className="border-t border-border pt-3 space-y-3">
        <h4 className="text-xs font-semibold">Billing override (enterprise / invoice agreements)</h4>
        <div className="flex gap-2 items-end">
          <FormField id="override-plan" label="Plan tier">
            <FormSelect value={tier} onChange={(e) => setTier(e.target.value as PlanTierId)} options={PLAN_TIERS.map((t) => ({ value: t, label: t }))} />
          </FormField>
          <button type="button" onClick={() => onPlan(tier)} disabled={planPending || tier === org.planTier} className="h-9 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50">
            {planPending ? 'Applying…' : 'Apply plan'}
          </button>
        </div>
        {planError ? <p role="alert" className="text-xs text-destructive">{errorMessage(planError)}</p> : null}
        <h4 className="text-xs font-semibold">Limit overrides</h4>
        <LimitOverrideForm key={JSON.stringify(org.limitOverrides)} detail={detail} onSaved={onChanged} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 border-t border-border pt-3">
        <div>
          <h4 className="text-xs font-semibold mb-1">Recent analyses</h4>
          {detail.recentAnalyses.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
            <ul className="text-xs space-y-1">
              {detail.recentAnalyses.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span className="font-mono">{a.id.slice(0, 8)}</span>
                  <span>{a.status === 'FAILED' ? <XCircle className="size-3 inline mr-0.5" aria-hidden="true" /> : null}{a.status} · {a.findingsCount} findings</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold mb-1">Audit tail</h4>
          <ul className="text-xs space-y-1">
            {detail.auditTail.map((e) => (
              <li key={String(e.sequenceNum)} className="flex justify-between gap-2">
                <span className="font-mono">{e.action}</span>
                <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
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
  key: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,99}$/, 'lower-case letters, digits, dot, dash, underscore'),
  description: z.string().max(500),
  enabled: z.boolean(),
  environments: z.array(z.enum(['development', 'test', 'production'])),
  planTiers: z.array(z.enum(PLAN_TIERS as [PlanTierId, ...PlanTierId[]])),
  allowOrganizations: z.string().refine(
    (v) => v.split(/[\s,]+/).filter(Boolean).every((id) => /^[0-9a-f-]{36}$/i.test(id)),
    'Comma-separated organization UUIDs'
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
            aria-label={flag ? `Edit flag ${flag.key}` : 'New feature flag'}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="key" children={(field) => (
                <FormField id="flag-key" name={field.name} label="Key" required error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} disabled={!!flag} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="description" children={(field) => (
                <FormField id="flag-desc" name={field.name} label="Description" error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="rolloutPercentage" children={(field) => (
                <FormField id="flag-rollout" name={field.name} label="Rollout % (user cohort)" error={field.state.meta.errors as any}>
                  <FormInput type="number" min={0} max={100} value={String(field.state.value)} onChange={(e) => field.handleChange(Number(e.target.value))} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="allowOrganizations" children={(field) => (
                <FormField id="flag-allow" name={field.name} label="Always on for organizations (UUIDs)" error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
            </div>
            <div className="flex flex-wrap gap-6 text-xs">
              <form.Field name="enabled" children={(field) => (
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} /> Enabled (kill switch)</label>
              )} />
              <form.Field name="betaOnly" children={(field) => (
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} /> Beta organizations only</label>
              )} />
              <form.Field name="environments" children={(field) => (
                <fieldset className="inline-flex items-center gap-3">
                  <legend className="sr-only">Environments</legend>
                  <span className="text-muted-foreground">Env:</span>
                  {(['development', 'test', 'production'] as const).map((env) => (
                    <label key={env} className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={field.state.value.includes(env)} onChange={() => field.handleChange(toggle(field.state.value, env))} /> {env}
                    </label>
                  ))}
                </fieldset>
              )} />
              <form.Field name="planTiers" children={(field) => (
                <fieldset className="inline-flex flex-wrap items-center gap-3">
                  <legend className="sr-only">Plans</legend>
                  <span className="text-muted-foreground">Plans:</span>
                  {PLAN_TIERS.map((t) => (
                    <label key={t} className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={field.state.value.includes(t)} onChange={() => field.handleChange(toggle(field.state.value, t))} /> {t}
                    </label>
                  ))}
                </fieldset>
              )} />
            </div>
            <p className="text-xs text-muted-foreground">Empty environment / plan selections mean “all”. Changes apply within 15 seconds without a redeploy and are audited.</p>
            {save.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(save.error)}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={!isDirty || !canSubmit || isSubmitting} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                {isSubmitting ? 'Saving…' : 'Save flag'}
              </button>
              <button type="button" onClick={onDone} className="rounded-lg border border-border px-3 py-1.5 text-xs">Cancel</button>
            </div>
          </form>
        </Guard>
      )}
    />
  );
}

export function FeatureFlagsPanel() {
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
        <h3 className="text-sm font-semibold inline-flex items-center gap-2"><Flag className="size-4" aria-hidden="true" /> Feature flags {q.data && <span className="text-xs font-normal text-muted-foreground">(environment: {q.data.environment})</span>}</h3>
        <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">
          <Plus className="size-3.5" aria-hidden="true" /> New flag
        </button>
      </div>
      {editing === 'new' && <FlagEditor onDone={done} />}
      {q.isLoading ? (
        <SkeletonBlock className="h-24" />
      ) : q.isError ? (
        <ErrorState title="Could not load feature flags" error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feature flags defined yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {q.data!.flags.map((f) => (
            <li key={f.key} className="py-2 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-mono font-semibold">{f.key}</span>{' '}
                  <span className="inline-flex items-center gap-1 text-xs">
                    {f.enabled ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <XCircle className="size-3.5" aria-hidden="true" />}
                    {f.enabled ? 'On' : 'Off'}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {f.description || 'No description'} · rollout {f.rolloutPercentage}% · env {f.environments.join('/') || 'all'} · plans{' '}
                    {f.planTiers.join('/') || 'all'}{f.betaOnly ? ' · beta only' : ''} · {f.allowOrganizations.length} allow-listed org(s)
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => setEditing(editing === f.key ? null : f.key)} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">Edit</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete feature flag ${f.key}?`)) del.mutate(f.key);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3" aria-hidden="true" /> Delete
                  </button>
                </span>
              </div>
              {editing === f.key && <FlagEditor flag={f} onDone={done} />}
            </li>
          ))}
        </ul>
      )}
      {del.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(del.error)}</p>}
    </div>
  );
}
