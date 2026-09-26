'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, CreditCard, ExternalLink, FileText, Loader2, Minus, Sparkles } from 'lucide-react';
import { SettingsNav } from '@/components/settings/settings-nav';
import {
  ErrorState,
  Notice,
  SkeletonBlock,
  SubscriptionStatusBadge,
  UsageMeterRow,
  errorMessage,
} from '@/components/commercial/states';
import {
  fetchBillingOverview,
  fetchInvoices,
  fetchPlanCatalog,
  formatMeterValue,
  openBillingPortal,
  startCheckout,
  type PlanCatalogEntry,
} from '@/lib/api/commercial';
import { ApiError } from '@/lib/api/custom-instance';
import type { PlanTierId } from '@erppreflight/schemas';

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function nextPeriodReset(periodStart: string): string {
  const d = new Date(periodStart);
  return formatDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString());
}

function BillingPageInner() {
  const searchParams = useSearchParams();
  const returnStatus = searchParams.get('status');

  const overview = useQuery({ queryKey: ['billing', 'overview'], queryFn: fetchBillingOverview });
  const catalog = useQuery({ queryKey: ['billing', 'plans'], queryFn: fetchPlanCatalog, staleTime: 5 * 60_000 });
  const providerConfigured = overview.data?.provider.configured ?? false;
  const invoices = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: fetchInvoices,
    enabled: providerConfigured,
    retry: false,
  });

  const returnUrl = typeof window !== 'undefined' ? `${window.location.origin}/settings/billing` : '';

  const checkout = useMutation({
    mutationFn: (tier: PlanTierId) => startCheckout(tier, returnUrl),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const portal = useMutation({
    mutationFn: () => openBillingPortal(returnUrl),
    onSuccess: ({ url }) => window.location.assign(url),
  });

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <SettingsNav />
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Plan &amp; billing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your subscription, trial and metered usage for the current billing period. Limits are enforced server-side.
          </p>
        </header>

        <div className="space-y-6">
          {returnStatus === 'success' && (
            <Notice tone="success" title="Checkout completed">
              Your subscription is activated as soon as the payment provider confirms it (usually a few seconds).
            </Notice>
          )}
          {returnStatus === 'cancelled' && <Notice tone="info" title="Checkout cancelled">No changes were made to your plan.</Notice>}

          {overview.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading billing overview">
              <SkeletonBlock className="h-44" />
              <SkeletonBlock className="h-44" />
            </div>
          ) : overview.isError ? (
            <ErrorState title="Could not load billing overview" error={overview.error} onRetry={() => overview.refetch()} />
          ) : overview.data ? (
            <>
              {!providerConfigured && (
                <Notice tone="warning" title="Billing is not configured on this deployment">
                  Online checkout, the customer portal and invoices are unavailable until the operator configures the payment
                  provider. Plan limits and usage metering still apply.
                </Notice>
              )}
              {overview.data.subscriptionStatus === 'PAST_DUE' && (
                <Notice tone="warning" title="Payment past due">
                  The last invoice could not be charged. Update your payment method in the billing portal to keep your plan.
                </Notice>
              )}

              <section className="grid gap-4 md:grid-cols-2" aria-label="Current plan">
                <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Current plan</p>
                      <p className="text-xl font-bold mt-0.5" data-testid="current-plan">
                        {catalog.data?.plans.find((p) => p.tier === overview.data.planTier)?.displayName ?? overview.data.planTier}
                      </p>
                    </div>
                    <SubscriptionStatusBadge status={overview.data.subscriptionStatus} />
                  </div>
                  {overview.data.effectiveTier !== overview.data.planTier && (
                    <p className="text-sm">
                      Limits currently enforced: <strong>{overview.data.effectiveTier}</strong>
                      {overview.data.trial.active ? ' (trial)' : ''}
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-muted-foreground">Renews / ends</dt>
                    <dd>{formatDate(overview.data.currentPeriodEnd)}</dd>
                    <dt className="text-muted-foreground">Cancels at period end</dt>
                    <dd>{overview.data.cancelAtPeriodEnd ? 'Yes' : 'No'}</dd>
                    <dt className="text-muted-foreground">Usage resets</dt>
                    <dd>{nextPeriodReset(overview.data.periodStart)}</dd>
                  </dl>
                  {overview.data.hasLimitOverrides && (
                    <p className="text-xs text-muted-foreground">Custom limits agreed with ERP Preflight apply to this organization.</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => portal.mutate()}
                      disabled={!providerConfigured || portal.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      {portal.isPending ? (
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <CreditCard className="size-4" aria-hidden="true" />
                      )}
                      Manage billing
                    </button>
                  </div>
                  {portal.isError && (
                    <p role="alert" className="text-xs text-destructive">
                      {portal.error instanceof ApiError && portal.error.statusCode === 409
                        ? 'No billing account yet — choose a plan below first.'
                        : errorMessage(portal.error)}
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-card p-5 space-y-3" aria-label="Trial">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
                    <Sparkles className="size-3.5" aria-hidden="true" /> Trial
                  </p>
                  {overview.data.trial.active ? (
                    <>
                      <p className="text-lg font-semibold" data-testid="trial-state">
                        {overview.data.trial.tier} trial — {overview.data.trial.daysRemaining} day
                        {overview.data.trial.daysRemaining === 1 ? '' : 's'} left
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Ends {formatDate(overview.data.trial.endsAt)}. Afterwards the workspace returns to the{' '}
                        <strong>{overview.data.planTier}</strong> limits unless you subscribe. No data is deleted by the downgrade.
                      </p>
                    </>
                  ) : overview.data.trial.endsAt ? (
                    <p className="text-sm text-muted-foreground" data-testid="trial-state">
                      Trial ended {formatDate(overview.data.trial.endsAt)}.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground" data-testid="trial-state">
                      No trial applies to this organization.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="usage-heading">
                <h2 id="usage-heading" className="text-base font-semibold mb-4">
                  Usage this period
                </h2>
                <div className="grid gap-5 sm:grid-cols-2">
                  {overview.data.meters.map((m) => (
                    <UsageMeterRow key={m.key} meterKey={m.key} used={m.used} limit={m.limit} unlimited={m.unlimited} />
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Also metered this period: {formatMeterValue('count', overview.data.metered.ENGINE_EXECUTION ?? 0)} engine
                  executions, {formatMeterValue('count', overview.data.metered.ARTIFACT_UPLOAD ?? 0)} uploads (
                  {formatMeterValue('storageBytes', overview.data.metered.ARTIFACT_BYTES ?? 0)}).
                </p>
              </section>
            </>
          ) : null}

          <section aria-labelledby="plans-heading">
            <h2 id="plans-heading" className="text-base font-semibold mb-3">
              Plans
            </h2>
            {catalog.isLoading ? (
              <div className="grid gap-4 md:grid-cols-3">
                <SkeletonBlock className="h-64" />
                <SkeletonBlock className="h-64" />
                <SkeletonBlock className="h-64" />
              </div>
            ) : catalog.isError ? (
              <ErrorState title="Could not load plans" error={catalog.error} onRetry={() => catalog.refetch()} />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {catalog.data?.plans.map((plan) => (
                  <PlanCard
                    key={plan.tier}
                    plan={plan}
                    current={overview.data?.planTier === plan.tier}
                    canCheckout={providerConfigured && plan.purchasable}
                    pending={checkout.isPending && checkout.variables === plan.tier}
                    onUpgrade={() => checkout.mutate(plan.tier)}
                  />
                ))}
              </div>
            )}
            {checkout.isError && (
              <div className="mt-3">
                <ErrorState title="Checkout could not be started" error={checkout.error} />
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="invoices-heading">
            <h2 id="invoices-heading" className="text-base font-semibold mb-3 inline-flex items-center gap-2">
              <FileText className="size-4" aria-hidden="true" /> Invoices
            </h2>
            {!providerConfigured ? (
              <p className="text-sm text-muted-foreground">Invoices are provided by the payment provider, which is not configured.</p>
            ) : invoices.isLoading ? (
              <SkeletonBlock className="h-24" />
            ) : invoices.isError ? (
              <ErrorState title="Could not load invoices" error={invoices.error} onRetry={() => invoices.refetch()} />
            ) : invoices.data && invoices.data.invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3 font-medium">Invoice</th>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium text-right">Amount</th>
                      <th className="py-2 font-medium">
                        <span className="sr-only">Links</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.data?.invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-border/60">
                        <td className="py-2 pr-3 font-mono text-xs">{inv.number ?? inv.id}</td>
                        <td className="py-2 pr-3">{formatDate(inv.createdAt)}</td>
                        <td className="py-2 pr-3">{inv.status ?? '—'}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {new Intl.NumberFormat(undefined, { style: 'currency', currency: inv.currency }).format(inv.amountDue / 100)}
                        </td>
                        <td className="py-2">
                          {inv.hostedInvoiceUrl && (
                            <a
                              href={inv.hostedInvoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              View <ExternalLink className="size-3" aria-hidden="true" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  canCheckout,
  pending,
  onUpgrade,
}: {
  plan: PlanCatalogEntry;
  current: boolean;
  canCheckout: boolean;
  pending: boolean;
  onUpgrade: () => void;
}) {
  const limitRows: Array<[string, string]> = [
    ['projects', 'Projects'],
    ['analysesPerMonth', 'Analyses / month'],
    ['storageBytes', 'Storage'],
    ['exportsPerMonth', 'Report exports / month'],
    ['teamMembers', 'Team members'],
  ];
  return (
    <article
      className={`rounded-xl border bg-card p-5 flex flex-col gap-3 ${current ? 'border-primary ring-1 ring-primary/40' : 'border-border'}`}
      aria-label={`${plan.displayName} plan${current ? ' (current)' : ''}`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{plan.displayName}</h3>
          {current && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-xs font-semibold text-primary">
              <Check className="size-3.5" aria-hidden="true" /> Current
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{plan.summary}</p>
      </div>
      <p className="text-2xl font-bold">
        {plan.monthlyPriceEur === null ? (
          'Contact sales'
        ) : plan.monthlyPriceEur === 0 ? (
          'Free'
        ) : (
          <>
            {eur.format(plan.monthlyPriceEur)}
            <span className="text-sm font-normal text-muted-foreground"> / month, excl. VAT</span>
          </>
        )}
      </p>
      <ul className="space-y-1 text-sm">
        {limitRows.map(([key, label]) => {
          const v = plan.limits[key];
          return (
            <li key={key} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums">{v === -1 ? 'Unlimited' : formatMeterValue(key, v ?? 0)}</span>
            </li>
          );
        })}
        {(
          [
            ['agentGate', 'Agent change gate'],
            ['cloudAlmSync', 'Cloud ALM / Jira sync'],
            ['reportBranding', 'Branded reports'],
          ] as const
        ).map(([key, label]) => (
          <li key={key} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            {plan.features[key] ? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3.5" aria-hidden="true" /> Included
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Minus className="size-3.5" aria-hidden="true" /> Not included
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-2">
        {current ? null : plan.purchasable ? (
          <button
            type="button"
            onClick={onUpgrade}
            disabled={!canCheckout || pending}
            title={canCheckout ? undefined : 'Billing is not configured on this deployment'}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}
            Choose {plan.displayName}
          </button>
        ) : plan.monthlyPriceEur === null ? (
          <Link
            href="/procurement"
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"
          >
            Contact sales
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export default function BillingSettingsPage() {
  return (
    <React.Suspense fallback={<div className="p-8"><SkeletonBlock className="h-40 max-w-5xl mx-auto" /></div>}>
      <BillingPageInner />
    </React.Suspense>
  );
}
