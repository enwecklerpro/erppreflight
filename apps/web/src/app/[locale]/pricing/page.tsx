import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Minus, Info } from 'lucide-react';
import type { Locale } from '../../../i18n/config';
import { getFormat, getMessages, getT, type TFunction } from '../../../i18n/translate';
import { fetchPublicPlans, type PublicPlan } from '../../../lib/plans';
import { localizedUrl, publicPageMetadata } from '../../../lib/seo';
import { JsonLd, breadcrumbJsonLd } from '../../../components/public/json-ld';
import { resolveLocale, type LocaleParams } from '../locale-params';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  return publicPageMetadata({
    locale,
    path: '/pricing',
    title: t('pricing.metaTitle'),
    description: t('pricing.metaDescription'),
  });
}

const GiB = 1024 * 1024 * 1024;

function formatPrice(plan: PublicPlan, locale: Locale, t: TFunction): string {
  if (plan.monthlyPriceEur === null) return t('common.contactSales');
  if (plan.monthlyPriceEur === 0) return t('pricing.free');
  return getFormat(locale).number(plan.monthlyPriceEur, {
    style: 'currency',
    currency: plan.currency || 'EUR',
    maximumFractionDigits: 0,
  });
}

function formatLimit(value: number | undefined, locale: Locale, t: TFunction): string {
  if (value === undefined) return '—';
  return value < 0 ? t('pricing.unlimited') : getFormat(locale).number(value);
}

function formatStorage(bytes: number | undefined, locale: Locale, t: TFunction): string {
  if (bytes === undefined) return '—';
  if (bytes < 0) return t('pricing.unlimited');
  return t('pricing.gigabytes', { count: getFormat(locale).number(Math.round(bytes / GiB)) });
}

function Feature({ enabled, label, t }: { enabled: boolean; label: string; t: TFunction }) {
  return (
    <li className={`flex items-start gap-2 ${enabled ? '' : 'text-muted-foreground'}`}>
      {enabled ? (
        <Check className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
      ) : (
        <Minus className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
      )}
      <span>
        {label}
        <span className="sr-only"> — {enabled ? t('pricing.included') : t('pricing.notIncluded')}</span>
      </span>
    </li>
  );
}

export default async function PricingPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  const m = getMessages(locale);
  const { plans, source } = await fetchPublicPlans();

  return (
    <div className="space-y-10">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
          { name: t('pricing.title'), url: localizedUrl(locale, '/pricing') },
        ])}
      />
      <header className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{t('pricing.title')}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t('pricing.intro')}</p>
      </header>

      {source === 'catalog' && (
        <p role="status" className="mx-auto max-w-2xl flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          {t('pricing.pricesUnavailable')}
        </p>
      )}

      <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {plans.map((plan) => {
          const f = plan.features;
          const l = plan.limits;
          const highlighted = plan.tier === 'PROFESSIONAL';
          return (
            <li
              key={plan.tier}
              data-testid={`plan-${plan.tier}`}
              className={`rounded-xl border bg-card p-5 flex flex-col ${highlighted ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
            >
              <h2 className="font-bold text-foreground">{plan.displayName}</h2>
              <p className="mt-1 text-xs text-muted-foreground min-h-[2.5rem]">{m.pricing.tiers[plan.tier]}</p>
              <p className="mt-4">
                <span className="text-3xl font-extrabold">{formatPrice(plan, locale, t)}</span>
                {plan.monthlyPriceEur !== null && plan.monthlyPriceEur > 0 && (
                  <span className="text-sm text-muted-foreground"> {t('pricing.perMonth')}</span>
                )}
              </p>
              <dl className="mt-5 space-y-2 text-sm">
                {[
                  [t('pricing.projects'), formatLimit(l.projects, locale, t)],
                  [t('pricing.analyses'), formatLimit(l.analysesPerMonth, locale, t)],
                  [t('pricing.landscapes'), formatLimit(l.landscapes, locale, t)],
                  [t('pricing.teamMembers'), formatLimit(l.teamMembers, locale, t)],
                  [t('pricing.storage'), formatStorage(l.storageBytes, locale, t)],
                  [t('pricing.exports'), formatLimit(l.exportsPerMonth, locale, t)],
                  [t('pricing.retention'), t('pricing.days', { count: plan.retention.auditLogDays })],
                  [t('pricing.support'), t('pricing.hours', { count: plan.supportSlaHours })],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-border/60 pb-1.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-semibold text-right">{value}</dd>
                  </div>
                ))}
              </dl>
              <ul className="mt-4 space-y-1.5 text-sm flex-1">
                <Feature enabled={Boolean(f.whatIfSimulation)} label={t('pricing.whatIf')} t={t} />
                <Feature enabled={Boolean(f.airGappedExport)} label={t('pricing.airGapped')} t={t} />
                <Feature enabled={Boolean(f.cloudAlmSync)} label={t('pricing.cloudAlm')} t={t} />
                <Feature enabled={Boolean(f.agentGate)} label={t('pricing.agentGate')} t={t} />
                <Feature enabled={Boolean(f.reportBranding)} label={t('pricing.reportBranding')} t={t} />
              </ul>
              {plan.monthlyPriceEur === null ? (
                <Link
                  href={`/${locale}/legal/imprint`}
                  className="mt-6 inline-flex justify-center px-4 py-2 rounded-lg text-sm font-semibold border border-border hover:bg-muted"
                >
                  {t('common.contactSales')}
                  <span className="sr-only">: {plan.displayName}</span>
                </Link>
              ) : (
                <Link
                  href="/signup"
                  className={`mt-6 inline-flex justify-center px-4 py-2 rounded-lg text-sm font-semibold ${
                    highlighted ? 'bg-primary text-white hover:bg-blue-600' : 'border border-border hover:bg-muted'
                  }`}
                >
                  {plan.monthlyPriceEur === 0 ? t('pricing.startFree') : t('pricing.choose')}
                  <span className="sr-only">: {plan.displayName}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-center text-xs text-muted-foreground">{t('pricing.catalogNote')}</p>
    </div>
  );
}
