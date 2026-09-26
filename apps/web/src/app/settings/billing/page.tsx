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
  useCommercialErrorText,
  useMeterFormat,
} from '@/components/commercial/states';
import {
  fetchBillingOverview,
  fetchInvoices,
  fetchPlanCatalog,
  openBillingPortal,
  startCheckout,
  type PlanCatalogEntry,
} from '@/lib/api/commercial';
import { ApiError } from '@/lib/api/custom-instance';
import type { PlanTierId } from '@erppreflight/schemas';
import { useFmt, useLabel, useMessages, useRichT, useT } from '@/i18n/client';

function nextPeriodReset(periodStart: string): string {
  const d = new Date(periodStart);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

function BillingPageInner() {
  const t = useT();
  const rt = useRichT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useCommercialErrorText();
  const formatMeter = useMeterFormat();
  const formatDate = fmt.date;
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
    <div className="text-foreground">
      <div className="max-w-5xl mx-auto">
        <SettingsNav />
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{t('app.billing.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('app.billing.subtitle')}</p>
        </header>

        <div className="space-y-6">
          {returnStatus === 'success' && (
            <Notice tone="success" title={t('app.billing.checkoutDoneTitle')}>
              {t('app.billing.checkoutDoneBody')}
            </Notice>
          )}
          {returnStatus === 'cancelled' && <Notice tone="info" title={t('app.billing.checkoutCancelledTitle')}>{t('app.billing.checkoutCancelledBody')}</Notice>}

          {overview.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label={t('app.billing.loadingOverview')}>
              <SkeletonBlock className="h-44" />
              <SkeletonBlock className="h-44" />
            </div>
          ) : overview.isError ? (
            <ErrorState title={t('app.billing.overviewFailed')} error={overview.error} onRetry={() => overview.refetch()} />
          ) : overview.data ? (
            <>
              {!providerConfigured && (
                <Notice tone="warning" title={t('app.billing.notConfiguredTitle')}>
                  {t('app.billing.notConfiguredBody')}
                </Notice>
              )}
              {overview.data.subscriptionStatus === 'PAST_DUE' && (
                <Notice tone="warning" title={t('app.billing.pastDueTitle')}>
                  {t('app.billing.pastDueBody')}
                </Notice>
              )}

              <section className="grid gap-4 md:grid-cols-2" aria-label={t('app.billing.currentPlanLabel')}>
                <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('app.billing.currentPlan')}</p>
                      <p className="text-xl font-bold mt-0.5" data-testid="current-plan">
                        {catalog.data?.plans.find((p) => p.tier === overview.data.planTier)?.displayName ?? overview.data.planTier}
                      </p>
                    </div>
                    <SubscriptionStatusBadge status={overview.data.subscriptionStatus} />
                  </div>
                  {overview.data.effectiveTier !== overview.data.planTier && (
                    <p className="text-sm">
                      {overview.data.trial.active
                        ? t('app.billing.enforcedTrial', { tier: overview.data.effectiveTier })
                        : t('app.billing.enforced', { tier: overview.data.effectiveTier })}
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-muted-foreground">{t('app.billing.renews')}</dt>
                    <dd>{formatDate(overview.data.currentPeriodEnd)}</dd>
                    <dt className="text-muted-foreground">{t('app.billing.cancelsAtEnd')}</dt>
                    <dd>{overview.data.cancelAtPeriodEnd ? t('app.ui.yes') : t('app.ui.no')}</dd>
                    <dt className="text-muted-foreground">{t('app.billing.usageResets')}</dt>
                    <dd>{formatDate(nextPeriodReset(overview.data.periodStart))}</dd>
                  </dl>
                  {overview.data.hasLimitOverrides && (
                    <p className="text-xs text-muted-foreground">{t('app.billing.customLimits')}</p>
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
                      {t('app.billing.manage')}
                    </button>
                  </div>
                  {portal.isError && (
                    <p role="alert" className="text-xs text-destructive">
                      {portal.error instanceof ApiError && portal.error.statusCode === 409
                        ? t('app.billing.noBillingAccount')
                        : errText(portal.error)}
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-card p-5 space-y-3" aria-label={t('app.billing.trial')}>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
                    <Sparkles className="size-3.5" aria-hidden="true" /> {t('app.billing.trial')}
                  </p>
                  {overview.data.trial.active ? (
                    <>
                      <p className="text-lg font-semibold" data-testid="trial-state">
                        {t('app.billing.trialActive', { tier: overview.data.trial.tier ?? '', count: overview.data.trial.daysRemaining ?? 0 })}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {rt('app.billing.trialEndsRich', {
                          date: formatDate(overview.data.trial.endsAt),
                          tier: overview.data.planTier,
                          b: (c) => <strong>{c}</strong>,
                        })}
                      </p>
                    </>
                  ) : overview.data.trial.endsAt ? (
                    <p className="text-sm text-muted-foreground" data-testid="trial-state">
                      {t('app.billing.trialEnded', { date: formatDate(overview.data.trial.endsAt) })}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground" data-testid="trial-state">
                      {t('app.billing.noTrial')}
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="usage-heading">
                <h2 id="usage-heading" className="text-base font-semibold mb-4">
                  {t('app.billing.usageTitle')}
                </h2>
                <div className="grid gap-5 sm:grid-cols-2">
                  {overview.data.meters.map((m) => (
                    <UsageMeterRow key={m.key} meterKey={m.key} used={m.used} limit={m.limit} unlimited={m.unlimited} />
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  {t('app.billing.alsoMetered', {
                    executions: formatMeter('count', overview.data.metered.ENGINE_EXECUTION ?? 0),
                    uploads: formatMeter('count', overview.data.metered.ARTIFACT_UPLOAD ?? 0),
                    bytes: formatMeter('storageBytes', overview.data.metered.ARTIFACT_BYTES ?? 0),
                  })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground" data-testid="usage-connector-requests">
                  {t('app.platformHardening.usage.connectorRequests', {
                    count: formatMeter('count', overview.data.metered.CONNECTOR_REQUEST ?? 0),
                  })}
                </p>
              </section>
            </>
          ) : null}

          <section aria-labelledby="plans-heading">
            <h2 id="plans-heading" className="text-base font-semibold mb-3">
              {t('app.billing.plansTitle')}
            </h2>
            {catalog.isLoading ? (
              <div className="grid gap-4 md:grid-cols-3">
                <SkeletonBlock className="h-64" />
                <SkeletonBlock className="h-64" />
                <SkeletonBlock className="h-64" />
              </div>
            ) : catalog.isError ? (
              <ErrorState title={t('app.billing.plansFailed')} error={catalog.error} onRetry={() => catalog.refetch()} />
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
                <ErrorState title={t('app.billing.checkoutFailed')} error={checkout.error} />
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="invoices-heading">
            <h2 id="invoices-heading" className="text-base font-semibold mb-3 inline-flex items-center gap-2">
              <FileText className="size-4" aria-hidden="true" /> {t('app.billing.invoicesTitle')}
            </h2>
            {!providerConfigured ? (
              <p className="text-sm text-muted-foreground">{t('app.billing.invoicesUnavailable')}</p>
            ) : invoices.isLoading ? (
              <SkeletonBlock className="h-24" />
            ) : invoices.isError ? (
              <ErrorState title={t('app.billing.invoicesFailed')} error={invoices.error} onRetry={() => invoices.refetch()} />
            ) : invoices.data && invoices.data.invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('app.billing.noInvoices')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th scope="col" className="py-2 pr-3 font-medium">{t('app.billing.colInvoice')}</th>
                      <th scope="col" className="py-2 pr-3 font-medium">{t('app.billing.colDate')}</th>
                      <th scope="col" className="py-2 pr-3 font-medium">{t('app.billing.colStatus')}</th>
                      <th scope="col" className="py-2 pr-3 font-medium text-right">{t('app.billing.colAmount')}</th>
                      <th scope="col" className="py-2 font-medium">
                        <span className="sr-only">{t('app.billing.colLinks')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.data?.invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-border/60">
                        <td className="py-2 pr-3 font-mono text-xs">{inv.number ?? inv.id}</td>
                        <td className="py-2 pr-3">{formatDate(inv.createdAt)}</td>
                        <td className="py-2 pr-3">{label('app.billing.invoiceStatus', inv.status)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {fmt.currency(inv.amountDue / 100, inv.currency.toUpperCase())}
                        </td>
                        <td className="py-2">
                          {inv.hostedInvoiceUrl && (
                            <a
                              href={inv.hostedInvoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              {t('app.billing.view')} <ExternalLink className="size-3" aria-hidden="true" />
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
  const t = useT();
  const fmt = useFmt();
  const messages = useMessages();
  const formatMeter = useMeterFormat();
  const limitRows = ['projects', 'analysesPerMonth', 'storageBytes', 'exportsPerMonth', 'teamMembers'] as const;
  const tierSummary = (messages.pricing.tiers as Record<string, string>)[plan.tier] ?? plan.summary;
  return (
    <article
      className={`rounded-xl border bg-card p-5 flex flex-col gap-3 ${current ? 'border-primary ring-1 ring-primary/40' : 'border-border'}`}
      aria-label={current ? t('app.billing.planLabelCurrent', { name: plan.displayName }) : t('app.billing.planLabel', { name: plan.displayName })}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{plan.displayName}</h3>
          {current && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-xs font-semibold text-primary">
              <Check className="size-3.5" aria-hidden="true" /> {t('app.billing.current')}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">{tierSummary}</p>
      </div>
      <p className="text-2xl font-bold">
        {plan.monthlyPriceEur === null ? (
          t('app.billing.contactSales')
        ) : plan.monthlyPriceEur === 0 ? (
          t('app.billing.free')
        ) : (
          <>
            {fmt.number(plan.monthlyPriceEur, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
            <span className="text-sm font-normal text-muted-foreground"> {t('app.billing.perMonth')}</span>
          </>
        )}
      </p>
      <ul className="space-y-1 text-sm">
        {limitRows.map((key) => {
          const v = plan.limits[key];
          return (
            <li key={key} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t(`app.billing.limit.${key}`)}</span>
              <span className="tabular-nums">{v === -1 ? t('app.billing.unlimited') : formatMeter(key, v ?? 0)}</span>
            </li>
          );
        })}
        {(['agentGate', 'cloudAlmSync', 'reportBranding'] as const).map((key) => (
          <li key={key} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t(`app.billing.feature.${key}`)}</span>
            {plan.features[key] ? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3.5" aria-hidden="true" /> {t('app.billing.included')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Minus className="size-3.5" aria-hidden="true" /> {t('app.billing.notIncluded')}
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
            title={canCheckout ? undefined : t('app.billing.notConfiguredTitle')}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}
            {t('app.billing.choose', { name: plan.displayName })}
          </button>
        ) : plan.monthlyPriceEur === null ? (
          <Link
            href="/procurement"
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"
          >
            {t('app.billing.contactSales')}
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
