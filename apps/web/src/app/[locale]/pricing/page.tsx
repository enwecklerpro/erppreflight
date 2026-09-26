import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Minus } from 'lucide-react';
import { LOCALE_TAGS, type Locale } from '../../../i18n/config';
import { getMessages, getT, type TFunction } from '../../../i18n/translate';
import { getPublicPlans, type PublicPlan } from '../../../lib/plans';
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

function formatPrice(plan: PublicPlan, locale: Locale, t: TFunction): string {
  if (plan.priceEurMonthly === null) return t('common.contactSales');
  if (plan.priceEurMonthly === 0) return t('pricing.free');
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(plan.priceEurMonthly);
}

function formatLimit(value: number, locale: Locale, t: TFunction): string {
  return value < 0 ? t('pricing.unlimited') : new Intl.NumberFormat(LOCALE_TAGS[locale]).format(value);
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
  const plans = getPublicPlans();

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

      <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {plans.map((plan) => {
          const f = plan.features;
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
                {plan.priceEurMonthly !== null && plan.priceEurMonthly > 0 && (
                  <span className="text-sm text-muted-foreground"> {t('pricing.perMonth')}</span>
                )}
              </p>
              <dl className="mt-5 space-y-2 text-sm">
                {[
                  [t('pricing.projects'), formatLimit(plan.maxProjects, locale, t)],
                  [t('pricing.analyses'), formatLimit(plan.maxAnalysesPerMonth, locale, t)],
                  [t('pricing.loc'), formatLimit(plan.maxCustomCodeLoc, locale, t)],
                  [t('pricing.landscapes'), formatLimit(plan.maxLandscapes, locale, t)],
                  [t('pricing.retention'), t('pricing.days', { count: f.auditLogRetentionDays })],
                  [t('pricing.support'), t('pricing.hours', { count: f.slaHours })],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-border/60 pb-1.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-semibold text-right">{value}</dd>
                  </div>
                ))}
              </dl>
              <ul className="mt-4 space-y-1.5 text-sm flex-1">
                <Feature enabled={f.whatIfSimulationEnabled} label={t('pricing.whatIf')} t={t} />
                <Feature enabled={f.airGappedExport} label={t('pricing.airGapped')} t={t} />
                <Feature enabled={f.cloudAlmSync} label={t('pricing.cloudAlm')} t={t} />
                <Feature enabled={f.agentGateEnabled} label={t('pricing.agentGate')} t={t} />
              </ul>
              <Link
                href="/signup"
                className={`mt-6 inline-flex justify-center px-4 py-2 rounded-lg text-sm font-semibold ${
                  highlighted ? 'bg-primary text-white hover:bg-blue-600' : 'border border-border hover:bg-muted'
                }`}
              >
                {plan.priceEurMonthly === 0 ? t('pricing.startFree') : t('pricing.choose')}
                <span className="sr-only">: {plan.displayName}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-center text-xs text-muted-foreground">{t('pricing.catalogNote')}</p>
    </div>
  );
}
